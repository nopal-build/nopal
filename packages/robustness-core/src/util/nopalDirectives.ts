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
 * matcher, in the same spirit as `preprocessWikiLinks` used to be. It
 * borrows the *convention* (colon count = scope), not byte-for-byte spec
 * compliance (no escaping edge cases, `[label]` support is intentionally
 * minimal).
 *
 * Used to also power the old `MdxRenderer`/`MdxEditorView` rendering
 * pipeline (a `preprocessDirectives` regex pass, a `DirectiveRegistry`
 * caller-supplied-renderer contract, and `project.server.ts`'s
 * `extractLeafDirectives`-driven `file=`/`folder=` resolution feeding
 * `ProjectView.tsx`). All of that is retired along with `MdxEditor` — see
 * the `oxmarkdown` skill's Build status. `OxRenderer`/`oxmarkdown-core` has
 * its own, unrelated directive model (real mdast nodes, not regex).
 *
 * What's LEFT here is narrower: only the LEAF-directive matcher
 * (`findLeafDirectiveOccurrences`/`replaceDirectiveAttrInMatch`), which
 * `fileReferences.server.ts` still uses for File Referencing & Renaming —
 * keeping a `::name{file="Old Name"}` attribute pointed at the right file
 * even after that file gets renamed, independent of whether anything still
 * renders the directive itself.
 *
 * This file has NO server-only imports — safe on both client and server.
 */

export type DirectiveAttrs = Record<string, string>;

export type ParsedDirective = {
  name: string;
  label: string | null;
  attrs: DirectiveAttrs;
};

const NAME = "[a-zA-Z][\\w-]*";
const LABEL = "(?:\\[([^\\]\\n]*)\\])?";
const ATTRS_OPTIONAL = "(?:\\{([^}\\n]*)\\})?";

const LEAF_RE = new RegExp(`^::(${NAME})${LABEL}${ATTRS_OPTIONAL}[ \\t]*$`, "gm");

export function parseDirectiveAttrs(raw: string | undefined): DirectiveAttrs {
  if (!raw) return {};
  const attrs: DirectiveAttrs = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]] = m[2];
  return attrs;
}

export type LeafDirectiveOccurrence = ParsedDirective & {
  /** Index into the ORIGINAL string where this occurrence's full match
   * (`::name{...}`) starts — lets a caller splice a targeted replacement
   * back in without a full re-parse/re-serialize of the whole document
   * (see `fileReferences.server.ts`, which needs this for File Referencing
   * & Renaming's rename propagation). */
  index: number;
  /** The exact, verbatim substring matched (`m[0]`). */
  match: string;
};

/** Every leaf directive (`::name{...}`) occurrence in a piece of markdown,
 * with each occurrence's exact position/raw text — needed to rewrite ONE
 * specific directive's attribute value in place
 * (`replaceDirectiveAttrInMatch` below) without disturbing anything else in
 * the file. */
export function findLeafDirectiveOccurrences(text: string): LeafDirectiveOccurrence[] {
  const out: LeafDirectiveOccurrence[] = [];
  for (const m of text.matchAll(LEAF_RE)) {
    out.push({
      name: m[1],
      label: m[2] ?? null,
      attrs: parseDirectiveAttrs(m[3]),
      index: m.index ?? 0,
      match: m[0],
    });
  }
  return out;
}

/**
 * Replaces ONE attribute's value within a SPECIFIC leaf-directive
 * occurrence's own raw text (as returned by `findLeafDirectiveOccurrences`)
 * — a scoped, single-attribute string replace rather than a full
 * re-parse/re-serialize, so nothing else about the directive (attribute
 * order, quoting, other attributes) or the rest of the file is touched.
 * A no-op (returns `matchText` unchanged) if the attribute isn't present.
 */
export function replaceDirectiveAttrInMatch(
  matchText: string,
  attrName: string,
  newValue: string,
): string {
  const re = new RegExp(`(\\b${attrName}\\s*=\\s*")[^"]*(")`);
  return matchText.replace(re, `$1${newValue}$2`);
}
