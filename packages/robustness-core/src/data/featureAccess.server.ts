/**
 * The second way to a file, next to the `shared_with` cache: through the
 * features list. A Client is never in the cache (ADR-023), so the cache
 * refuses them every file; this lets them open a project's photos when
 * their group gets `photos`, by the same rule the Photos tab shows
 * (`isReachablePhoto`): a photo, never a cost file, a photo of a receipt
 * included.
 *
 * And a photo the moment it's posted (Austin, 2026-09-28): until a sync
 * copies a Card's attachment into the project, the project page serves the
 * writer's original, which sits in their own day and which the cache
 * refuses everyone else. It opens for anyone whose group reaches that row
 * on a project whose Card attaches it (`attachedReach`).
 *
 * Used by the routes that serve bytes (view, rendition, download). Not by
 * the Vault or the file record: a client has neither.
 */

import { canViewFileRef, getFolderById } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";
import { query } from "./generic.server";
import { findOwningProjectFolder, getProjectRole } from "./projectSharing.server";
import { loadProjectFiles, type ProjectFileRow } from "./fileFolders.server";
import { isReachablePhoto, rowsForReader } from "./projectView.server";

/** How long a project's photo list is reused: a thumbnail grid asks once
 * per photo, and the list is about ten queries. A file refiled as a cost
 * stops opening within this long. */
const PHOTO_LIST_MS = 60_000;
const projectRows = new Map<string, { at: number; rows: ProjectFileRow[] }>();

/** A project's file rows (`loadProjectFiles`), reused for `PHOTO_LIST_MS`. */
async function rowsOf(project: VaultFolder): Promise<ProjectFileRow[]> {
  const cached = projectRows.get(project._id);
  if (cached && Date.now() - cached.at < PHOTO_LIST_MS) return cached.rows;
  const rows = await loadProjectFiles(project);
  projectRows.set(project._id, { at: Date.now(), rows });
  return rows;
}

/** The files a project's Photos tab serves (not cost files), by the id
 * each is served as. */
async function photoIds(project: VaultFolder): Promise<Set<string>> {
  return new Set((await rowsOf(project)).filter((r) => isReachablePhoto(r, ["photos"])).map((r) => r.serveId));
}

/** Answers for a writer's original, per viewer and file, reused as long
 * as the rows: a grid of fresh posts asks once per photo. */
const attachedAnswers = new Map<string, { at: number; ok: boolean }>();

/** Whether `file` is a writer's original that a Card on some project
 * attaches, and the viewer's group there reaches its row (the rule each
 * tab already shows: `rowsForReader`, so no receipt for a Client). */
async function attachedReach(humanId: string, file: FileRef): Promise<boolean> {
  const key = `${humanId}:${file._id}`;
  const cached = attachedAnswers.get(key);
  if (cached && Date.now() - cached.at < PHOTO_LIST_MS) return cached.ok;
  // The writer's own Cards that name the file. Only the writer's: a Card
  // can name any id, and sync copies only its author's own files.
  const cards = await query<[{ project_folder_id?: string }[]]>(
    `SELECT project_folder_id FROM file_refs
     WHERE source = 'daily_log_card' AND human_id = $author AND string::contains(content ?? "", $fileId)`,
    { author: file.human_id, fileId: file._id },
  );
  let ok = false;
  for (const projectId of new Set((cards?.[0] ?? []).map((c) => c.project_folder_id).filter((id): id is string => !!id))) {
    const project = await getFolderById(projectId);
    const role = project ? await getProjectRole(project, humanId) : null;
    if (!project || !role) continue;
    if (rowsForReader(await rowsOf(project), role.features).some((r) => r.serveId === file._id)) {
      ok = true;
      break;
    }
  }
  attachedAnswers.set(key, { at: Date.now(), ok });
  return ok;
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
 * (`canViewFileRef`), a photo on a project whose group gets `photos`, or
 * a Card's attachment not yet copied into its project (`attachedReach`). */
export async function canReadFile(humanId: string, file: FileRef): Promise<boolean> {
  if (await canViewFileRef(humanId, file)) return true;
  if (!file.folder_id) return false;
  const project = await photoProjectFor(humanId, file.folder_id);
  if (project && (await photoIds(project)).has(file._id)) return true;
  return attachedReach(humanId, file);
}
