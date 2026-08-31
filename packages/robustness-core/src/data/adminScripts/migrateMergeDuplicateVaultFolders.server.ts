// =============================================================================
// Admin script: merge duplicate vault folders.
//
// `getOrCreateVaultFolder`/`ensureVaultRootFolders` (vault.server.ts) used to
// do a plain "SELECT, then CREATE if missing" check with no atomicity —
// concurrent requests for the SAME conceptual folder (e.g. a Daily Log
// upload and a Card creation landing at the same moment) could both miss the
// SELECT and both create one, leaving REAL, silently duplicate folders
// (multiple "daily-logs" roots, multiple same-date subfolders, ...) for the
// same human. Once that happens, whichever duplicate a later bare `LIMIT 1`
// resolves to is non-deterministic — a file created via one duplicate can
// become permanently invisible to a request that resolves to a different
// one (this is exactly what caused a freshly-added Daily Log Card to work
// within the session that created it, then get stuck on "Loading card…"
// forever after a reload).
//
// `getOrCreateVaultFolder`/`ensureVaultRootFolders` are now fixed (a
// deterministic per-(human, name, parent) folder id, created via an atomic
// `UPSERT`) so this can't happen again going forward — this script is the
// cleanup for whatever duplicates already exist.
//
// For every human, walks the folder tree top-down (root-level first, then
// each surviving folder's own children, recursively) and merges every group
// of same-named siblings under the same parent: the OLDEST becomes
// canonical, every other folder's children/files are reparented onto it,
// then the now-empty duplicate is deleted.
//
// Idempotent — safe to re-run (a tree with no duplicates left is a no-op).
// Run "Dedupe daily-log readme.md mirrors" AFTER this — merging duplicate
// date folders can leave more than one readme.md file_ref in the same
// (now-canonical) folder.
// =============================================================================

import { query, formatRecord, merge, remove } from "../generic.server";
import type { VaultFolder, FileRef } from "../vault.types";
import type { Human } from "../humans.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

const now = () => new Date().toISOString();

async function allHumans(): Promise<Human[]> {
  const result = await query<[Human[]]>(`SELECT * FROM humans`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function foldersByParent(humanId: string, parentFolderId: string | null): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId AND parent_folder_id = $parentFolderId
     ORDER BY created_at ASC`,
    { humanId, parentFolderId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function filesByFolder(folderId: string): Promise<FileRef[]> {
  const result = await query<[FileRef[]]>(`SELECT * FROM file_refs WHERE folder_id = $folderId`, { folderId });
  return (result?.[0] ?? []).map(formatRecord);
}

/** Moves every child folder and every file off `duplicate` onto
 * `canonical`, then deletes `duplicate` (now empty). Doesn't itself dedupe
 * grandchildren that collide by name after reparenting — the caller's own
 * recursive walk re-checks `canonical`'s children fresh, which catches
 * that case the same way it catches any other pre-existing duplicate. */
async function mergeFolderInto(
  duplicate: VaultFolder,
  canonical: VaultFolder,
  dryRun: boolean,
  log: (line: string) => void,
): Promise<void> {
  const children = await foldersByParent(duplicate.human_id, duplicate._id);
  for (const child of children) {
    log(`    ${dryRun ? "would reparent" : "reparent"} folder "${child.name}" (${child._id}) -> ${canonical._id}`);
    if (!dryRun) {
      await merge("vault_folders", child._id, { parent_folder_id: canonical._id, updated_at: now() });
    }
  }

  const files = await filesByFolder(duplicate._id);
  for (const file of files) {
    log(`    ${dryRun ? "would reparent" : "reparent"} file "${file.name}" (${file._id}) -> ${canonical._id}`);
    if (!dryRun) {
      await merge("file_refs", file._id, { folder_id: canonical._id, updated_at: now() });
    }
  }

  log(`    ${dryRun ? "would delete" : "delete"} now-empty duplicate folder "${duplicate.name}" (${duplicate._id})`);
  if (!dryRun) {
    await remove("vault_folders", duplicate._id);
  }
}

/** Merges every set of same-named sibling folders under `parentFolderId`
 * (for `humanId`), then recurses into whatever's left to catch duplicates
 * at any depth — this is how a duplicate "daily-logs" ROOT and a duplicate
 * date-named folder underneath it both get caught by the same walk. */
async function mergeDuplicateSiblings(
  humanId: string,
  parentFolderId: string | null,
  dryRun: boolean,
  log: (line: string) => void,
): Promise<number> {
  const siblings = await foldersByParent(humanId, parentFolderId);
  const byName = new Map<string, VaultFolder[]>();
  for (const folder of siblings) {
    const group = byName.get(folder.name) ?? [];
    group.push(folder);
    byName.set(folder.name, group);
  }

  let merged = 0;
  const survivors: VaultFolder[] = [];
  for (const [name, group] of byName) {
    // Already `ORDER BY created_at ASC` — the first is the oldest.
    const [canonical, ...duplicates] = group;
    survivors.push(canonical);
    if (duplicates.length === 0) continue;
    log(`  human ${humanId}: merging ${duplicates.length} duplicate(s) of "${name}" into ${canonical._id}`);
    for (const duplicate of duplicates) {
      await mergeFolderInto(duplicate, canonical, dryRun, log);
      merged++;
    }
  }

  for (const survivor of survivors) {
    merged += await mergeDuplicateSiblings(humanId, survivor._id, dryRun, log);
  }
  return merged;
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const humans = await allHumans();
  log(`Checking ${humans.length} human(s) for duplicate vault folders…${dryRun ? " (dry run)" : ""}`);
  let totalMerged = 0;
  for (const human of humans) {
    totalMerged += await mergeDuplicateSiblings(human._id, null, dryRun, log);
  }
  const summary = `${totalMerged} duplicate folder(s) ${dryRun ? "would be" : ""} merged across ${humans.length} human(s).`;
  log(summary);
  return { summary };
}
