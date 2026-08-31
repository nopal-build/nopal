// =============================================================================
// Admin script: removes duplicate `*-summary.md` files created by the
// concurrent-retry bug found while testing PhyLog's pre-capture stage
// (fixed: server.js's httpServer.setTimeout + the CLI client's request
// timeout). Keeps the OLDEST copy of each duplicated name per folder,
// deletes the rest.
//
// Argument: the folder id to clean up (required).
//
// NOTE: the original CLI version of this script hardcoded a single human
// (by email) to scope the lookup, which only worked when that human
// happened to own the target folder. This resolves the folder's REAL
// owner (`getFolderById`) instead, so it works for any folder.
// =============================================================================

import { listFolderChildren, deleteFileRef, getFolderById } from "../vault.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

export async function run({ args, dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const folderId = args[0]?.trim();
  if (!folderId) {
    const message = "Missing required folder id argument.";
    log(message);
    return { summary: message };
  }

  const folder = await getFolderById(folderId);
  if (!folder) {
    const message = `Folder "${folderId}" not found.`;
    log(message);
    return { summary: message };
  }

  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const byName = new Map<string, typeof files>();
  for (const f of files) {
    if (!f.name.endsWith("-summary.md")) continue;
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }

  let deleted = 0;
  for (const [name, list] of byName) {
    if (list.length <= 1) continue;
    const sorted = [...list].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    const [, ...dupes] = sorted;
    for (const dupe of dupes) {
      log(`  ${dryRun ? "would delete" : "deleting"} duplicate ${name} (${dupe._id})`);
      if (!dryRun) await deleteFileRef(dupe._id);
      deleted++;
    }
  }

  const summary = `${deleted} duplicate summary file(s) ${dryRun ? "would be" : ""} deleted in "${folder.name}".`;
  log(summary);
  return { summary };
}
