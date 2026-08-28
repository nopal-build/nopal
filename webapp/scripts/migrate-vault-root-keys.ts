// =============================================================================
// One-off migration: Vault Root Folders (vault-v2)
//
// Run via: npx vite-node scripts/migrate-vault-root-keys.ts
// (DB connection comes from the same env/defaults as `npm run seed:data`.)
//
// For every human:
//   1. Ensure the Vault Root Folders exist (daily-logs, projects, personal),
//      tagging pre-existing name-matched folders with `vault_root_key`.
//   2. Re-home every OTHER root-level folder:
//        shared with someone  → under `projects`
//        not shared           → under `personal`
//   3. Re-home root-level files (no folder) → under `personal`.
//   4. Propagate `vault_root_key` to every descendant folder.
//
// Idempotent — safe to re-run.
// =============================================================================

import { getDb } from "robustness-core/data/db.server";
import { query, formatRecord, merge } from "robustness-core/data/generic.server";
import { ensureVaultRootFolders } from "robustness-core/data/vault.server";
import type { VaultFolder, FileRef } from "robustness-core/data/vault.types";
import type { VaultRootKey } from "robustness-core/data/vaultRoots";
import type { Human } from "robustness-core/data/humans.server";

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

async function rootLevelFiles(humanId: string): Promise<FileRef[]> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE human_id = $humanId AND folder_id = null`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

const now = () => new Date().toISOString();

/** Stamp `vault_root_key` on every descendant folder (BFS). */
async function propagateRootKey(
  folderId: string,
  key: VaultRootKey,
): Promise<number> {
  let stamped = 0;
  const queue = [folderId];
  while (queue.length) {
    const children = await childFolders(queue.shift()!);
    for (const child of children) {
      queue.push(child._id);
      if (child.vault_root_key !== key) {
        await merge("vault_folders", child._id, {
          vault_root_key: key,
          updated_at: now(),
        });
        stamped++;
      }
    }
  }
  return stamped;
}

function isShared(folder: VaultFolder): boolean {
  return Array.isArray(folder.shared_with) && folder.shared_with.length > 0;
}

async function migrateHuman(human: Human): Promise<void> {
  console.log(`\n── ${human.name ?? human.email} (${human._id})`);

  // 1. Roots (created or tagged)
  const roots = await ensureVaultRootFolders(human._id);
  const rootByKey = Object.fromEntries(
    roots.map((r) => [r.vault_root_key as VaultRootKey, r]),
  ) as Record<VaultRootKey, VaultFolder>;
  console.log(`   roots ok: ${roots.map((r) => r.name).join(", ")}`);

  // 2. Re-home stray root-level folders
  const rootIds = new Set(roots.map((r) => r._id));
  const strays = (await rootLevelFolders(human._id)).filter(
    (f) => !rootIds.has(f._id),
  );
  for (const stray of strays) {
    const dest = isShared(stray) ? rootByKey["projects"] : rootByKey["personal"];
    const key = dest.vault_root_key as VaultRootKey;
    await merge("vault_folders", stray._id, {
      parent_folder_id: dest._id,
      vault_root_key: key,
      updated_at: now(),
    });
    console.log(`   moved folder "${stray.name}" → ${dest.name}/`);
  }

  // 3. Re-home root-level files
  for (const file of await rootLevelFiles(human._id)) {
    await merge("file_refs", file._id, {
      folder_id: rootByKey["personal"]._id,
      updated_at: now(),
    });
    console.log(`   moved file "${file.name}" → personal/`);
  }

  // 4. Propagate keys through every root subtree
  for (const root of roots) {
    const count = await propagateRootKey(
      root._id,
      root.vault_root_key as VaultRootKey,
    );
    if (count) console.log(`   stamped ${count} folder(s) under ${root.name}/`);
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
  console.log(`Migrating vault root keys for ${humans.length} human(s)…`);
  for (const human of humans) {
    await migrateHuman(human);
  }
  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
