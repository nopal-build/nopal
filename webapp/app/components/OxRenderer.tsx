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

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Definition, RootContent } from "mdast";
import {
  parseOxDocument,
  countExtraBlankLines,
  directiveAttrs,
  isDirectiveNode,
  parseRefAttrs,
  type OxDocument,
  type DirectiveNode,
} from "oxmarkdown-core";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
import type { OxInteractive } from "../oxmarkdown/interactive";
import OxPopover from "../oxmarkdown/OxPopover";
import type { CardResolver, GalleryFolderResolver } from "oxmarkdown-core";
import type { UploadFileFn } from "../oxmarkdown/fileDirective";
import { OxEditorContext } from "../oxmarkdown/OxEditorContext";
import { CircleButton } from "stamps/CircleButton";
import { surfaceBase } from "stamps/surface.css";
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
  /** Resolves a `::card{file="..."}` directive's `file` attribute to real
   * project/content data — see `oxmarkdown/cardDirective.ts`. Supplied by
   * `OxEditor`. */
  resolveCard?: CardResolver;
  /** Resolves a `::gallery{folder="..."}` LEAF directive's `folder`
   * attribute to that folder's images — see
   * `oxmarkdown-core/galleryDirective.ts`. Omit entirely for a page with
   * no vault-backed folder resolution at all (e.g. the styles/demo page);
   * the directive then renders nothing rather than an empty box. */
  resolveGalleryFolder?: GalleryFolderResolver;
  className?: string;
}

export default function OxRenderer({
  markdown,
  directives,
  theme,
  interactive,
  resolveCard,
  resolveGalleryFolder,
  className,
}: OxRendererProps) {
  const doc = useMemo(() => parseOxDocument(markdown), [markdown]);
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  return (
    <div
      className={`ox-content ox-tokens${className ? ` ${className}` : ""}`}
      style={style}
    >
      <div className="ox-dot-grid">
        <OxTreeRenderer
          doc={doc}
          directives={directives}
          interactive={interactive}
          resolveCard={resolveCard}
          resolveGalleryFolder={resolveGalleryFolder}
        />
      </div>
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

/** Same idea as `DirectiveRegistryContext`, for `::card{...}`'s
 * `resolveCard` lookup — `OxEditor`'s Editing-mode decorator nodes
 * (`oxmarkdown/editingNodes.tsx`) need to reach it without a prop threaded
 * through Lexical's node model (which only holds plain data). */
export const CardResolverContext = createContext<CardResolver | undefined>(undefined);

/** Same idea again, for a `::card{...}` directive's nested editor to reach
 * the OUTER editor's own `onUploadFile` — a Card allows file attachments
 * (unlike a `::file{...}` caption, which deliberately doesn't), and
 * uploads should land in the exact same place the outer document's OWN
 * attachments do (e.g. that day's vault folder), not a second, divergent
 * upload path. */
export const UploadFileContext = createContext<UploadFileFn | undefined>(undefined);

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
  resolveCard?: CardResolver;
  resolveGalleryFolder?: GalleryFolderResolver;
}

/** The actual tree walk, factored out of `OxRenderer` so `OxEditor` can
 * reuse it against a document it owns and mutates. See `OxTreeRendererProps`. */
export function OxTreeRenderer({ doc, directives, interactive, resolveCard, resolveGalleryFolder }: OxTreeRendererProps) {
  const definitions = useMemo(() => collectDefinitions(doc), [doc]);
  return (
    <>{renderBlockNodes(doc.children, { directives, definitions, interactive, resolveCard, resolveGalleryFolder })}</>
  );
}

interface RenderCtx {
  directives?: DirectiveRegistry;
  definitions: Map<string, Definition>;
  interactive?: OxInteractive;
  resolveCard?: CardResolver;
  resolveGalleryFolder?: GalleryFolderResolver;
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

/** A bare single `\n` inside a paragraph's source text parses into ONE
 * mdast text node whose `.value` contains the literal newline character
 * (confirmed against `mdast-util-from-markdown` directly — it is neither
 * stripped to a space nor split into a `break` node). This renders every
 * line as the author actually typed it, matching Editing mode's own
 * line-break handling (see `editingTransforms.ts`), instead of collapsing
 * hard-wrapped text into one flowing paragraph. */
function renderTextWithBreaks(value: string, key: number): ReactNode {
  const lines = value.split("\n");
  if (lines.length === 1) return value;
  return (
    <Fragment key={key}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </Fragment>
  );
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
      return renderTextWithBreaks(node.value, key);

    case "strong":
      return <strong key={key}>{renderNodes(node.children, ctx)}</strong>;

    case "emphasis":
      return <em key={key}>{renderNodes(node.children, ctx)}</em>;

    case "delete":
      return <del key={key}>{renderNodes(node.children, ctx)}</del>;

    case "mark":
      return <mark key={key}>{renderNodes(node.children, ctx)}</mark>;

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

/** Splits a `:::grid{...}` container's own children into cells on `::col`
 * leaf-directive markers — the marker itself is a pure break, never
 * rendered on its own. Content before the first `::col` is always the
 * first cell, so a `:::grid` with no `::col` at all degrades to one
 * full-width cell rather than an error. */
function splitGridCells(children: readonly unknown[]): RootContent[][] {
  const cells: RootContent[][] = [[]];
  for (const child of children as RootContent[]) {
    if ((child as DirectiveNode).type === "leafDirective" && (child as DirectiveNode).name === "col") {
      cells.push([]);
      continue;
    }
    cells[cells.length - 1].push(child);
  }
  return cells;
}

const MAX_GRID_COLUMNS = 6;

/** The `columns` attribute wins when present (clamped to a sane range so a
 * typo can't blow out the layout); otherwise defaults to one column per
 * cell, so the common case — "split content into N groups, lay them out
 * side by side" — needs no attribute at all. */
function clampGridColumns(columnsAttr: string | undefined, cellCount: number): number {
  const parsed = columnsAttr ? parseInt(columnsAttr, 10) : NaN;
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : cellCount;
  return Math.min(Math.max(base, 1), MAX_GRID_COLUMNS);
}

interface GalleryImage {
  url: string;
  alt: string | null;
  title: string | null;
}

/** Recursively collects every `image` mdast node found within a
 * `:::gallery{...}` container's children — no new syntax needed, a
 * gallery is just a directive-wrapped SEQUENCE of ordinary `![alt](url)`
 * markdown images, usually one per line/paragraph. This is what makes it
 * degrade gracefully: a renderer that doesn't understand the `gallery`
 * directive at all (Obsidian, GitHub, a bare text editor) still shows every
 * photo, just stacked instead of tiled. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectGalleryImages(nodes: readonly unknown[]): GalleryImage[] {
  const images: GalleryImage[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image") {
      images.push({ url: node.url, alt: node.alt ?? null, title: node.title ?? null });
      return;
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  (nodes as RootContent[]).forEach(visit);
  return images;
}

// 3 is the most columns the gallery layout supports at all right now —
// `max-columns` can only ever bring this DOWN, never raise it.
const GALLERY_COLUMN_CAP = 3;

/** The gallery's own fixed breakpoints: 1 photo → 1 column, 2–6 → 2, 7+ →
 * 3 — then capped by the `max-columns` attribute (default/hard ceiling
 * `GALLERY_COLUMN_CAP`). */
function computeGalleryColumns(photoCount: number, maxColumnsAttr: string | undefined): number {
  const auto = photoCount <= 1 ? 1 : photoCount <= 6 ? 2 : 3;
  const parsed = maxColumnsAttr ? parseInt(maxColumnsAttr, 10) : NaN;
  const maxColumns =
    Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, GALLERY_COLUMN_CAP) : GALLERY_COLUMN_CAP;
  return Math.min(auto, maxColumns);
}

/** The actual grid markup, shared by both the container (`:::gallery{...}`)
 * and leaf (`::gallery{folder="..."}`) forms — same visual result either
 * way, they only differ in WHERE `images` came from. `title` is only ever
 * non-null from the leaf form today (the container form has no attribute
 * for it — a caller who wants a heading just writes one in the
 * surrounding markdown, same as any other block). */
function renderGalleryGrid(
  images: GalleryImage[],
  maxColumnsAttr: string | undefined,
  key: number,
  title: string | null,
): ReactNode {
  const columns = computeGalleryColumns(images.length, maxColumnsAttr);
  const grid = (
    <div
      className="ox-gallery-directive"
      style={{ "--ox-gallery-columns": columns } as CSSProperties}
    >
      {images.map((img, i) => (
        <figure key={i} className="ox-gallery-item">
          <img src={img.url} alt={img.alt ?? ""} title={img.title ?? undefined} loading="lazy" />
          {img.alt && <figcaption>{img.alt}</figcaption>}
        </figure>
      ))}
    </div>
  );
  if (!title) return <Fragment key={key}>{grid}</Fragment>;
  return (
    <div key={key}>
      <div className="ox-directive-title">{title}</div>
      {grid}
    </div>
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

  // `:ref{...}` — same built-in category, see
  // `oxmarkdown-core/src/refDirective.ts`. A TEXT directive (inline, no
  // children) rather than a leaf/container one, since it's a citation
  // sitting inline in a sentence, not its own row. Never editable — no
  // `ctx.interactive` branch at all, unlike the generic directive-attrs
  // popover other directives get further down.
  if (node.type === "textDirective" && node.name === "ref") {
    return <RefDirectiveStatic key={key} node={node} />;
  }

  // `::card{file="..."}` — same category, see `oxmarkdown/cardDirective.ts`.
  if (node.type === "leafDirective" && node.name === "card") {
    return (
      <CardDirectiveStatic
        key={key}
        node={node}
        directives={ctx.directives}
        interactive={ctx.interactive}
        resolveCard={ctx.resolveCard}
      />
    );
  }

  // `:::toggle{collapsed="true"}` — same built-in category as `::file`/
  // `::card` above, see `oxmarkdown/OxToggleNode.ts`'s header. Native
  // `<details>`/`<summary>` gives real click-to-collapse/expand for free,
  // with zero JS dependency — unlike checkbox toggling, this works even
  // in a fully passive/non-interactive render (no `ctx.interactive`
  // needed at all). The directive's OWN first child is always the title
  // (see `convertToggle`/`convertBlock`'s mirror in `editingTransforms.ts`);
  // collapse state here is deliberately EPHEMERAL (native `<details>`'s own
  // browser-managed `open` state, seeded from the saved `collapsed`
  // attribute) — NOT re-saved back to the markdown the way Editing mode's
  // own toggle persists, matching how a native disclosure widget's open/
  // closed state is ordinarily per-view, not part of a document's content.
  if (node.type === "containerDirective" && node.name === "toggle") {
    const [titleNode, ...bodyNodes] = node.children;
    const isTitleParagraph = (titleNode as { type?: string } | undefined)?.type === "paragraph";
    const titleChildren = isTitleParagraph
      ? ((titleNode as { children?: unknown[] }).children ?? [])
      : [];
    const bodySource = isTitleParagraph ? bodyNodes : node.children;
    return (
      <details key={key} className="ox-toggle" open={directiveAttrs(node).collapsed !== "true"}>
        <summary className="ox-toggle-summary">{renderNodes(titleChildren, ctx)}</summary>
        <div className="ox-toggle-body">{renderBlockNodes(bodySource, ctx)}</div>
      </details>
    );
  }

  // `:::grid{columns="N"}` / `::col` — a basic side-by-side layout, built
  // the same way `:::toggle` is: a first-class, always-available built-in
  // (not a caller-registered directive from `oxmarkdown/directiveRegistry.ts`),
  // so it works out of the box on any page with no wiring. STATIC/
  // Interacting-mode ONLY — Editing mode has no dedicated preview for it
  // and falls back to the same generic "Unknown block" placeholder any
  // other unregistered container directive shows there (`editingNodes.tsx`'s
  // `OxDirectiveDecorator`). Nothing is destroyed by that — the underlying
  // markdown round-trips losslessly regardless (`OxDirectiveNode` holds the
  // real mdast node) — it just isn't rendered as a real grid while typing.
  // A stray `::col` used outside a `:::grid{...}` falls through to the
  // ordinary "unknown directive" rendering below, same as any other
  // directive misuse.
  if (node.type === "containerDirective" && node.name === "grid") {
    const cells = splitGridCells(node.children);
    const columns = clampGridColumns(directiveAttrs(node).columns, cells.length);
    return (
      <div
        key={key}
        className="ox-grid-directive"
        style={{ "--ox-grid-columns": columns } as CSSProperties}
      >
        {cells.map((cellNodes, i) => (
          <div key={i} className="ox-grid-cell">
            {renderBlockNodes(cellNodes, ctx)}
          </div>
        ))}
      </div>
    );
  }

  // `:::gallery{max-columns="N"}` — a basic photo grid, same built-in
  // category as `:::grid` above (not a caller-registered directive — see
  // that case's own comment for why). Deliberately built on ORDINARY
  // markdown images (`![alt](url)`) as the container's children, not a
  // new per-photo leaf directive — this is what lets a gallery degrade to
  // a plain sequence of individually-viewable images on any renderer that
  // doesn't understand the `gallery` directive at all. STATIC/
  // Interacting-mode ONLY, same deliberate limitation as `:::grid` (see
  // that case's comment) — Editing mode shows the generic "Unknown block"
  // placeholder instead; nothing is lost, the real mdast node round-trips
  // losslessly through export either way.
  if (node.type === "containerDirective" && node.name === "gallery") {
    const images = collectGalleryImages(node.children);
    // No images found at all (e.g. a caller left it empty, or every child
    // is some other kind of content) — degrade to plain content instead of
    // an empty box, same as any other unregistered container directive.
    if (images.length === 0) {
      return <Fragment key={key}>{renderBlockNodes(node.children, ctx)}</Fragment>;
    }
    return renderGalleryGrid(images, directiveAttrs(node)["max-columns"], key, null);
  }

  // `::gallery{folder="..."}` — the LEAF-directive sibling of the
  // container form just above: same visual result (a titled photo grid),
  // but the photos are resolved from a named vault FOLDER instead of
  // being written out as inline `![alt](url)` images — see
  // `oxmarkdown-core/galleryDirective.ts`'s header for why both exist
  // under the same name. Built-in, same category as `::file`/`::card`
  // above (not a caller-registered directive), and STATIC/Interacting-mode
  // ONLY like the container form — Editing mode shows the generic
  // "Unknown block" placeholder instead, same deliberate limitation.
  // Renders nothing (not an empty box, not an error marker) when
  // `resolveGalleryFolder` is omitted, the folder name doesn't resolve, or
  // it resolves to zero images — the folder may just not exist yet, or
  // this render context (e.g. the styles/demo page) may have no vault
  // behind it at all.
  if (node.type === "leafDirective" && node.name === "gallery") {
    const attrs = directiveAttrs(node);
    const images = ctx.resolveGalleryFolder?.(attrs.folder ?? "");
    if (!images || images.length === 0) return null;
    return renderGalleryGrid(
      images.map((img) => ({ url: img.url, alt: img.name, title: null })),
      undefined,
      key,
      attrs.title ?? null,
    );
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
 * supplies the circular hover background/border (`variant="red"`, see
 * `packages/stamps/src/circleButton.css.ts`), so only the two crossing
 * strokes are needed here, not the circle that came with them in the
 * original combined default/hover reference image. `stroke="currentColor"`
 * (swapped from the original hardcoded `#A63B31`, which is `--red`'s own
 * hex value) so it inherits whatever color the `red` variant sets, same
 * adaptation as the "add file" paperclip icon. Paths otherwise UNCHANGED
 * from what was given;
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
  // The modal owns its own "is it open" state right here rather than in
  // either caller (`FileDirectiveStatic`/`OxDirectiveDecorator`) — both
  // paths get the zoom behavior for free this way, with zero per-caller
  // wiring. While open, the caption moves INTO the modal (see below) —
  // it's the exact same `caption` node either place, so it must never be
  // rendered in both slots at once (two mounted copies of the same live
  // `<OxEditor>` caption would drift out of sync the moment either one is
  // typed in, since each mounts its own independent Lexical state from
  // the same initial `markdown` prop). Moving it costs a remount (a
  // typing cursor mid-caption resets), an acceptable trade-off for reusing
  // the one real editor instance instead of running two.
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="ox-file-directive" contentEditable={false}>
      {isImage ? (
        <img
          className="ox-file-thumb"
          src={`/api/vault/view/${fileId}`}
          alt={name}
          title={name}
          draggable={false}
          role="button"
          tabIndex={0}
          onClick={() => setZoomed(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setZoomed(true);
            }
          }}
        />
      ) : (
        <div
          className="ox-file-thumb"
          title={uploadError ? `${name} — upload failed` : name}
          data-upload-error={uploadError ? "true" : undefined}
          aria-hidden="true"
        />
      )}
      <div className="ox-file-caption">{zoomed ? null : caption}</div>
      {onRemove && (
        // A dedicated `--ox-grid`-wide (41px) slot, centering the 36px
        // button within it — CircleButton sets its own width/height via
        // an inline style (from its `size` prop), which a CSS class can
        // never override, so the centering has to live on this WRAPPER
        // instead of trying to resize the button itself.
        <div className="ox-file-remove-slot">
          <CircleButton
            variant="red"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <RemoveFileIcon />
          </CircleButton>
        </div>
      )}
      {zoomed && isImage && fileId && (
        <FileImageModal
          name={name}
          fileId={fileId}
          caption={caption}
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}

/** The enlarged view opened by clicking a `::file{...}` image thumbnail —
 * see the oxmarkdown skill's file-directive section. Two independent
 * concerns:
 *
 *   1. A modal overlay (a Surface panel on a dimmed backdrop, closes on
 *      Escape or a backdrop click — same conventions as `Modal.tsx`,
 *      though this needs its own shell rather than reusing that
 *      component: `Modal.tsx`'s panel caps out at a fixed 400px width,
 *      wrong for a photo that should get as much of the screen as it can).
 *   2. Two-step zoom: opens "fit" (as large as it can get without ever
 *      upscaling past the image's real size — plain `max-width`/
 *      `max-height: 100%` on the `<img>`), then a click enlarges to true
 *      100% (1 image pixel = 1 screen pixel), which can then need
 *      scrolling. If the image was never scaled down to fit in the first
 *      place (it's simply smaller than the space available), "fit" and
 *      "100%" are the same picture — `canZoomFurther` stays false and no
 *      second click/zoom-cursor is offered at all, per the product
 *      requirement: a small image should just always show at its real
 *      size, never artificially upscaled.
 */
function FileImageModal({
  name,
  fileId,
  caption,
  onClose,
}: {
  name: string;
  fileId: string;
  caption: ReactNode;
  onClose: () => void;
}) {
  const [zoomedIn, setZoomedIn] = useState(false);
  const [canZoomFurther, setCanZoomFurther] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Re-checked on load (natural size just became known) and on resize
  // (whether "fit" needs to downscale at all can change with the
  // viewport) — never while `zoomedIn` (the image renders at its natural
  // size then, so it'd always read as "can't zoom further" and could
  // otherwise flip `canZoomFurther` off mid-zoom on a resize, stranding
  // the user unable to zoom back out). Memoized on `zoomedIn` specifically
  // so the resize listener below always sees the CURRENT value rather than
  // whatever it was when the listener was first attached.
  const checkZoomable = useCallback(() => {
    const img = imgRef.current;
    if (!img || zoomedIn) return;
    setCanZoomFurther(img.naturalWidth > img.clientWidth || img.naturalHeight > img.clientHeight);
  }, [zoomedIn]);

  useEffect(() => {
    checkZoomable();
    window.addEventListener("resize", checkZoomable);
    return () => window.removeEventListener("resize", checkZoomable);
  }, [checkZoomable]);

  return (
    <div className="ox-file-modal-backdrop" onClick={onClose}>
      <div
        className={`ox-file-modal ${surfaceBase}`}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ox-file-modal-close-slot">
          <CircleButton onClick={onClose} aria-label="Close">
            <RemoveFileIcon />
          </CircleButton>
        </div>
        <div className="ox-file-modal-image-area">
          <img
            ref={imgRef}
            src={`/api/vault/view/${fileId}`}
            alt={name}
            className={`ox-file-modal-image${zoomedIn ? " ox-file-modal-image--full" : ""}`}
            onLoad={checkZoomable}
            onClick={() => canZoomFurther && setZoomedIn((z) => !z)}
            style={{ cursor: canZoomFurther ? (zoomedIn ? "zoom-out" : "zoom-in") : "default" }}
          />
        </div>
        <div className="ox-file-modal-caption">{caption}</div>
      </div>
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

// ── Card directive (`::card{file="..."}`) ──────────────────────────────
// A Card's own vault file is mounted here as a whole nested document, not
// a small caption like `::file{...}` — see `oxmarkdown/cardDirective.ts`
// for why its content is resolved from OUTSIDE (`resolveCard`) rather than
// stored in an attribute. Shares one layout shell (header + content slot)
// across both the static path here and the live Editing-mode path
// (`oxmarkdown/editingNodes.tsx`).

/** `contentEditable={false}` on the root for the SAME reason
 * `FileDirectiveLayout` needs it: the header (project name/link) is
 * presentational, not real editable text, so without this a click there
 * could still place a native caret. The nested content area is
 * unaffected — a real editable region works normally inside a
 * `contenteditable="false"` ancestor (confirmed already for `::file`'s
 * caption; see the oxmarkdown skill). */
export function CardDirectiveLayout({
  projectName,
  projectHref,
  content,
  onRemove,
  pending,
}: {
  projectName: string;
  projectHref: string;
  content: ReactNode;
  onRemove?: () => void;
  /** True while this Card is still an optimistic placeholder — see
   * `ResolvedCard.pending` (`oxmarkdown/cardDirective.ts`). Dims the whole
   * card and disables interaction with its content area (the header's
   * "open project" link stays live — its href is already the real,
   * known folder id, nothing about it is actually pending). */
  pending?: boolean;
}) {
  return (
    <div
      className={`ox-card-directive ${surfaceBase}${pending ? " ox-card-directive--pending" : ""}`}
      contentEditable={false}
    >
      <div className="ox-card-header">
        <div className="ox-card-header-info">
          <span className="font-bold purple-light-text truncate">{projectName}</span>
          <a href={projectHref} className="text-xs ox-card-open-link">
            open project →
          </a>
        </div>
        {onRemove && (
          <CircleButton
            variant="red"
            onClick={onRemove}
            aria-label={`Remove ${projectName} card`}
          >
            <RemoveFileIcon />
          </CircleButton>
        )}
      </div>
      <div className="ox-card-content">{content}</div>
    </div>
  );
}

/**
 * The read-only path — used both by a fully passive `OxRenderer` (no
 * `interactive` at all, e.g. a public unauthenticated view) AND by
 * Interacting mode (`interactive` present). The two render the card's
 * OWN content differently:
 *
 * - No `interactive` at all: plain static markdown via `OxStaticNodes`,
 *   matching how the REST of a non-interactive render behaves — no live
 *   interaction of any kind, anywhere.
 * - `interactive` present: the caller wants SOME live interaction
 *   elsewhere in this document (task checkboxes, directive popovers), so
 *   the card's own content gets a REAL nested `<OxEditor mode="interacting">`
 *   instead of a second, bespoke static-render path — its own checkboxes/
 *   file thumbnails all keep working, and edits (a checkbox toggle) flow
 *   into `resolved.onChange`, never the OUTER document's `onChange`.
 *   Reusing THE component (via `OxEditorContext`, avoiding a circular
 *   import — see that file) rather than reimplementing Interacting mode's
 *   own selection/commit logic a second time here.
 */
function CardDirectiveStatic({
  node,
  directives,
  interactive,
  resolveCard,
}: {
  node: DirectiveNode;
  directives?: DirectiveRegistry;
  interactive?: OxInteractive;
  resolveCard?: CardResolver;
}) {
  const attrs = directiveAttrs(node);
  const resolved = resolveCard?.(attrs.file);
  const OxEditorComponent = useContext(OxEditorContext);

  if (!resolved) {
    // Still loading, or this render context has no card data at all (e.g.
    // no `resolveCard` was ever supplied) — show the shell so the row's
    // presence is still visible rather than silently vanishing.
    return (
      <CardDirectiveLayout
        projectName="Card"
        projectHref="#"
        content={<span className="subtle-text">Loading card…</span>}
      />
    );
  }

  // An OPTIMISTIC placeholder (see `ResolvedCard.pending`'s own header) —
  // `projectName`/`projectHref` are already the REAL values (known
  // client-side without the server), so the header shows correctly right
  // away; only the content area defers to the real thing landing, rather
  // than mounting a live editor against a card that doesn't exist yet.
  if (resolved.pending) {
    return (
      <CardDirectiveLayout
        projectName={resolved.projectName}
        projectHref={resolved.projectHref}
        pending
        content={<span className="subtle-text">Creating card…</span>}
      />
    );
  }

  if (interactive && OxEditorComponent) {
    return (
      <CardDirectiveLayout
        projectName={resolved.projectName}
        projectHref={resolved.projectHref}
        content={
          <OxEditorComponent
            mode="interacting"
            markdown={resolved.markdown}
            onChange={resolved.onChange}
            directives={directives}
          />
        }
      />
    );
  }

  const cardDoc = parseOxDocument(resolved.markdown);
  return (
    <CardDirectiveLayout
      projectName={resolved.projectName}
      projectHref={resolved.projectHref}
      content={<OxStaticNodes nodes={cardDoc.children} directives={directives} />}
    />
  );
}

// ── Ref directive (`:ref{...}`) ─────────────────────────────────────────
// A read-only attribution mark — see `oxmarkdown-core/src/refDirective.ts`
// for the attribute shape and the `graphlog` skill for who writes these
// (GraphLog's `sync-graph` stage, into `Graph/graph-log-YYYY-MM-DD.md`).
// Two renderings, both decided purely by the `verbose` attribute (never by
// rendering context) per the skill's own resolved decision:
//   - verbose="true" (graph-log entries only): fully spelled-out plain
//     inline text, no popover — there's nothing hidden to reveal.
//   - omitted/false (everywhere else): a single `*` glyph; click/tap opens
//     a small read-only popover with Name/Datetime/Location. This directive
//     is never editable by a human (GraphLog is the only writer), so unlike
//     every OTHER directive it does NOT go through `InteractiveDirective`'s
//     generic attrs-editing popover further below — the popover here has no
//     input fields, just plain text/links, and open/close is purely local
//     component state rather than `ctx.interactive`'s selection model.

/** Formats an ISO datetime for display — e.g. "Aug 17, 2026, 2:30 PM".
 * Falls back to the raw string if it doesn't parse, rather than showing
 * "Invalid Date" for a malformed/foreign `:ref{...}`.
 *
 * Pinned to an explicit locale AND `timeZone: "UTC"` (never the viewer's
 * own, and never `undefined`) — `toLocaleString(undefined, ...)` resolves
 * to whatever locale/timezone the RUNTIME is in, which is the server's
 * during SSR and the browser's during hydration; those two disagree
 * (confirmed directly — this shipped as a real hydration-mismatch bug on
 * `/fruits/styles/oxmarkdown` once already), so React throws a hydration
 * error the moment the client's re-render produces different text than
 * what the server sent down. Same fix `fruits_.profile.tsx`'s
 * `formatSignedAt` already applies for the same reason — see its own
 * comment. */
function formatRefDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Best-effort link target for a cited human's name — same `/humanId:path`
 * shape the oxmarkdown skill documents for `@`-mentions (see `mention.ts`),
 * scoped to that human's own vault root rather than a specific file. Shares
 * mentions' own known, not-yet-wired-up gap: this is a literal href, not
 * yet resolved to real in-app navigation to an actual profile page (no such
 * page exists yet) — whoever finishes that TODO for mentions should cover
 * this the same way. */
function humanProfileHref(humanId: string): string {
  return `/${humanId}:root`;
}

function RefDirectiveStatic({ node }: { node: DirectiveNode }) {
  const parsed = parseRefAttrs(node);
  if (!parsed) {
    return <span className="ox-directive-unknown">:ref</span>;
  }
  const { name, humanId, datetime, location, verbose } = parsed;
  const nameNode = humanId ? (
    <a href={humanProfileHref(humanId)}>{name}</a>
  ) : (
    <span>{name}</span>
  );

  if (verbose) {
    return (
      <span className="ox-ref ox-ref--verbose">
        {nameNode} · {formatRefDatetime(datetime)} ·{" "}
        <a href={location}>source</a>
      </span>
    );
  }

  return (
    <RefDirectiveMarker
      name={name}
      humanId={humanId}
      datetime={formatRefDatetime(datetime)}
      location={location}
    />
  );
}

function RefDirectiveMarker({
  name,
  humanId,
  datetime,
  location,
}: {
  name: string;
  humanId?: string;
  datetime: string;
  location: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const toggle = () => setOpen((o) => !o);
  return (
    <span
      ref={setAnchorEl as React.Ref<never>}
      className="ox-ref ox-ref-marker"
      role="button"
      tabIndex={0}
      aria-label={`Reference: ${name}`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      *
      <OxPopover anchorEl={anchorEl} open={open} onDismiss={() => setOpen(false)}>
        <div className="ox-popover-title">Reference</div>
        <div className="ox-ref-popover-row">
          <span>Name</span>
          {humanId ? <a href={humanProfileHref(humanId)}>{name}</a> : <span>{name}</span>}
        </div>
        <div className="ox-ref-popover-row">
          <span>When</span>
          <span>{datetime}</span>
        </div>
        <div className="ox-ref-popover-row">
          <span>Source</span>
          <a href={location}>{location}</a>
        </div>
      </OxPopover>
    </span>
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
