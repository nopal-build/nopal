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
 * And a photo on a suggestion that is waiting (Austin, 2026-10-01: "a
 * guide needs to see photos"): an Observer's Card feeds the project
 * nothing until a Guide takes it, so its attachment has no row and no
 * copy. It opens for whoever decides suggestions on that project.
 *
 * Once the sync has copied an attachment, the original is its writer's
 * alone again and everyone else is served the copy. But a Card's markdown
 * still names the original, and so does the synced copy of that Card, so
 * every page that renders one asks for an id the reader cannot open.
 * `readableFile` answers that request with the project's copy when the
 * reader can open the copy: the original's record stays closed, and no
 * page that prints a Card has to know about the two ids (2026-10-01; the
 * Logbook's photos broke for everyone but their writer).
 *
 * Used by the routes that serve bytes (view, rendition, download). Not by
 * the Vault or the file record: a client has neither.
 */

import { canViewFileRef, getFileRefById, getFolderById } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";
import { query } from "./generic.server";
import { findOwningProjectFolder, getProjectRole } from "./projectSharing.server";
import { loadProjectFiles, type ProjectFileRow } from "./fileFolders.server";
import { isReachablePhoto, rowsForReader } from "./projectView.server";

/** How long a project's photo list is reused: a thumbnail grid asks once
 * per photo, and the list is about ten queries. A file refiled as a cost
 * stops opening within this long. */
const PHOTO_LIST_MS = 60_000;
/** How long a "no" is reused. A photo posted, taken or copied a moment
 * ago is not in a list from before it, and a minute of a broken picture
 * on everyone else's screen is what the short answer avoids; a grid of
 * refused files still costs one reload per project in this long. */
const REFUSAL_MS = 5_000;
const projectRows = new Map<string, { at: number; rows: ProjectFileRow[] }>();

/** A project's file rows (`loadProjectFiles`), reused for `maxAgeMs`. */
async function rowsOf(project: VaultFolder, maxAgeMs = PHOTO_LIST_MS): Promise<ProjectFileRow[]> {
  const cached = projectRows.get(project._id);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.rows;
  const rows = await loadProjectFiles(project);
  projectRows.set(project._id, { at: Date.now(), rows });
  return rows;
}

/** A project's file rows, loaded again when the reused list has nothing
 * `has` is looking for and is more than a moment old. */
async function rowsFinding(project: VaultFolder, has: (rows: ProjectFileRow[]) => boolean): Promise<ProjectFileRow[]> {
  const rows = await rowsOf(project);
  return has(rows) ? rows : rowsOf(project, REFUSAL_MS);
}

/** How long an answer is reused: a yes as long as the rows, a no only
 * for a moment. */
function stillGood(at: number, yes: boolean): boolean {
  return Date.now() - at < (yes ? PHOTO_LIST_MS : REFUSAL_MS);
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
  if (cached && stillGood(cached.at, cached.ok)) return cached.ok;
  let ok = false;
  for (const { projectId, suggestion } of await projectsAttaching(file)) {
    const project = await getFolderById(projectId);
    const role = project ? await getProjectRole(project, humanId) : null;
    if (!project || !role) continue;
    const served = (rows: ProjectFileRow[]) => rowsForReader(rows, role.features).some((r) => r.serveId === file._id);
    if (served(await rowsFinding(project, served))) {
      ok = true;
      break;
    }
    // A suggestion feeds no row until it is taken: whoever decides on it
    // has to see what they are deciding on.
    if (suggestion && role.features.includes("suggestions")) {
      ok = true;
      break;
    }
  }
  attachedAnswers.set(key, { at: Date.now(), ok });
  return ok;
}

/** The projects with a Card, by the file's own writer, that names the
 * file, and whether a Card that names it there is a suggestion. Only the
 * writer's Cards: a Card can name any id, and sync copies only its
 * author's own files. */
async function projectsAttaching(file: FileRef): Promise<{ projectId: string; suggestion: boolean }[]> {
  const cards = await query<[{ project_folder_id?: string; suggestion?: boolean }[]]>(
    `SELECT project_folder_id, suggestion FROM file_refs
     WHERE source = 'daily_log_card' AND human_id = $author AND string::contains(content ?? "", $fileId)`,
    { author: file.human_id, fileId: file._id },
  );
  const byProject = new Map<string, boolean>();
  for (const c of cards?.[0] ?? []) {
    if (c.project_folder_id) byProject.set(c.project_folder_id, (byProject.get(c.project_folder_id) ?? false) || !!c.suggestion);
  }
  return [...byProject].map(([projectId, suggestion]) => ({ projectId, suggestion }));
}

/** Answers for an original's copy, per viewer and file, reused as long
 * as the rows. The id of the copy, or null. */
const copyAnswers = new Map<string, { at: number; copyId: string | null }>();

/** The project's copy of a writer's original, when a sync has made one
 * and the viewer may open it. The copy is judged by `canReadFile` like
 * any file asked for by its own id, so this opens nothing a file tab
 * would not: no receipt for a Client. */
async function reachableCopy(humanId: string, file: FileRef): Promise<FileRef | null> {
  const key = `${humanId}:${file._id}`;
  const cached = copyAnswers.get(key);
  if (cached && stillGood(cached.at, !!cached.copyId)) return cached.copyId ? ((await getFileRefById(cached.copyId)) ?? null) : null;
  let found: FileRef | null = null;
  for (const { projectId } of await projectsAttaching(file)) {
    const project = await getFolderById(projectId);
    if (!project) continue;
    const copied = (r: ProjectFileRow) => r.fileId === file._id && r.serveId !== file._id;
    const row = (await rowsFinding(project, (rows) => rows.some(copied))).find(copied);
    const copy = row ? await getFileRefById(row.serveId) : undefined;
    if (copy && (await canReadFile(humanId, copy))) {
      found = copy;
      break;
    }
  }
  copyAnswers.set(key, { at: Date.now(), copyId: found?._id ?? null });
  return found;
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
  // The files a project's Photos tab serves (not cost files), by the id
  // each is served as.
  const isPhoto = (rows: ProjectFileRow[]) => rows.some((r) => r.serveId === file._id && isReachablePhoto(r, ["photos"]));
  if (project && isPhoto(await rowsFinding(project, isPhoto))) return true;
  return attachedReach(humanId, file);
}

/** The file whose bytes `humanId` gets when they ask for `file`: the file
 * itself when they may open it, the project's copy of it when it is a
 * writer's original they may not (`reachableCopy`), or null, which the
 * routes answer as a file that doesn't exist. */
export async function readableFile(humanId: string, file: FileRef): Promise<FileRef | null> {
  if (await canReadFile(humanId, file)) return file;
  return reachableCopy(humanId, file);
}
