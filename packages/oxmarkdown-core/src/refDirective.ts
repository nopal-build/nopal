/**
 * Shared types + markdown-building logic for the `:ref{...}` interactable
 * — an inline, read-only attribution mark: who said/wrote something, when,
 * and where it came from. Built for GraphLog (see the `graphlog` skill),
 * whose `sync-graph` stage writes one alongside every node it extracts into
 * a day's `Graph/graph-log-YYYY-MM-DD.md`, but usable anywhere a statement
 * needs a lightweight "who/when/where" citation.
 *
 * A TEXT directive (`:ref{...}`, inline, no children — same tier as
 * `::file{...}`/`::card{...}`: a built-in interactable rendered directly by
 * `OxRenderer.tsx`, never a caller-registered `DirectiveRegistry` entry,
 * and never editable by a human — GraphLog is the only writer). Framework-
 * agnostic (no React import), same reasoning as `cardDirective.ts`: both
 * the web app's renderer AND GraphLog's server-side pipeline (writing
 * these into graph-log files) need to agree on the exact attribute shape
 * without either one owning the other.
 */

import type { DirectiveNode, TextDirective } from "./document";

/** The five params from the spec, as a plain object — `humanId` is
 * optional (a node might cite a source with no known Human record yet),
 * everything else is required. `verbose` defaults to `false` when omitted
 * from the built markdown (see `buildRefDirectiveMarkdown`) — GraphLog only
 * ever passes `verbose: true` when writing into a `Graph/graph-log-*.md`
 * file; every other use (a future citation elsewhere) should omit it. */
export interface RefAttrs {
  /** Display name of the person being cited. */
  name: string;
  /** This app's Human id, if the source is a known human — lets the
   * rendered name link to their vault root (see `OxRenderer.tsx`'s
   * `RefDirectiveStatic`). Omit for an unknown/external source. */
  humanId?: string;
  /** ISO 8601 datetime string. Rendering formats this for display; the
   * raw ISO string is what's actually stored in the directive attribute so
   * it round-trips losslessly and sorts/parses unambiguously. */
  datetime: string;
  /** Path to the originating content (a vault path, or any other href the
   * writer considers a stable pointer back to the source) — rendered as a
   * link in both display modes. */
  location: string;
  /** `true` only for verbatim graph-log entries (see the module header) —
   * every other usage should omit this attribute entirely, which is the
   * same as `false`. */
  verbose?: boolean;
}

/** Attribute keys as written into the directive's `{...}` — kept as named
 * constants so the writer (GraphLog) and reader (`OxRenderer.tsx`) can't
 * drift apart on spelling. */
export const REF_ATTR_KEYS = {
  name: "name",
  humanId: "human-id",
  datetime: "datetime",
  location: "location",
  verbose: "verbose",
} as const;

/** `micromark-extension-directive`'s attribute-value parser has NO escape
 * mechanism at all for `"` inside a double-quoted value — confirmed
 * directly: a backslash-escaped quote doesn't get unescaped, it breaks
 * attribute parsing outright (the whole `attributes` object comes back
 * `null`, silently dropping every attribute, not just the one containing
 * the quote). So a literal `"` can never survive round-tripping through
 * this directive syntax at all — the only real option is to substitute a
 * visually-similar character rather than write markdown this parser can't
 * read back. Swapped for a right double quotation mark (”) rather than a
 * plain apostrophe, so "nickname in quotes" still reads as a quote, just a
 * curly one instead of a straight one. */
function escapeDirectiveAttrValue(value: string): string {
  return value.replace(/"/g, "\u201d");
}

/** Builds the literal `:ref{...}` markdown text for one attribution — what
 * GraphLog's `sync-graph` stage appends inline after a cited statement.
 * Deliberately a plain string builder, not a mutation of an existing
 * `DirectiveNode`, since GraphLog only ever composes fresh markdown text
 * (a whole `graph-log-*.md` file), never edits an existing parsed tree the
 * way `cardDirective.ts`'s append/remove helpers do for a live document. */
export function buildRefDirectiveMarkdown(attrs: RefAttrs): string {
  const parts = [
    `${REF_ATTR_KEYS.name}="${escapeDirectiveAttrValue(attrs.name)}"`,
  ];
  if (attrs.humanId) {
    parts.push(`${REF_ATTR_KEYS.humanId}="${escapeDirectiveAttrValue(attrs.humanId)}"`);
  }
  parts.push(`${REF_ATTR_KEYS.datetime}="${escapeDirectiveAttrValue(attrs.datetime)}"`);
  parts.push(`${REF_ATTR_KEYS.location}="${escapeDirectiveAttrValue(attrs.location)}"`);
  if (attrs.verbose) {
    parts.push(`${REF_ATTR_KEYS.verbose}="true"`);
  }
  return `:ref{${parts.join(" ")}}`;
}

/** Reads a parsed `:ref{...}` node's attributes back into `RefAttrs` —
 * the read-side mirror of `buildRefDirectiveMarkdown`, used by
 * `OxRenderer.tsx` so it never hand-rolls the same attribute-key spelling
 * a second time. Tolerant of a missing/malformed node (returns `null`)
 * rather than throwing — a hand-edited or foreign `:ref{...}` with missing
 * required attributes should degrade to the generic "unknown directive"
 * rendering, not crash the page. */
export function parseRefAttrs(node: DirectiveNode): RefAttrs | null {
  const attrs = node.attributes ?? {};
  const name = attrs[REF_ATTR_KEYS.name];
  const datetime = attrs[REF_ATTR_KEYS.datetime];
  const location = attrs[REF_ATTR_KEYS.location];
  if (!name || !datetime || !location) return null;
  return {
    name,
    humanId: attrs[REF_ATTR_KEYS.humanId] || undefined,
    datetime,
    location,
    verbose: attrs[REF_ATTR_KEYS.verbose] === "true",
  };
}

export function isRefDirective(node: { type: string; name?: string }): node is TextDirective {
  return node.type === "textDirective" && node.name === "ref";
}
