/**
 * Wiki-link plugin for the MDX editor.
 *
 * Typing [[label]] in the editor is auto-transformed into an inline
 * WikiLinkNode (a Lexical DecoratorNode). Clicking the rendered chip
 * navigates to the resolved vault page, or triggers creation if the page
 * doesn't exist yet.
 *
 * Cursor-adjacent expansion: when the user moves their cursor next to (or
 * onto) a wiki-link chip, it expands back into raw [[label]] text so it can
 * be edited. When the cursor moves away the text transform re-converts it.
 *
 * On serialization the chip exports back to plain [[label]] markdown.
 */

import {
  realmPlugin,
  addComposerChild$,
  addLexicalNode$,
  addExportVisitor$,
  addToMarkdownExtension$,
  type LexicalExportVisitor,
} from "@mdxeditor/editor";
import {
  $applyNodeReplacement,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  DecoratorNode,
  TextNode,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
} from "react";
import type * as Mdast from "mdast";
import type { VaultRefItem } from "./refPopoverPlugin";

// ── Context ───────────────────────────────────────────────────────────────────

export interface WikiLinkContextValue {
  items: VaultRefItem[];
  onNavigate?: (href: string) => void;
  onCreate?: (label: string) => void;
}

export const WikiLinkContext = createContext<WikiLinkContextValue>({
  items: [],
});

// ── Chip component ────────────────────────────────────────────────────────────

function WikiLinkChip({ label }: { label: string }) {
  const { items, onNavigate, onCreate } = useContext(WikiLinkContext);

  const q = label.toLowerCase().trim();
  let item: VaultRefItem | null = null;

  if (q.includes("/")) {
    const parts = q.split("/");
    const fileName = parts[parts.length - 1];
    const folderHint = parts.slice(0, -1).join("/");
    for (const it of items) {
      const name = it.label.replace(/\.md$/i, "").toLowerCase();
      const detail = (it.detail ?? "").toLowerCase();
      if (name === fileName && detail.includes(folderHint)) {
        item = it;
        break;
      }
    }
  }

  if (!item) {
    for (const it of items) {
      const name = it.label.replace(/\.md$/i, "").toLowerCase();
      if (name === q) {
        item = it;
        break;
      }
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (item?.href) {
      onNavigate?.(item.href);
    } else {
      onCreate?.(label);
    }
  };

  return (
    <button
      type="button"
      className={`nopal-wiki-chip${item ? "" : " nopal-wiki-chip--unresolved"}`}
      title={
        item
          ? `Open: ${item.label.replace(/\.md$/i, "")}`
          : `Create page: ${label}`
      }
      onMouseDown={(e) => e.stopPropagation()}
      onClick={handleClick}
      contentEditable={false}
    >
      <span className="nopal-wiki-chip-label">{label}</span>
      <span className="nopal-wiki-chip-arrow">{item ? "→" : "+"}</span>
    </button>
  );
}

// ── Lexical node ──────────────────────────────────────────────────────────────

export type SerializedWikiLinkNode = Spread<
  { label: string },
  SerializedLexicalNode
>;

export class WikiLinkNode extends DecoratorNode<ReactElement> {
  __label: string;

  static getType(): string {
    return "wiki-link";
  }

  static clone(node: WikiLinkNode): WikiLinkNode {
    return new WikiLinkNode(node.__label, node.__key);
  }

  static importJSON(serialized: SerializedWikiLinkNode): WikiLinkNode {
    return $createWikiLinkNode(serialized.label);
  }

  constructor(label: string, key?: NodeKey) {
    super(key);
    this.__label = label;
  }

  exportJSON(): SerializedWikiLinkNode {
    return { type: "wiki-link", version: 1, label: this.__label };
  }

  getLabel(): string {
    return this.__label;
  }

  getTextContent(): string {
    return `[[${this.__label}]]`;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "wiki-link-wrap";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  decorate(): ReactElement {
    return <WikiLinkChip label={this.__label} />;
  }
}

export function $createWikiLinkNode(label: string): WikiLinkNode {
  return $applyNodeReplacement(new WikiLinkNode(label));
}

export function $isWikiLinkNode(
  node: LexicalNode | null | undefined,
): node is WikiLinkNode {
  return node instanceof WikiLinkNode;
}

// ── Shared regex ──────────────────────────────────────────────────────────────

const WIKI_RE = /(?<![!\[])\[\[([^\[\]\n]+)\]\]/g;

// ── Text transform: [[label]] text → WikiLinkNode ─────────────────────────────
// Skips conversion when the cursor is inside the [[...]] span so the user
// can edit it. The expand plugin re-triggers this transform when the cursor
// moves out by dirtying the containing TextNode.

function WikiLinkTransformPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([WikiLinkNode])) return;

    return editor.registerNodeTransform(TextNode, (node) => {
      if (!node.isSimpleText()) return;
      const text = node.getTextContent();
      const nodeKey = node.getKey();

      WIKI_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKI_RE.exec(text)) !== null) {
        const label = match[1];
        const start = match.index;
        const end = start + match[0].length;

        // Leave as raw text while cursor is within (or touching) the span.
        const sel = $getSelection();
        if ($isRangeSelection(sel) && sel.isCollapsed()) {
          const { anchor } = sel;
          if (
            anchor.type === "text" &&
            anchor.key === nodeKey &&
            anchor.offset >= start &&
            anchor.offset <= end
          ) {
            continue;
          }
        }

        let target: TextNode;
        if (start === 0) {
          [target] = node.splitText(end);
        } else {
          [, target] = node.splitText(start, end);
        }
        target.replace($createWikiLinkNode(label));
        return;
      }
    });
  }, [editor]);

  return null;
}

// ── Expand plugin ─────────────────────────────────────────────────────────────
//
// Three cooperating handlers:
//
//   SELECTION_CHANGE_COMMAND
//     Step 1 — re-convert when cursor leaves the span (dirty paragraph;
//       transform re-runs and the cursor guard no longer blocks conversion).
//     Step 2 — refresh lastInsideRef (nodeKey + bounds) after every cursor
//       move, picking up post-merge keys and post-edit bound changes.
//     Step 3 — expand an adjacent WikiLinkNode chip into raw [[label]] text.
//
//   KEY_ARROW_RIGHT_COMMAND / KEY_ARROW_LEFT_COMMAND
//     Handle the two boundary cases that SELECTION_CHANGE misses:
//       a) Cursor is AT the end (Right) or start (Left) of [[...]]; the arrow
//          key may not move the cursor at all (e.g. end of document), so no
//          SELECTION_CHANGE fires and step 1 never triggers.
//       b) The cursor IS at the inclusive-end boundary (offset === end), so
//          step 1's guard says "still inside" even though the user is trying
//          to exit rightward.
//     Solution: directly perform the conversion inside editor.update() at
//     the boundary, bypassing the dirty→transform path entirely.
//     A `skipNextExpansion` flag prevents the new chip from immediately
//     re-expanding (the cursor lands adjacent to it right after conversion).

function WikiLinkExpandPlugin() {
  const [editor] = useLexicalComposerContext();

  // paragraphKey — stable key of the parent paragraph (never merged).
  // nodeKey      — key of the specific TextNode (may become stale after a
  //                Lexical merge; step 2 corrects it on the next SC).
  // start / end  — inclusive character bounds of the [[...]] match.
  const lastInsideRef = useRef<{
    paragraphKey: string;
    nodeKey: string;
    start: number;
    end: number;
  } | null>(null);

  // Set to true after a boundary-arrow conversion so that the chip that
  // just appeared doesn't immediately re-expand (cursor lands next to it).
  const skipNextExpansionRef = useRef(false);

  useEffect(() => {
    // ── Shared: directly convert the tracked [[...]] span ──────────────────
    // Used by the boundary arrow handlers instead of dirty→transform so we
    // can force conversion even when the cursor is still at offset === end.
    function convertTrackedSpan(
      paraKey: string,
      nodeKey: string,
      start: number,
      end: number,
    ) {
      editor.update(() => {
        // Try the specific TextNode first (fast path).
        const node = $getNodeByKey(nodeKey);
        if (node instanceof TextNode && node.isAttached()) {
          const text = node.getTextContent();
          WIKI_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = WIKI_RE.exec(text)) !== null) {
            if (m.index === start && m.index + m[0].length === end) {
              doSplit(node, m[1], m.index, m.index + m[0].length);
              return;
            }
          }
        }
        // Fallback: the TextNode was merged; scan the whole paragraph.
        const para = $getNodeByKey(paraKey);
        if (!$isElementNode(para)) return;
        for (const child of para.getChildren()) {
          if (!(child instanceof TextNode)) continue;
          const text = child.getTextContent();
          WIKI_RE.lastIndex = 0;
          const m2 = WIKI_RE.exec(text);
          if (m2) {
            doSplit(child, m2[1], m2.index, m2.index + m2[0].length);
            return;
          }
        }
      });
    }

    function doSplit(
      node: TextNode,
      label: string,
      matchStart: number,
      matchEnd: number,
    ) {
      let target: TextNode;
      if (matchStart === 0) {
        [target] = node.splitText(matchEnd);
      } else {
        [, target] = node.splitText(matchStart, matchEnd);
      }
      target.replace($createWikiLinkNode(label));
    }

    // ── KEY_ARROW_RIGHT: convert when cursor is at the closing ]] ──────────
    const unregRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      () => {
        if (!lastInsideRef.current) return false;
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
        const { anchor } = sel;
        const { nodeKey, end, paragraphKey, start } = lastInsideRef.current;
        // Fire when cursor is AT the end boundary — pressing Right here either
        // moves out of the TextNode (where step 1 would catch it) or does
        // nothing (end of document). Either way, the user intends to exit.
        if (
          anchor.type === "text" &&
          anchor.key === nodeKey &&
          anchor.offset === end
        ) {
          skipNextExpansionRef.current = true;
          lastInsideRef.current = null;
          convertTrackedSpan(paragraphKey, nodeKey, start, end);
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    // ── KEY_ARROW_LEFT: convert when cursor is at the opening [[ ───────────
    const unregLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      () => {
        if (!lastInsideRef.current) return false;
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
        const { anchor } = sel;
        const { nodeKey, start, paragraphKey, end } = lastInsideRef.current;
        if (
          anchor.type === "text" &&
          anchor.key === nodeKey &&
          anchor.offset === start
        ) {
          skipNextExpansionRef.current = true;
          lastInsideRef.current = null;
          convertTrackedSpan(paragraphKey, nodeKey, start, end);
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    // ── SELECTION_CHANGE: steps 1-3 ────────────────────────────────────────
    const unregSC = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();

        // ── Step 1: re-convert if cursor left the tracked span ──────────────
        if (lastInsideRef.current) {
          const { paragraphKey, nodeKey, start, end } = lastInsideRef.current;
          let stillInside = false;

          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const { anchor } = selection;
            if (
              anchor.type === "text" &&
              anchor.key === nodeKey &&
              anchor.offset >= start &&
              anchor.offset <= end
            ) {
              stillInside = true;
            }
          }

          if (!stillInside) {
            lastInsideRef.current = null;
            // Skip the next expansion pass so the chip we're about to
            // re-create doesn't immediately re-expand (same guard used by
            // the boundary-arrow handlers).
            skipNextExpansionRef.current = true;
            // Directly convert [[...]] back to a WikiLinkNode instead of
            // trying to dirty the TextNode via setTextContent(t).
            // Lexical short-circuits setTextContent when t === __text,
            // so the text-node transform never fires and the chip stays
            // as raw text indefinitely.
            convertTrackedSpan(paragraphKey, nodeKey, start, end);
            // Fall through — cursor might be adjacent to a different WikiLinkNode.
          }
        }

        // ── Step 2: refresh lastInsideRef ───────────────────────────────────
        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const { anchor } = selection;
          if (anchor.type === "text") {
            const anchorNode = anchor.getNode();
            if (anchorNode instanceof TextNode) {
              const text = anchorNode.getTextContent();
              const parent = anchorNode.getParent();
              WIKI_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = WIKI_RE.exec(text)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (anchor.offset >= start && anchor.offset <= end) {
                  lastInsideRef.current = {
                    paragraphKey: $isElementNode(parent)
                      ? parent.getKey()
                      : anchor.key,
                    nodeKey: anchor.key,
                    start,
                    end,
                  };
                  return false; // cursor inside [[...]] — nothing to expand
                }
              }
            }
          }
        }

        // ── Step 3: expand adjacent WikiLinkNode ────────────────────────────
        // Skip one expansion cycle after a boundary-arrow re-conversion so
        // the chip that just appeared doesn't immediately expand again.
        if (skipNextExpansionRef.current) {
          skipNextExpansionRef.current = false;
          return false;
        }

        let wikiNode: WikiLinkNode | null = null;
        // Cursor placement after expansion:
        //   false → end of [[label]]  (approached from right; Right-arrow exits)
        //   true  → start of [[label]] (approached from left;  Left-arrow exits)
        let placeAtStart = false;

        if ($isNodeSelection(selection)) {
          for (const node of selection.getNodes()) {
            if ($isWikiLinkNode(node)) {
              wikiNode = node;
              break;
            }
          }
        } else if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const { anchor } = selection;
          const anchorNode = anchor.getNode();

          if ($isWikiLinkNode(anchorNode)) {
            wikiNode = anchorNode;
          } else if (anchor.type === "element" && $isElementNode(anchorNode)) {
            const children = anchorNode.getChildren();
            const before =
              anchor.offset > 0 ? (children[anchor.offset - 1] ?? null) : null;
            const after = children[anchor.offset] ?? null;
            if ($isWikiLinkNode(before)) {
              wikiNode = before; // chip is left-of-cursor → approached from right
            } else if ($isWikiLinkNode(after)) {
              wikiNode = after; // chip is right-of-cursor → approached from left
              placeAtStart = true;
            }
          } else if (anchor.type === "text") {
            const textLen = anchorNode.getTextContent().length;
            if (anchor.offset === 0) {
              const prev = anchorNode.getPreviousSibling();
              if ($isWikiLinkNode(prev)) {
                wikiNode = prev; // cursor at start of right-neighbor → approached from right
              }
            } else if (anchor.offset === textLen) {
              const next = anchorNode.getNextSibling();
              if ($isWikiLinkNode(next)) {
                wikiNode = next; // cursor at end of left-neighbor → approached from left
                placeAtStart = true;
              }
            }
          }
        }

        if (!wikiNode) return false;

        const capturedNode = wikiNode;
        const label = capturedNode.getLabel();
        const rawText = `[[${label}]]`;

        editor.update(() => {
          const textNode = $createTextNode(rawText);
          capturedNode.replace(textNode);
          // Place cursor at the boundary the user approached from so that
          // pressing the reverse arrow immediately hits the key-command handler
          // and re-converts without traversing the full text.
          // Place cursor inside the brackets, next to the label text.
          const pos = placeAtStart ? 2 : rawText.length - 2;
          textNode.select(pos, pos);
        });

        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregRight();
      unregLeft();
      unregSC();
    };
  }, [editor]);

  return null;
}

// ── Markdown export ───────────────────────────────────────────────────────────

const WikiLinkVisitor: LexicalExportVisitor<WikiLinkNode, Mdast.Nodes> = {
  testLexicalNode: $isWikiLinkNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: "wikiLink",
      label: lexicalNode.getLabel(),
    } as unknown as Mdast.PhrasingContent);
  },
};

// ── Plugin ────────────────────────────────────────────────────────────────────

export const wikiLinkPlugin = realmPlugin({
  init(realm) {
    realm.pub(addLexicalNode$, WikiLinkNode);
    realm.pub(addExportVisitor$, WikiLinkVisitor);
    realm.pub(addToMarkdownExtension$, {
      handlers: {
        wikiLink: (node: { label: string }) => `[[${node.label}]]`,
      },
    } as any);
    realm.pub(addComposerChild$, WikiLinkTransformPlugin);
    realm.pub(addComposerChild$, WikiLinkExpandPlugin);
  },
});
