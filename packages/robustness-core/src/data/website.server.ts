/**
 * `website` — a Container Folder Type (see `vaultFolderTypes.ts`, and the
 * `vault` skill's "website projects" section) for a folder of pages backing
 * a public site — Nopal's own marketing site (rendered at `/v2/*`) is the
 * first one. Deliberately NOT GraphLog-managed, unlike `project-n02`:
 * ordinary owner/Sharing-Roles-writable content, no `skills`/`syncs`
 * children, no auto-seeded GraphLog defaults. Only CREATING one is
 * restricted (`creatableBy: "Super"`); once created it's an ordinary
 * shareable project like any other.
 *
 * This file owns the one bit of scaffolding a brand new `website` project
 * needs: a starter `README.md` (doubles as both the project's own Sharing
 * Roles doc — same as any other project's README — AND the site's
 * homepage) and an empty `_site-settings.json` (nav config).
 *
 * Mirrors `projectN02.server.ts`'s own shape (`applyProjectN02Shape`) and
 * its mutual-import cycle with `vault.server.ts` — this file's own import
 * of `vault.server.ts` below stays a normal static one; the OTHER
 * direction (`vault.server.ts` reaching into this file, for
 * `applyWebsiteShape`) is a lazy `import()` instead, which is what
 * actually keeps this cycle safe under Vite's dev SSR (see the comment
 * above that lazy import in `vault.server.ts` for why — it's load-bearing,
 * not stylistic).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createFileRef,
  getFileRefById,
  getFolderAncestry,
  getFolderById,
  listFolderChildren,
  resolveDailyLogsFolder,
  updateFileRef,
  type FileRef,
  type VaultFolder,
} from "./vault.server";
import { splitFrontmatter } from "./project.types";
import { canActAsProjectOwner } from "./projectSharing.server";
import { getDailyLogCardsForDates } from "./dailyLog.server";
import { findLeafDirectiveOccurrences } from "../util/nopalDirectives";
import {
  getCachedWebsitePage,
  setCachedWebsitePage,
  invalidateWebsiteCache,
} from "./websiteCache.server";

const README_NAME = "README.md";
const SITE_SETTINGS_NAME = "_site-settings.json";

const DEFAULT_README = `# Welcome

This is the homepage of your new website project — edit this file to
replace this placeholder. It renders as the site's homepage.
`;

const DEFAULT_SITE_SETTINGS = `${JSON.stringify(
  {
    nav: [],
  },
  null,
  2,
)}\n`;

async function ensureTextFile(
  humanId: string,
  folderId: string,
  name: string,
  content: string,
  contentType: string,
): Promise<void> {
  const { files } = await listFolderChildren(humanId, folderId);
  if (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
  await createFileRef({
    human_id: humanId,
    name,
    content,
    content_type: contentType,
    folder_id: folderId,
  });
}

/**
 * Idempotently ensures a `website` project has its starter `README.md` and
 * `_site-settings.json` — safe to call on every access (a no-op once both
 * already exist). No-ops entirely for anything that isn't actually a
 * `website` anchor folder.
 */
export async function applyWebsiteShape(folder: VaultFolder): Promise<VaultFolder> {
  if (folder.folder_type !== "website" || !folder.is_folder_type_root) return folder;
  await Promise.all([
    ensureTextFile(folder.human_id, folder._id, README_NAME, DEFAULT_README, "text/markdown"),
    ensureTextFile(
      folder.human_id,
      folder._id,
      SITE_SETTINGS_NAME,
      DEFAULT_SITE_SETTINGS,
      "application/json",
    ),
  ]);
  return folder;
}

// ─── Public rendering (`/v2/*`) — read side only for now ────────────────────

export type WebsitePublishStatus = "draft" | "published";

/** Conservative default — a page with no front matter at all (a brand new
 * `website` project's seeded README, or any hand-added file) stays hidden
 * from the public `/v2/*` routes until an editor explicitly opts it in.
 * Same "fail closed" instinct the rest of Vault's permission model uses. */
export const DEFAULT_WEBSITE_PUBLISH_STATUS: WebsitePublishStatus = "draft";

export type WebsitePageMeta = {
  title: string | null;
  description: string | null;
  publish: WebsitePublishStatus;
};

export type ResolvedWebsitePage = {
  file: FileRef;
  meta: WebsitePageMeta;
  /** The file's markdown with front matter stripped — ready for
   * `OxRenderer`. */
  body: string;
};

/** Every ancestor folder from the root container down to (and including)
 * the folder/file being viewed — same shape `fruits_.vault.tsx`'s own
 * `ancestry` array already uses. Finds the `website` anchor among them, if
 * any: the loader's way of knowing "is this file/folder part of a website
 * project at all" without re-walking the tree itself. */
export function findWebsiteAnchor(ancestry: VaultFolder[]): VaultFolder | null {
  return (
    ancestry.find((f) => f.folder_type === "website" && f.is_folder_type_root) ?? null
  );
}

/** Reads just `title`/`description`/`publish` from a page's front matter —
 * mirrors `project.types.ts`'s `parseProjectSharing`/`parseProjectStatus`
 * (never throws, defaults on anything missing/malformed). Deliberately NOT
 * a full manifest parse — a website page's front matter has no other
 * reserved keys yet. Exported for `fruits_.vault.tsx`'s loader, which needs
 * a page's `publish` state to render the toggle without a second content
 * fetch. */
export function parseWebsitePageMeta(markdown: string): WebsitePageMeta {
  const fallback: WebsitePageMeta = {
    title: null,
    description: null,
    publish: DEFAULT_WEBSITE_PUBLISH_STATUS,
  };
  const { frontmatter } = splitFrontmatter(markdown);
  if (!frontmatter) return fallback;
  try {
    const data = parseYaml(frontmatter);
    if (!data || typeof data !== "object") return fallback;
    const d = data as Record<string, unknown>;
    return {
      title: typeof d.title === "string" ? d.title : null,
      description: typeof d.description === "string" ? d.description : null,
      publish: d.publish === "published" ? "published" : DEFAULT_WEBSITE_PUBLISH_STATUS,
    };
  } catch {
    return fallback;
  }
}

/**
 * Rewrites ONLY the `publish` key of a page's front matter, preserving
 * every other field (`title`/`description`/...) and the body untouched —
 * mirrors `project.types.ts`'s `withProjectStatus` exactly, including
 * dropping the key entirely when set back to the default ("draft"), so a
 * once-published-then-unpublished page front-matter-round-trips to
 * looking exactly like a page that was never published at all.
 */
export function withWebsitePublish(markdown: string, publish: WebsitePublishStatus): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let data: Record<string, unknown> = {};
  if (frontmatter) {
    try {
      const parsed = parseYaml(frontmatter);
      if (parsed && typeof parsed === "object") data = { ...(parsed as Record<string, unknown>) };
    } catch {
      data = {};
    }
  }
  if (publish !== DEFAULT_WEBSITE_PUBLISH_STATUS) data.publish = publish;
  else delete data.publish;

  if (Object.keys(data).length === 0) return body;
  const yamlText = stringifyYaml(data).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

export type SetWebsitePagePublishResult =
  | { ok: true; publish: WebsitePublishStatus }
  | { ok: false; error: string };

/**
 * Sets a website page's `publish` front matter — gated by the SAME
 * ordinary Sharing-Roles check every other website write goes through
 * (`canActAsProjectOwner`), not a platform Admin/Super role (see
 * `vaultFolderTypes.ts`'s `website.writable: "owner"`).
 */
export async function setWebsitePagePublish(
  actingHumanId: string,
  file: FileRef,
  publish: WebsitePublishStatus,
): Promise<SetWebsitePagePublishResult> {
  if (!(await canActAsProjectOwner(actingHumanId, file.human_id, file.folder_id))) {
    return {
      ok: false,
      error: "You don't have permission to change this page's publish status",
    };
  }
  const updatedContent = withWebsitePublish(file.content ?? "", publish);
  await updateFileRef(file._id, { content: updatedContent });
  return { ok: true, publish };
}

function toResolvedPage(file: FileRef): ResolvedWebsitePage {
  const markdown = file.content ?? "";
  const { body } = splitFrontmatter(markdown);
  return { file, meta: parseWebsitePageMeta(markdown), body };
}

function stripMdExtension(name: string): string {
  return name.replace(/\.md$/i, "");
}

/**
 * Resolves a `/v2/...` path to a page inside `siteFolder` — the vault
 * folder tree itself IS the URL tree (no stored `slug`). Each path segment
 * matches a child FOLDER by name; once segments are exhausted, that
 * folder's own `README.md` is the page (same convention Vault already uses
 * for a folder's own index doc). The LAST segment may instead match a
 * plain markdown FILE (by name, minus `.md`) when no folder matches — e.g.
 * `about` → `about.md`. Returns `null` on no match (a real 404).
 *
 * Cached (`websiteCache.server.ts`) — a hit skips every DB round trip
 * below entirely. See that module's header for the invalidation scheme
 * (a per-site version bump, triggered by `invalidateWebsiteCacheForFile`
 * below whenever a `website`-project file changes) that keeps this from
 * ever serving stale content after a save.
 */
export async function resolveWebsitePageByPath(
  siteFolder: VaultFolder,
  segments: string[],
): Promise<ResolvedWebsitePage | null> {
  const cleanSegments = segments.map((s) => s.trim()).filter(Boolean);
  // Lowercased -- every segment match below is already case-insensitive
  // (`.toLowerCase()` on both sides), so two requests differing only in
  // casing must land on the exact same cache entry rather than each
  // populating their own redundant copy.
  const pathKey = cleanSegments.join("/").toLowerCase();

  const cached = await getCachedWebsitePage<ResolvedWebsitePage>(siteFolder._id, pathKey);
  if (cached) return cached;

  const resolved = await resolveWebsitePageByPathUncached(siteFolder, cleanSegments);
  // Only a REAL resolved page is cached -- caching a miss (`null`) would
  // mean a page that doesn't exist YET (e.g. mid-creation, or simply not
  // published) keeps 404ing from cache for up to the TTL even after it's
  // created/published, instead of picking it up on the very next request
  // the way `invalidateWebsiteCache`'s version bump already guarantees for
  // an EXISTING page's own edits.
  if (resolved) await setCachedWebsitePage(siteFolder._id, pathKey, resolved);
  return resolved;
}

async function resolveWebsitePageByPathUncached(
  siteFolder: VaultFolder,
  cleanSegments: string[],
): Promise<ResolvedWebsitePage | null> {
  let currentFolder = siteFolder;

  for (let i = 0; i < cleanSegments.length; i++) {
    const segment = cleanSegments[i];
    const isLast = i === cleanSegments.length - 1;
    const { folders, files } = await listFolderChildren(
      currentFolder.human_id,
      currentFolder._id,
    );

    const matchedFolder = folders.find(
      (f) => f.name.toLowerCase() === segment.toLowerCase(),
    );
    if (matchedFolder) {
      currentFolder = matchedFolder;
      continue;
    }

    if (isLast) {
      const matchedFile = files.find(
        (f) =>
          f.name.toLowerCase().endsWith(".md") &&
          f.name.toLowerCase() !== README_NAME.toLowerCase() &&
          stripMdExtension(f.name).toLowerCase() === segment.toLowerCase(),
      );
      if (matchedFile) {
        const full = await getFileRefById(matchedFile._id);
        return full ? toResolvedPage(full) : null;
      }
    }
    return null;
  }

  const { files } = await listFolderChildren(currentFolder.human_id, currentFolder._id);
  const readme = files.find((f) => f.name.toLowerCase() === README_NAME.toLowerCase());
  if (!readme) return null;
  const full = await getFileRefById(readme._id);
  return full ? toResolvedPage(full) : null;
}

export type WebsiteSitemapEntry = {
  /** The real, resolvable `/`-rooted URL path -- e.g. `"/"`, `"/guides"`,
   * `"/materials/zip-r"` -- built from the SAME folder-name/file-name
   * segments `resolveWebsitePageByPath` above matches against, just
   * walked forward (DB tree -> URL) instead of backward (URL -> DB tree). */
  path: string;
  /** The page's own `title` front matter when it set one; otherwise a
   * humanized version of the path's own last segment (`"scc-demo"` ->
   * `"Scc Demo"`) -- same "never show a blank link" instinct `::icon`/
   * `::stamp`'s own placeholders already use, just text instead of a
   * dashed box. Never actually exercised today (every currently-published
   * page already sets a real `title`), but a sitemap is exactly the kind
   * of listing that silently degrades into a wall of blank links the
   * moment someone forgets one, so it's worth the small defensive cost. */
  title: string;
  /** The top-level folder name a nested page lives under (humanized, e.g.
   * `"Materials"`), or `null` for a root-level page (the homepage, or a
   * plain `.md` file sitting directly in the site's own root) -- callers
   * group the flat list returned by `listWebsiteSitemapEntries` by this
   * for display. Only ever ONE level deep (the site's real content is
   * flat-per-folder today -- materials/assemblies/science/posts, no
   * nesting within those) -- a page three folders deep would still only
   * ever report its FIRST ancestor folder's name here, by design: more
   * than one grouping tier isn't worth the complexity until a real site
   * actually has that much depth. `ARCHIVE_FOLDER_NAMES` below folds
   * SEVERAL distinct folders into one shared `"Archive"` label (2026-10-25,
   * human ask) rather than each getting its own section -- the ported
   * Notion content (materials/assemblies/science) plus posts reads as one
   * "everything else" bucket to a visitor, not four separate site
   * sections on par with the handful of real top-level pages. */
  section: string | null;
};

/** Folder names (lowercased) whose pages ALL share the single `"Archive"`
 * sitemap section, instead of each getting its own humanized label --
 * see `WebsiteSitemapEntry.section`'s own comment for why. Deliberately a
 * closed, hand-picked list, NOT a generic "any non-root folder is an
 * archive" rule -- a real future content folder that ISN'T meant to read
 * as archival (nothing like that exists today) would otherwise get
 * silently swept in here too. */
const ARCHIVE_FOLDER_NAMES = new Set(["materials", "assemblies", "posts", "science"]);

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const SITEMAP_CACHE_KEY = "__sitemap__";

/**
 * Every PUBLISHED page under a `website` project, flattened and grouped --
 * the data behind `/sitemap`'s auto-generated page list (see `garden`'s
 * website-switchover seed). Deliberately NOT an OxMarkdown page an editor
 * hand-maintains (the one thing explicitly asked against): a hand-written
 * list silently drifts the moment a page is added/renamed/(un)published,
 * which is exactly the failure mode a sitemap exists to prevent. Walks the
 * ENTIRE folder tree recursively (today: one level deep in practice, see
 * `WebsiteSitemapEntry.section`'s own comment, but written generically in
 * case that ever changes) -- a `README.md` is that folder's own page (same
 * convention `resolveWebsitePageByPathUncached` above already resolves a
 * URL against); every OTHER plain `.md` file is a page at `folder-path/
 * filename`; anything (file OR folder) whose name starts with `_` is
 * PRIVATE infrastructure (`_footer.md`, `_site-settings.json`, a future
 * `_theme.md`), never a real page, and is skipped entirely, never
 * recursed into. A page missing `publish: published` front matter (the
 * default -- see `DEFAULT_WEBSITE_PUBLISH_STATUS`) is silently excluded,
 * same gate every other public-facing read of this content already
 * applies. Cached under the SAME per-site version-bump scheme
 * `resolveWebsitePageByPath` above uses (`websiteCache.server.ts`) --
 * `"__sitemap__"` is a RESERVED sentinel pathKey, the exact same role
 * `"__index__"` already plays there for the (real, resolvable) empty
 * path, so it can never collide with an actual page's own lowercased
 * path-segment key.
 */
export async function listWebsiteSitemapEntries(
  siteFolder: VaultFolder,
): Promise<WebsiteSitemapEntry[]> {
  const cached = await getCachedWebsitePage<WebsiteSitemapEntry[]>(siteFolder._id, SITEMAP_CACHE_KEY);
  if (cached) return cached;

  const entries: WebsiteSitemapEntry[] = [];

  async function maybeAddPage(fileId: string, segments: string[], section: string | null) {
    const full = await getFileRefById(fileId);
    if (!full) return;
    const meta = parseWebsitePageMeta(full.content ?? "");
    if (meta.publish !== "published") return;
    const lastSegment = segments[segments.length - 1] ?? "";
    const title = meta.title || humanizeSlug(lastSegment) || "Home";
    entries.push({ path: `/${segments.join("/")}`, title, section });
  }

  async function walk(folder: VaultFolder, segments: string[], section: string | null) {
    const { folders, files } = await listFolderChildren(folder.human_id, folder._id);

    const readme = files.find((f) => f.name.toLowerCase() === README_NAME.toLowerCase());
    if (readme) await maybeAddPage(readme._id, segments, section);

    for (const file of files) {
      if (file.name.toLowerCase() === README_NAME.toLowerCase()) continue;
      if (!file.name.toLowerCase().endsWith(".md")) continue;
      if (file.name.startsWith("_")) continue;
      await maybeAddPage(file._id, [...segments, stripMdExtension(file.name)], section);
    }

    for (const sub of folders) {
      if (sub.name.startsWith("_")) continue;
      const label = ARCHIVE_FOLDER_NAMES.has(sub.name.toLowerCase()) ? "Archive" : humanizeSlug(sub.name);
      await walk(sub, [...segments, sub.name], section ?? label);
    }
  }

  await walk(siteFolder, [], null);
  await setCachedWebsitePage(siteFolder._id, SITEMAP_CACHE_KEY, entries);
  return entries;
}

export type ResolvedWebsiteDailyLogEntry = {
  projectName: string;
  date: string;
  content: string;
};

/**
 * Resolves every `::daily-log{date="..." project="..."}` reference found
 * in a website page's own body against the SITE OWNER's own daily-log
 * Cards (see the `vault` skill's Cards section) — a curated, static embed
 * of a specific real day's project update, for pages like `/v2/stories`
 * that want to show real build-log content without making the whole page
 * a live daily-log feed. Always resolves against `siteFolder.human_id`,
 * never an anonymous visitor's own identity — webapp has no session at all
 * (see `loadWebsitePage.server.ts`'s header comment), so there's no other
 * human to resolve against, and it matches the intent anyway: a website
 * page's author is curating THEIR OWN project history.
 *
 * Batches by unique `date` (one `getDailyLogCardsForDates` call for every
 * date at once, not per directive occurrence, and not even one call per
 * date — see that function's own doc) — mirrors `project.server.ts`'s own
 * `resolveProjectManifest` deduping repeated `::gallery{folder="..."}`
 * lookups by folder name.
 *
 * Keyed `${date}::${lowercased project name}` — MUST match
 * `webapp/app/oxmarkdown/websiteDirectives.tsx`'s own `dailyLogEntryKey`,
 * duplicated by hand there (same webapp/robustness-core split convention
 * the rest of OxMarkdown's directive rendering already follows).
 */
export async function resolveWebsiteDailyLogEntries(
  siteFolder: VaultFolder,
  body: string,
): Promise<Record<string, ResolvedWebsiteDailyLogEntry>> {
  const dates = new Set<string>();
  for (const directive of findLeafDirectiveOccurrences(body)) {
    if (directive.name !== "daily-log") continue;
    if (directive.attrs.date) dates.add(directive.attrs.date);
  }
  if (dates.size === 0) return {};

  // Resolved ONCE and reused for every date below. `resolveDailyLogsFolder`
  // only depends on `humanId`, not `date`, but used to run once PER date
  // here (itself several round trips) -- a page citing N days paid for the
  // same resolution N times over, sequentially. Confirmed the single worst
  // request in the `fruits-performance-followup` garden seed's real-traffic
  // investigation (3.56s total, 2.37s inside this function alone).
  const rootFolder = await resolveDailyLogsFolder(siteFolder.human_id);

  // Every date's Cards resolved in 2 queries TOTAL, not 2 PER date --
  // `getDailyLogCardsForDates` (`dailyLog.server.ts`) batches the
  // date-folder lookup and the card lookup across every date at once. An
  // earlier version of this resolved dates concurrently via `Promise.all`
  // over single-date `getDailyLogCards` calls, which helped (sequential ->
  // concurrent) but still fired 2 round trips PER date -- real traffic
  // with ~15 dates on one page showed the later ones queueing against the
  // DB's single shared-CPU machine. See the garden seed for the trace.
  const dateList = [...dates];
  const cardsByDate = await getDailyLogCardsForDates(siteFolder.human_id, dateList, rootFolder);

  const entries: Record<string, ResolvedWebsiteDailyLogEntry> = {};
  for (const date of dateList) {
    for (const card of cardsByDate[date] ?? []) {
      const key = `${date}::${card.projectName.trim().toLowerCase()}`;
      entries[key] = { projectName: card.projectName, date, content: card.content };
    }
  }
  return entries;
}

/** Walks a `./`/`../`-style relative path (split on `/`, `.` segments are
 * no-ops, `..` moves to the CURRENT folder's own parent) starting from
 * `startFolderId`, resolving the final segment as a FILE name in whatever
 * folder the walk lands on — the same name-based child lookup
 * `resolveWebsitePageByPathUncached` already uses, just generalized to
 * support stepping back up the tree too (that one only ever walks
 * downward, URL-segment by URL-segment, so it never needed `..`).
 *
 * Clamped to `siteFolder` itself as a hard ceiling — `..` past the site's
 * own root returns `null` rather than escaping into the rest of that
 * human's vault. This matters because `/v2/*` is PUBLIC and anonymous
 * (no session at all, see `loadWebsitePage.server.ts`'s header comment):
 * without this, a crafted `::include-ox{file="../../../private/secret"}`
 * on an otherwise-innocent page could walk out of the website project
 * entirely and expose unrelated private vault content. */
async function resolveRelativeVaultFile(
  siteFolder: VaultFolder,
  startFolderId: string | null,
  relativePath: string,
): Promise<FileRef | null> {
  if (!startFolderId) return null;
  const humanId = siteFolder.human_id;
  const segments = relativePath.split("/").filter((s) => s.length > 0);
  const fileName = segments.pop();
  if (!fileName || fileName === "." || fileName === "..") return null;

  let currentFolderId = startFolderId;
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (currentFolderId === siteFolder._id) return null;
      const current = await getFolderById(currentFolderId);
      if (!current?.parent_folder_id) return null;
      currentFolderId = current.parent_folder_id;
      continue;
    }
    const { folders } = await listFolderChildren(humanId, currentFolderId);
    const match = folders.find((f) => f.name.toLowerCase() === segment.toLowerCase());
    if (!match) return null;
    currentFolderId = match._id;
  }

  const { files } = await listFolderChildren(humanId, currentFolderId);
  const match = files.find((f) => f.name.toLowerCase() === fileName.toLowerCase());
  return match ? (await getFileRefById(match._id)) ?? null : null;
}

/**
 * Resolves every `::include-ox{file="..."}` reference found in a website
 * page's own body — each `file` is resolved RELATIVE TO THAT PAGE'S OWN
 * CONTAINING FOLDER (`pageFolderId`, the resolved page's own `file.
 * folder_id` — see `loadWebsitePage.server.ts`), via
 * `resolveRelativeVaultFile` above. Lets an author write one shared
 * `_footer.md` (plain oxmarkdown — any directive this registry supports,
 * including a NESTED `::include-ox` of its own) and include it at the
 * bottom of every page that wants one, rather than a site-wide footer
 * baked into `_site-settings.json` and auto-rendered by every page
 * identically (the OLD `WebsiteSettings.footer`, removed entirely).
 *
 * Deliberately ONE LEVEL DEEP ONLY — this scans the ENTRY page's own body
 * for occurrences, but does NOT recursively scan whatever it resolves for
 * FURTHER `::include-ox` references of their own (an included file's own
 * nested includes, if any, simply won't be in the returned map, and
 * render as unresolved/nothing — see `websiteDirectives.tsx`'s own
 * `include-ox` handler). This happens to make a two-file MUTUAL cycle
 * (a.md includes b.md, b.md includes a.md) harmless already — visiting
 * a.md only ever resolves b.md's content, never b.md's OWN reference
 * back to a.md, since that second hop is never scanned for at all. A
 * DIRECT self-reference (a file including itself) is a real risk this
 * shallow resolution does NOT protect against on its own though —
 * guarded instead at render time, by `websiteDirectives.tsx`'s
 * `includeOxHandler` tracking the chain of ancestors already being
 * rendered and refusing to re-enter one. That render-time guard is also
 * what would keep this correct if this function ever became recursive.
 *
 * Keyed by the literal, UN-resolved `file="..."` string (not an absolute
 * path) — matches `webapp/app/oxmarkdown/websiteDirectives.tsx`'s own
 * `include-ox` lookup, which only ever has the raw attribute value to key
 * with at render time, the same `dailyLogEntryKey`-style convention
 * `resolveWebsiteDailyLogEntries` (above) already follows. Front matter
 * (if the included file happens to have any) is stripped, same as any
 * other page body.
 */
export async function resolveWebsiteIncludes(
  siteFolder: VaultFolder,
  pageFolderId: string | null,
  body: string,
): Promise<Record<string, string>> {
  const files = new Set<string>();
  for (const directive of findLeafDirectiveOccurrences(body)) {
    if (directive.name !== "include-ox") continue;
    if (directive.attrs.file) files.add(directive.attrs.file);
  }
  if (files.size === 0) return {};

  const resolved: Record<string, string> = {};
  for (const file of files) {
    const fileRef = await resolveRelativeVaultFile(siteFolder, pageFolderId, file);
    if (!fileRef?.content) continue;
    resolved[file] = splitFrontmatter(fileRef.content).body;
  }
  return resolved;
}

export type WebsiteLinkItem = { label: string; to: string };

// `footer` (tagline + links + social) USED to live here, auto-rendered by
// `webapp/app/routes/v2.tsx`'s own `<footer>` -- removed entirely
// (2026-10-04) in favor of `::include-ox{file="..."}` (see
// `resolveWebsiteIncludes` below): an author now hand-writes their own
// `_footer.md` (any oxmarkdown, including other website directives) and
// includes it at the bottom of each page that wants one, rather than this
// file baking in one fixed, settings-driven footer shape for every site.
export type WebsiteSettings = {
  nav: WebsiteLinkItem[];
  /** Optional, standalone CTA pill shown in the header (`WebsiteHeader.tsx`
   * in `webapp`) alongside `nav`, NOT carved out of it — `nav` always
   * renders in full (desktop inline links AND the mobile dropdown) whether
   * or not one of its own `to`s happens to match this. Keying this off an
   * explicit field (rather than a "last item in `nav`" positional
   * convention `WebsiteHeader.tsx` used to use) means authoring this in
   * the Vault's own Site Settings editor (`SiteSettingsModal` in
   * `fruits/app/routes/vault.tsx`) is unambiguous, and reordering `nav`
   * can never silently change which link is featured. Absent entirely
   * when a site doesn't want a featured button (no pill renders at all). */
  featuredButton?: WebsiteLinkItem;
};

const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  nav: [],
};

/** Shared single-item validation `parseLinkItems` (below) also uses per
 * entry — both a label and a `to` must be non-empty strings, or the whole
 * item is dropped rather than persisted/rendered half-filled-in. */
function parseLinkItem(raw: unknown): WebsiteLinkItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const label = (raw as Record<string, unknown>).label;
  const to = (raw as Record<string, unknown>).to;
  if (typeof label === "string" && label && typeof to === "string" && to) {
    return { label, to };
  }
  return undefined;
}

function parseLinkItems(raw: unknown): WebsiteLinkItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WebsiteLinkItem[] = [];
  for (const entry of raw) {
    const item = parseLinkItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/** Reads `_site-settings.json` (nav config) — falls back to empty defaults
 * for a missing/malformed file rather than failing the whole page render,
 * same fail-soft convention `parseWebsitePageMeta` uses. */
export async function getWebsiteSettings(siteFolder: VaultFolder): Promise<WebsiteSettings> {
  const { files } = await listFolderChildren(siteFolder.human_id, siteFolder._id);
  const settingsListing = files.find(
    (f) => f.name.toLowerCase() === SITE_SETTINGS_NAME.toLowerCase(),
  );
  const settingsFile = settingsListing ? await getFileRefById(settingsListing._id) : null;
  if (!settingsFile?.content) return DEFAULT_WEBSITE_SETTINGS;
  try {
    const parsed = JSON.parse(settingsFile.content) as Record<string, unknown>;
    const featuredButton = parseLinkItem(parsed.featuredButton);
    return {
      nav: parseLinkItems(parsed.nav),
      ...(featuredButton ? { featuredButton } : {}),
    };
  } catch {
    return DEFAULT_WEBSITE_SETTINGS;
  }
}

export type SetWebsiteSettingsResult =
  | { ok: true; settings: WebsiteSettings }
  | { ok: false; error: string };

/** Overwrites `_site-settings.json` wholesale (creating it if somehow
 * missing) — same permission gate as `setWebsitePagePublish`. The nav
 * editor always sends the FULL settings object (it's small), so there's
 * no partial-merge case to handle here, unlike a page's front matter. */
export async function setWebsiteSettings(
  actingHumanId: string,
  siteFolder: VaultFolder,
  settings: WebsiteSettings,
): Promise<SetWebsiteSettingsResult> {
  if (!(await canActAsProjectOwner(actingHumanId, siteFolder.human_id, siteFolder._id))) {
    return {
      ok: false,
      error: "You don't have permission to change this site's settings",
    };
  }
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  const { files } = await listFolderChildren(siteFolder.human_id, siteFolder._id);
  const existing = files.find(
    (f) => f.name.toLowerCase() === SITE_SETTINGS_NAME.toLowerCase(),
  );
  if (existing) {
    await updateFileRef(existing._id, { content });
  } else {
    await createFileRef({
      human_id: siteFolder.human_id,
      name: SITE_SETTINGS_NAME,
      content,
      content_type: "application/json",
      folder_id: siteFolder._id,
    });
  }
  return { ok: true, settings };
}

/**
 * The one `website` project backing the public `/v2/*` routes today —
 * config-selected via `WEBSITE_PROJECT_FOLDER_ID` (no UI/mapping mechanism
 * yet, since only one site exists; picking among several is a real later
 * problem once that's actually needed). Returns `null` when unset, not
 * found, or not actually a `website` anchor — callers treat that as a
 * plain 404, never a crash.
 */
export async function getPrimaryWebsiteFolder(): Promise<VaultFolder | null> {
  const folderId = process.env.WEBSITE_PROJECT_FOLDER_ID;
  if (!folderId) return null;
  const folder = await getFolderById(folderId);
  if (!folder || folder.folder_type !== "website" || !folder.is_folder_type_root) return null;
  return folder;
}

/**
 * `vault.server.ts`'s `updateFileRef` calls this after EVERY file update
 * (whenever `content`/`name`/`folder_id` is part of it) via the lazy
 * `getWebsiteModule()` import there — a no-op for the overwhelming
 * majority of vault writes, which have nothing to do with a `website`
 * project at all. Only does real work when the edited file's own folder
 * is actually `folder_type: "website"` (denormalized onto every
 * descendant of a website anchor, so THIS part needs no ancestry walk).
 *
 * Resolves the file's OWN website anchor via its ancestry
 * (`getFolderAncestry` + `findWebsiteAnchor`, above) rather than reaching
 * for `getPrimaryWebsiteFolder()` (which reads `WEBSITE_PROJECT_FOLDER_ID`)
 * — a REAL BUG this fixes, not just a multi-site nicety: this function
 * runs inside `vault.server.ts`'s `updateFileRef`, i.e. inside WHICHEVER
 * app's process actually saved the file (in practice, `fruits`, since
 * that's where the Vault UI lives) — and `WEBSITE_PROJECT_FOLDER_ID` has
 * never been configured for `fruits` (see
 * `fruits/scripts/copy-secrets-from-webapp.sh`'s own comment: "fruits has
 * no use for" it — true until this cache existed). Reaching for it here
 * meant `getPrimaryWebsiteFolder()` always returned `null` in the process
 * that actually needed to invalidate, so a saved edit never bumped the
 * version at all — confirmed directly (a real repro: patching this exact
 * file's content through the real API and checking Redis showed the
 * version never moved), not just reasoned about. The only reason an edit
 * ever became visible was this cache's own 1-hour TTL backstop expiring.
 * Resolving the file's own anchor instead needs no cross-app env var at
 * all, and is correct for a future multi-site world too (bumps the
 * SPECIFIC site the file belongs to, not always "the primary one").
 */
export async function invalidateWebsiteCacheForFile(file: FileRef): Promise<void> {
  if (!file.folder_id) return;
  const folder = await getFolderById(file.folder_id);
  if (folder?.folder_type !== "website") return;
  const ancestry = await getFolderAncestry(file.folder_id);
  const anchor = findWebsiteAnchor(ancestry);
  if (anchor) await invalidateWebsiteCache(anchor._id);
}
