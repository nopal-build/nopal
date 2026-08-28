/**
 * GraphLog's daily automatic run — an Admin/Super-only opt-in per
 * `project-n02` folder (a project OR a `personal` space), mirroring
 * `projectStatus.server.ts`'s architecture: a denormalized boolean flag on
 * `vault_folders` (`graphlog_scheduled`/`graphlog_scheduled_at`) is the
 * source of truth, set only through `setGraphLogScheduled` below.
 *
 * The actual daily trigger lives outside this file: `server.js` calls
 * `POST /api/graphlog/scheduled-run` once, anchored to local midnight
 * (not just "once every 24h from server start" like the other crons),
 * which calls `getGraphLogScheduledFolders` here and enqueues a normal
 * `"run"` job (`graphLogQueue.server.ts`) for each. `runGraphLogPipeline`
 * itself needs no separate "fresh vs incremental" mode for this — every
 * stage already decides that on its own from what's already on disk (a
 * brand new or just-`reset` project has no `Graph` folder / no synced
 * days yet, so `sync-graph` walks every day from scratch; an existing
 * project only picks up what's new since its last run).
 */

import { formatRecord, query } from "./generic.server";
import { updateVaultFolder, type VaultFolder } from "./vault.server";

/** Whether `folder` is currently enrolled in GraphLog's daily automatic
 * run. Reads the denormalized cache directly (see module doc). */
export function isGraphLogScheduled(folder: VaultFolder): boolean {
  return folder.graphlog_scheduled === true;
}

export type SetGraphLogScheduledResult =
  | { ok: true; scheduled: boolean }
  | { ok: false; error: string };

/**
 * Enables/disables GraphLog's daily automatic run for a `project-n02`
 * folder. Deliberately NOT gated on project ownership/Sharing Roles the
 * way `setProjectStatus` is on its creator — the caller (see
 * `api.graphlog.schedule.tsx`) is expected to have already checked
 * Admin/Super, which is a stricter, orthogonal gate.
 */
export async function setGraphLogScheduled(
  folder: VaultFolder,
  scheduled: boolean,
): Promise<SetGraphLogScheduledResult> {
  if (folder.folder_type !== "project-n02" || !folder.is_folder_type_root) {
    return { ok: false, error: "GraphLog scheduling only applies to a project or personal space" };
  }

  await updateVaultFolder(folder._id, {
    graphlog_scheduled: scheduled,
    graphlog_scheduled_at: new Date().toISOString(),
  });

  return { ok: true, scheduled };
}

/**
 * Every `project-n02` root folder currently enrolled in the daily
 * automatic run — what `api.graphlog.scheduled-run.tsx`'s midnight cron
 * enqueues a `"run"` job for. A direct query against the denormalized
 * cache (same trick `getTrashedProjectFoldersForCleanup` uses for
 * `project_status`) rather than a per-human scan across every vault.
 */
export async function getGraphLogScheduledFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE folder_type = 'project-n02'
       AND is_folder_type_root = true
       AND graphlog_scheduled = true`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}
