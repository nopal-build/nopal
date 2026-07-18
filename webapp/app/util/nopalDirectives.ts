/**
 * Generic directives — a hand-rolled take on the "generic directives"
 * markdown convention (see the `remark-directive` package / the CommonMark
 * directives proposal). Colon count sets scope, exactly like the spec:
 *
 *   :name{attrs}        text directive       — inline, e.g. :csv-key{key="x"}
 *   ::name{attrs}       leaf directive       — standalone block, own line
 *   :::name{attrs}      container directive — wraps nested markdown
 *   ...content...
 *   :::
 *
 * This is NOT the `remark-directive` package — it's a small regex-based
 * preprocessor in the same spirit as `preprocessWikiLinks`/the old
 * `preprocessCsvRefs` in MdxRenderer.tsx, so it plugs into the existing
 * per-paragraph render pipeline without a unified/remark-ecosystem
 * dependency. It borrows the *convention* (colon count = scope), not
 * byte-for-byte spec compliance (no escaping edge cases, `[label]` support
 * is intentionally minimal).
 *
 * KNOWN LIMITATION: a ProseNode is one `\n\n`-delimited paragraph (see
 * `importFromMarkdown` in nopalEditorState.ts), so a container directive's
 * content must not itself contain a blank line — it can't wrap multiple
 * paragraphs today. Lifting that means teaching `importFromMarkdown` to
 * treat an unclosed `:::` as "keep consuming paragraphs," which is real
 * surgery on the core editor state. Deliberately deferred to the OxMarkdown
 * rewrite (see `.agents/skills/oxmarkdown/SKILL.md`) rather than done here.
 * A single, possibly multi-line (soft-wrapped) block works fine.
 *
 * This file has NO server-only imports — safe on both client and server.
 */

import type { ReactNode } from "react";

export type DirectiveAttrs = Record<string, string>;

export type ParsedDirective = {
  name: string;
  label: string | null;
  attrs: DirectiveAttrs;
};

const NAME = "[a-zA-Z][\\w-]*";
const LABEL = "(?:\\[([^\\]\\n]*)\\])?";
const ATTRS_OPTIONAL = "(?:\\{([^}\\n]*)\\})?";
/** Text directives require attrs — otherwise ordinary prose containing a
 * colon (e.g. "Note: bring snacks") would constantly false-positive. */
const ATTRS_REQUIRED = "\\{([^}\\n]*)\\}";

const CONTAINER_RE = new RegExp(
  `^:::(${NAME})${LABEL}${ATTRS_OPTIONAL}[ \\t]*\\n([\\s\\S]*?)\\n:::[ \\t]*$`,
  "gm",
);
const LEAF_RE = new RegExp(`^::(${NAME})${LABEL}${ATTRS_OPTIONAL}[ \\t]*$`, "gm");
const TEXT_RE = new RegExp(`:(${NAME})${LABEL}${ATTRS_REQUIRED}`, "g");

export function parseDirectiveAttrs(raw: string | undefined): DirectiveAttrs {
  if (!raw) return {};
  const attrs: DirectiveAttrs = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]] = m[2];
  return attrs;
}

/**
 * Every leaf directive (`::name{...}`) in a piece of markdown — used
 * server-side to know which files/folders a project's directives reference,
 * without needing the full render pipeline (see `project.server.ts`).
 */
export function extractLeafDirectives(text: string): ParsedDirective[] {
  const out: ParsedDirective[] = [];
  for (const m of text.matchAll(LEAF_RE)) {
    out.push({ name: m[1], label: m[2] ?? null, attrs: parseDirectiveAttrs(m[3]) });
  }
  return out;
}

function attr(name: string, value: string): string {
  return `data-${name}="${encodeURIComponent(value)}"`;
}

/**
 * Replaces every directive with an inert HTML placeholder element carrying
 * its name/label/attrs (and, for containers, its raw inner content) as
 * data-attributes, for a `span`/`div` component override to intercept at
 * render time (see MdxRenderer.tsx). Order matters: containers first (so
 * their interior isn't mistaken for standalone leaf directives), then leaf,
 * then text.
 */
export function preprocessDirectives(text: string): string {
  text = text.replace(CONTAINER_RE, (_m, name, label, rawAttrs, content) => {
    const attrs = JSON.stringify(parseDirectiveAttrs(rawAttrs));
    return (
      `<div class="nopal-directive-container" ${attr("directive-name", name)} ` +
      `${attr("directive-label", label ?? "")} ${attr("directive-attrs", attrs)} ` +
      `${attr("directive-content", content)}></div>`
    );
  });

  text = text.replace(LEAF_RE, (_m, name, label, rawAttrs) => {
    const attrs = JSON.stringify(parseDirectiveAttrs(rawAttrs));
    return (
      `<div class="nopal-directive-leaf" ${attr("directive-name", name)} ` +
      `${attr("directive-label", label ?? "")} ${attr("directive-attrs", attrs)}></div>`
    );
  });

  text = text.replace(TEXT_RE, (_m, name, label, rawAttrs) => {
    const attrs = JSON.stringify(parseDirectiveAttrs(rawAttrs));
    return (
      `<span class="nopal-directive-text" ${attr("directive-name", name)} ` +
      `${attr("directive-label", label ?? "")} ${attr("directive-attrs", attrs)}></span>`
    );
  });

  return text;
}

// ── Rendering registry ──────────────────────────────────────────────────────
// Callers of MdxRenderer/MdxEditorView (e.g. ProjectView) supply a registry
// mapping directive names to renderers, so MdxRenderer itself stays
// domain-agnostic — it doesn't know what "csv-table" or "gallery" mean, only
// how to parse `::csv-table{...}` and hand it off.

export type DirectiveRenderProps = {
  attrs: DirectiveAttrs;
  label: string | null;
  /** Only present for container directives — the recursively-rendered inner markdown. */
  children?: ReactNode;
};

export type DirectiveRenderer = (props: DirectiveRenderProps) => ReactNode;

export type DirectiveRegistry = Record<string, DirectiveRenderer>;
