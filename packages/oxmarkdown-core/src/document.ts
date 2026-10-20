/**
 * OxMarkdown document model — parse/serialize, framework-agnostic.
 *
 * Replaces the `\n\n`-split ProseNode approach in `nopalEditorState.ts` with
 * a real markdown AST (mdast), so block structure — including a directive
 * that wraps multiple paragraphs — is a real nested tree instead of
 * independently-parsed string chunks. See the `oxmarkdown` skill, "Build
 * plan" step 1, and the "KNOWN LIMITATION" note in `util/nopalDirectives.ts`
 * this replaces.
 *
 * No React import here, on purpose. Parsing/serializing markdown is pure
 * data transformation — kept separate from any rendering layer so this
 * stays usable outside a React context (see the `oxmarkdown` skill's
 * "Future: native apps" note). `components/OxRenderer.tsx` is the React
 * wrapper that consumes this.
 *
 * Uses the real `mdast-util-directive` / `mdast-util-frontmatter` /
 * `mdast-util-gfm` packages — the spec-compliant implementations of the
 * exact syntax `util/nopalDirectives.ts` hand-rolled with regex. All three
 * were already transitive dependencies (via `@mdxeditor/editor`); they're
 * now real, direct dependencies instead.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown, type Join } from "mdast-util-to-markdown";
import { directive } from "micromark-extension-directive";
import {
  directiveFromMarkdown,
  directiveToMarkdown,
} from "mdast-util-directive";
import { frontmatter } from "micromark-extension-frontmatter";
import {
  frontmatterFromMarkdown,
  frontmatterToMarkdown,
} from "mdast-util-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import {
  highlightMark,
  highlightMarkFromMarkdown,
  highlightMarkToMarkdown,
} from "./highlightMark.js";
import type {
  BlockContent,
  DefinitionContent,
  Parent,
  PhrasingContent,
  Root,
  Yaml,
} from "mdast";

export type OxDocument = Root;

// ── Directive node types ────────────────────────────────────────────────────
// `mdast-util-directive` doesn't ship `mdast` module-augmentation types, so
// the runtime shape is declared here directly — verified against its source
// (`mdast-util-directive/lib/index.js`: `{ type, name, attributes, children }`).

interface DirectiveNodeBase extends Parent {
  name: string;
  attributes: Record<string, string> | null;
}

export interface TextDirective extends DirectiveNodeBase {
  type: "textDirective";
  children: PhrasingContent[];
}

export interface LeafDirective extends DirectiveNodeBase {
  type: "leafDirective";
  children: PhrasingContent[];
}

export interface ContainerDirective extends DirectiveNodeBase {
  type: "containerDirective";
  children: (BlockContent | DefinitionContent)[];
}

export type DirectiveNode = TextDirective | LeafDirective | ContainerDirective;

export function isDirectiveNode(node: { type: string }): node is DirectiveNode {
  return (
    node.type === "textDirective" ||
    node.type === "leafDirective" ||
    node.type === "containerDirective"
  );
}

export type DirectiveAttrs = Record<string, string>;

/** Directive attributes, always a plain object (never `null`) for callers —
 * `mdast-util-directive` allows `null` when a directive has no `{...}` at all. */
export function directiveAttrs(node: DirectiveNode): DirectiveAttrs {
  return node.attributes ?? {};
}

// ── Front matter ─────────────────────────────────────────────────────────────

/** The document's front matter node, if present — always the first child
 * when it exists. Its `.value` is the raw YAML text (no `---` delimiters). */
export function getFrontmatterNode(doc: OxDocument): Yaml | null {
  const first = doc.children[0];
  return first && first.type === "yaml" ? (first as Yaml) : null;
}

// ── Parse / serialize ────────────────────────────────────────────────────────

export function parseOxDocument(markdown: string): OxDocument {
  return fromMarkdown(markdown, {
    extensions: [directive(), frontmatter("yaml"), gfm(), highlightMark()],
    mdastExtensions: [
      directiveFromMarkdown(),
      frontmatterFromMarkdown("yaml"),
      gfmFromMarkdown(),
      highlightMarkFromMarkdown(),
    ],
  });
}

export function serializeOxDocument(doc: OxDocument, extraJoin?: Join): string {
  return toMarkdown(doc, {
    extensions: [
      directiveToMarkdown(),
      frontmatterToMarkdown("yaml"),
      gfmToMarkdown(),
      highlightMarkToMarkdown(),
    ],
    bullet: "-",
    fences: true,
    incrementListMarker: false,
    listItemIndent: "one",
    // `OxEditor`'s Editing mode passes a custom join (`editingTransforms.ts`'s
    // `blankLineJoin`) that forces ZERO blank lines around any empty-
    // paragraph node specifically — each one already represents exactly one
    // real blank line by sitting in the flow with nothing else added around
    // it, so the library's own default join (which would otherwise ALSO add
    // its usual blank line on top) has to be turned off for those specific
    // pairs. Confirmed directly, not assumed: N empty paragraphs with every
    // surrounding join forced to 0 serializes to exactly N blank lines.
    join: extraJoin ? [extraJoin] : undefined,
  });
}

/** How many blank lines BEYOND the one CommonMark already requires to
 * separate two blocks sat between them in the original source — using each
 * node's real `position` (line numbers survive parsing even though the AST
 * itself has no "blank line" node type; see the oxmarkdown skill's TODO 10).
 * Shared by `OxRenderer`'s static spacer rendering and `OxEditor`'s Editing-
 * mode import, so both surfaces treat "how many blank lines were here" the
 * same way. Returns 0 (not negative) when nodes are missing position info
 * or the gap is at/under the ordinary minimum. */
export function countExtraBlankLines(
  prev: { position?: { end: { line: number } } },
  next: { position?: { start: { line: number } } },
): number {
  return Math.max(0, countBlankLines(prev, next) - 1);
}

/** The TOTAL number of blank lines between two blocks in the original
 * source (0 or more) — unlike `countExtraBlankLines` above, not reduced by
 * the one CommonMark already requires. Used by `OxEditor`'s Editing-mode
 * import (`editingTransforms.ts`) to materialize each blank line as a real,
 * ordinary empty `ParagraphNode` — one editor row per source line, per the
 * oxmarkdown skill's "1 markdown line = 1 editor line" principle — rather
 * than the static renderer's approach (one default-margin gap, plus a
 * spacer per line beyond that), which is fine for read-only display but
 * isn't what a live-editable surface needs. */
export function countBlankLines(
  prev: { position?: { end: { line: number } } },
  next: { position?: { start: { line: number } } },
): number {
  const prevPos = prev.position;
  const nextPos = next.position;
  if (!prevPos || !nextPos) return 0;
  return Math.max(0, nextPos.start.line - prevPos.end.line - 1);
}

/** How many grid units of space a READING surface (`OxRenderer`'s
 * `renderBlockNodes`, both the fruits and webapp copies) draws between two
 * sibling blocks. The file's own blank-line count, literally, with one
 * exception: a heading always gets at least one line above it, so text
 * never runs straight into the next heading (Austin, 2026-10-20: "one
 * deliberate line between text and a heading"). Below a heading stays
 * literal — no space unless someone typed a blank line there. More than
 * one typed line above a heading is kept, never collapsed.
 *
 * Only ever called BETWEEN siblings, so a heading that opens its container
 * (the document, a section, a list item, ...) gets nothing above it.
 * Editing mode deliberately doesn't use this: there, one line in the file
 * is one row on screen, and a forced line would be a row that isn't in
 * the file — it keeps reading `countBlankLines` directly. */
export function blankLineUnits(
  prev: { position?: { end: { line: number } } },
  next: { type?: string; position?: { start: { line: number } } },
): number {
  const blanks = countBlankLines(prev, next);
  return next.type === "heading" ? Math.max(1, blanks) : blanks;
}

/** A `serializeOxDocument` join that keeps the source file's own blank
 * lines between any two blocks that both came from it (they carry a
 * `position`), instead of the library default of exactly one everywhere.
 * For a mutate-and-reserialize edit of a PARSED tree — Interacting mode's
 * checkbox toggle, a directive popover's attribute edit — so one click
 * changes the one thing clicked, not every blank-line run and heading gap
 * in the file. A node added since the parse has no `position` and gets the
 * library's ordinary single blank line. */
export const sourceBlankLineJoin: Join = (left, right) => {
  if (!left.position || !right.position) return undefined;
  return countBlankLines(left, right);
};

const ATX_HEADING_LINE_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE_LINE_RE = /^ {0,3}(```|~~~)/;

/** Puts headings in markdown that a MODEL wrote (not a person) into the
 * same shape everywhere: exactly one blank line above a heading that isn't
 * the first line, no blank lines directly under one, and no blank lines at
 * the very start or end. Line-based (an ATX `#` line), leaving fenced code
 * untouched. For writers like GraphLog's Efforts page (`update_section`),
 * where whatever blank lines the model happened to send would otherwise
 * become the page's spacing — never run on a person's own text, whose
 * blank lines are deliberate. */
export function normalizeHeadingSpacing(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let afterHeading = false;
  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(FENCE_LINE_RE);
    if (fence) {
      out.push(line);
      if (fenceMatch && fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      afterHeading = false;
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      if (!afterHeading) out.push("");
      continue;
    }
    if (ATX_HEADING_LINE_RE.test(line)) {
      while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
      if (out.length > 0) out.push("");
      out.push(line);
      afterHeading = true;
      continue;
    }
    afterHeading = false;
    out.push(line);
  }
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}
