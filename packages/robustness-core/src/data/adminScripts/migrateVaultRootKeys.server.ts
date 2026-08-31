// =============================================================================
// Admin script: Vault Root Folders (vault-v2).
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

import { query, formatRecord, merge } from "../generic.server";
import { ensureVaultRootFolders } from "../vault.server";
import type { VaultFolder, FileRef } from "../vault.types";
import type { VaultRootKey } from "../vaultRoots";
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

async function rootLevelFiles(humanId: string): Promise<FileRef[]> {
  const result = await query<[FileRef[]]>(`SELECT * FROM file_refs WHERE human_id = $humanId AND folder_id = null`, {
    humanId,
  });
  return (result?.[0] ?? []).map(formatRecord);
}

/** Stamp `vault_root_key` on every descendant folder (BFS). */
async function propagateRootKey(folderId: string, key: VaultRootKey, dryRun: boolean): Promise<number> {
  let stamped = 0;
  const queue = [folderId];
  while (queue.length) {
    const children = await childFolders(queue.shift()!);
    for (const child of children) {
      queue.push(child._id);
      if (child.vault_root_key !== key) {
        if (!dryRun) await merge("vault_folders", child._id, { vault_root_key: key, updated_at: now() });
        stamped++;
      }
    }
  }
  return stamped;
}

function isShared(folder: VaultFolder): boolean {
  return Array.isArray(folder.shared_with) && folder.shared_with.length > 0;
}

async function migrateHuman(human: Human, dryRun: boolean, log: (line: string) => void): Promise<void> {
  log(`── ${human.name ?? human.email} (${human._id})`);

  // 1. Roots (created or tagged)
  const roots = await ensureVaultRootFolders(human._id);
  const rootByKey = Object.fromEntries(roots.map((r) => [r.vault_root_key as VaultRootKey, r])) as Record<
    VaultRootKey,
    VaultFolder
  >;
  log(`   roots ok: ${roots.map((r) => r.name).join(", ")}`);

  // 2. Re-home stray root-level folders
  const rootIds = new Set(roots.map((r) => r._id));
  const strays = (await rootLevelFolders(human._id)).filter((f) => !rootIds.has(f._id));
  for (const stray of strays) {
    const dest = isShared(stray) ? rootByKey["projects"] : rootByKey["personal"];
    const key = dest.vault_root_key as VaultRootKey;
    log(`   ${dryRun ? "would move" : "moving"} folder "${stray.name}" -> ${dest.name}/`);
    if (!dryRun) {
      await merge("vault_folders", stray._id, { parent_folder_id: dest._id, vault_root_key: key, updated_at: now() });
    }
  }

  // 3. Re-home root-level files
  for (const file of await rootLevelFiles(human._id)) {
    log(`   ${dryRun ? "would move" : "moving"} file "${file.name}" -> personal/`);
    if (!dryRun) {
      await merge("file_refs", file._id, { folder_id: rootByKey["personal"]._id, updated_at: now() });
    }
  }

  // 4. Propagate keys through every root subtree
  for (const root of roots) {
    const count = await propagateRootKey(root._id, root.vault_root_key as VaultRootKey, dryRun);
    if (count) log(`   stamped ${count} folder(s) under ${root.name}/`);
  }
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const humans = await allHumans();
  log(`Migrating vault root keys for ${humans.length} human(s)…${dryRun ? " (dry run)" : ""}`);
  for (const human of humans) {
    await migrateHuman(human, dryRun, log);
  }
  const summary = `Checked ${humans.length} human(s).`;
  log(summary);
  return { summary };
}
