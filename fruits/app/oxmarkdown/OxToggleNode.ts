/**
 * A Notion-style Toggle List — a title line + collapsible block content
 * underneath. Triggered by typing `> ` at the start of a line (see
 * `OX_TOGGLE_TRANSFORMER` in `OxEditor.tsx`; `"` was moved to that spot for
 * blockquotes instead — see `OX_QUOTE_TRANSFORMER`, same file).
 *
 * Saved as a container directive: `:::toggle{collapsed="true"}` (the
 * `collapsed` attribute is omitted entirely when false/expanded, keeping
 * the common case's markdown clean) wrapping the title as its OWN first
 * child, then the body as everything after it — deliberately NOT a
 * `title="..."` attribute string: an attribute can only ever hold plain
 * text, and a title should support the exact same inline markdown (bold,
 * links, ...) any other line of prose does. No new markdown punctuation,
 * no lossy round-trip for a formatted title:
 *
 *   :::toggle
 *   Release: **Sunny**
 *
 *   - fence-line.jpg file put in [./gallery/fence-line.jpg](...)
 *   :::
 *
 * Architecturally this is a REAL container, not a decorator/directive
 * pill like `::file`/`::card` — `OxToggleNode` extends `ElementNode` the
 * same way `@lexical/rich-text`'s `QuoteNode` does (see
 * `editingTransforms.ts`'s `blockquote` case, which already proves a
 * multi-paragraph, genuinely nested, natively-editable block container
 * works fine in this editor). This sidesteps the OxDirectiveNode/decorator
 * system's own known limitation entirely ("a container directive's nested
 * content isn't independently editable yet") for this ONE proven, real
 * need — mirroring how checklists got their own dedicated
 * `OxListItemNode` instead of a generic fix to `@lexical/list`.
 *
 * Children are always `[OxToggleSummaryNode, ...body block nodes]` — the
 * summary is always exactly the first child, always present (even if
 * empty), same "always a real clickable row" invariant `MinRowsPlugin`/
 * `LeadingBlockGuardPlugin` already use elsewhere.
 */

import {
  $applyNodeReplacement,
  $createParagraphNode,
  $isParagraphNode,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export type SerializedOxToggleNode = Spread<{ collapsed: boolean }, SerializedElementNode>;

export class OxToggleNode extends ElementNode {
  __collapsed: boolean;

  constructor(collapsed = false, key?: NodeKey) {
    super(key);
    this.__collapsed = collapsed;
  }

  static getType(): string {
    return "ox-toggle";
  }

  static clone(node: OxToggleNode): OxToggleNode {
    return new OxToggleNode(node.__collapsed, node.__key);
  }

  static importJSON(serializedNode: SerializedOxToggleNode): OxToggleNode {
    return $createOxToggleNode(serializedNode.collapsed).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedOxToggleNode {
    return { ...super.exportJSON(), type: "ox-toggle", collapsed: this.getCollapsed() };
  }

  getCollapsed(): boolean {
    return this.getLatest().__collapsed;
  }

  setCollapsed(collapsed: boolean): this {
    const self = this.getWritable();
    self.__collapsed = collapsed;
    return self;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.classList.add("ox-toggle");
    dom.classList.toggle("ox-toggle--collapsed", this.__collapsed);
    return dom;
  }

  updateDOM(_prevNode: this, dom: HTMLElement, _config: EditorConfig): boolean {
    dom.classList.toggle("ox-toggle--collapsed", this.__collapsed);
    return false;
  }
}

export function $createOxToggleNode(collapsed = false): OxToggleNode {
  return $applyNodeReplacement(new OxToggleNode(collapsed));
}

export function $isOxToggleNode(node: LexicalNode | null | undefined): node is OxToggleNode {
  return node instanceof OxToggleNode;
}

/** The toggle's title line — always exactly `OxToggleNode`'s first child.
 * A thin `ElementNode` (holds ordinary inline content, same as a
 * paragraph) rather than a plain `ParagraphNode` only so rendering/CSS
 * and keyboard behavior can target it specifically. */
export class OxToggleSummaryNode extends ElementNode {
  static getType(): string {
    return "ox-toggle-summary";
  }

  static clone(node: OxToggleSummaryNode): OxToggleSummaryNode {
    return new OxToggleSummaryNode(node.__key);
  }

  static importJSON(serializedNode: SerializedElementNode): OxToggleSummaryNode {
    return $createOxToggleSummaryNode().updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: "ox-toggle-summary" };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.classList.add("ox-toggle-summary");
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  /** Enter on the title line moves into the body — REUSING the toggle's
   * own already-there empty body paragraph (from construction, or a
   * prior escape back out) rather than creating a redundant second one
   * right next to it, which is a REAL bug this fixes, confirmed directly
   * by testing: every toggle already starts with exactly one empty body
   * paragraph (see `toggleTransformer.ts`/`convertToggle`'s own "always a
   * real clickable row" invariant), so unconditionally inserting another
   * one here left TWO empty paragraphs sitting side by side — which then
   * broke the double-Enter escape gesture (`OxTogglePlugin.tsx`) further
   * down: escaping requires the current empty paragraph to be the LAST
   * child, and it no longer was, with a second, indistinguishable empty
   * paragraph still sitting after it forever. Only falls back to
   * creating a genuinely NEW paragraph when the next sibling either
   * doesn't exist (shouldn't normally happen) or already has real
   * content (Enter fired mid-title with a non-empty first body line
   * already there) — that narrower case can still mis-place split-off
   * trailing title text at the END of existing body content rather than
   * ahead of it, a real but much rarer edge left as a known limitation
   * rather than solved here. */
  insertNewAfter(_selection: RangeSelection | null, restoreSelection = true): LexicalNode {
    const existingNext = this.getNextSibling();
    if ($isParagraphNode(existingNext) && existingNext.getChildrenSize() === 0) {
      if (restoreSelection) existingNext.selectStart();
      return existingNext;
    }
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }
}

export function $createOxToggleSummaryNode(): OxToggleSummaryNode {
  return $applyNodeReplacement(new OxToggleSummaryNode());
}

export function $isOxToggleSummaryNode(
  node: LexicalNode | null | undefined,
): node is OxToggleSummaryNode {
  return node instanceof OxToggleSummaryNode;
}

/** Walks up from any node to the nearest `OxToggleNode` ancestor (or
 * itself), if any — used by click handlers that only have a DOM target or
 * a plain selection anchor to start from (mirrors
 * `OxListItemNode.ts`'s `$getNearestOxListItemNode`). */
export function $getNearestOxToggleNode(node: LexicalNode | null): OxToggleNode | null {
  let current: LexicalNode | null = node;
  while (current !== null) {
    if ($isOxToggleNode(current)) return current;
    current = current.getParent();
  }
  return null;
}
