/**
 * Sharing a project's Efforts page by link (Austin, 2026-10-05): an
 * Admin/Super turns it on, and anyone with `/public/newspaper/<folderId>`
 * reads the latest Efforts page, read only, with no login.
 *
 * Deliberately NOT `is_public`. Publishing a folder opens everything
 * under it (Skills, Graph, the synced daily logs); this opens one page.
 * `vault_folders.newspaper_shared_at` is the flag, written only by
 * `setNewspaperShared` below, the same shape as `graphLogSchedule.server.ts`.
 *
 * What the page is allowed to carry is decided here, not in the route:
 * - `publicEffortsBody` takes the README body and removes every `:ref`
 *   citation (a contributor's name, human id, date and log path; Austin
 *   chose to drop them), then points every `/api/vault/view/<id>` at this
 *   folder's own file route.
 * - `sharedFileIds` is the set of files that route may serve: exactly
 *   the view URLs the body and its galleries name, recomputed from the
 *   current README on every request. A `::file{}` directive is not on the
 *   list; the page passes `servedFileIds={}` so one draws without its
 *   picture rather than through a login-only URL.
 *
 * Kept by hand: the embed shapes above. A new way of putting a file on
 * the Efforts page renders without its picture on the shared link until
 * it is added here.
 */

import { isStaff, type Human } from "./humans.server";
import { isProjectFolder } from "./projectSharing.server";
import type { ResolvedGalleryImage } from "oxmarkdown-core";
import type { ResolvedProject } from "./project.types";
import { getFileRefById, getFolderById, updateVaultFolder, type VaultFolder } from "./vault.server";
import type { FileRef } from "./vault.types";
import { resolveProjectManifest } from "./project.server";
import { getProjectStatus } from "./projectStatus.server";

export function isNewspaperShared(folder: Pick<VaultFolder, "newspaper_shared_at">): boolean {
  return !!folder.newspaper_shared_at;
}

export type SetNewspaperSharedResult =
  | { ok: true; sharedAt: string | null }
  | { ok: false; status: 400 | 403; error: string };

/** Turns the link on or off. Admin/Super only; a project folder only (a
 * folder directly under `projects`, never a personal space). */
export async function setNewspaperShared(
  actor: Pick<Human, "role">,
  folder: VaultFolder,
  on: boolean,
): Promise<SetNewspaperSharedResult> {
  if (!isStaff(actor)) return { ok: false, status: 403, error: "Only an Admin or Super can share a project" };
  if (!(await isProjectFolder(folder))) return { ok: false, status: 400, error: "Only a project can be shared" };
  const sharedAt = on ? (folder.newspaper_shared_at ?? new Date().toISOString()) : null;
  await updateVaultFolder(folder._id, { newspaper_shared_at: sharedAt });
  return { ok: true, sharedAt };
}

// A `:ref{...}` citation. Attribute values can never hold a `"`
// (`refDirective.ts`'s `escapeDirectiveAttrValue`), so a quoted value is
// matched whole and a `}` inside one doesn't end the directive.
const REF_DIRECTIVE = /[ \t]?:ref\{(?:[^}"]|"[^"]*")*\}/g;
const VIEW_URL = /\/api\/vault\/view\/([A-Za-z0-9]+)/g;

/** Where the shared page loads one of its files from. */
export function sharedViewUrl(folderId: string, fileId: string): string {
  return `/api/newspaper/${folderId}/view/${fileId}`;
}

/** The README body as the shared page shows it: no citations, and every
 * file URL pointing at this folder's own route. */
export function publicEffortsBody(body: string, folderId: string): string {
  return body.replace(REF_DIRECTIVE, "").replace(VIEW_URL, (_, id: string) => sharedViewUrl(folderId, id));
}

/** The galleries the body names, with their URLs pointed the same way. */
export function publicGalleryFolders(
  galleryFolders: Record<string, ResolvedGalleryImage[]>,
  folderId: string,
): Record<string, ResolvedGalleryImage[]> {
  return Object.fromEntries(
    Object.entries(galleryFolders).map(([name, images]) => [
      name,
      images.map((img) => ({ ...img, url: img.url.replace(VIEW_URL, (_, id: string) => sharedViewUrl(folderId, id)) })),
    ]),
  );
}

/** Every file id the page shows: the view URLs in the body (photos,
 * videos, linked files) and in the galleries it resolves. Nothing else is
 * served under the link. */
export function sharedFileIds(body: string, galleryFolders: Record<string, ResolvedGalleryImage[]>): Set<string> {
  const ids = new Set<string>();
  const collect = (text: string) => {
    for (const m of text.matchAll(VIEW_URL)) ids.add(m[1]);
  };
  collect(body.replace(REF_DIRECTIVE, ""));
  for (const images of Object.values(galleryFolders)) for (const img of images) collect(img.url);
  return ids;
}

/** Everything the shared page receives, and nothing else: the route
 * returns this object as its loader data. */
export interface SharedEffortsPage {
  title: string;
  /** The last print, as a date (UTC, so the server and browser agree). */
  updated: string | null;
  body: string;
  galleryFolders: Record<string, ResolvedGalleryImage[]>;
  url: string;
}

export function sharedEffortsPage(
  folder: Pick<VaultFolder, "_id" | "name">,
  project: Pick<ResolvedProject, "manifest" | "body" | "galleryFolders">,
  printedAt: string | null,
  origin: string,
): SharedEffortsPage {
  return {
    title: project.manifest.title ?? folder.name,
    updated: printedAt
      ? new Date(printedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      : null,
    body: publicEffortsBody(project.body, folder._id),
    galleryFolders: publicGalleryFolders(project.galleryFolders, folder._id),
    url: `${origin}/public/newspaper/${folder._id}`,
  };
}

/** The file a shared page may load, or null: the folder is shared and not
 * trashed, and the file is one the CURRENT page names (`sharedFileIds`).
 * Checked on every request, never remembered from a render, so turning
 * the link off or reprinting the page takes effect at once. */
export async function sharedPageFile(folderId: string, fileId: string): Promise<FileRef | null> {
  const folder = await getFolderById(folderId);
  if (!folder || !isNewspaperShared(folder) || getProjectStatus(folder) === "trashed") return null;
  const project = await resolveProjectManifest(folder.human_id, folder);
  if (!sharedFileIds(project.body, project.galleryFolders).has(fileId)) return null;
  return (await getFileRefById(fileId)) ?? null;
}
