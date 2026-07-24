/**
 * A minimal `/` slash-command menu — per the oxmarkdown skill, "an editing
 * affordance, not a saved syntax": typing `/` never ends up IN the saved
 * markdown, it only ever triggers inserting a real block (a heading, a
 * list, a directive, ...), the same as if it had been typed by hand.
 *
 * Deliberately small command set for this landing (headings, the three
 * list types, a divider, one example directive) — proves the mechanism
 * end-to-end; growing the list later is just adding entries to
 * `COMMANDS`, not new plumbing.
 *
 * Scope note: only triggers at the START of an otherwise-empty text node
 * (i.e. typing `/` as the first character of a block). Mid-text `/` (an
 * emoji-picker-style trigger anywhere) is out of scope for this pass.
 *
 * Escape/Enter are handled as real Lexical commands (`KEY_ESCAPE_COMMAND`/
 * `KEY_ENTER_COMMAND`), not as a DOM `onKeyDown` on the floating menu —
 * the menu is a portal the user never focuses (focus stays in the
 * contentEditable the whole time), so a DOM listener on it would never
 * fire for the keystrokes that matter.
 *
 * Positioning/portal/directionality/max-height/mobile-sheet-layout are all
 * delegated to `OxPopover` (`oxmarkdown/OxPopover.tsx`) rather than a
 * hand-rolled `rect.bottom + 4` calculation — the old version of this file
 * computed the anchor rect once per Lexical update and never recomputed it
 * on scroll, so the menu visibly stayed pinned to the window while the
 * editor content (and the `/` trigger it's supposed to sit next to)
 * scrolled away underneath it. `OxPopover`'s `anchorEl`-based `autoUpdate`
 * fixes that for free. Escape is still handled as a real Lexical command
 * (see above) rather than `OxPopover`'s own built-in Escape/outside-press
 * dismissal, specifically so it can also record `dismissed` (don't
 * reopen for the SAME `/query` until it changes) — `OxPopover`'s
 * `onDismiss` is still wired up too, for outside-press (clicking away)
 * and, on mobile, the sheet's backdrop.
 */

import { useEffect, useRef, useState } from "react";
import OxPopover from "./OxPopover";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type ElementNode,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { $createHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $insertList } from "@lexical/list";
import { $getNearestOxListItemNode } from "./OxListItemNode";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createOxDirectiveNode } from "./editingNodes";

function getTopLevelBlock(node: LexicalNode): ElementNode | null {
  let current: LexicalNode | null = node;
  for (;;) {
    const parent: LexicalNode | null = current?.getParent() ?? null;
    if (!parent) return null;
    if ($isRootOrShadowRoot(parent)) {
      return $isElementNode(current) ? current : null;
    }
    current = parent;
  }
}

interface SlashCommand {
  label: string;
  keywords: string[];
  run: (textNodeKey: string) => void;
}

/** Clears the trigger text node (removing the `/query`) and leaves the
 * selection collapsed there, then runs a block-transform utility
 * (`$setBlocksType`/`$insertList`) against that now-empty selection. */
function runOnClearedNode(textNodeKey: string, apply: (selection: RangeSelection) => void) {
  const textNode = $getNodeByKey(textNodeKey);
  if (!$isTextNode(textNode)) return;
  textNode.setTextContent("");
  const selection = $createRangeSelection();
  selection.anchor.set(textNode.getKey(), 0, "text");
  selection.focus.set(textNode.getKey(), 0, "text");
  $setSelection(selection);
  apply(selection);
}

/** Same clearing step, but hands the whole top-level block to `apply` —
 * for commands that insert a sibling block rather than retyping this one.
 * `apply` returns the node it inserted; a fresh paragraph is added right
 * after THAT (not the original trigger block) and selected, so the user
 * can keep typing in a natural spot below the new block. Found by testing:
 * without this, the trigger's now-empty paragraph doesn't reliably get
 * removed (Lexical keeps at least one paragraph around), leaving the
 * caret dangling in a blank line ABOVE the inserted block instead of a
 * continuation below it. */
function runOnBlock(textNodeKey: string, apply: (block: ElementNode) => LexicalNode) {
  const textNode = $getNodeByKey(textNodeKey);
  if (!$isTextNode(textNode)) return;
  const block = getTopLevelBlock(textNode);
  if (!block) return;
  textNode.setTextContent("");
  const inserted = apply(block);
  const following = $createParagraphNode();
  inserted.insertAfter(following);
  following.select();
  if (block.getTextContent() === "") block.remove();
}

const COMMANDS: SlashCommand[] = [
  { label: "Heading 1", keywords: ["h1", "heading1", "heading"], run: (key) => runOnClearedNode(key, (sel) => $setBlocksType(sel, () => $createHeadingNode("h1"))) },
  { label: "Heading 2", keywords: ["h2", "heading2", "heading"], run: (key) => runOnClearedNode(key, (sel) => $setBlocksType(sel, () => $createHeadingNode("h2"))) },
  { label: "Heading 3", keywords: ["h3", "heading3", "heading"], run: (key) => runOnClearedNode(key, (sel) => $setBlocksType(sel, () => $createHeadingNode("h3"))) },
  { label: "Bulleted list", keywords: ["bullet", "ul", "list"], run: (key) => runOnClearedNode(key, () => $insertList("bullet")) },
  { label: "Numbered list", keywords: ["number", "ol", "ordered", "list"], run: (key) => runOnClearedNode(key, () => $insertList("number")) },
  {
    label: "Task list",
    keywords: ["task", "todo", "check", "checkbox"],
    run: (key) =>
      runOnClearedNode(key, (sel) => {
        // Always a plain "bullet" list, never "check" — see
        // `OxListItemNode.ts`'s header. Whether the item that ends up
        // holding the selection has a checkbox is OUR OWN field, set
        // explicitly right after `$insertList` creates it.
        $insertList("bullet");
        const listItem = $getNearestOxListItemNode(sel.anchor.getNode());
        listItem?.setChecked(false);
      }),
  },
  {
    label: "Divider",
    keywords: ["divider", "hr", "rule", "separator"],
    run: (key) =>
      runOnBlock(key, (block) => {
        const hr = $createHorizontalRuleNode();
        block.insertAfter(hr);
        return hr;
      }),
  },
  {
    label: "Note",
    keywords: ["note", "directive", "callout"],
    run: (key) =>
      runOnBlock(key, (block) => {
        const directive = $createOxDirectiveNode({
          type: "leafDirective",
          name: "note",
          attributes: { title: "" },
          children: [],
        });
        block.insertAfter(directive);
        return directive;
      }),
  },
];

interface SlashMenuState {
  query: string;
  anchorKey: string;
  anchorEl: HTMLElement;
}

export default function SlashCommandPlugin(): React.ReactElement | null {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const menuRef = useRef<SlashMenuState | null>(null);
  menuRef.current = menu;

  function matchesFor(state: SlashMenuState): SlashCommand[] {
    const q = state.query.toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.keywords.some((k) => k.includes(q)) || c.label.toLowerCase().includes(q),
    );
  }

  function runCommand(state: SlashMenuState, command: SlashCommand) {
    editor.update(() => command.run(state.anchorKey));
    setMenu(null);
  }

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setMenu(null);
          return;
        }
        const anchor = selection.anchor;
        if (anchor.type !== "text") {
          setMenu(null);
          return;
        }
        const textNode = anchor.getNode();
        const text = textNode.getTextContent();
        const isFirstChild = textNode.getParent()?.getFirstChild() === textNode;
        if (!isFirstChild || !text.startsWith("/") || anchor.offset < 1) {
          setMenu(null);
          return;
        }
        const query = text.slice(1, anchor.offset);
        const dismissKey = `${textNode.getKey()}:${text}`;
        if (/\s/.test(query) || dismissed === dismissKey) {
          setMenu(null);
          return;
        }
        const dom = editor.getElementByKey(textNode.getKey());
        if (!dom) {
          setMenu(null);
          return;
        }
        setMenu({ query, anchorKey: textNode.getKey(), anchorEl: dom });
      });
    });

    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        const state = menuRef.current;
        if (!state) return false;
        setDismissed(`${state.anchorKey}:/${state.query}`);
        setMenu(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const state = menuRef.current;
        if (!state) return false;
        const first = matchesFor(state)[0];
        if (!first) return false;
        event?.preventDefault();
        runCommand(state, first);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterUpdate();
      unregisterEscape();
      unregisterEnter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, dismissed]);

  const matches = menu ? matchesFor(menu) : [];

  return (
    <OxPopover
      anchorEl={menu?.anchorEl ?? null}
      open={menu != null}
      className="ox-slash-menu"
      onDismiss={() => {
        const state = menuRef.current;
        if (state) setDismissed(`${state.anchorKey}:/${state.query}`);
        setMenu(null);
      }}
    >
      {matches.length === 0 ? (
        <div className="ox-popover-field">
          <span>No matches</span>
        </div>
      ) : (
        matches.map((c) => (
          <button
            key={c.label}
            type="button"
            className="ox-slash-menu-item"
            // mousedown, not click — fires before the contentEditable would
            // otherwise blur and collapse the selection this depends on.
            onMouseDown={(e) => {
              e.preventDefault();
              if (menu) runCommand(menu, c);
            }}
          >
            {c.label}
          </button>
        ))
      )}
    </OxPopover>
  );
}
