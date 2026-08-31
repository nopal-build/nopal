// =============================================================================
// Admin script: re-seed a project's GraphLog skill files after a defaults
// change.
//
// Context: `graphLogDefaults.server.ts`'s `DEFAULT_GRAPH_SKILL` /
// `DEFAULT_GRAPH_STRUCTURE_SKILL` / `DEFAULT_PROJECT_VIEW_SKILL` seed a
// BRAND NEW project's `skills/*.md` and are explicitly NOT retroactive
// (see that file's own module doc) -- updating them alone does nothing for
// a project that already has its own copies. This is the other half: for
// one named project, it overwrites `skills/GRAPH.md` / `GRAPH_STRUCTURE.md`
// / `PROJECT_VIEW.md` with the CURRENT hardcoded defaults, but ONLY when
// the project's existing file still looks like a KNOWN PREVIOUS version --
// matched by a distinctive substring, NOT byte-for-byte. A file that's
// been hand-edited (or admin-overridden) is left untouched and reported,
// never silently clobbered.
//
// Argument: project name (defaults to "Nopal O." if left blank).
//
// Idempotent — safe to re-run (a file already on the new text just
// no-ops on the next run, since it no longer matches the "previous
// default" snapshot below).
// =============================================================================

import { query, formatRecord } from "../generic.server";
import { getFileRefById, listFolderChildren, updateFileRef, type VaultFolder } from "../vault.server";
import {
  DEFAULT_GRAPH_SKILL,
  DEFAULT_GRAPH_STRUCTURE_SKILL,
  DEFAULT_PROJECT_VIEW_SKILL,
} from "../graphLogDefaults.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

/** Short, distinctive strings identifying a KNOWN PREVIOUS version of each
 * file. A file matching any one of them is treated as an unmodified copy
 * of a version we shipped, and is safe to overwrite.
 *
 * A LIST, not a single string, because a file can have more than one known
 * previous version in the wild at once: the repo's own last default, and a
 * draft hand-installed on a project ahead of the repo.
 *
 * A fingerprint drawn from a version that the CURRENT default still
 * contains is safe only because the equality check below runs FIRST and
 * no-ops. Keep that ordering. Without it, an already-updated file would
 * match its own fingerprint and be rewritten on every run. */
const PREVIOUS_DEFAULT_FINGERPRINTS: Record<string, string[]> = {
  "GRAPH.md": [
    "Be generous. The graph is allowed to be large. A missing node is invisible forever, and everything downstream is built from what you leave.\n\n## What does not earn a node",
    "with nothing worth capturing today.\n\n## What does not earn a node",
  ],
  "GRAPH_STRUCTURE.md": ["say so on the Weight line"],
  "PROJECT_VIEW.md": [
    "You never read graph-log files or daily logs directly, and you never count links or judge weight yourself",
    "Don't gloss a quote.",
  ],
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

async function reseedProject(
  projectFolder: VaultFolder,
  dryRun: boolean,
  log: (line: string) => void,
): Promise<number> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) {
    log(`   no skills/ folder — nothing to reseed.`);
    return 0;
  }
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);

  let reseeded = 0;
  for (const name of Object.keys(NEW_CONTENT)) {
    const listing = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!listing) {
      log(`   ${name}: not present — leaving alone (ensureProjectN02 seeds it on next run if missing).`);
      continue;
    }
    const file = await getFileRefById(listing._id);
    const current = file?.content ?? "";
    const fingerprints = PREVIOUS_DEFAULT_FINGERPRINTS[name] ?? [];
    const looksUnmodified = fingerprints.some((fp) => current.includes(fp));

    if (current === NEW_CONTENT[name]) {
      log(`   ${name}: already on the new default — no-op.`);
      continue;
    }
    if (!looksUnmodified) {
      log(`   ${name}: SKIPPED — doesn't match the expected previous default (looks hand-edited or already overridden). Review manually.`);
      continue;
    }
    log(`   ${name}: ${dryRun ? "would reseed" : "reseeding"} (${current.length} -> ${NEW_CONTENT[name].length} chars).`);
    if (!dryRun) await updateFileRef(listing._id, { content: NEW_CONTENT[name] });
    reseeded++;
  }
  return reseeded;
}

export async function run({ args, dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const projectName = args[0]?.trim() || "Nopal O.";

  const folder = await findProjectFolder(projectName);
  if (!folder) {
    const message = `No project-n02 folder named "${projectName}" found.`;
    log(message);
    return { summary: message };
  }

  log(`Reseeding GraphLog skill files for "${projectName}" (${folder._id})…${dryRun ? " (dry run)" : ""}`);
  const reseeded = await reseedProject(folder, dryRun, log);
  const summary = `${reseeded} skill file(s) ${dryRun ? "would be" : ""} reseeded for "${projectName}".`;
  log(summary);
  return { summary };
}
