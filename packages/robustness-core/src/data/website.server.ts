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
 * homepage) and an empty `_site-settings.json` (nav + footer config).
 *
 * Mirrors `projectN02.server.ts`'s own shape (`applyProjectN02Shape`) and
 * its safe mutual-import cycle with `vault.server.ts` — every name pulled
 * back from there is a hoisted `function` declaration, and nothing here
 * calls one at module-evaluation time, only later from inside async
 * functions.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createFileRef,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  updateFileRef,
  type FileRef,
  type VaultFolder,
} from "./vault.server";
import { splitFrontmatter } from "./project.types";
import { canActAsProjectOwner } from "./projectSharing.server";

const README_NAME = "README.md";
const SITE_SETTINGS_NAME = "_site-settings.json";

const DEFAULT_README = `# Welcome

This is the homepage of your new website project — edit this file to
replace this placeholder. It renders as the site's homepage.
`;

const DEFAULT_SITE_SETTINGS = `${JSON.stringify(
  {
    nav: [],
    footer: { tagline: "", links: [], social: [] },
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
 */
export async function resolveWebsitePageByPath(
  siteFolder: VaultFolder,
  segments: string[],
): Promise<ResolvedWebsitePage | null> {
  let currentFolder = siteFolder;
  const cleanSegments = segments.map((s) => s.trim()).filter(Boolean);

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

export type WebsiteLinkItem = { label: string; to: string };

export type WebsiteSettings = {
  nav: WebsiteLinkItem[];
  footer: {
    tagline: string;
    links: WebsiteLinkItem[];
    social: WebsiteLinkItem[];
  };
};

const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  nav: [],
  footer: { tagline: "", links: [], social: [] },
};

function parseLinkItems(raw: unknown): WebsiteLinkItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WebsiteLinkItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const label = (entry as Record<string, unknown>).label;
    const to = (entry as Record<string, unknown>).to;
    if (typeof label === "string" && label && typeof to === "string" && to) {
      out.push({ label, to });
    }
  }
  return out;
}

/** Reads `_site-settings.json` (nav + footer config) — falls back to empty
 * defaults for a missing/malformed file rather than failing the whole page
 * render, same fail-soft convention `parseWebsitePageMeta` uses. */
export async function getWebsiteSettings(siteFolder: VaultFolder): Promise<WebsiteSettings> {
  const { files } = await listFolderChildren(siteFolder.human_id, siteFolder._id);
  const settingsListing = files.find(
    (f) => f.name.toLowerCase() === SITE_SETTINGS_NAME.toLowerCase(),
  );
  const settingsFile = settingsListing ? await getFileRefById(settingsListing._id) : null;
  if (!settingsFile?.content) return DEFAULT_WEBSITE_SETTINGS;
  try {
    const parsed = JSON.parse(settingsFile.content) as Record<string, unknown>;
    const footer = (parsed.footer ?? {}) as Record<string, unknown>;
    return {
      nav: parseLinkItems(parsed.nav),
      footer: {
        tagline: typeof footer.tagline === "string" ? footer.tagline : "",
        links: parseLinkItems(footer.links),
        social: parseLinkItems(footer.social),
      },
    };
  } catch {
    return DEFAULT_WEBSITE_SETTINGS;
  }
}

export type SetWebsiteSettingsResult =
  | { ok: true; settings: WebsiteSettings }
  | { ok: false; error: string };

/** Overwrites `_site-settings.json` wholesale (creating it if somehow
 * missing) — same permission gate as `setWebsitePagePublish`. The nav/
 * footer editor always sends the FULL settings object (it's small), so
 * there's no partial-merge case to handle here, unlike a page's front
 * matter. */
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
