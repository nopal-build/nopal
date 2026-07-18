/**
 * Custom Lexical nodes for OxEditor's Editing mode (build plan step 4).
 *
 * Two node classes cover everything the mdast <-> Lexical bridge
 * (`editingTransforms.ts`) can't represent as native Lexical rich-text:
 *
 *   - `OxDirectiveNode` — our `:name`/`::name`/`:::name{attrs}` syntax.
 *     Always atomic: attrs are editable (via the same popover Interacting
 *     mode uses), but a container directive's nested content is NOT
 *     independently editable yet — it renders read-only via `OxStaticNodes`.
 *     See the oxmarkdown skill's Editing-mode TODOs for why this is a
 *     deliberate, documented scope line, not an oversight.
 *   - `OxOpaqueNode` — a lossless passthrough for any mdast node this
 *     bridge doesn't have a real Lexical mapping for (tables, raw HTML,
 *     footnotes, anything future). Stores the raw mdast node verbatim and
 *     re-emits it unchanged on export — the whole point is that opening a
 *     document with a table in Editing mode can never silently drop it,
 *     even though there's no rich table-editing UI yet. Falls back to
 *     `OxStaticNodes` (the same static renderer `OxRenderer` uses) so it's
 *     still visible, not blank.
 *
 * Both implement `getRevertText()` — a small duck-typed contract (see
 * `isRevertibleOxNode` below) that `InteractablesPlugin` uses generically,
 * so a future interactable (an `@mention` node) gets Backspace-revert /
 * Delete-remove for free just by implementing the same method, no new
 * plugin code required.
 */

import { createElement, Fragment, useContext, useEffect, useMemo, type ReactElement } from "react";
import {
  DecoratorNode,
  $getNodeByKey,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import type { RootContent } from "mdast";
import {
  directiveAttrs,
  serializeOxDocument,
  type DirectiveNode as OxMdastDirectiveNode,
} from "./document";
import type { OxInteractive } from "./interactive";
import {
  DirectiveRegistryContext,
  InteractiveDirective,
  OxStaticNodes,
} from "../components/OxRenderer";

/** Any Lexical node that can be reverted to its raw markdown text on a
 * second Backspace. Duck-typed on purpose — see this file's header. */
export interface OxRevertibleDecorator {
  getRevertText(): string;
}

export function isRevertibleOxNode(
  node: LexicalNode | null | undefined,
): node is LexicalNode & OxRevertibleDecorator {
  return !!node && typeof (node as unknown as OxRevertibleDecorator).getRevertText === "function";
}

/** Shared by every decorator's own click handling below (`OxDirectiveNode`
 * and `OxOpaqueNode` today). A plain React `onClick` fires independently of
 * Lexical's OWN click-driven selection sync, which runs right after and
 * silently overwrites whatever NodeSelection `onClick` just set (verified
 * directly: `isSelected` flips true, then false again a beat later, no
 * focus/blur involved). `CLICK_COMMAND` is dispatched by Lexical's OWN root
 * click handler as part of that same pipeline — returning `true` here tells
 * it this click was already handled, which actually suppresses the default
 * sync, unlike a bare DOM listener racing against it. (Originally fixed only
 * on `OxDirectiveNode` and missed on `OxOpaqueNode` — hence pulling it out
 * here, so a third decorator can't repeat the same miss.) */
function useSelectDecoratorOnClick(nodeKey: NodeKey, setSelected: (selected: boolean) => void): void {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        const dom = editor.getElementByKey(nodeKey);
        const target = event.target as Node | null;
        if (dom && target && (target === dom || dom.contains(target))) {
          setSelected(true);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, nodeKey, setSelected]);
}

// ── OxDirectiveNode ─────────────────────────────────────────────────────────

export type SerializedOxDirectiveNode = Spread<
  { mdastNode: OxMdastDirectiveNode },
  SerializedLexicalNode
>;

export class OxDirectiveNode extends DecoratorNode<ReactElement> {
  __mdastNode: OxMdastDirectiveNode;

  static getType(): string {
    return "ox-directive";
  }
  static clone(node: OxDirectiveNode): OxDirectiveNode {
    return new OxDirectiveNode(node.__mdastNode, node.__key);
  }
  constructor(mdastNode: OxMdastDirectiveNode, key?: NodeKey) {
    super(key);
    this.__mdastNode = mdastNode;
  }

  isInline(): boolean {
    return this.__mdastNode.type === "textDirective";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement(this.isInline() ? "span" : "div");
  }
  updateDOM(): false {
    return false;
  }

  getMdastNode(): OxMdastDirectiveNode {
    return this.__mdastNode;
  }

  /** Commits an attribute edit from the popover — see `InteractiveDirective`. */
  setAttribute(key: string, value: string): void {
    const writable = this.getWritable();
    writable.__mdastNode = {
      ...writable.__mdastNode,
      attributes: { ...(writable.__mdastNode.attributes ?? {}), [key]: value },
    } as OxMdastDirectiveNode;
  }

  /** Duck-typed by `InteractablesPlugin` — see `OxRevertibleDecorator`. */
  getRevertText(): string {
    return serializeOxDocument({ type: "root", children: [this.__mdastNode] }).trimEnd();
  }

  decorate(): ReactElement {
    return createElement(OxDirectiveDecorator, {
      nodeKey: this.getKey(),
      mdastNode: this.__mdastNode,
    });
  }

  exportJSON(): SerializedOxDirectiveNode {
    return { type: "ox-directive", version: 1, mdastNode: this.__mdastNode };
  }
  static importJSON(serialized: SerializedOxDirectiveNode): OxDirectiveNode {
    return new OxDirectiveNode(serialized.mdastNode);
  }
}

export function $createOxDirectiveNode(mdastNode: OxMdastDirectiveNode): OxDirectiveNode {
  return new OxDirectiveNode(mdastNode);
}
export function $isOxDirectiveNode(
  node: LexicalNode | null | undefined,
): node is OxDirectiveNode {
  return node instanceof OxDirectiveNode;
}

/** `decorate()` always runs against the latest node version, so `mdastNode`
 * arrives fresh on every reconciled update (an attribute edit calls
 * `setAttribute`, which replaces `__mdastNode` on the writable node — see
 * above) — no need to re-read editor state inside this component. */
function OxDirectiveDecorator({
  nodeKey,
  mdastNode,
}: {
  nodeKey: string;
  mdastNode: OxMdastDirectiveNode;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected] = useLexicalNodeSelection(nodeKey);
  const directives = useContext(DirectiveRegistryContext);
  useSelectDecoratorOnClick(nodeKey, setSelected);

  const attrs = directiveAttrs(mdastNode);
  const renderer = directives?.[mdastNode.name];
  const content = renderer ? (
    renderer({
      attrs,
      label: null,
      children:
        mdastNode.type === "containerDirective" ? (
          <OxStaticNodes nodes={mdastNode.children} directives={directives} />
        ) : undefined,
    })
  ) : mdastNode.type === "textDirective" ? (
    <span className="ox-directive-unknown">:{mdastNode.name}</span>
  ) : (
    <div className="ox-directive-unknown ox-directive-unknown--block">
      Unknown block: ::{mdastNode.name}
    </div>
  );

  const interactive: OxInteractive = useMemo(
    () => ({
      isSelected: () => isSelected,
      select: (n) => setSelected(n != null),
      toggleTask: () => {},
      editDirectiveAttr: (_node, key, value) => {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isOxDirectiveNode(node)) node.setAttribute(key, value);
        });
      },
    }),
    [editor, nodeKey, isSelected, setSelected],
  );

  return (
    <InteractiveDirective node={mdastNode} attrs={attrs} interactive={interactive}>
      {content}
    </InteractiveDirective>
  );
}

// ── OxOpaqueNode ─────────────────────────────────────────────────────────
// Lossless passthrough for anything the mdast<->Lexical bridge doesn't map
// to real Lexical nodes yet (tables, raw HTML, footnotes, ...). See this
// file's header for why this exists at all: it's the difference between
// "no rich UI for this yet" and "silently deletes your table."

export type SerializedOxOpaqueNode = Spread<
  { mdastNode: RootContent; kind: "block" | "inline" },
  SerializedLexicalNode
>;

export class OxOpaqueNode extends DecoratorNode<ReactElement> {
  __mdastNode: RootContent;
  __kind: "block" | "inline";

  static getType(): string {
    return "ox-opaque";
  }
  static clone(node: OxOpaqueNode): OxOpaqueNode {
    return new OxOpaqueNode(node.__mdastNode, node.__kind, node.__key);
  }
  constructor(mdastNode: RootContent, kind: "block" | "inline", key?: NodeKey) {
    super(key);
    this.__mdastNode = mdastNode;
    this.__kind = kind;
  }

  isInline(): boolean {
    return this.__kind === "inline";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement(this.__kind === "inline" ? "span" : "div");
    el.contentEditable = "false";
    return el;
  }
  updateDOM(): false {
    return false;
  }

  getMdastNode(): RootContent {
    return this.__mdastNode;
  }

  getRevertText(): string {
    return serializeOxDocument({ type: "root", children: [this.__mdastNode] }).trimEnd();
  }

  decorate(): ReactElement {
    return createElement(OxOpaqueDecorator, {
      nodeKey: this.getKey(),
      mdastNode: this.__mdastNode,
      block: this.__kind === "block",
    });
  }

  exportJSON(): SerializedOxOpaqueNode {
    return { type: "ox-opaque", version: 1, mdastNode: this.__mdastNode, kind: this.__kind };
  }
  static importJSON(serialized: SerializedOxOpaqueNode): OxOpaqueNode {
    return new OxOpaqueNode(serialized.mdastNode, serialized.kind);
  }
}

export function $createOxOpaqueNode(
  mdastNode: RootContent,
  kind: "block" | "inline",
): OxOpaqueNode {
  return new OxOpaqueNode(mdastNode, kind);
}
export function $isOxOpaqueNode(node: LexicalNode | null | undefined): node is OxOpaqueNode {
  return node instanceof OxOpaqueNode;
}

function OxOpaqueDecorator({
  nodeKey,
  mdastNode,
  block,
}: {
  nodeKey: string;
  mdastNode: RootContent;
  block: boolean;
}) {
  const [isSelected, setSelected] = useLexicalNodeSelection(nodeKey);
  useSelectDecoratorOnClick(nodeKey, setSelected);
  return (
    <span
      className={`ox-opaque${block ? " ox-opaque--block" : ""}${isSelected ? " ox-selected" : ""}`}
      title={`Not yet editable here — raw: ${mdastNode.type}`}
    >
      <OxStaticNodes nodes={[mdastNode]} />
    </span>
  );
}

// ── OxBlankLinesNode ──────────────────────────────────────────
// Represents "N extra blank lines were here" as ONE atomic unit —
// deliberately NOT as N empty `ParagraphNode`s. A real Lexical element
// always gets its own default blank-line join on EACH side when exported,
// so a single empty paragraph between two real blocks serializes to 3
// blank lines, not 1 (confirmed directly) — representing a gap as a
// discrete node it always inherits that overhead, twice. This node instead
// carries the count as plain data and is consumed specially by
// `exportOxDocument` (`editingTransforms.ts`), which never emits it as a
// real mdast node — it turns the count into a custom `join` passed to
// `serializeOxDocument`, `mdast-util-to-markdown`'s own real mechanism for
// controlling exactly how many blank lines separate two specific siblings.

export type SerializedOxBlankLinesNode = Spread<{ count: number }, SerializedLexicalNode>;

export class OxBlankLinesNode extends DecoratorNode<ReactElement> {
  __count: number;

  static getType(): string {
    return "ox-blank-lines";
  }
  static clone(node: OxBlankLinesNode): OxBlankLinesNode {
    return new OxBlankLinesNode(node.__count, node.__key);
  }
  constructor(count: number, key?: NodeKey) {
    super(key);
    this.__count = count;
  }

  isInline(): boolean {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement("div");
    el.contentEditable = "false";
    return el;
  }
  updateDOM(): false {
    return false;
  }

  getCount(): number {
    return this.__count;
  }

  decorate(): ReactElement {
    return createElement(
      Fragment,
      null,
      ...Array.from({ length: this.__count }, (_unused, i) =>
        createElement("div", { key: i, className: "ox-blank-line-spacer", "aria-hidden": true }),
      ),
    );
  }

  exportJSON(): SerializedOxBlankLinesNode {
    return { type: "ox-blank-lines", version: 1, count: this.__count };
  }
  static importJSON(serialized: SerializedOxBlankLinesNode): OxBlankLinesNode {
    return new OxBlankLinesNode(serialized.count);
  }
}

export function $createOxBlankLinesNode(count: number): OxBlankLinesNode {
  return new OxBlankLinesNode(count);
}
export function $isOxBlankLinesNode(
  node: LexicalNode | null | undefined,
): node is OxBlankLinesNode {
  return node instanceof OxBlankLinesNode;
}

