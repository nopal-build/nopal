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
 matter, simply renders with sensible defaults (see `resolveProjectManifest` in `project.server.ts`, which never fails closed on this).
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

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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

/**
 * Where a project sits in the human's own project lifecycle — see the
 * `vault` skill's Projects section. "trashed" is a soft-delete: the
 * trash-cleanup cron (`api.vault.trash-cleanup.tsx`) permanently deletes a
 * project 30 days after its status was last set to "trashed".
 */
export type ProjectStatus = "active" | "completed" | "trashed";

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "completed", "trashed"];

/** Every project starts out Active — the default when a README has no
 * `status` front matter yet (a brand new project, or one written before
 * this field existed). */
export const DEFAULT_PROJECT_STATUS: ProjectStatus = "active";

export type ProjectManifest = {
  title?: string;
  /** Free-form label (e.g. "blog", "client-deliverable", "budget"). Not yet
   * used to drive behavior — reserved for future default styling/layout. */
  type?: string;
  /** Defaults to "document" — the layout that can never look broken. */
  layout?: ProjectLayout;
  /** Defaults to "active". Written exclusively via
   * `projectStatus.server.ts`'s `setProjectStatus`, which also keeps
   * `vault_folders.project_status` (a denormalized read cache, same trick
   * `shared_with` uses for `sharing`) in sync. */
  status?: ProjectStatus;
  /** This project's collaborators and their Sharing Role — see
   * `projectSharing.server.ts`. Convenience passthrough for callers already
   * resolving the full manifest (e.g. the project rollup page); read
   * independently via `parseProjectSharing` wherever a project's sharing
   * needs to work even without a full valid manifest (most callers). */
  sharing?: ProjectSharingEntry[];
};

/** One collaborator's role assignment on a project — PhyLog's Sharing
 * Roles, stored as the `sharing` list in a project's own README.md front
 * matter (never in a separate database table — see `projectSharing.server.ts`
 * for why, and `sharingRoles.server.ts` for where the role NAME itself is
 * defined/validated). The project's own creator is never listed here —
 * they're always an implicit "Owner", resolved from the folder's own
 * `human_id` instead. */
export type ProjectSharingEntry = { human: string; role: string };

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
const VALID_STATUSES = new Set<string>(PROJECT_STATUSES);

/** Normalizes a raw front-matter `status` value — anything unrecognized
 * (missing, malformed, hand-typed typo) silently falls back to the
 * default rather than failing the whole manifest parse, same reasoning
 * `parseSharingList` already uses for `sharing`. */
function parseStatus(raw: unknown): ProjectStatus {
  return typeof raw === "string" && VALID_STATUSES.has(raw)
    ? (raw as ProjectStatus)
    : DEFAULT_PROJECT_STATUS;
}

/** Validates/coerces a raw `sharing` front-matter value into a clean
 * `ProjectSharingEntry[]` — silently drops anything malformed (not an
 * array, or an entry missing a non-empty `human`/`role` string) rather
 * than failing the whole parse, since a project's collaborator list must
 * keep working even when the rest of its front matter doesn't form a
 * valid `ProjectManifest` (see `parseProjectSharing` below, which reads
 * this independently of `parseProjectManifest`'s own all-or-nothing
 * validity check). */
function parseSharingList(raw: unknown): ProjectSharingEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectSharingEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const human = (entry as Record<string, unknown>).human;
    const role = (entry as Record<string, unknown>).role;
    if (typeof human === "string" && human && typeof role === "string" && role) {
      out.push({ human, role });
    }
  }
  return out;
}

/** Reads just the `sharing` list from a README's front matter — the ONLY
 * place a project's Sharing Role assignments are read from (see
 * `projectSharing.server.ts`). Independent of `parseProjectManifest`'s
 * validity check: `[]` for a project with no README/front matter at all,
 * malformed front matter, or no `sharing` key — never throws, since a
 * project must stay shareable (or at least resolvable to "nobody but the
 * owner") regardless of whatever else is or isn't in its front matter. */
export function parseProjectSharing(markdown: string): ProjectSharingEntry[] {
  const { frontmatter } = splitFrontmatter(markdown);
  if (!frontmatter) return [];
  try {
    const data = parseYaml(frontmatter);
    if (!data || typeof data !== "object") return [];
    return parseSharingList((data as Record<string, unknown>).sharing);
  } catch {
    return [];
  }
}

/** Reads just the `status` field from a README's front matter — mirrors
 * `parseProjectSharing` above. Defaults to "active" for a project with no
 * README/front matter, malformed front matter, or no `status` key. */
export function parseProjectStatus(markdown: string): ProjectStatus {
  const { frontmatter } = splitFrontmatter(markdown);
  if (!frontmatter) return DEFAULT_PROJECT_STATUS;
  try {
    const data = parseYaml(frontmatter);
    if (!data || typeof data !== "object") return DEFAULT_PROJECT_STATUS;
    return parseStatus((data as Record<string, unknown>).status);
  } catch {
    return DEFAULT_PROJECT_STATUS;
  }
}

/**
 * Rewrites ONLY the `sharing` key of a README's front matter, preserving
 * every other front-matter field (title/type/layout/...) and the body
 * completely untouched — the sole intended writer of a project's
 * collaborator list (`projectSharing.server.ts`'s `setProjectSharing`).
 * Passing an empty list removes the `sharing` key entirely (a project with
 * no collaborators besides its owner has no reason to carry a `sharing: []`
 * line), and removes the front matter block altogether if nothing else was
 * in it either.
 */
export function withProjectSharing(
  markdown: string,
  entries: ProjectSharingEntry[],
): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let data: Record<string, unknown> = {};
  if (frontmatter) {
    try {
      const parsed = parseYaml(frontmatter);
      if (parsed && typeof parsed === "object") {
        data = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // Malformed existing front matter — rather than crash the share
      // action, start clean. Rare: only reachable via hand-edited YAML
      // that was already broken before this write.
      data = {};
    }
  }
  if (entries.length > 0) data.sharing = entries;
  else delete data.sharing;

  if (Object.keys(data).length === 0) return body;
  const yamlText = stringifyYaml(data).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

/**
 * Rewrites ONLY the `status` key of a README's front matter, preserving
 * every other field (title/type/layout/sharing/...) untouched — the sole
 * intended writer of a project's `status`
 * (`projectStatus.server.ts`'s `setProjectStatus`). Setting the default
 * ("active") removes the `status` key entirely, same convention
 * `withProjectSharing` uses for an empty collaborator list.
 */
export function withProjectStatus(markdown: string, status: ProjectStatus): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let data: Record<string, unknown> = {};
  if (frontmatter) {
    try {
      const parsed = parseYaml(frontmatter);
      if (parsed && typeof parsed === "object") {
        data = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      data = {};
    }
  }
  if (status !== DEFAULT_PROJECT_STATUS) data.status = status;
  else delete data.status;

  if (Object.keys(data).length === 0) return body;
  const yamlText = stringifyYaml(data).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

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
        status: parseStatus((data as Record<string, unknown>).status),
        sharing: parseSharingList((data as Record<string, unknown>).sharing),
      },
      body,
    };
  } catch {
    return { manifest: null, body };
  }
}
