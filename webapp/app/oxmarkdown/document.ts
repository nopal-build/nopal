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
    extensions: [directive(), frontmatter("yaml"), gfm()],
    mdastExtensions: [
      directiveFromMarkdown(),
      frontmatterFromMarkdown("yaml"),
      gfmFromMarkdown(),
    ],
  });
}

export function serializeOxDocument(doc: OxDocument, extraJoin?: Join): string {
  return toMarkdown(doc, {
    extensions: [
      directiveToMarkdown(),
      frontmatterToMarkdown("yaml"),
      gfmToMarkdown(),
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
