// =============================================================================
// Admin script: `deliverables` folders become `letters`.
//
// "Deliverables" became "Letters" on 2026-10-27 (Austin: a letter is a
// human message from one person to another; the word changed in the UI
// and the code so humans, the model and the code share one mental
// model). The feature key, the tab, the routes and the modules changed
// with the code. What the code could not change is stored: each
// project's folder is a `vault_folders` row with `folder_type:
// "deliverables"` and the name "Deliverables". Until this has run, the
// code reads the old value as the new one (`isLettersFolderType`,
// `SPACE_FOLDER_TYPES.deliverables.legacyOf`), so nothing is broken in
// between; once it has run on every row, that legacy entry can go.
//
// For every folder stored as `deliverables`:
//   - `folder_type` becomes `letters` (the type's root and any folder
//     under it that inherited the type, the way `cascadeFolderType`
//     stamps descendants)
//   - a root named exactly "Deliverables" is named "Letters"; any other
//     name was a person's choice and stays
//   - the id stays: every `file_refs.folder_id` points at it, and the
//     code finds the folder by type, never by id or name
//
// Idempotent: a row already on `letters` is not selected. Dry run names
// every row it would rewrite and writes nothing.
// =============================================================================

import { query, formatRecord, merge } from "../generic.server";
import type { VaultFolder } from "../vault.types";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

export const LEGACY_FOLDER_TYPE = "deliverables";
export const LEGACY_FOLDER_NAME = "Deliverables";

/** What one stored folder becomes, or null when it is not a legacy
 * folder. Pure, so the test reads it without a database. */
export function lettersRewrite(
  folder: Pick<VaultFolder, "folder_type" | "name" | "is_folder_type_root">,
): { folder_type: "letters"; name?: string } | null {
  if ((folder.folder_type as string | undefined) !== LEGACY_FOLDER_TYPE) return null;
  const renamed = !!folder.is_folder_type_root && folder.name === LEGACY_FOLDER_NAME;
  return renamed ? { folder_type: "letters", name: "Letters" } : { folder_type: "letters" };
}

async function legacyFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = $legacy ORDER BY is_folder_type_root DESC, name`,
    { legacy: LEGACY_FOLDER_TYPE },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const folders = await legacyFolders();
  if (folders.length === 0) {
    const message = "No folder is stored as deliverables; every Letters folder already carries the new name.";
    log(message);
    return { summary: message };
  }

  let rewritten = 0;
  let renamed = 0;
  for (const folder of folders) {
    const patch = lettersRewrite(folder);
    if (!patch) continue;
    const what = patch.name ? `folder_type letters, name "${patch.name}"` : "folder_type letters";
    log(`${dryRun ? "would rewrite" : "rewriting"} ${folder._id} ("${folder.name}", ${folder.is_folder_type_root ? "root" : "inherited"}): ${what}`);
    if (!dryRun) {
      await merge("vault_folders", folder._id, { ...patch, updated_at: new Date().toISOString() });
    }
    rewritten++;
    if (patch.name) renamed++;
  }

  const summary = `${dryRun ? "Would rewrite" : "Rewrote"} ${rewritten} folder(s) from deliverables to letters, ${renamed} of them renamed to "Letters".`;
  log(summary);
  return { summary };
}
