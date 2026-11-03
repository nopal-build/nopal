// =============================================================================
// Admin script: Migrate Trashed Projects To Archived
// (garden/3-growing/guide-projects-phases.md).
//
// Before `archived` existed, "trashed" was the only way to put a project
// away without deleting it outright -- in practice it got used for both
// "I'm done with this" AND "delete this permanently" (the human's own
// call, 2026-11-02). Going forward `trashed` is reserved for the second
// meaning only (it still feeds the real 30-day trash-cleanup cron,
// unchanged) -- every project CURRENTLY `trashed` is, by this call,
// presumed to have meant the first, and is moved to `archived` +
// `completed` outright instead, cancelling whatever trash-cleanup
// countdown it was on.
//
// Idempotent -- a second run finds nothing left in `trashed` to migrate.
// =============================================================================

import { listEveryProject } from "../projectSharing.server";
import { getProjectStatus, migrateTrashedToArchivedProject } from "../projectStatus.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const everyProject = await listEveryProject();
  const trashed = everyProject.filter(({ folder }) => getProjectStatus(folder) === "trashed");

  log(`Found ${everyProject.length} project folder(s) org-wide, ${trashed.length} currently trashed.`);
  for (const { folder } of trashed) {
    log(`  ${dryRun ? "would migrate" : "migrating"} "${folder.name}" -> archived + completed (cancels its trash-cleanup countdown)`);
    if (!dryRun) await migrateTrashedToArchivedProject(folder);
  }

  const summary = `${trashed.length} project(s) ${dryRun ? "would be " : ""}migrated from trashed to archived.`;
  log(summary);
  return { summary };
}
