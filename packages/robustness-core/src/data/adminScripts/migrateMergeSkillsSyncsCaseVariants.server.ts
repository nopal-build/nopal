// =============================================================================
// Admin script: merge case-variant duplicate Skills/Syncs folders.
//
// `project-n02`'s `skills`/`syncs` space folders are supposed to be a
// singleton per parent (one per project, one for Personal), but at least
// three different "find (or create) the syncs folder" call sites used to
// disagree on both the selection rule AND the exact name/id to create with
// (`resolveDailyLogsFolder`/`ensureProjectSyncsFolder` picked the OLDEST
// `syncs`-typed child with a deterministic id; `ensureSyncApiAnalysis` did
// a plain, unsorted `.find()` and created a lowercase "syncs" with a
// random id if none matched) — now unified behind one shared
// `ensureSyncsFolder` (vault.server.ts). Confirmed, 2026-10-02: on a real
// account this produced two real "syncs"/"Syncs" folders under Personal
// that disagreed about which was canonical, silently splitting months of
// real Daily Log history across both (the Daily Log system kept finding
// the older, lowercase one; everything else drifted onto a newer,
// capitalized one created later by the divergent code path).
//
// For every project-n02 folder (every project, and every human's
// Personal), finds every `is_folder_type_root` child of each kind
// ("skills", "syncs") and, whenever there's more than one:
//   - the properly-capitalized name ("Skills"/"Syncs") becomes canonical
//     if one of the duplicates already has it; otherwise the OLDEST
//     becomes canonical (and is renamed to the proper capitalization);
//   - every other duplicate's content is merged into the canonical one
//     via `mergeFolderContentsInto` (recursive, same-named sub-folders
//     merge into each other, same-named FILES get an auto-dedupe suffix
//     rather than silently colliding — a day genuinely logged in both
//     places ends up with both copies, never one overwriting the other;
//     review `<name> (2).<ext>`-suffixed files afterward if any appear),
//     then deleted.
//
// `mergeFolderContentsInto` moves folders directly through the data layer
// (not the human-facing move route), so it is NOT blocked by a connector
// folder (e.g. a `sync-one-way` "photos"/"screenshots" folder) being
// "pinned" against an ordinary move — it moves with its ORIGINAL id
// intact, so a published folder's public URL survives the merge.
//
// Idempotent — safe to re-run (a container with at most one folder of
// each kind left is a no-op).
// =============================================================================

import { query, formatRecord } from "../generic.server";
import {
  deleteVaultFolderCascade,
  listFolderChildren,
  mergeFolderContentsInto,
  updateVaultFolder,
  type VaultFolder,
} from "../vault.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

const PREFERRED_NAME = { skills: "Skills", syncs: "Syncs" } as const;
type SpaceKind = keyof typeof PREFERRED_NAME;

async function findAllProjectN02Folders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = "project-n02" AND is_folder_type_root = true`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const containers = await findAllProjectN02Folders();
  log(
    `Scanning ${containers.length} project/Personal folder(s) for case-variant duplicate Skills/Syncs folders.${dryRun ? " (dry run)" : ""}`,
  );

  let merged = 0;
  let containersTouched = 0;

  for (const container of containers) {
    const { folders } = await listFolderChildren(container.human_id, container._id);
    let touchedThisContainer = false;

    for (const kind of Object.keys(PREFERRED_NAME) as SpaceKind[]) {
      const matches = folders.filter((f) => f.is_folder_type_root && f.folder_type === kind);
      if (matches.length <= 1) continue;

      const preferred = PREFERRED_NAME[kind];
      let canonical =
        matches.find((f) => f.name === preferred) ??
        [...matches].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      const dupes = matches.filter((f) => f._id !== canonical._id);

      log(
        `"${container.name}" (${container._id}): ${matches.length} "${kind}" folders — canonical ${
          dryRun ? "would be" : "is"
        } "${canonical.name}" (${canonical._id})${
          canonical.name !== preferred ? `, renaming to "${preferred}"` : ""
        }.`,
      );
      if (canonical.name !== preferred && !dryRun) {
        await updateVaultFolder(canonical._id, { name: preferred });
      }

      for (const dupe of dupes) {
        log(`   - ${dryRun ? "would merge and delete" : "merging and deleting"} "${dupe.name}" (${dupe._id})`);
        if (!dryRun) {
          await mergeFolderContentsInto(dupe, canonical);
          await deleteVaultFolderCascade(dupe._id);
        }
      }
      merged += dupes.length;
      touchedThisContainer = true;
    }
    if (touchedThisContainer) containersTouched++;
  }

  const summary = `${merged} duplicate Skills/Syncs folder(s) ${dryRun ? "would be" : ""} merged across ${containersTouched} container(s).`;
  log(summary);
  return { summary };
}
