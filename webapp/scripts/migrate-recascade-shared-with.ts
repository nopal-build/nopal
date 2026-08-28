// =============================================================================
// One-off migration/repair: re-cascade `shared_with` onto every descendant
// of a shared project.
//
// Run via: npx vite-node scripts/migrate-recascade-shared-with.ts
// (DB connection comes from the same env/defaults as `npm run seed:data`.)
//
// Bug this fixes: `createVaultFolder` inherited `vault_root_key` and
// `folder_type` from a parent folder, but NOT `shared_with` -- so any
// subfolder created inside an already-shared project (a project's own
// `skills` folder seeded lazily via `ensureProjectN01`, a `photos`
// subfolder created after sharing, etc.) was born with `shared_with: []`,
// invisible to every collaborator who could otherwise see the project's
// README/release-log (which live directly in the project folder itself,
// so they were never affected). Fixed at the source in
// `vault.server.ts`'s `createVaultFolder`; this script repairs data
// created before that fix.
//
// For every `project-n01` folder (a project, or `personal`) whose own
// `shared_with` is non-empty, re-runs `cascadeShareVaultFolder` -- which
// re-reads every CURRENT descendant folder and stamps them all with the
// project's own `shared_with`, regardless of when they were created.
//
// Idempotent -- safe to re-run.
// =============================================================================

import { query, formatRecord } from "robustness-core/data/generic.server";
import { cascadeShareVaultFolder } from "robustness-core/data/vault.server";
import type { VaultFolder } from "robustness-core/data/vault.types";

async function sharedProjectFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE folder_type = "project-n01"
       AND is_folder_type_root = true`,
  );
  const all = (result?.[0] ?? []).map(formatRecord);
  return all.filter(
    (f) => Array.isArray(f.shared_with) && f.shared_with.length > 0,
  );
}

async function main() {
  const projects = await sharedProjectFolders();
  console.log(`Found ${projects.length} shared project(s) to re-cascade...`);

  for (const project of projects) {
    console.log(
      `\n-- "${project.name}" (${project._id}) shared_with: ${JSON.stringify(project.shared_with)}`,
    );
    await cascadeShareVaultFolder(project._id, project.shared_with);
    console.log(`   re-cascaded to every current descendant folder.`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
