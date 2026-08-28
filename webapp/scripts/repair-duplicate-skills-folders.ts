// =============================================================================
// One-off repair: duplicate "Skills" folders left behind by a real,
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
// Run via: npx vite-node scripts/repair-duplicate-skills-folders.ts [--dry-run]
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

import { getDb } from "robustness-core/data/db.server";
import { query, formatRecord } from "robustness-core/data/generic.server";
import {
  listFolderChildren,
  deleteVaultFolderCascade,
  systemVaultFolderKey,
  type VaultFolder,
} from "robustness-core/data/vault.server";

async function findAllProjectN02Folders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const db = await getDb();
  if (!db) {
    console.error("Could not connect to SurrealDB — aborting.");
    process.exit(1);
  }

  const projects = await findAllProjectN02Folders();
  console.log(`Scanning ${projects.length} project-n02 folder(s) for duplicate Skills folders${dryRun ? " (dry run)" : ""}...\n`);

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
      console.log(`! "${project.name}" (${project._id}): ${skillsFolders.length} Skills folders, none matching the expected auto-provisioned id — skipping, review manually.`);
      skipped++;
      continue;
    }

    console.log(`"${project.name}" (${project._id}): deleting ${autoProvisioned.length} auto-provisioned duplicate(s), keeping ${real.length} real one(s).`);
    for (const dupe of autoProvisioned) {
      if (!dryRun) await deleteVaultFolderCascade(dupe._id);
      console.log(`   - deleted ${dupe._id}`);
    }
    repaired++;
  }

  console.log(`\n${dryRun ? "Would repair" : "Repaired"} ${repaired} project(s), skipped ${skipped} ambiguous one(s).`);
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
