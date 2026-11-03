// =============================================================================
// Admin script: repair duplicate FILES (KNOWLEDGE.md, GRAPH.md, ...) inside
// a "Skills" folder — a different bug from "Repair duplicate Skills
// folders" (which dedupes the FOLDER itself).
//
// Root cause: `ensureSkillFile` (`projectN02.server.ts`) is a plain
// "list, then create if missing" check with no atomicity, unlike the
// Skills FOLDER it lives inside (which already gets a deterministic id —
// see `applyProjectN02Shape`'s own fix). `ensureProjectN02` runs on every
// human's `personal/` root from `ensureVaultRootFolders` (page loads, the
// Vault's root-children fetcher, starting a new project, ...) — the first
// time in each server process. Two of those landing close together for
// the SAME human (e.g. two server replicas, or two requests racing right
// after a deploy) can each see "no KNOWLEDGE.md yet" before either write
// commits, and both create one with a fresh random id — real, genuine
// duplicate files, not just a cosmetic listing glitch. Same code path
// seeds every PROJECT's own Skills folder too, so this isn't
// `personal/skills`-only.
//
// This script is the cleanup; `ensureSkillFile` itself now also takes a
// deterministic id (same fix pattern as the folder) so this should stop
// recurring going forward.
//
// For every "skills" folder (any project's, or a human's `personal/`),
// groups its files by case-insensitive name and, for any name with more
// than one file:
//   - all copies byte-identical → keep the OLDEST, delete the rest
//     (the common case: the race above always fires with the exact same
//     seed content).
//   - some copies match the CURRENT effective default for that stage
//     (`getAllEffectiveGraphLogDefaultSkills`) and at least one does not
//     → the non-default (real edit) survives, every default-matching copy
//     is deleted.
//   - otherwise (two or more copies that disagree AND neither is the
//     plain default) → genuinely ambiguous, reported and skipped rather
//     than guessed at, same convention as
//     `repairDuplicateSkillsFolders.server.ts`.
//
// Idempotent — safe to re-run (a folder with no duplicately-named files
// left is a no-op).
// =============================================================================

import { query, formatRecord } from "../generic.server";
import { listFolderChildren, deleteFileRef, getFileRefById, type VaultFolder, type FileRefListing } from "../vault.server";
import { getAllEffectiveGraphLogDefaultSkills, type GraphLogDefaultStage } from "../graphLogDefaults.server";
import { SKILL_FILE_NAMES } from "../projectN02.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

async function findAllSkillsFolders(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE folder_type = "skills" AND is_folder_type_root = true`,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** `"knowledge.md"` → `"knowledge"`, etc — the reverse of `SKILL_FILE_NAMES`. */
const STAGE_BY_LOWER_NAME = new Map<string, GraphLogDefaultStage>(
  (Object.keys(SKILL_FILE_NAMES) as GraphLogDefaultStage[]).map((stage) => [
    SKILL_FILE_NAMES[stage].toLowerCase(),
    stage,
  ]),
);

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const folders = await findAllSkillsFolders();
  log(`Scanning ${folders.length} Skills folder(s) for duplicately-named files.${dryRun ? " (dry run)" : ""}`);

  const effective = await getAllEffectiveGraphLogDefaultSkills();

  let deleted = 0;
  let touched = 0;
  let skipped = 0;

  for (const folder of folders) {
    const { files } = await listFolderChildren(folder.human_id, folder._id);
    const byName = new Map<string, FileRefListing[]>();
    for (const f of files) {
      const key = f.name.toLowerCase();
      const list = byName.get(key) ?? [];
      list.push(f);
      byName.set(key, list);
    }

    let touchedThisFolder = false;

    for (const [lowerName, group] of byName) {
      if (group.length <= 1) continue;

      const listingsSorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const sorted = await Promise.all(
        listingsSorted.map(async (listing) => {
          const full = await getFileRefById(listing._id);
          return { ...listing, content: full?.content ?? null };
        }),
      );
      const stage = STAGE_BY_LOWER_NAME.get(lowerName);
      const defaultContent = stage ? effective[stage].content : undefined;

      // Distinct contents among this group (trimmed, so trailing-whitespace
      // noise doesn't manufacture a false "they disagree").
      const distinct = new Map<string, (typeof sorted)[number][]>();
      for (const f of sorted) {
        const key = (f.content ?? "").trim();
        const list = distinct.get(key) ?? [];
        list.push(f);
        distinct.set(key, list);
      }

      let survivor: (typeof sorted)[number];
      let dupes: (typeof sorted)[number][];

      if (distinct.size === 1) {
        // Byte-identical across the board — keep the oldest.
        survivor = sorted[0];
        dupes = sorted.slice(1);
      } else if (defaultContent !== undefined) {
        // Distinct NON-default groups — excludes the default-content group
        // (if present), so two IDENTICAL hand-edits aren't mistaken for a
        // disagreement just because both differ from the default.
        const defaultKey = defaultContent.trim();
        const nonDefaultGroups = [...distinct.entries()].filter(([key]) => key !== defaultKey);

        if (nonDefaultGroups.length === 1) {
          const [, winners] = nonDefaultGroups[0];
          survivor = winners.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
          dupes = sorted.filter((f) => f._id !== survivor._id);
        } else if (nonDefaultGroups.length === 0) {
          // Shouldn't happen (distinct.size > 1 but every group's key
          // equals the default would mean the default itself has >1
          // distinct forms) — fall back to oldest.
          survivor = sorted[0];
          dupes = sorted.slice(1);
        } else {
          log(
            `! "${folder.name}" (${folder._id}): ${group.length} "${sorted[0].name}" files, ` +
              `${nonDefaultGroups.length} disagree with each other AND with the current default — skipping, review manually.`,
          );
          skipped++;
          continue;
        }
      } else {
        log(
          `! "${folder.name}" (${folder._id}): ${group.length} "${sorted[0].name}" files with ${distinct.size} different contents (not a known default-seeded name) — skipping, review manually.`,
        );
        skipped++;
        continue;
      }

      log(
        `"${folder.name}" (${folder._id}): ${dryRun ? "would delete" : "deleting"} ${dupes.length} duplicate "${survivor.name}" (keeping ${survivor._id}).`,
      );
      for (const dupe of dupes) {
        if (!dryRun) await deleteFileRef(dupe._id);
        log(`   - ${dryRun ? "would delete" : "deleted"} ${dupe._id}`);
      }
      deleted += dupes.length;
      touchedThisFolder = true;
    }

    if (touchedThisFolder) touched++;
  }

  const summary = `${deleted} duplicate file(s) ${dryRun ? "would be" : ""} deleted across ${touched} Skills folder(s), ${skipped} ambiguous name(s) skipped.`;
  log(summary);
  return { summary };
}
