/**
 * OxRenderer — rendering of an OxMarkdown document, static by default.
 *
 * Walks the real mdast tree from `oxmarkdown/document.ts` directly (no
 * regex placeholders, no per-paragraph independent parses — see the
 * `oxmarkdown` skill's "Build plan" step 1).
 *
 * Pass `interactive` (see `oxmarkdown/interactive.ts`) to turn on
 * Interacting-mode affordances — task checkboxes and directives become
 * real interactables (selectable, actionable) instead of plain markup.
 * `OxEditor` is the stateful wrapper that owns selection/mutation and
 * supplies this; nothing here changes when `interactive` is omitted, which
 * is what every step-1 caller (including this file's own callers so far)
 * still does.
 *
 * Visual output is intentionally NOT a port of `.nopal-content` — see
 * `styles/oxmarkdown.css` for the themable `.ox-content` system this uses
 * instead, modeled off the same design language.
 */

import { createContext, Fragment, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Definition, RootContent } from "mdast";
import {
  parseOxDocument,
  countExtraBlankLines,
  directiveAttrs,
  isDirectiveNode,
  type OxDocument,
  type DirectiveNode,
} from "../oxmarkdown/document";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
import type { OxInteractive } from "../oxmarkdown/interactive";
import OxPopover from "../oxmarkdown/OxPopover";
import { CircleButton } from "./CircleButton";
import "../styles/oxmarkdown.css";

export interface OxRendererProps {
  markdown: string;
  /** Renderers for `::name{...}` / `:::name{...}` / `:name{...}` directives
   * — see `oxmarkdown/directiveRegistry.ts`. Unregistered names render a
   * visible "unknown directive" marker rather than vanishing. */
  directives?: DirectiveRegistry;
  /** Override specific theme tokens (a font, an accent color, ...) without
   * touching `oxmarkdown.css` — see `oxmarkdown/theme.ts`. */
  theme?: OxTheme;
  /** Turns on Interacting-mode rendering for checkboxes/directives — see
   * `oxmarkdown/interactive.ts`. Supplied by `OxEditor`. */
  interactive?: OxInteractive;
  className?: string;
}

export default function OxRenderer({
  markdown,
  directives,
  theme,
  interactive,
  className,
}: OxRendererProps) {
  const doc = useMemo(() => parseOxDocument(markdown), [markdown]);
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  return (
    <div
      className={`ox-content ox-tokens${className ? ` ${className}` : ""}`}
      style={style}
    >
      <OxTreeRenderer doc={doc} directives={directives} interactive={interactive} />
    </div>
  );
}

/** Ambient directive registry for content rendered OUTSIDE `OxTreeRenderer`'s
 * own render pass — specifically, `OxEditor`'s Editing-mode decorator nodes
 * (`oxmarkdown/editingNodes.tsx`), which render through Lexical's own tree,
 * not this file's `renderNodes` walk. Provided once by whichever surface
 * owns the registry; consumed by anything that needs it without a prop
 * threaded through Lexical's node model (which only holds plain data, not
 * arbitrary React props). */
export const DirectiveRegistryContext = createContext<DirectiveRegistry | undefined>(undefined);

/** Renders a plain list of mdast nodes with the same static logic as
 * `OxRenderer`/`OxTreeRenderer`, but with no `interactive` — used where
 * content needs to be visible but isn't (yet) independently editable: a
 * container directive's children in Editing mode, or an `OxOpaqueNode`'s
 * passthrough content (see `oxmarkdown/editingNodes.tsx`). */
export function OxStaticNodes({
  nodes,
  directives,
}: {
  nodes: readonly unknown[];
  directives?: DirectiveRegistry;
}) {
  return <>{renderBlockNodes(nodes, { directives, definitions: new Map() })}</>;
}

export interface OxTreeRendererProps {
  /** An already-parsed document — not raw markdown. `OxEditor` uses this
   * directly (instead of `OxRenderer`) so it can hold on to the exact same
   * tree it renders, mutate a node in place on an interaction, and
   * re-serialize that same tree — rather than this component parsing its
   * own private copy that nothing outside it could reach. */
  doc: OxDocument;
  directives?: DirectiveRegistry;
  interactive?: OxInteractive;
}

/** The actual tree walk, factored out of `OxRenderer` so `OxEditor` can
 * reuse it against a document it owns and mutates. See `OxTreeRendererProps`. */
export function OxTreeRenderer({ doc, directives, interactive }: OxTreeRendererProps) {
  const definitions = useMemo(() => collectDefinitions(doc), [doc]);
  return <>{renderBlockNodes(doc.children, { directives, definitions, interactive })}</>;
}

interface RenderCtx {
  directives?: DirectiveRegistry;
  definitions: Map<string, Definition>;
  interactive?: OxInteractive;
}

function collectDefinitions(doc: OxDocument): Map<string, Definition> {
  const map = new Map<string, Definition>();
  for (const node of doc.children) {
    if (node.type === "definition") map.set(node.identifier, node);
  }
  return map;
}

// ── Node dispatch ────────────────────────────────────────────────────────────

function renderNodes(nodes: readonly unknown[], ctx: RenderCtx): ReactNode {
  return (nodes as RootContent[]).map((node, i) => renderNode(node, i, ctx));
}

/** Same as `renderNodes`, but for BLOCK-level sibling lists specifically —
 * inserts a spacer for each blank line beyond the one CommonMark already
 * requires to separate two blocks (`countExtraBlankLines`, shared with
 * `OxEditor`'s Editing-mode import so both surfaces agree). Without this,
 * "1 blank line" and "5 blank lines" between two paragraphs render byte-
 * identically — confirmed regression, see the oxmarkdown skill's TODO 10.
 * Only meaningful for block content (root children, a blockquote's/
 * container directive's children, ...) — inline phrasing content (a
 * paragraph's own children) doesn't have this concept and should keep
 * using plain `renderNodes`. */
function renderBlockNodes(nodes: readonly unknown[], ctx: RenderCtx): ReactNode {
  const list = nodes as RootContent[];
  const out: ReactNode[] = [];
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (i > 0) {
      const extra = countExtraBlankLines(list[i - 1], node);
      for (let s = 0; s < extra; s++) {
        out.push(<div key={`spacer-${i}-${s}`} className="ox-blank-line-spacer" aria-hidden="true" />);
      }
    }
    out.push(renderNode(node, i, ctx));
  }
  return out;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderNode(node: any, key: number, ctx: RenderCtx): ReactNode {
  switch (node.type) {
    // Metadata — not visible body content.
    case "yaml":
    case "definition":
      return null;

    case "paragraph":
      return <p key={key}>{renderNodes(node.children, ctx)}</p>;

    case "heading": {
      const Tag = HEADING_TAGS[Math.min(node.depth, 6) - 1];
      return <Tag key={key}>{renderNodes(node.children, ctx)}</Tag>;
    }

    case "text":
      return node.value;

    case "strong":
      return <strong key={key}>{renderNodes(node.children, ctx)}</strong>;

    case "emphasis":
      return <em key={key}>{renderNodes(node.children, ctx)}</em>;

    case "delete":
      return <del key={key}>{renderNodes(node.children, ctx)}</del>;

    case "break":
      return <br key={key} />;

    case "thematicBreak":
      return <hr key={key} />;

    case "inlineCode":
      return <code key={key}>{node.value}</code>;

    case "code":
      return (
        <pre key={key} className="ox-code-block">
          <code className={node.lang ? `language-${node.lang}` : undefined}>
            {node.value}
          </code>
        </pre>
      );

    case "link": {
      const isExternal = /^https?:\/\//.test(node.url);
      return (
        <a
          key={key}
          href={node.url}
          title={node.title ?? undefined}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
        >
          {renderNodes(node.children, ctx)}
        </a>
      );
    }

    case "image":
      return <img key={key} src={node.url} alt={node.alt ?? ""} title={node.title ?? undefined} />;

    case "linkReference": {
      const def = ctx.definitions.get(node.identifier);
      if (!def) return <Fragment key={key}>{renderNodes(node.children, ctx)}</Fragment>;
      return (
        <a key={key} href={def.url} title={def.title ?? undefined}>
          {renderNodes(node.children, ctx)}
        </a>
      );
    }

    case "imageReference": {
      const def = ctx.definitions.get(node.identifier);
      if (!def) return null;
      return <img key={key} src={def.url} alt={node.alt ?? ""} title={def.title ?? undefined} />;
    }

    case "blockquote":
      return <blockquote key={key}>{renderBlockNodes(node.children, ctx)}</blockquote>;

    case "list":
      return renderList(node, key, ctx);

    case "table":
      return renderTable(node, key, ctx);

    // Raw HTML passthrough — same trust model the old rehype-raw pipeline
    // used (allowed, not sanitized). `<span>` is an approximation for
    // block-level raw HTML too; browsers tolerate the occasional invalid
    // nesting this can produce for a block element inside it.
    case "html":
      return <span key={key} dangerouslySetInnerHTML={{ __html: node.value }} />;

    case "textDirective":
    case "leafDirective":
    case "containerDirective":
      return renderDirective(node as DirectiveNode, key, ctx);

    // Intentionally unhandled for now: GFM footnotes. Not used anywhere in
    // nopal content today (the old MdxRenderer doesn't support them either
    // — no regression), so skipped rather than half-built. Renders nothing.
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderList(node: any, key: number, ctx: RenderCtx): ReactNode {
  const isTaskList = node.children.some((c: { checked?: boolean | null }) => c.checked != null);
  const Tag = node.ordered ? "ol" : "ul";
  const props =
    node.ordered && node.start != null && node.start !== 1 ? { start: node.start } : {};

  return (
    <Tag key={key} className={isTaskList ? "contains-task-list ox-task-list" : undefined} {...props}>
      {node.children.map((item: unknown, i: number) => renderListItem(item, i, ctx))}
    </Tag>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderListItem(node: any, key: number, ctx: RenderCtx): ReactNode {
  if (node.checked == null) {
    return <li key={key}>{renderBlockNodes(node.children, ctx)}</li>;
  }

  // Task item: unwrap the first paragraph's inline content into the label
  // (matching the old system's flat "task text" concept); any remaining
  // block children (a nested list, etc.) render normally after it.
  const [first, ...rest] = node.children;
  const labelChildren = first?.type === "paragraph" ? first.children : [first].filter(Boolean);

  return (
    <li key={key} className="ox-task-item">
      {ctx.interactive ? (
        <TaskCheckbox node={node} interactive={ctx.interactive} />
      ) : (
        <span
          className={`ox-task-checkbox${node.checked ? " checked" : ""}`}
          role="checkbox"
          aria-checked={node.checked}
        />
      )}
      <span className={`ox-task-text${node.checked ? " ox-task-text--checked" : ""}`}>
        {renderNodes(labelChildren, ctx)}
      </span>
      {rest.length > 0 && renderBlockNodes(rest, ctx)}
    </li>
  );
}

// ── Interactive: task checkbox ──────────────────────────────────────────────
// Select-then-act, per the oxmarkdown skill: a click both selects AND
// toggles in one motion (matching an ordinary HTML checkbox); once selected
// by ANY method (focus via Tab, or click), Space or Tab also toggles it as
// a separate step. Tab deliberately isn't prevented — it both toggles AND
// still moves focus to the next interactable, per the skill's explicit call.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TaskCheckbox({ node, interactive }: { node: any; interactive: OxInteractive }) {
  const selected = interactive.isSelected(node);
  const checked = !!node.checked;

  return (
    <span
      className={`ox-task-checkbox${checked ? " checked" : ""}${selected ? " ox-selected" : ""}`}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onFocus={() => interactive.select(node)}
      onBlur={() => interactive.select(null)}
      onClick={() => interactive.toggleTask(node)}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          interactive.toggleTask(node);
        } else if (e.key === "Tab" && !e.shiftKey) {
          interactive.toggleTask(node);
        }
      }}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderTable(node: any, key: number, ctx: RenderCtx): ReactNode {
  const align: (string | null)[] = node.align ?? [];
  const [headerRow, ...bodyRows] = node.children;
  const cellStyle = (i: number): CSSProperties | undefined => {
    const a = align[i];
    return a ? { textAlign: a as CSSProperties["textAlign"] } : undefined;
  };

  return (
    <table key={key}>
      <thead>
        <tr>
          {headerRow.children.map((cell: { children: unknown[] }, i: number) => (
            <th key={i} style={cellStyle(i)}>
              {renderNodes(cell.children, ctx)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((row: { children: { children: unknown[] }[] }, ri: number) => (
          <tr key={ri}>
            {row.children.map((cell, ci: number) => (
              <td key={ci} style={cellStyle(ci)}>
                {renderNodes(cell.children, ctx)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderDirective(node: DirectiveNode, key: number, ctx: RenderCtx): ReactNode {
  // `::file{...}` is a BUILT-IN interactable, not a caller-registered
  // directive (same category as task checkboxes, not "gallery"/"csv-table")
  // — see `oxmarkdown/fileDirective.ts`'s header. Handled before the
  // registry lookup so it can't be shadowed by a caller's own "file" entry.
  if (node.type === "leafDirective" && node.name === "file") {
    return <FileDirectiveStatic key={key} node={node} directives={ctx.directives} />;
  }

  const attrs = directiveAttrs(node);
  const renderer = ctx.directives?.[node.name];

  if (node.type === "containerDirective") {
    const rendered = <Fragment key="inner">{renderBlockNodes(node.children, ctx)}</Fragment>;
    // Unregistered container name: still show the content, just without
    // whatever wrapper the registry would have added — matches how an
    // unrecognized HTML element degrades to its children in the browser.
    // Not interactive yet — nested-interactable selection inside a container
    // is TODO 5 in the oxmarkdown skill, deferred until Editing mode exists.
    if (!renderer) return <Fragment key={key}>{rendered}</Fragment>;
    return <Fragment key={key}>{renderer({ attrs, label: null, children: rendered })}</Fragment>;
  }

  const content = renderer ? (
    renderer({ attrs, label: null })
  ) : node.type === "leafDirective" ? (
    <div className="ox-directive-unknown ox-directive-unknown--block">
      Unknown block: ::{node.name}
    </div>
  ) : (
    <span className="ox-directive-unknown">:{node.name}</span>
  );

  if (ctx.interactive) {
    return (
      <InteractiveDirective key={key} node={node} attrs={attrs} interactive={ctx.interactive}>
        {content}
      </InteractiveDirective>
    );
  }
  return <Fragment key={key}>{content}</Fragment>;
}

// ── File directive (`::file{...}`) ────────────────────────────────────
// A fixed-size placeholder thumbnail plus a caption alongside it, always
// its own full block row (`display: flex`, never `inline-block` — unlike
// every OTHER directive, which shrink-to-fit via `InteractiveDirective`).
// Bypasses `InteractiveDirective`'s generic attrs-popover entirely: a
// raw-text-field editor for `caption` would be redundant with (and
// confusing next to) the real rendering right there, and `name` is just
// the file's own original filename — not something to hand-edit at all.
// See `oxmarkdown/fileDirective.ts` for why this is a built-in
// interactable, not a caller-registered directive.

/** Just the X mark from the provided artwork — CircleButton itself
 * supplies the circular hover background/border (`.circle-btn-red`,
 * root.css), so only the two crossing strokes are needed here, not the
 * circle that came with them in the original combined default/hover
 * reference image. `stroke="currentColor"` (swapped from the original
 * hardcoded `#A63B31`, which is `--red`'s own hex value) so it inherits
 * whatever color `.circle-btn-red` sets, same adaptation as the "add
 * file" paperclip icon. Paths otherwise UNCHANGED from what was given;
 * `viewBox` cropped to "0 0 36 36" (the default X's own coordinates
 * already sit centered within that — confirmed against the reference
 * artwork's hover-state circle, `rx=17.5`/35px, positioned identically
 * relative to ITS OWN X once the +44px horizontal offset between the
 * two is subtracted) — matching CircleButton's 36px default size. */
function RemoveFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.99805 25.0003L24.1276 11" stroke="currentColor" strokeWidth="2" />
      <path d="M26.0022 24.8008L11.457 11.2005" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Shared presentational shell — both the STATIC path here and the LIVE
 * Editing-mode path (`oxmarkdown/editingNodes.tsx`) render this same
 * layout, differing only in what `caption` node they pass in (plain
 * rendered markdown here; a real nested `<OxEditor>` there) and whether
 * `onRemove` is supplied at all (only Editing mode can remove content —
 * the static/Interacting-mode path passes nothing, so no button renders).
 *
 * `contentEditable={false}` on the root: without it, a click inside the
 * thumbnail (plain presentational `<div>`, no real text/Lexical node
 * behind it) could still place a native caret there — `OxDirectiveNode`'s
 * own wrapper element doesn't set this itself (unlike `OxOpaqueNode`,
 * which does), so this directive's OWN rendered content has to. The
 * caption's nested `<OxEditor>` (Editing mode) is unaffected — a nested
 * `contenteditable="true"` region works normally inside a
 * `contenteditable="false"` ancestor, confirmed directly (same reasoning
 * that makes nesting one live Lexical editor inside another safe at all;
 * see the oxmarkdown skill). */
export function FileDirectiveLayout({
  name,
  fileId,
  contentType,
  uploadError,
  caption,
  onRemove,
}: {
  name: string;
  /** The uploaded vault file's id, once known — undefined while an
   * upload is still in flight (or if this content came from a caller
   * that never wired up real uploads at all, e.g. the visual mockup). */
  fileId?: string;
  contentType?: string;
  /** Set once `onUploadFile` rejects — see `oxmarkdown/fileDirective.ts`.
   * Shown as a plain placeholder with a title explaining what happened,
   * rather than looking identical to "still uploading" forever. */
  uploadError?: boolean;
  caption: ReactNode;
  onRemove?: () => void;
}) {
  const isImage = !!fileId && !!contentType?.startsWith("image/");
  return (
    <div className="ox-file-directive" contentEditable={false}>
      {isImage ? (
        <img
          className="ox-file-thumb"
          src={`/api/vault/view/${fileId}`}
          alt={name}
          title={name}
          draggable={false}
        />
      ) : (
        <div
          className="ox-file-thumb"
          title={uploadError ? `${name} — upload failed` : name}
          data-upload-error={uploadError ? "true" : undefined}
          aria-hidden="true"
        />
      )}
      <div className="ox-file-caption">{caption}</div>
      {onRemove && (
        // A dedicated `--ox-grid`-wide (41px) slot, centering the 36px
        // button within it — CircleButton sets its own width/height via
        // an inline style (from its `size` prop), which a CSS class can
        // never override, so the centering has to live on this WRAPPER
        // instead of trying to resize the button itself.
        <div className="ox-file-remove-slot">
          <CircleButton
            className="circle-btn-red"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <RemoveFileIcon />
          </CircleButton>
        </div>
      )}
    </div>
  );
}

/** The read-only path: a plain `OxRenderer` with no `interactive`, or
 * Interacting mode (which never allows free-form typing — see the
 * oxmarkdown skill's Interacting-vs-Editing model) — so the caption is
 * just rendered markdown, the same static way anything else here is,
 * never a live editor. */
function FileDirectiveStatic({
  node,
  directives,
}: {
  node: DirectiveNode;
  directives?: DirectiveRegistry;
}) {
  const attrs = directiveAttrs(node);
  const captionDoc = attrs.caption ? parseOxDocument(attrs.caption) : null;
  return (
    <FileDirectiveLayout
      name={attrs.name ?? "file"}
      fileId={attrs.fileId}
      contentType={attrs.contentType}
      uploadError={attrs.uploadError === "1"}
      caption={
        captionDoc ? <OxStaticNodes nodes={captionDoc.children} directives={directives} /> : null
      }
    />
  );
}

// ── Interactive: directive (text/leaf) ──────────────────────────────
// Click/focus selects; while selected, a popover lists its attributes as
// editable fields — the generic "adjust attributes without hand-editing the
// directive text" affordance from the oxmarkdown skill. Works for any
// directive name/kind since it only depends on the attrs being a flat
// key/value map, not on what a specific directive means.

/** Exported so `oxmarkdown/editingNodes.tsx` can reuse the exact same
 * select/popover UI for Editing-mode directive decorators, instead of a
 * second implementation — both modes render identically because they share
 * this one component; only the `interactive` adapter behind it differs
 * (React state here in `OxEditor`'s Interacting mode, a Lexical node update
 * there). */
export function InteractiveDirective({
  node,
  attrs,
  interactive,
  children,
}: {
  node: DirectiveNode;
  attrs: Record<string, string>;
  interactive: OxInteractive;
  children: ReactNode;
}) {
  const selected = interactive.isSelected(node);
  const isBlock = node.type === "leafDirective";
  const Tag = isBlock ? "div" : "span";
  const attrEntries = Object.entries(attrs);
  const hasPopover = selected && attrEntries.length > 0;

  // Held in state, not a plain ref — `OxPopover` takes this as an external
  // floating-ui "reference" element (see its own header), which needs a
  // value it can react to as soon as the wrapper actually mounts.
  const [wrapperEl, setWrapperEl] = useState<HTMLElement | null>(null);

  return (
    <Tag
      ref={setWrapperEl as React.Ref<never>}
      className={selected ? "ox-selected" : undefined}
      // Always shrink-to-fit, even for a leaf directive's `<div>` —
      // otherwise a block-level wrapper defaults to full row width, and the
      // `.ox-selected` highlight ends up covering the whole row instead of
      // just the directive's own content. A future full-width leaf
      // directive (a real table/gallery) can still stretch itself via its
      // OWN rendered content; this wrapper just shouldn't do it by default.
      style={{ display: "inline-block" }}
      tabIndex={0}
      onFocus={() => interactive.select(node)}
      onClick={() => interactive.select(node)}
    >
      {children}
      <OxPopover anchorEl={wrapperEl} open={hasPopover} onDismiss={() => interactive.select(null)}>
        <div className="ox-popover-title">::{node.name}</div>
        {attrEntries.map(([attrKey, attrValue]) => (
          <label key={attrKey} className="ox-popover-field">
            <span>{attrKey}</span>
            <input
              defaultValue={attrValue}
              onBlur={(e) => interactive.editDirectiveAttr(node, attrKey, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        ))}
      </OxPopover>
    </Tag>
  );
}

// Re-exported so callers can check a node's type without importing from
// `oxmarkdown/document.ts` directly, if they only otherwise touch this file.
export { isDirectiveNode };
