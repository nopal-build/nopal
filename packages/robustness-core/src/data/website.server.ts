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

import { createFileRef, listFolderChildren, type VaultFolder } from "./vault.server";

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
    ensureTextFile(folder.human_id, folder._id, "README.md", DEFAULT_README, "text/markdown"),
    ensureTextFile(
      folder.human_id,
      folder._id,
      "_site-settings.json",
      DEFAULT_SITE_SETTINGS,
      "application/json",
    ),
  ]);
  return folder;
}
