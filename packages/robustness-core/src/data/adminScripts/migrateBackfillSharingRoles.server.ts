// =============================================================================
// Admin script: backfill missing Sharing Role entries for humans who
// already have legacy VIEW access to a project.
//
// Bug this fixes: PhyLog's Sharing Roles (`projectSharing.server.ts`)
// replaced the old plain `shared_with: string[] | "everyone"` sharing
// model, but nothing ever migrated EXISTING `shared_with` entries into the
// new model's source of truth — a project's own README.md `sharing` front
// matter. `vault_folders.shared_with` is supposed to be a derived cache of
// that list (kept in sync by `setProjectSharing`), but for any project
// shared BEFORE this feature shipped, it's the other way around: a human's
// id sits in `shared_with` (so they can still VIEW everything — the Vault,
// the README, the project's files) with NO corresponding `sharing` entry
// at all. Since every owner-tier-gated action (editing a project's
// `skills` folder, changing sharing itself) reads the `sharing` list, not
// `shared_with`, that human silently has full view access but no Role —
// `getProjectRole` returns `null` for them, same as a total stranger.
//
// For every project folder with a non-empty `shared_with`: for each human
// id in there that ISN'T the project's own creator and has NO entry in the
// project's current `sharing` list, add one with the least-privileged
// default role (the first non-owner-tier role in `sharing_roles`, e.g.
// "Observer") — preserving whatever view access they already had, without
// silently granting anyone owner-tier permissions they never had before.
// Existing `sharing` entries are left completely untouched.
//
// Idempotent — safe to re-run (a project with no drift is a no-op).
//
// NOTE: this originally selected `folder_type = "project-n01"` -- the
// project type at the time it was written. Projects have since become
// `project-n02` (same drift `migrate-recascade-shared-with.ts`'s own
// history hit), so it silently matched NOTHING for a long stretch. Fixed
// here on the same port that moved this into the registry.
// =============================================================================

import { query, formatRecord } from "../generic.server";
import { getFolderById } from "../vault.server";
import { getProjectSharing, setProjectSharing, type ProjectSharingEntry } from "../projectSharing.server";
import { getSharingRoles } from "../sharingRoles.server";
import { getHumansById } from "../humans.server";
import type { VaultFolder } from "../vault.types";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

async function sharedProjectFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE folder_type = "project-n02"
       AND is_folder_type_root = true
       AND vault_root_key = "projects"`,
  );
  const all = (result?.[0] ?? []).map(formatRecord);
  return all.filter((f) => Array.isArray(f.shared_with) && f.shared_with.length > 0);
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const roles = await getSharingRoles();
  const defaultRole = roles.find((r) => !r.is_owner)?.name ?? roles[0]?.name;
  if (!defaultRole) {
    const message = "No sharing roles defined at all — aborting.";
    log(message);
    return { summary: message };
  }
  log(`Default backfill role: "${defaultRole}"${dryRun ? " (dry run — no writes)" : ""}`);

  const projects = await sharedProjectFolders();
  log(`Found ${projects.length} project(s) with existing shared_with entries.`);

  let touched = 0;
  for (const project of projects) {
    // Re-fetch fresh — `sharedProjectFolders` may be slightly stale if two
    // projects happen to share underlying folder data (they never do, but
    // cheap insurance against acting on a stale snapshot).
    const folder = await getFolderById(project._id);
    if (!folder) continue;

    const sharing = await getProjectSharing(folder);
    const alreadyShared = new Set(sharing.map((e) => e.human));
    const missing = (folder.shared_with ?? []).filter(
      (humanId) => humanId !== folder.human_id && !alreadyShared.has(humanId),
    );
    if (missing.length === 0) continue;

    const humans = await getHumansById(missing);
    const nameFor = (id: string) =>
      humans.find((h) => h._id === id)?.name || humans.find((h) => h._id === id)?.email || id;

    log(`"${folder.name}" (${folder._id})`);
    for (const humanId of missing) {
      log(`  ${dryRun ? "would add" : "adding"}: ${nameFor(humanId)} (${humanId}) -> role "${defaultRole}" (had view access, no role)`);
    }

    if (!dryRun) {
      const newEntries: ProjectSharingEntry[] = [
        ...sharing,
        ...missing.map((human) => ({ human, role: defaultRole })),
      ];
      // Acting as the project's own creator — always an implicit Owner
      // (`getProjectRole`), so this always passes `setProjectSharing`'s own
      // permission check regardless of who runs this.
      const result = await setProjectSharing(folder.human_id, folder, newEntries);
      if (!result.ok) {
        log(`  ! failed: ${result.error}`);
        continue;
      }
    }
    touched++;
  }

  const summary = `${touched} project(s) ${dryRun ? "would be" : ""} touched.`;
  log(summary);
  return { summary };
}
