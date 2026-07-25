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
 * Both are plain `DecoratorNode`s — `InteractablesPlugin` handles select-
 * then-delete for ANY decorator generically (via `$isDecoratorNode`), so a
 * future interactable (an `@mention` node) gets that for free just by
 * being a decorator, no new plugin code and no special contract to
 * implement. (An earlier version of this had each decorator implement a
 * `getRevertText()` method, reverting to raw markdown text on a first
 * Backspace/Delete instead of deleting outright — removed as unwanted
 * complexity for a marginal benefit: retyping a directive from scratch
 * via `/` is simple enough that a soft revert step wasn't worth the extra
 * machinery, including the escaping a reverted directive's raw text
 * needed on export to avoid being mistaken for a live directive again.) */

import { createElement, useContext, useEffect, useMemo, type ReactElement } from "react";
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
  type DirectiveNode as OxMdastDirectiveNode,
} from "./document";
import type { OxInteractive } from "./interactive";
import {
  DirectiveRegistryContext,
  CardResolverContext,
  UploadFileContext,
  FileDirectiveLayout,
  CardDirectiveLayout,
  InteractiveDirective,
  OxStaticNodes,
} from "../components/OxRenderer";
import { OxEditorContext } from "./OxEditorContext";

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
  const resolveCard = useContext(CardResolverContext);
  const onUploadFile = useContext(UploadFileContext);
  // See this component's header comment (below the JSDoc) for why this
  // comes from a context rather than a direct import of `OxEditor.tsx`.
  const OxEditorComponent = useContext(OxEditorContext);
  useSelectDecoratorOnClick(nodeKey, setSelected);

  const attrs = directiveAttrs(mdastNode);

  // Every hook above runs unconditionally, on every render, regardless of
  // directive kind — the "file" branch below returns early, so nothing
  // after this point may itself be a hook (react-hooks/rules-of-hooks).
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

  // `::file{...}` is a built-in interactable (same category as task
  // checkboxes), not a caller-registered directive — see
  // `oxmarkdown/fileDirective.ts`'s header. Its caption is a REAL, live
  // nested `<OxEditor>` here (Editing mode always allows free-form typing
  // — unlike the static/Interacting-mode path in `OxRenderer.tsx`, which
  // renders the same caption as plain read-only markdown instead).
  // `OxEditorComponent` comes from `OxEditorContext` rather than a direct
  // import of `components/OxEditor.tsx`, which would be circular (that
  // module already imports THIS one for `OxDirectiveNode`/`OxOpaqueNode`).
  if (mdastNode.name === "file" && mdastNode.type === "leafDirective") {
    return (
      <FileDirectiveLayout
        name={attrs.name ?? "file"}
        fileId={attrs.fileId}
        contentType={attrs.contentType}
        uploadError={attrs.uploadError === "1"}
        onRemove={() => {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            node?.remove();
          });
        }}
        caption={
          OxEditorComponent ? (
            <OxEditorComponent
              mode="editing"
              markdown={attrs.caption ?? ""}
              onChange={(value) => interactive.editDirectiveAttr(mdastNode, "caption", value)}
              // Starts at 1 row and simply grows — a caption doesn't need
              // (or want) a whole 4-row canvas reserved up front.
              minRows={1}
              // No dot grid, and no left gutter/marker glyphs either —
              // it reads as a small annotation field next to a
              // thumbnail, not its own document, and the gutter would
              // otherwise push its text a further grid cell right of
              // where it should align (both classes, `oxmarkdown.css`).
              className="ox-file-caption-editor ox-no-gutter"
              placeholder="add words"
              // Lets ArrowUp/ArrowDown flow into a sibling file
              // directive's caption within THIS SAME outer document —
              // see `oxmarkdown/fileCaptionFlow.ts`.
              fileCaptionFlow={{ outerEditor: editor, nodeKey }}
            />
          ) : null
        }
      />
    );
  }

  // `::card{file="..."}` — same built-in category as `::file{...}` above,
  // see `oxmarkdown/cardDirective.ts`'s header. Unlike a file's caption,
  // a Card's content is resolved from OUTSIDE (`resolveCard`, via
  // `CardResolverContext`) rather than stored in an attribute on this
  // directive — it's a whole separate vault file with its own load/save
  // lifecycle. Allows file attachments (`allowFileAttachments`/
  // `showAddFileLink`), unlike a caption, which deliberately doesn't.
  if (mdastNode.name === "card" && mdastNode.type === "leafDirective") {
    const resolved = resolveCard?.(attrs.file);
    return (
      <CardDirectiveLayout
        projectName={resolved?.projectName ?? "Card"}
        projectHref={resolved?.projectHref ?? "#"}
        onRemove={() => {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            node?.remove();
          });
        }}
        content={
          resolved && OxEditorComponent ? (
            <OxEditorComponent
              mode="editing"
              markdown={resolved.markdown}
              onChange={resolved.onChange}
              allowFileAttachments
              showAddFileLink
              onUploadFile={onUploadFile}
              // Lets ArrowUp/ArrowDown in the OUTER editor land directly
              // inside THIS card — see `oxmarkdown/cardFlow.ts`.
              cardFlow={{ outerEditor: editor, nodeKey }}
            />
          ) : (
            <span className="subtle-text">Loading card…</span>
          )
        }
      />
    );
  }

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

// Blank lines between blocks are represented as ordinary, empty
// `ParagraphNode`s in Editing mode now — NOT a custom decorator node (see
// `editingTransforms.ts`'s header for the full reasoning, and the
// oxmarkdown skill's TODO 10 for the "1 markdown line = 1 editor line"
// principle this satisfies directly). A plain empty paragraph gets 100%
// standard Lexical text-editing behavior for free — clickable, focusable,
// Backspace/Enter/arrow/undo all just work — which a decorator node never
// gets without hand-building each one (as the previous `OxBlankLinesNode`
// here had to, including a click-redirect hack that's no longer needed at
// all now that there's real, ordinary text-editable content to click on).
