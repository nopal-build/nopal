/**
 * The second way to a file, next to the `shared_with` cache: through the
 * features list. A Client is never in the cache (ADR-023), so the cache
 * refuses them every file; this lets them open a project's photos when
 * their group gets `photos`, by the same rule the Photos tab shows
 * (`isReachablePhoto`): a photo, never a cost file, a photo of a receipt
 * included.
 *
 * Used by the routes that serve bytes (view, rendition, download). Not by
 * the Vault or the file record: a client has neither.
 */

import { canViewFileRef, getFolderById } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";
import { findOwningProjectFolder, getProjectRole } from "./projectSharing.server";
import { loadProjectFiles } from "./fileFolders.server";
import { isReachablePhoto } from "./projectView.server";

/** How long a project's photo list is reused: a thumbnail grid asks once
 * per photo, and the list is about ten queries. A file refiled as a cost
 * stops opening within this long. */
const PHOTO_LIST_MS = 60_000;
const photoLists = new Map<string, { at: number; ids: Set<string> }>();

/** The files a project's Photos tab serves (not cost files), by the id
 * each is served as. */
async function photoIds(project: VaultFolder): Promise<Set<string>> {
  const cached = photoLists.get(project._id);
  if (cached && Date.now() - cached.at < PHOTO_LIST_MS) return cached.ids;
  const ids = new Set(
    (await loadProjectFiles(project)).filter((r) => isReachablePhoto(r, ["photos"])).map((r) => r.serveId),
  );
  photoLists.set(project._id, { at: Date.now(), ids });
  return ids;
}

/** Which project's photos a person reaches from a folder, or null, reused
 * as long as the photo list: without it every thumbnail walked the folder
 * up to its project and read the README for the role. A role change
 * lands within this long. */
const photoReach = new Map<string, { at: number; project: VaultFolder | null }>();

async function photoProjectFor(humanId: string, folderId: string): Promise<VaultFolder | null> {
  const key = `${humanId}:${folderId}`;
  const cached = photoReach.get(key);
  if (cached && Date.now() - cached.at < PHOTO_LIST_MS) return cached.project;
  const folder = await getFolderById(folderId);
  const owning = folder ? await findOwningProjectFolder(folder) : null;
  const role = owning ? await getProjectRole(owning, humanId) : null;
  const project = role?.features.includes("photos") ? owning : null;
  photoReach.set(key, { at: Date.now(), project });
  return project;
}

/** Whether `humanId` may open `file`'s bytes: the cache's answer
 * (`canViewFileRef`), or a photo on a project whose group gets `photos`. */
export async function canReadFile(humanId: string, file: FileRef): Promise<boolean> {
  if (await canViewFileRef(humanId, file)) return true;
  if (!file.folder_id) return false;
  const project = await photoProjectFor(humanId, file.folder_id);
  return !!project && (await photoIds(project)).has(file._id);
}
