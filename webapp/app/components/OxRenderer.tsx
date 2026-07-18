/**
 * OxRenderer — static rendering of an OxMarkdown document.
 *
 * Walks the real mdast tree from `oxmarkdown/document.ts` directly (no
 * regex placeholders, no per-paragraph independent parses — see the
 * `oxmarkdown` skill's "Build plan" step 1). Pure display only: no
 * selection, no click/backspace/act behavior yet — that's `OxEditor`
 * (step 2), built on top of this.
 *
 * Visual output is intentionally NOT a port of `.nopal-content` — see
 * `styles/oxmarkdown.css` for the themable `.ox-content` system this uses
 * instead, modeled off the same design language.
 */

import { Fragment, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Definition, RootContent } from "mdast";
import {
  parseOxDocument,
  directiveAttrs,
  isDirectiveNode,
  type OxDocument,
  type DirectiveNode,
} from "../oxmarkdown/document";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
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
  className?: string;
}

export default function OxRenderer({
  markdown,
  directives,
  theme,
  className,
}: OxRendererProps) {
  const doc = useMemo(() => parseOxDocument(markdown), [markdown]);
  const definitions = useMemo(() => collectDefinitions(doc), [doc]);
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  return (
    <div
      className={`ox-content${className ? ` ${className}` : ""}`}
      style={style}
    >
      {renderNodes(doc.children, { directives, definitions })}
    </div>
  );
}

interface RenderCtx {
  directives?: DirectiveRegistry;
  definitions: Map<string, Definition>;
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
      return <blockquote key={key}>{renderNodes(node.children, ctx)}</blockquote>;

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
    return <li key={key}>{renderNodes(node.children, ctx)}</li>;
  }

  // Task item: unwrap the first paragraph's inline content into the label
  // (matching the old system's flat "task text" concept); any remaining
  // block children (a nested list, etc.) render normally after it.
  const [first, ...rest] = node.children;
  const labelChildren = first?.type === "paragraph" ? first.children : [first].filter(Boolean);

  return (
    <li key={key} className="ox-task-item">
      <span
        className={`ox-task-checkbox${node.checked ? " checked" : ""}`}
        role="checkbox"
        aria-checked={node.checked}
      />
      <span className={`ox-task-text${node.checked ? " ox-task-text--checked" : ""}`}>
        {renderNodes(labelChildren, ctx)}
      </span>
      {rest.length > 0 && renderNodes(rest, ctx)}
    </li>
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
  const attrs = directiveAttrs(node);
  const renderer = ctx.directives?.[node.name];

  if (node.type === "containerDirective") {
    const rendered = <Fragment key="inner">{renderNodes(node.children, ctx)}</Fragment>;
    // Unregistered container name: still show the content, just without
    // whatever wrapper the registry would have added — matches how an
    // unrecognized HTML element degrades to its children in the browser.
    if (!renderer) return <Fragment key={key}>{rendered}</Fragment>;
    return <Fragment key={key}>{renderer({ attrs, label: null, children: rendered })}</Fragment>;
  }

  if (!renderer) {
    return node.type === "leafDirective" ? (
      <div key={key} className="ox-directive-unknown ox-directive-unknown--block">
        Unknown block: ::{node.name}
      </div>
    ) : (
      <span key={key} className="ox-directive-unknown">
        :{node.name}
      </span>
    );
  }

  return <Fragment key={key}>{renderer({ attrs, label: null })}</Fragment>;
}

// Re-exported so callers can check a node's type without importing from
// `oxmarkdown/document.ts` directly, if they only otherwise touch this file.
export { isDirectiveNode };
