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
import { toMarkdown } from "mdast-util-to-markdown";
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

/** Directive attributes, always a plain object (never `null`) for callers —
 * `mdast-util-directive` allows `null` when a directive has no `{...}` at all. */
export function directiveAttrs(node: DirectiveNode): Record<string, string> {
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

export function serializeOxDocument(doc: OxDocument): string {
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
  });
}
