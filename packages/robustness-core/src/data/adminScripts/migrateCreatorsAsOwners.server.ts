// =============================================================================
// Admin script: ADR-023's one-off, run once right after the deploy.
//
// 1. Adds any default Sharing Role missing from `sharing_roles` (Client:
//    the table is only seeded when empty, so production never got it).
// 2. Writes every project's creator into its README `sharing` list as
//    Owner. Until now the creator was an unwritten Owner; the code no
//    longer assumes that, so without this a creator can't reach their own
//    project.
// 3. Rewrites every project's `shared_with` from its list: everyone but a
//    Client, on the project folder and every folder under it.
//
// Nobody else's role changes: Austin re-marks the real clients as Client
// in the share modal afterwards. Idempotent; honors dry run.
// =============================================================================

import { query, formatRecord } from "../generic.server";
import { getProjectSharing, writeProjectSharing } from "../projectSharing.server";
import { GUIDING_ROLE, ensureDefaultSharingRoles, getSharingRoles } from "../sharingRoles.server";
import type { VaultFolder } from "../vault.types";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  if (dryRun) {
    const have = new Set((await getSharingRoles()).map((r) => r.name));
    if (!have.has("Client")) log("would add role Client");
  } else {
    for (const name of await ensureDefaultSharingRoles()) log(`added role ${name}`);
  }

  const roots = await query<[{ id: unknown }[]]>(
    `SELECT id FROM vault_folders WHERE vault_root_key = "projects" AND (parent_folder_id = NONE OR parent_folder_id = NULL)`,
  );
  const rootIds = (roots?.[0] ?? []).map((r) => {
    const id = r.id as { id?: unknown };
    return String(id?.id ?? r.id);
  });
  const projects = (
    (await query<[VaultFolder[]]>(`SELECT * FROM vault_folders WHERE parent_folder_id IN $rootIds`, { rootIds }))?.[0] ?? []
  ).map(formatRecord);

  let added = 0;
  for (const project of projects) {
    const sharing = await getProjectSharing(project);
    const hasCreator = sharing.some((e) => e.human === project.human_id);
    const next = hasCreator ? sharing : [{ human: project.human_id, role: GUIDING_ROLE }, ...sharing];
    if (!hasCreator) {
      added++;
      log(`${project.name}: creator written in as Owner`);
    }
    if (!dryRun) await writeProjectSharing(project, next);
  }

  const summary = `${added} of ${projects.length} project(s) got their creator as Owner; every project's shared_with ${dryRun ? "would be" : "was"} rebuilt.`;
  log(summary);
  return { summary };
}
