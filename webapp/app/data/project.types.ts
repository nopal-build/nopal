/**
 * Project manifest — the "language" AI (or a human) uses to declare how a
 * folder under the `projects` vault root should be rolled up into a single
 * view, instead of just a plain file/folder table.
 *
 * A project is still just an ordinary vault folder. Front matter on that
 * folder's `README.md` carries a handful of flat, document-level facts
 * (title/type/layout) — the traditional, idiomatic use of front matter (see
 * Jekyll/Hugo/Astro/Obsidian's Properties panel). It deliberately does NOT
 * hold the project's content blocks; those live inline in the README's own
 * body as generic directives (see `util/nopalDirectives.ts`), so the body
 * reads as one continuous document instead of a manifest pointing at a
 * separate `overview.md`. A folder with no front matter, or malformed front
 * matter, simply falls back to the plain vault folder view: nothing breaks.
 *
 * Example `README.md`:
 *
 *   ---
 *   title: Casa Verde Remodel
 *   type: client-deliverable
 *   layout: grid
 *   ---
 *
 *   # Casa Verde Remodel
 *
 *   Full kitchen and primary bath remodel for the Verde family.
 *
 *   ::csv-table{file="budget.csv" title="Budget"}
 *
 *   ::gallery{folder="photos" title="Progress Photos" size="half"}
 *
 *   ::svg{file="floorplan.svg" title="Floor Plan" size="half"}
 *
 * This file has NO server-only imports — safe on both client and server.
 */

import { parse as parseYaml } from "yaml";

/**
 * How much horizontal space a directive block wants on wide viewports.
 * Ignored below the `md` breakpoint — every block stacks full-width on
 * mobile regardless, so a badly-chosen size never breaks the small-screen
 * reading experience. See `ProjectView.tsx` for how this maps to CSS grid
 * spans.
 */
export type ProjectBlockSize = "third" | "half" | "full";

/**
 * "document": single column, always — the blog/docs feel. This is just the
 *   plain markdown rendering every other vault file already gets; size
 *   hints on directives are ignored. Default, because it can never look
 *   broken on any viewport.
 * "grid": a responsive bento grid on `md`+ viewports (dashboard/client
 *   deliverable feel), collapsing to a single stacked column on mobile.
 */
export type ProjectLayout = "document" | "grid";

export type ProjectManifest = {
  title?: string;
  /** Free-form label (e.g. "blog", "client-deliverable", "budget"). Not yet
   * used to drive behavior — reserved for future default styling/layout. */
  type?: string;
  /** Defaults to "document" — the layout that can never look broken. */
  layout?: ProjectLayout;
};

/** Resolved data a directive block needs to render — deliberately narrow (a
 * URL/name plus optional inline text) rather than a full `FileRef`, so the
 * renderer has no vault-specific coupling and this shape is trivially
 * JSON-serializable as loader data (no Map/Set — plain Records keyed by the
 * `file`/`folder` attribute value as written in the directive). */
export type ResolvedFile = { url: string; name: string; content?: string };

/** The fully-resolved payload a project view needs to render. Built
 * server-side by `resolveProjectManifest` in `project.server.ts`. */
export type ResolvedProject = {
  manifest: ProjectManifest;
  /** The README's body, with front matter stripped — rendered as-is via
   * MdxEditorView; directives inside it are resolved against `files`/`folders`. */
  body: string;
  /** Keyed by a directive's `file="..."` attribute value. */
  files: Record<string, ResolvedFile>;
  /** Keyed by a directive's `folder="..."` attribute value — every image
   * file found directly inside that subfolder. */
  folders: Record<string, ResolvedFile[]>;
  /** Flat key/value facts parsed from `project.csv`, if present in the
   * folder — what `:csv-key{key="..."}` resolves against (see
   * `util/projectCsv.ts`). Absent/empty when there's no such file. */
  csvFields?: Record<string, string>;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Splits a markdown file into its front matter (raw YAML, if present) and
 * the remaining body text. Returns `frontmatter: null` when there's no
 * leading `---` block at all. */
export function splitFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

const VALID_LAYOUTS = new Set(["document", "grid"]);

/**
 * Parses a `README.md`'s content into a `ProjectManifest`, if present.
 * Fails closed on any malformed/missing front matter — returns
 * `manifest: null` rather than throwing, so callers can always fall back to
 * the plain vault folder view.
 */
export function parseProjectManifest(markdown: string): {
  manifest: ProjectManifest | null;
  body: string;
} {
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (!frontmatter) return { manifest: null, body };

  try {
    const data = parseYaml(frontmatter) as Partial<ProjectManifest> | null;
    if (!data || typeof data !== "object") return { manifest: null, body };
    if (data.layout && !VALID_LAYOUTS.has(data.layout)) {
      return { manifest: null, body };
    }
    return {
      manifest: {
        title: typeof data.title === "string" ? data.title : undefined,
        type: typeof data.type === "string" ? data.type : undefined,
        layout: data.layout,
      },
      body,
    };
  } catch {
    return { manifest: null, body };
  }
}
