// =============================================================================
// Admin script: `skills`/`syncs` Vault Roots → Vault Folder Types.
//
// `skills` and `syncs` used to be their own top-level Vault Root Folders.
// They're now Vault Folder TYPES (`vaultFolderTypes.ts`) — special
// sub-folders a human creates inside a project or their Personal space,
// one `skills` + one `syncs` each. This migrates any pre-existing
// root-level `skills`/`syncs` folders (which no longer show up in
// `VAULT_ROOT_KEYS`/`ensureVaultRootFolders`) into the human's `personal/`
// folder, tagged with the new `folder_type`.
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

import { query, formatRecord, merge } from "../generic.server";
import { ensureVaultRootFolders } from "../vault.server";
import type { VaultFolder } from "../vault.types";
import type { Human } from "../humans.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

const now = () => new Date().toISOString();

async function allHumans(): Promise<Human[]> {
  const result = await query<[Human[]]>(`SELECT * FROM humans`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function rootLevelFolders(humanId: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE human_id = $humanId AND parent_folder_id = null`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function childFolders(parentId: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(`SELECT * FROM vault_folders WHERE parent_folder_id = $parentId`, {
    parentId,
  });
  return (result?.[0] ?? []).map(formatRecord);
}

/** Stamp `folder_type` + `vault_root_key` on every descendant folder (BFS). */
async function propagate(
  folderId: string,
  folderType: string,
  vaultRootKey: string,
  dryRun: boolean,
): Promise<number> {
  let stamped = 0;
  const queue = [folderId];
  while (queue.length) {
    const children = await childFolders(queue.shift()!);
    for (const child of children) {
      queue.push(child._id);
      if (child.folder_type !== folderType || child.vault_root_key !== vaultRootKey) {
        if (!dryRun) {
          await merge("vault_folders", child._id, {
            folder_type: folderType,
            vault_root_key: vaultRootKey,
            updated_at: now(),
          });
        }
        stamped++;
      }
    }
  }
  return stamped;
}

async function migrateHuman(human: Human, dryRun: boolean, log: (line: string) => void): Promise<number> {
  const roots = await ensureVaultRootFolders(human._id);
  const personalRoot = roots.find((r) => r.vault_root_key === "personal");
  if (!personalRoot) {
    log(`   ! no personal/ root for ${human._id} — skipping`);
    return 0;
  }

  const strays = (await rootLevelFolders(human._id)).filter((f) => f.name === "skills" || f.name === "syncs");
  if (strays.length === 0) return 0;

  log(`── ${human.name ?? human.email} (${human._id})`);
  let migrated = 0;
  for (const stray of strays) {
    const folderType = stray.name; // "skills" | "syncs"
    log(`   ${dryRun ? "would move" : "moving"} "${stray.name}" -> personal/${stray.name}/ (folder_type: ${folderType})`);
    if (!dryRun) {
      await merge("vault_folders", stray._id, {
        parent_folder_id: personalRoot._id,
        vault_root_key: "personal",
        folder_type: folderType,
        is_folder_type_root: true,
        updated_at: now(),
      });
    }
    const count = await propagate(stray._id, folderType, "personal", dryRun);
    if (count) log(`   stamped ${count} descendant folder(s)`);
    migrated++;
  }
  return migrated;
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const humans = await allHumans();
  log(`Checking ${humans.length} human(s) for stray skills/syncs roots…${dryRun ? " (dry run)" : ""}`);
  let totalMigrated = 0;
  for (const human of humans) {
    totalMigrated += await migrateHuman(human, dryRun, log);
  }
  const summary = `${totalMigrated} stray skills/syncs root(s) ${dryRun ? "would be" : ""} migrated across ${humans.length} human(s).`;
  log(summary);
  return { summary };
}
