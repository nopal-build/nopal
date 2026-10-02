// Reseed GraphLog skill files: every project's `skills/*.md` set to the
// CURRENT effective defaults (an admin's override on
// /maker/graphlog/defaults, else the built-in), with `reseedProjectN02Skills`
// (`projectN02.server.ts`), the same call as the Vault's per-project
// Reseed (2026-10-02).
//
// This used to carry its own copies of three defaults (GRAPH,
// GRAPH_STRUCTURE, PROJECT_VIEW) and fingerprints of their previous
// versions, ran on one named project, and never created a missing file.
// The copies went stale (no EFFORTS, VOICE, FILING or SOW; KNOWLEDGE
// still `skip` on projects seeded before 2026-09-09) and nothing else
// backfills a project that already exists, so projects ran nightly with
// stages off nobody chose.
//
// What it does, per project:
//   - creates a seeded file that is missing (and the Skills folder, if
//     there is none)
//   - overwrites one that differs from the current default, hand edits
//     included: "reset to current" is the point. The text it replaced is
//     written into this run's log in full, so an edit can be put back by
//     hand from the run's page.
//   - deletes a legacy name sitting beside its successor (PROJECT_VIEW.md)
//   - leaves a file already on the current default alone
//
// Which projects: every GraphLog project (`project-n02` root under a
// person's projects). Not a website (its own folder type), not a person's
// `personal` root. A project with a run in progress is skipped and named,
// so a stage never reads a file mid-rewrite.
//
// Argument: a project name to do just that one; blank for all.
// Dry run reports exactly what would change and writes nothing.

import { query, formatRecord } from "../generic.server";
import { listFolderChildren, type VaultFolder } from "../vault.server";
import { ensureProjectN02, reseedProjectN02Skills } from "../projectN02.server";
import { getGraphLogProjectStatus } from "../graphLogQueue.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

async function graphLogProjects(name?: string): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE folder_type = "project-n02" AND is_folder_type_root = true
       AND (vault_root_key = NONE OR vault_root_key != "personal")
       ${name ? "AND name = $name" : ""}
     ORDER BY name`,
    name ? { name } : {},
  );
  return (result?.[0] ?? []).map(formatRecord);
}

async function hasSkillsFolder(folder: VaultFolder): Promise<boolean> {
  const { folders } = await listFolderChildren(folder.human_id, folder._id);
  return folders.some((f) => f.is_folder_type_root && f.folder_type === "skills");
}

export async function run({ args, dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const only = args[0]?.trim() || undefined;
  const projects = await graphLogProjects(only);
  if (projects.length === 0) {
    const message = only ? `No GraphLog project named "${only}".` : "No GraphLog projects.";
    log(message);
    return { summary: message };
  }

  log(`Reseeding skills to the current defaults on ${projects.length} project(s)${dryRun ? " (dry run: nothing is written)" : ""}.`);
  const counts = { created: 0, reseeded: 0, removed: 0, unchanged: 0 };
  const busy: string[] = [];

  for (const project of projects) {
    log("");
    log(`## ${project.name} (${project._id})`);
    if ((await getGraphLogProjectStatus(project._id)).running) {
      log("   skipped: GraphLog is running on it. Run this again once it finishes.");
      busy.push(project.name);
      continue;
    }
    if (!(await hasSkillsFolder(project))) {
      if (dryRun) {
        log("   no Skills folder: would create it with every current skill.");
        continue;
      }
      // Creates the folder and every seeded file at the current default.
      await ensureProjectN02(project);
      log("   no Skills folder: created it with every current skill.");
    }
    const results = await reseedProjectN02Skills(project, { dryRun });
    for (const entry of results) {
      counts[entry.outcome]++;
      const verb = {
        created: dryRun ? "would create" : "created",
        reseeded: dryRun ? "would overwrite" : "overwrote",
        removed: dryRun ? "would delete (legacy)" : "deleted (legacy)",
        unchanged: "already current",
      }[entry.outcome];
      log(`   ${entry.file}: ${verb}`);
      // The replaced text, whole, so a person's edit is never lost to a
      // reset. Only on a real run; a dry run only says what would go.
      if (!dryRun && entry.previous !== undefined && entry.outcome !== "unchanged") {
        log(`   ----- ${entry.file} before this run -----`);
        for (const line of entry.previous.split("\n")) log(`   | ${line}`);
        log(`   ----- end of ${entry.file} -----`);
      }
    }
  }

  const summary =
    `${dryRun ? "Dry run: " : ""}${counts.created} created, ${counts.reseeded} overwritten, ${counts.removed} legacy deleted, ` +
    `${counts.unchanged} already current, across ${projects.length - busy.length} project(s)` +
    (busy.length ? `; skipped while running: ${busy.join(", ")}` : "") +
    ".";
  log("");
  log(summary);
  return { summary };
}
