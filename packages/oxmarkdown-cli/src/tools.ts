/**
 * Pure, framework-agnostic tool implementations for the OxMarkdown MCP
 * server — every function here takes/returns plain strings and JSON, built
 * directly on `oxmarkdown-core` (the same parse/serialize package the web
 * app's `OxRenderer`/`OxEditor` and GraphLog's worker both already share —
 * see the `oxmarkdown` skill). Kept separate from `index.ts` so the MCP
 * wiring (zod schemas, transport) never mixes with the actual logic.
 */
import {
  appendCardDirectiveMarkdown,
  buildRefDirectiveMarkdown,
  directiveAttrs,
  isDirectiveNode,
  parseOxDocument,
  parseRefAttrs,
  removeCardDirectiveMarkdown,
  serializeOxDocument,
  type DirectiveNode,
  type RefAttrs,
} from "oxmarkdown-core";
import { stripPositions, walk } from "./walk";

// ── Parse / format ──────────────────────────────────────────────────────────

export function parseMarkdown(markdown: string, includePositions: boolean): unknown {
  const doc = parseOxDocument(markdown);
  return includePositions ? doc : stripPositions(doc);
}

/** Round-trips through the real parser/serializer — normalizes bullet
 * markers, fence style, list indent, etc. to OxMarkdown's own canonical
 * output (see `document.ts`'s `serializeOxDocument`), the same shape any
 * OxEditor save produces. Useful for cleaning up hand-written or
 * externally-generated markdown before it's saved into a vault file. */
export function formatMarkdown(markdown: string): string {
  return serializeOxDocument(parseOxDocument(markdown));
}

// ── Directives ───────────────────────────────────────────────────────────────

export interface DirectiveSummary {
  kind: "leaf" | "container" | "text";
  name: string;
  attributes: Record<string, string>;
  line: number | null;
}

const DIRECTIVE_KIND: Record<DirectiveNode["type"], DirectiveSummary["kind"]> = {
  leafDirective: "leaf",
  containerDirective: "container",
  textDirective: "text",
};

export function listDirectives(markdown: string): DirectiveSummary[] {
  const doc = parseOxDocument(markdown);
  const results: DirectiveSummary[] = [];
  walk(doc, (node) => {
    if (!isDirectiveNode(node)) return;
    results.push({
      kind: DIRECTIVE_KIND[node.type],
      name: node.name,
      attributes: directiveAttrs(node),
      line: node.position?.start.line ?? null,
    });
  });
  return results;
}

// ── Mentions ─────────────────────────────────────────────────────────────────

export interface MentionSummary {
  label: string;
  path: string;
  line: number | null;
}

function inlineText(node: any): string {
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map(inlineText).join("");
}

/** An `@mention` is saved as an ordinary `[@Name](path)` markdown link (see
 * the oxmarkdown skill's "`@` mentions" section) — never a directive or a
 * special node type — so finding one means walking every `link` node and
 * checking whether its own rendered text starts with `@`. */
export function listMentions(markdown: string): MentionSummary[] {
  const doc = parseOxDocument(markdown);
  const results: MentionSummary[] = [];
  walk(doc, (node) => {
    if (node.type !== "link") return;
    const label = inlineText(node);
    if (!label.startsWith("@")) return;
    results.push({ label, path: node.url, line: node.position?.start.line ?? null });
  });
  return results;
}

// ── Lint ─────────────────────────────────────────────────────────────────────

export interface LintIssue {
  severity: "error" | "warning";
  message: string;
  line: number | null;
}

/** Built-in interactable directive names `OxRenderer`/`OxEditor` know how
 * to render specially (see the oxmarkdown skill's "Build status"). Not
 * exhaustive of every directive a CALLER might register into its own
 * `DirectiveRegistry` (e.g. `csv-key`) — an unrecognized name is only ever
 * flagged as a warning, never an error, since it may simply be one of
 * those caller-registered kinds this tool has no way to know about. */
const KNOWN_BUILTIN_DIRECTIVES = new Set([
  "file",
  "card",
  "gallery",
  "grid",
  "col",
  "toggle",
  "ref",
  "embed",
  "csv-key",
]);

/** Heuristic, non-exhaustive structural checks — not a full validator
 * against every rendering rule in the oxmarkdown skill, just the mistakes
 * most likely to silently degrade to "unknown directive"/plain text at
 * render time instead of erroring loudly. */
export function lintMarkdown(markdown: string): LintIssue[] {
  const doc = parseOxDocument(markdown);
  const issues: LintIssue[] = [];

  walk(doc, (node) => {
    if (!isDirectiveNode(node)) return;
    const line = node.position?.start.line ?? null;

    if (node.name === "ref" && node.type === "textDirective") {
      if (!parseRefAttrs(node)) {
        issues.push({
          severity: "error",
          message: ':ref{...} is missing a required attribute (name, datetime, location)',
          line,
        });
      }
      return;
    }

    if (node.name === "card" && node.type === "leafDirective") {
      if (!directiveAttrs(node).file) {
        issues.push({
          severity: "error",
          message: '::card{...} is missing its required "file" attribute',
          line,
        });
      }
      return;
    }

    if (node.name === "gallery" && node.type === "leafDirective") {
      if (!directiveAttrs(node).folder) {
        issues.push({
          severity: "error",
          message: '::gallery{...} (folder-referencing leaf form) is missing its required "folder" attribute',
          line,
        });
      }
      return;
    }

    if (!KNOWN_BUILTIN_DIRECTIVES.has(node.name)) {
      issues.push({
        severity: "warning",
        message: `Unrecognized directive name ":${node.name}" — fine if some caller registers this via its own DirectiveRegistry, otherwise it renders as "unknown directive"`,
        line,
      });
    }
  });

  // `==highlighted==` resolves paired delimiters into real `mark` nodes;
  // any literal "==" left in the source on a line with no `mark` node is
  // either a genuinely unmatched delimiter or plain text that happens to
  // contain "==" — flagged as a warning either way, since it's cheap for a
  // human/agent to eyeball and confirm.
  const markLines = new Set<number>();
  walk(doc, (node) => {
    if (node.type === "mark" && node.position) markLines.add(node.position.start.line);
  });
  markdown.split("\n").forEach((lineText, idx) => {
    const lineNo = idx + 1;
    if (lineText.includes("==") && !markLines.has(lineNo)) {
      issues.push({
        severity: "warning",
        message: 'Line contains "==" not recognized as a matched ==highlight== pair',
        line: lineNo,
      });
    }
  });

  return issues;
}

// ── Directive builders (write helpers) ──────────────────────────────────────

export function buildRefDirective(attrs: RefAttrs): string {
  return buildRefDirectiveMarkdown(attrs);
}

export function insertCardDirective(
  markdown: string,
  attrs: { file: string; projectFolderId: string },
): string {
  return appendCardDirectiveMarkdown(markdown, attrs);
}

export function removeCardDirective(markdown: string, file: string): string {
  return removeCardDirectiveMarkdown(markdown, file);
}
