// =============================================================================
// Admin script: re-cascade `shared_with` onto every descendant of a shared
// folder.
//
// Registered in `adminScriptsRegistry.server.ts` as "recascade-shared-with"
// -- run it from /fruits/maker/scripts, not directly. Formerly a one-off
// CLI script (`webapp/scripts/migrate-recascade-shared-with.ts`), ported
// here so it runs on the worker (which already holds the real prod DB
// credentials as Fly secrets) instead of requiring a local `vite-node` +
// `fly proxy` tunnel every time it needs a re-run.
//
// Bug this fixes: `createVaultFolder` inherited `vault_root_key` and
// `folder_type` from a parent folder, but NOT `shared_with` -- so any
// subfolder created inside an already-shared project (a project's own
// `Skills` folder, auto-provisioned lazily by `ensureProjectN02`; a
// `photos` subfolder created after sharing; etc.) was born with
// `shared_with: []`, invisible to every collaborator who could otherwise
// see the project's README/release-log (which live directly in the project
// folder itself, so they were never affected). Fixed at the source in
// `vault.server.ts`'s `createVaultFolder`; this script repairs data
// created before that fix.
//
// This selects share ANCHORS -- any folder with a non-empty `shared_with`
// whose parent isn't itself shared (the same "the folder that was
// ACTUALLY shared, not one of its descendants" definition
// `getTopLevelSharedFolders` uses) -- and repairs downward from each, so
// it can't go stale if a folder type is ever renamed (see this script's
// git history for the exact way selecting by `folder_type` bit us once
// already).
//
// UNION, NOT OVERWRITE: `cascadeShareVaultFolder` stamps every descendant
// with the anchor's list verbatim. That's right at share-time, but wrong
// for a repair pass -- a descendant carrying an id the anchor doesn't have
// would silently LOSE that access. This merges the anchor's ids INTO each
// descendant instead, so the pass can only ever grant back access that
// cascading should already have given, never take any away.
//
// Idempotent -- safe to re-run (a folder with no drift is a no-op).
// =============================================================================

import { query, formatRecord, merge } from "../generic.server";
import type { VaultFolder } from "../vault.types";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

function sharedWith(folder: VaultFolder): string[] {
  return Array.isArray(folder.shared_with) ? folder.shared_with : [];
}

/** Every folder that currently has someone in `shared_with`. */
async function allSharedFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE array::len(shared_with) > 0
     ORDER BY human_id, name ASC`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** The folders sharing was actually applied TO — one whose parent is also
 * shared is a descendant of an anchor, not an anchor itself. */
function shareAnchors(shared: VaultFolder[]): VaultFolder[] {
  const sharedIds = new Set(shared.map((f) => f._id));
  return shared.filter(
    (f) => !f.parent_folder_id || !sharedIds.has(f.parent_folder_id),
  );
}

async function descendants(parentId: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE parent_folder_id = $parentId`,
    { parentId },
  );
  const children = (result?.[0] ?? []).map(formatRecord);
  const out: VaultFolder[] = [];
  for (const child of children) {
    out.push(child);
    out.push(...(await descendants(child._id)));
  }
  return out;
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const shared = await allSharedFolders();
  const anchors = shareAnchors(shared);
  log(
    `${shared.length} shared folder(s) total; ${anchors.length} share anchor(s) to repair from.${dryRun ? " (dry run)" : ""}`,
  );

  let foldersRepaired = 0;
  let anchorsWithDrift = 0;

  for (const anchor of anchors) {
    const want = sharedWith(anchor);
    const kids = await descendants(anchor._id);
    const drifted = kids.filter((k) => {
      const have = new Set(sharedWith(k));
      return want.some((h) => !have.has(h));
    });
    if (drifted.length === 0) continue;

    anchorsWithDrift++;
    log(`"${anchor.name}" (${anchor._id}, owner ${anchor.human_id}) shared_with ${JSON.stringify(want)}`);
    for (const folder of drifted) {
      const union = Array.from(new Set([...sharedWith(folder), ...want]));
      log(
        `  ${dryRun ? "would fix" : "fixing"}: "${folder.name}" (${folder._id}) ${JSON.stringify(sharedWith(folder))} -> ${JSON.stringify(union)}`,
      );
      if (!dryRun) {
        await merge("vault_folders", folder._id, {
          shared_with: union,
          updated_at: new Date().toISOString(),
        });
      }
      foldersRepaired++;
    }
  }

  const summary = `${foldersRepaired} folder(s) ${dryRun ? "would be" : ""} repaired across ${anchorsWithDrift} shared folder(s).`;
  log(summary);
  return { summary };
}
