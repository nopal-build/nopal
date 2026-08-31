// =============================================================================
// Admin script: repair duplicate "Skills" folders left behind by a real,
// confirmed bug in `pull-daily-logs.ts` (fixed alongside this script) —
// tagging a freshly-pulled local project `project-n02` immediately at
// creation fired `createVaultFolder`'s own `ensureProjectN02` side effect
// (auto-provisioning a Skills folder, deterministic id, DEFAULT content)
// BEFORE the real remote Skills folder (its own original id, its own real
// content) was pulled in by `pullFolderTree` moments later — leaving two
// "Skills" folders under the same project, neither deduped by
// `projectN02.server.ts`'s own deterministic-id fix (that fix only
// prevents the SAME code path racing against itself, not two genuinely
// different creation paths each producing one).
//
// For every project-n02 folder with 2+ "Skills" folders, deletes whichever
// one has the deterministic auto-provisioned id
// (`systemVaultFolderKey(humanId, "Skills", projectId)`) — that one is
// ALWAYS the auto-seeded default, never real customized content, and its
// id is locally-generated rather than matching anything on the remote it
// was pulled from. The other (real, pulled) Skills folder is left alone.
// If a project somehow has 2+ Skills folders and NONE match the
// deterministic id (a different, unrelated situation), it's reported and
// skipped rather than guessed at.
//
// Idempotent — safe to re-run (a project with exactly one Skills folder
// left is a no-op).
// =============================================================================

import { query, formatRecord } from "../generic.server";
import {
  listFolderChildren,
  deleteVaultFolderCascade,
  systemVaultFolderKey,
  type VaultFolder,
} from "../vault.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

async function findAllProjectN02Folders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const projects = await findAllProjectN02Folders();
  log(`Scanning ${projects.length} project-n02 folder(s) for duplicate Skills folders.${dryRun ? " (dry run)" : ""}`);

  let repaired = 0;
  let skipped = 0;

  for (const project of projects) {
    const { folders } = await listFolderChildren(project.human_id, project._id);
    const skillsFolders = folders.filter((f) => f.is_folder_type_root && f.folder_type === "skills");
    if (skillsFolders.length <= 1) continue;

    const deterministicId = systemVaultFolderKey(project.human_id, "Skills", project._id);
    const autoProvisioned = skillsFolders.filter((f) => f._id === deterministicId);
    const real = skillsFolders.filter((f) => f._id !== deterministicId);

    if (autoProvisioned.length === 0 || real.length === 0) {
      log(
        `! "${project.name}" (${project._id}): ${skillsFolders.length} Skills folders, none matching the expected auto-provisioned id — skipping, review manually.`,
      );
      skipped++;
      continue;
    }

    log(
      `"${project.name}" (${project._id}): ${dryRun ? "would delete" : "deleting"} ${autoProvisioned.length} auto-provisioned duplicate(s), keeping ${real.length} real one(s).`,
    );
    for (const dupe of autoProvisioned) {
      if (!dryRun) await deleteVaultFolderCascade(dupe._id);
      log(`   - ${dryRun ? "would delete" : "deleted"} ${dupe._id}`);
    }
    repaired++;
  }

  const summary = `${repaired} project(s) ${dryRun ? "would be" : ""} repaired, ${skipped} ambiguous one(s) skipped.`;
  log(summary);
  return { summary };
}
