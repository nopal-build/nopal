// =============================================================================
// One-off migration: `skills`/`syncs` Vault Roots → Vault Folder Types
//
// Run via: npx vite-node scripts/migrate-syncs-skills-to-folder-types.ts
// (DB connection comes from the same env/defaults as `npm run seed:data`.)
//
// `skills` and `syncs` used to be their own top-level Vault Root Folders
// (see `webapp/app/data/vaultRoots.ts`'s history). They're now Vault Folder
// TYPES (`vaultFolderTypes.ts`) — special sub-folders a human creates inside
// a project or their Personal space, one `skills` + one `syncs` each. This
// migrates any pre-existing root-level `skills`/`syncs` folders (which no
// longer show up in `VAULT_ROOT_KEYS`/`ensureVaultRootFolders`) into the
// human's `personal/` folder, tagged with the new `folder_type`.
//
// For every human, for each of `skills`/`syncs` (if a stray root-level
// folder with that key exists):
//   1. Re-parent it under `personal/`, stamping `folder_type` (+
//      `is_folder_type_root: true`) and `vault_root_key: "personal"`.
//   2. Propagate `folder_type` to every descendant folder (cascade, same
//      trick `vault_root_key` uses — see `cascadeFolderType` in
//      vault.server.ts, reimplemented standalone here since that function
//      isn't exported).
//
// Idempotent — safe to re-run (a human who already has personal/skills or
// personal/syncs, or no stray root at all, is a no-op).
// =============================================================================

import { getDb } from "../app/data/db.server";
import { query, formatRecord, merge } from "../app/data/generic.server";
import { ensureVaultRootFolders } from "../app/data/vault.server";
import type { VaultFolder } from "../app/data/vault.types";
import type { Human } from "../app/data/humans.server";

async function allHumans(): Promise<Human[]> {
  const result = await query<[Human[]]>(`SELECT * FROM humans`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function rootLevelFolders(humanId: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId AND parent_folder_id = null`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function childFolders(parentId: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE parent_folder_id = $parentId`,
    { parentId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

const now = () => new Date().toISOString();

/** Stamp `folder_type` + `vault_root_key` on every descendant folder (BFS). */
async function propagate(
  folderId: string,
  folderType: string,
  vaultRootKey: string,
): Promise<number> {
  let stamped = 0;
  const queue = [folderId];
  while (queue.length) {
    const children = await childFolders(queue.shift()!);
    for (const child of children) {
      queue.push(child._id);
      if (child.folder_type !== folderType || child.vault_root_key !== vaultRootKey) {
        await merge("vault_folders", child._id, {
          folder_type: folderType,
          vault_root_key: vaultRootKey,
          updated_at: now(),
        });
        stamped++;
      }
    }
  }
  return stamped;
}

async function migrateHuman(human: Human): Promise<void> {
  const roots = await ensureVaultRootFolders(human._id);
  const personalRoot = roots.find((r) => r.vault_root_key === "personal");
  if (!personalRoot) {
    console.log(`   ! no personal/ root for ${human._id} — skipping`);
    return;
  }

  const strays = (await rootLevelFolders(human._id)).filter(
    (f) => f.name === "skills" || f.name === "syncs",
  );
  if (strays.length === 0) return;

  console.log(`\n── ${human.name ?? human.email} (${human._id})`);
  for (const stray of strays) {
    const folderType = stray.name; // "skills" | "syncs"
    await merge("vault_folders", stray._id, {
      parent_folder_id: personalRoot._id,
      vault_root_key: "personal",
      folder_type: folderType,
      is_folder_type_root: true,
      updated_at: now(),
    });
    const count = await propagate(stray._id, folderType, "personal");
    console.log(
      `   moved "${stray.name}" → personal/${stray.name}/ (folder_type: ${folderType}` +
        (count ? `, stamped ${count} descendant folder(s)` : "") +
        `)`,
    );
  }
}

async function main() {
  // Fail fast when the DB isn't reachable.
  const db = await getDb();
  if (!db) {
    console.error("Could not connect to SurrealDB — aborting.");
    process.exit(1);
  }
  await db.close();

  const humans = await allHumans();
  console.log(`Checking ${humans.length} human(s) for stray skills/syncs roots…`);
  for (const human of humans) {
    await migrateHuman(human);
  }
  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
