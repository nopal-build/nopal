/**
 * GraphLog's daily automatic run: on by default for every `project-n02`
 * folder (a project OR a `personal` space) that already has a graph, off
 * only where an Admin/Super turned it off (ADR-030; it was opt-in until
 * 2026-10-01). Mirrors
 * `projectStatus.server.ts`'s architecture: a denormalized boolean flag on
 * `vault_folders` (`graphlog_scheduled`/`graphlog_scheduled_at`) is the
 * source of truth, set only through `setGraphLogScheduled` below.
 *
 * The actual daily trigger lives outside this file: `server.js` calls
 * `POST /api/graphlog/scheduled-run` once, anchored to local midnight
 * (not just "once every 24h from server start" like the other crons),
 * which calls `getGraphLogScheduledFolders` here and enqueues a normal
 * `"run"` job (`graphLogQueue.server.ts`) for each. A `"run"` builds the
 * graph and holds the Efforts page for a print (ADR-030). `runGraphLogPipeline`
 * itself needs no separate "fresh vs incremental" mode for this — every
 * stage already decides that on its own from what's already on disk (a
 * brand new or just-`reset` project has no `Graph` folder / no synced
 * days yet, so `sync-graph` walks every day from scratch; an existing
 * project only picks up what's new since its last run).
 */

import { formatRecord, query } from "./generic.server";
import { updateVaultFolder, type VaultFolder } from "./vault.server";
import { findProjectGraphFolder } from "./projectN02.server";
import { isNightly } from "./effortsPrint.server";

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
 * Every `project-n02` root folder the nightly runs for, which is what
 * `api.graphlog.scheduled-run.tsx`'s midnight cron enqueues a `"run"`
 * job for. Not turned off (`!= false`, so a folder that never set the
 * flag is on), and already holding a graph (`isNightly`): a project that
 * was never run does not pay its whole backlog on the first night.
 */
export async function getGraphLogScheduledFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE folder_type = 'project-n02'
       AND is_folder_type_root = true
       AND (graphlog_scheduled = NONE OR graphlog_scheduled != false)`,
  );
  const folders = (result?.[0] ?? []).map(formatRecord);
  const withGraph = await Promise.all(folders.map(async (f) => isNightly(f, (await findProjectGraphFolder(f)) !== null)));
  return folders.filter((_, i) => withGraph[i]);
}
