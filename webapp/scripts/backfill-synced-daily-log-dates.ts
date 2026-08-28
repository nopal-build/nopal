// =============================================================================
// One-off repair: backfill a missing `date` on an already-synced Daily
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
// Run via: npx vite-node scripts/backfill-synced-daily-log-dates.ts "Project Name"
//          (or with no project name to scan every project-n02 folder)
// =============================================================================

import { getDb } from "robustness-core/data/db.server";
import { query, formatRecord } from "robustness-core/data/generic.server";
import { listFolderChildren, updateFileRef, type VaultFolder } from "robustness-core/data/vault.server";
import { parseSyncedCardFileName, parseSyncedAttachmentFileName } from "robustness-core/data/dailyLogSync.server";

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

async function main() {
  const projectName = process.argv[2];

  const db = await getDb();
  if (!db) {
    console.error("Could not connect to SurrealDB — aborting.");
    process.exit(1);
  }

  const projects = await findProjectFolders(projectName);
  if (projects.length === 0) {
    console.error(projectName ? `No project-n02 folder named "${projectName}" found.` : "No project-n02 folders found.");
    process.exit(1);
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
        await updateFileRef(file._id, { date: recovered });
        fixed++;
      }
    }
    if (fixed > 0) {
      console.log(`"${project.name}": backfilled date on ${fixed} file(s).`);
      totalFixed += fixed;
    }
  }

  console.log(`\nDone. ${totalFixed} file(s) backfilled across ${projects.length} project(s) scanned.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
