// =============================================================================
// One-off migration/repair: re-cascade `shared_with` onto every descendant
// of a shared folder.
//
// Run via: npx vite-node scripts/migrate-recascade-shared-with.ts [--dry-run]
// (DB connection comes from the same env/defaults as `npm run seed:data` --
// point DATABASE_URL/DATABASE_USERNAME/DATABASE_PASSWORD at whichever
// environment you want to repair, e.g. production, before running this.)
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
// WHY IT NEEDED FIXING AGAIN: this script used to select only
// `folder_type = "project-n01"` -- the project type at the time it was
// written. Projects have since become `project-n02`, so it silently
// matched NOTHING and the drift it exists to repair went untouched.
// Re-confirmed the hard way: `pull-daily-logs.ts` died listing the
// `Skills` folder inside a SHARED "Crouch Casita" project, which 404s for
// the collaborator while the project itself lists fine.
//
// So this no longer filters by folder type at all. It selects share
// ANCHORS -- any folder with a non-empty `shared_with` whose parent isn't
// itself shared (the same "the folder that was ACTUALLY shared, not one of
// its descendants" definition `getTopLevelSharedFolders` uses) -- and
// repairs downward from each. That can't go stale the next time a folder
// type is renamed.
//
// UNION, NOT OVERWRITE: `cascadeShareVaultFolder` stamps every descendant
// with the anchor's list verbatim. That's right at share-time, but wrong
// for a repair pass -- a descendant carrying an id the anchor doesn't have
// would silently LOSE that access. This merges the anchor's ids INTO each
// descendant instead, so the pass can only ever grant back access that
// cascading should already have given, never take any away.
//
// Idempotent -- safe to re-run (a folder with no drift is a no-op).
// `--dry-run` prints what WOULD change without writing anything.
// =============================================================================

import { query, formatRecord, merge } from "robustness-core/data/generic.server";
import type { VaultFolder } from "robustness-core/data/vault.types";

const DRY_RUN = process.argv.includes("--dry-run");

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

async function main() {
  const shared = await allSharedFolders();
  const anchors = shareAnchors(shared);
  console.log(
    `${shared.length} shared folder(s) total; ${anchors.length} share anchor(s) to repair from.${DRY_RUN ? " (dry run)" : ""}`,
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
    console.log(
      `\n-- "${anchor.name}" (${anchor._id}, owner ${anchor.human_id}) shared_with ${JSON.stringify(want)}`,
    );
    for (const folder of drifted) {
      const union = Array.from(new Set([...sharedWith(folder), ...want]));
      console.log(
        `   ${DRY_RUN ? "would fix" : "fixing"}: "${folder.name}" (${folder._id}) ${JSON.stringify(sharedWith(folder))} -> ${JSON.stringify(union)}`,
      );
      if (!DRY_RUN) {
        await merge("vault_folders", folder._id, {
          shared_with: union,
          updated_at: new Date().toISOString(),
        });
      }
      foldersRepaired++;
    }
  }

  console.log(
    `\nDone. ${foldersRepaired} folder(s) ${DRY_RUN ? "would be" : ""} repaired across ${anchorsWithDrift} shared folder(s).`,
  );
  if (DRY_RUN) console.log("Dry run — nothing was written.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
