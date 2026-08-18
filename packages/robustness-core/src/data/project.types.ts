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
 * body as ordinary markdown plus OxMarkdown directives (see
 * `oxmarkdown-core/galleryDirective.ts` for `::gallery{folder="..."}`, the
 * one directive `resolveProjectManifest` still resolves), so the body
 * reads as one continuous document instead of a manifest pointing at a
 * separate `overview.md`. A folder with no front matter, or malformed front
 matter, simply renders with sensible defaults (see `resolveProjectManifest` in `project.server.ts`, which never fails closed on this).
 *
 * `layout` is currently unused by rendering (`ProjectView.tsx` dropped its
 * old grid/per-block-size layout when `MdxEditor` was retired — see the
 * `oxmarkdown` skill's Build status) but still parses/round-trips through
 * front matter for a future revisit.
 *
 * Example `README.md`:
 *
 *   ---
 *   title: Casa Verde Remodel
 *   type: client-deliverable
 *   ---
 *
 *   # Casa Verde Remodel
 *
 *   Full kitchen and primary bath remodel for the Verde family.
 *
 *   ::gallery{folder="photos" title="Progress Photos"}
 *
 * This file has NO server-only imports (the `oxmarkdown-core` type import
 * below is a pure, framework-agnostic type) — safe on both client and
 * server.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ResolvedGalleryImage } from "oxmarkdown-core";

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

/** The payload a project view needs to render. Built server-side by
 * `resolveProjectManifest` in `project.server.ts`. Deliberately narrow —
 * this used to also carry `files`/`csvFields` resolved from
 * `::name{file="..."}` directives in the body (the old
 * `MdxEditorView`/`nopalDirectives.ts` extension mechanism), dropped once
 * `ProjectView.tsx` moved to plain `OxRenderer` and stopped resolving those
 * directives at all — see the `oxmarkdown` skill's Build status.
 * `galleryFolders` survives (re-added, this time built the right way) for
 * OxMarkdown's own real `::gallery{folder="..."}` leaf directive — see
 * `oxmarkdown-core/galleryDirective.ts`. */
export type ResolvedProject = {
  manifest: ProjectManifest;
  /** The README's body, with front matter stripped — rendered as-is via
   * `OxRenderer`. */
  body: string;
  /** Keyed by a `::gallery{folder="..."}` directive's `folder` attribute
   * value — every image found directly inside that subfolder. What
   * `ProjectView.tsx`'s `resolveGalleryFolder` closes over. */
  galleryFolders: Record<string, ResolvedGalleryImage[]>;
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
 * Rewrites ONLY the body of a README, preserving its front matter
 * (title/type/layout/status/sharing/...) byte-for-byte -- the general
 * "replace generated content, keep durable metadata" operation every
 * writer of a project's README should go through instead of hand-rolling
 * `splitFrontmatter` + re-concatenation. `capture.server.ts`'s own
 * organize/README agent step uses this to apply a fresh body without
 * disturbing front matter it never even sees, and
 * `projectN01.server.ts`'s `resetProjectN01Content` uses it (with an
 * empty `newBody`) specifically so a project reset clears PhyLog's own
 * generated content WITHOUT also destroying front matter that's actually
 * durable, human-authored project metadata -- most importantly the
 * `sharing` list (Sharing Roles), which lives ONLY here (see
 * `projectSharing.server.ts`); a real bug, confirmed and fixed, where
 * resetting a project silently revoked every collaborator's role because
 * the reset deleted README.md outright instead of just its body.
 */
export function withReadmeBody(originalMarkdown: string, newBody: string): string {
  const { frontmatter } = splitFrontmatter(originalMarkdown);
  if (!frontmatter) return newBody;
  return `---\n${frontmatter}\n---\n${newBody}`;
}

export type ReadmeSection = {
  /** The H2 heading text (trimmed, exactly as written -- no normalization
   * beyond that), or "" for the INTRO -- everything before the first H2,
   * including any H1 title. There is always exactly one intro section
   * (possibly empty), even for a document with no H2s at all. */
  heading: string;
  /** Everything between this heading and the next H2 (or end of
   * document), NOT including the `## heading` line itself. */
  content: string;
};

const H2_HEADING_RE = /^##[ \t]+(.+?)[ \t]*$/;

/**
 * Splits a README BODY (front matter already removed -- see
 * `splitFrontmatter`) into its H2 (`## `) sections, for capture's
 * `update_section`/`remove_section` tools (`capture.server.ts`) -- see
 * the `phylog` skill for why section-scoped edits exist at all (bounding
 * an edit's blast radius to one section, instead of `update_readme`'s
 * whole-body replacement). Deliberately simple LINE-based splitting, not
 * a full markdown parser -- a line matching `^## text$` starts a new
 * section; anything else (including deeper headings like `###`, or `##`
 * appearing inside a fenced code block) is just content. This matches
 * the level of rigor `splitFrontmatter` above already uses for the same
 * kind of tradeoff (simple regex over a real parser).
 */
export function splitReadmeSections(body: string): ReadmeSection[] {
  const lines = body.split("\n");
  const sections: ReadmeSection[] = [];
  let heading = "";
  let current: string[] = [];
  for (const line of lines) {
    const match = line.match(H2_HEADING_RE);
    if (match) {
      sections.push({ heading, content: current.join("\n") });
      heading = match[1].trim();
      current = [];
    } else {
      current.push(line);
    }
  }
  sections.push({ heading, content: current.join("\n") });
  return sections;
}

/** Inverse of `splitReadmeSections` -- reassembles a README body from its
 * sections, in array order. The intro (`heading: ""`) never gets a `##`
 * line of its own; every other section does. */
export function joinReadmeSections(sections: ReadmeSection[]): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.content}` : s.content))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n\n");
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
