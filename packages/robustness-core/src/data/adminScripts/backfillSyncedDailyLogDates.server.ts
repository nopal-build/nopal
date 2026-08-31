// =============================================================================
// Admin script: backfill a missing `date` on an already-synced Daily
// Logs file (a Card's own text, or an attachment) inside a project's
// `syncs/Daily Logs/` folder.
//
// Real, confirmed cause: `sync-graph`'s own candidate collection requires
// a real `date` (`collectDatedCandidates`'s `!!f.date`). A file that
// predates the `date`-stamping fix (`dailyLogSync.server.ts`), or one
// mirrored in by `pull-daily-logs.ts` before ITS OWN matching fix, is
// missing it -- and for any contributor other than whoever last ran
// `pull-daily-logs.ts`, a plain `daily-log-sync` re-run can never reach
// their days at all (their RAW Cards were never pulled locally, only the
// already-synced mirror). `date` is fully recoverable from the filename
// shape itself (`YYYY-MM-DD-humanId.md` / `YYYY-MM-DD-humanId-name`), no
// need to touch content or ask anywhere else for it.
//
// Argument: an optional project name (scans every project-n02 folder if
// left blank).
// =============================================================================

import { query, formatRecord } from "../generic.server";
import { listFolderChildren, updateFileRef, type VaultFolder } from "../vault.server";
import { parseSyncedCardFileName, parseSyncedAttachmentFileName } from "../dailyLogSync.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

function dateFromSyncedName(name: string): string | null {
  return parseSyncedCardFileName(name)?.date ?? parseSyncedAttachmentFileName(name)?.date ?? null;
}

async function findProjectFolders(name: string | undefined): Promise<VaultFolder[]> {
  const result = name
    ? await query<[VaultFolder[]]>(
        `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true AND name = $name`,
        { name },
      )
    : await query<[VaultFolder[]]>(
        `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true`,
      );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function run({ args, dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const projectName = args[0]?.trim() || undefined;

  const projects = await findProjectFolders(projectName);
  if (projects.length === 0) {
    const message = projectName
      ? `No project-n02 folder named "${projectName}" found.`
      : "No project-n02 folders found.";
    log(message);
    return { summary: message };
  }

  let totalFixed = 0;
  for (const project of projects) {
    const { folders } = await listFolderChildren(project.human_id, project._id);
    const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
    if (!syncsFolder) continue;
    const { folders: syncSubs } = await listFolderChildren(project.human_id, syncsFolder._id);
    const dailyLogsFolder = syncSubs.find((f) => f.name === "Daily Logs");
    if (!dailyLogsFolder) continue;

    const { files } = await listFolderChildren(project.human_id, dailyLogsFolder._id);
    let fixed = 0;
    for (const file of files) {
      const recovered = dateFromSyncedName(file.name);
      if (recovered && file.date !== recovered) {
        log(
          `  ${dryRun ? "would fix" : "fixing"}: "${file.name}" (${file._id}) date ${file.date ?? "(none)"} -> ${recovered}`,
        );
        if (!dryRun) await updateFileRef(file._id, { date: recovered });
        fixed++;
      }
    }
    if (fixed > 0) {
      log(`"${project.name}": ${dryRun ? "would backfill" : "backfilled"} date on ${fixed} file(s).`);
      totalFixed += fixed;
    }
  }

  const summary = `${totalFixed} file(s) ${dryRun ? "would be" : ""} backfilled across ${projects.length} project(s) scanned.`;
  log(summary);
  return { summary };
}
