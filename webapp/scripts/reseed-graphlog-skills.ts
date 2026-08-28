// =============================================================================
// One-off: re-seed a project's GraphLog skill files after a defaults change.
//
// Run via: npx vite-node scripts/reseed-graphlog-skills.ts ["Project Name"]
// (DB connection comes from the same env/defaults as `npm run seed:data`.)
//
// Context: `graphLogDefaults.server.ts`'s `DEFAULT_GRAPH_SKILL` /
// `DEFAULT_GRAPH_STRUCTURE_SKILL` / `DEFAULT_PROJECT_VIEW_SKILL` seed a
// BRAND NEW project's `skills/*.md` and are explicitly NOT retroactive
// (see that file's own module doc) -- updating them alone does nothing for
// a project that already has its own copies. This script is the other
// half: for one named project (default "Nopal O."), it overwrites
// `skills/GRAPH.md` / `GRAPH_STRUCTURE.md` / `PROJECT_VIEW.md` with the
// CURRENT hardcoded defaults, but ONLY when the project's existing file
// still matches the PREVIOUS hardcoded default byte-for-byte -- a file
// that's been hand-edited (or admin-overridden) is left untouched and
// reported, never silently clobbered.
//
// Idempotent — safe to re-run (a file already on the new text just
// no-ops on the next run, since it no longer matches the "previous
// default" snapshot below).
// =============================================================================

import { getDb } from "robustness-core/data/db.server";
import { query, formatRecord } from "robustness-core/data/generic.server";
import { getFileRefById, listFolderChildren, updateFileRef, type VaultFolder } from "robustness-core/data/vault.server";
import {
  DEFAULT_GRAPH_SKILL,
  DEFAULT_GRAPH_STRUCTURE_SKILL,
  DEFAULT_PROJECT_VIEW_SKILL,
} from "robustness-core/data/graphLogDefaults.server";

/** A short, distinctive prefix unique to the PREVIOUS default text for
 * each file -- present only in an unmodified copy of the old default,
 * gone from both the new default and any real hand edit. */
const PREVIOUS_DEFAULT_FINGERPRINT: Record<string, string> = {
  "GRAPH.md": "Be generous. The graph is allowed to be large. A missing node is invisible forever, and everything downstream is built from what you leave.\n\n## What does not earn a node",
  "GRAPH_STRUCTURE.md": "# Weight and status\n\nStill write a `Weight: ...` line in the shape shown below",
  "PROJECT_VIEW.md": "You never read graph-log files or daily logs directly, and you never count links or judge weight yourself",
};

const NEW_CONTENT: Record<string, string> = {
  "GRAPH.md": DEFAULT_GRAPH_SKILL,
  "GRAPH_STRUCTURE.md": DEFAULT_GRAPH_STRUCTURE_SKILL,
  "PROJECT_VIEW.md": DEFAULT_PROJECT_VIEW_SKILL,
};

async function findProjectFolder(name: string): Promise<VaultFolder | null> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true AND name = $name`,
    { name },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);
  return rows[0] ?? null;
}

async function reseedProject(projectFolder: VaultFolder): Promise<void> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) {
    console.log(`   no skills/ folder — nothing to reseed.`);
    return;
  }
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);

  for (const name of Object.keys(NEW_CONTENT)) {
    const listing = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!listing) {
      console.log(`   ${name}: not present — leaving alone (ensureProjectN02 seeds it on next run if missing).`);
      continue;
    }
    const file = await getFileRefById(listing._id);
    const current = file?.content ?? "";
    const fingerprint = PREVIOUS_DEFAULT_FINGERPRINT[name];
    const looksUnmodified = fingerprint ? current.includes(fingerprint) : false;

    if (current === NEW_CONTENT[name]) {
      console.log(`   ${name}: already on the new default — no-op.`);
      continue;
    }
    if (!looksUnmodified) {
      console.log(`   ${name}: SKIPPED — doesn't match the expected previous default (looks hand-edited or already overridden). Review manually.`);
      continue;
    }
    await updateFileRef(listing._id, { content: NEW_CONTENT[name] });
    console.log(`   ${name}: reseeded (${current.length} → ${NEW_CONTENT[name].length} chars).`);
  }
}

async function main() {
  const projectName = process.argv[2] ?? "Nopal O.";

  const db = await getDb();
  if (!db) {
    console.error("Could not connect to SurrealDB — aborting.");
    process.exit(1);
  }

  const folder = await findProjectFolder(projectName);
  if (!folder) {
    console.error(`No project-n02 folder named "${projectName}" found.`);
    await db.close();
    process.exit(1);
  }

  console.log(`Reseeding GraphLog skill files for "${projectName}" (${folder._id})…`);
  await reseedProject(folder);
  console.log("\n✓ Done.");
  await db.close();
}

main().catch((err) => {
  console.error("Reseed failed:", err);
  process.exit(1);
});
