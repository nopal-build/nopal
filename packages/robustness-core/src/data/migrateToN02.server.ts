/**
 * `nopal project migrate-to-n02` — converts one existing `project-n01`
 * space (a project, or `personal`) into `project-n02` (see the `graphlog`
 * skill's "Planned: migration" section). Destructive and explicit, same
 * philosophy as PhyLog's own `nopal phylog reset` — always applies for
 * real, no dry-run/preview mode, requires an explicit confirmation flag
 * at the CLI layer.
 *
 * What this does, in order:
 *
 *   1. Verifies `folder` is CURRENTLY a `project-n01` anchor — refuses
 *      otherwise (already migrated, or not a real project at all).
 *   2. Deletes every direct child EXCEPT the `skills`/`syncs` folders —
 *      including PhyLog's own `daily-logs` (project-scoped staging type)
 *      and `newspapers`, and any organized content PhyLog ever filed at
 *      the project root. `README.md` is a special case: the FILE
 *      survives, only its BODY is cleared (`withReadmeBody`, front matter
 *      preserved byte for byte) — same reasoning as PhyLog's own reset
 *      (`projectN01.server.ts`'s `resetProjectN01ContentInternal`): a
 *      project's Sharing Roles and lifecycle `status` live ONLY in that
 *      front matter, and deleting the whole file would silently revoke
 *      every collaborator's role.
 *   3. Retags the folder `project-n02` and seeds `skills/KNOWLEDGE.md`/
 *      `GRAPH.md`/`PROJECT_VIEW.md` (`applyProjectN02Shape`) — REPLACING
 *      PhyLog's own `PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md` (which
 *      have no meaning for GraphLog) but PRESERVING everything else
 *      already in `skills/` (a general `SKILL.md` project-identity file,
 *      or any other custom file a human dropped in — see
 *      `projectN01.server.ts`'s own `RESERVED_SKILL_FILE_NAMES` for the
 *      shared convention `SKILL.md` follows across both pipelines).
 *   4. Runs `daily-log-sync` once, unconditionally, across this project's
 *      ENTIRE history (no date filter) — backfills `syncs/Daily Logs`
 *      from every Card this project has ever had, so GraphLog's later
 *      agentic stages have real history to work from immediately.
 *
 * Deliberately does NOT run the agentic stages (`sync-knowledge`/
 * `sync-graph`/`graph-project-view`) itself — those cost real money and
 * are non-deterministic (same "never wired into anything automatic"
 * philosophy PhyLog holds), so migration only ever does the free,
 * deterministic structural conversion. Run `nopal graphlog run` (or the
 * individual stage commands) as an explicit, separate follow-up once
 * migration finishes — the CLI's own `nopal project migrate-to-n02`
 * prints this as a reminder.
 */

import {
  deleteFileRef,
  deleteVaultFolderCascade,
  getFolderById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
} from "./vault.server";
import { splitFrontmatter, withReadmeBody } from "./project.types";
import { applyProjectN02Shape } from "./projectN02.server";
import { runDailyLogSync, type DailyLogSyncResult } from "./dailyLogSync.server";

/** Same reserved PhyLog stage-skill names `projectN01.server.ts` already
 * defines — duplicated here (not imported) for the same "keep GraphLog
 * independent of PhyLog code" reason every other GraphLog file already
 * gives (see `graphLogDefaults.server.ts`). `skill.md` is deliberately
 * NOT in this list — it's a shared, pipeline-agnostic project-identity
 * file both systems already read generically, so migration preserves it
 * rather than deleting it. */
const PHYLOG_ONLY_SKILL_FILE_NAMES = new Set(["pre_capture.md", "capture.md", "post_capture.md"]);

export type MigrateToN02Result =
  | {
      ok: true;
      deletedFolders: string[];
      deletedFiles: string[];
      readmeCleared: boolean;
      dailyLogSync: DailyLogSyncResult;
    }
  | { ok: false; error: string };

/**
 * Migrates `folderId` (a project, or `personal`) from `project-n01` to
 * `project-n02` — see this file's own module doc for the exact steps.
 */
export async function migrateProjectToN02(folderId: string): Promise<MigrateToN02Result> {
  const folder = await getFolderById(folderId);
  if (!folder) return { ok: false, error: "Folder not found" };

  if (!(folder.folder_type === "project-n01" && folder.is_folder_type_root)) {
    return {
      ok: false,
      error: "This isn't a project-n01 space — nothing to migrate (already migrated, or not a real project).",
    };
  }

  const { folders, files } = await listFolderChildren(folder.human_id, folder._id);
  const deletedFolders: string[] = [];
  const deletedFiles: string[] = [];
  let readmeCleared = false;

  for (const child of folders) {
    const survives = child.is_folder_type_root && (child.folder_type === "skills" || child.folder_type === "syncs");
    if (survives) continue;
    await deleteVaultFolderCascade(child._id);
    deletedFolders.push(child.name);
  }

  for (const file of files) {
    if (file.name.toLowerCase() === "readme.md") continue; // handled below — body cleared, never deleted.
    await deleteFileRef(file._id);
    deletedFiles.push(file.name);
  }

  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  if (readme) {
    const { body } = splitFrontmatter(readme.content ?? "");
    if (body.trim().length > 0) {
      await updateFileRef(readme._id, { content: withReadmeBody(readme.content ?? "", "") });
      readmeCleared = true;
    }
  }

  const migrated = await applyProjectN02Shape(await getFolderById(folder._id) ?? folder);

  // Swap out PhyLog's own stage skills — everything else in `skills/`
  // (a general `SKILL.md`, or any other custom file) is left alone.
  const { folders: postFolders } = await listFolderChildren(migrated.human_id, migrated._id);
  const skillsFolder = postFolders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (skillsFolder) {
    const { files: skillFiles } = await listFolderChildren(migrated.human_id, skillsFolder._id);
    for (const file of skillFiles) {
      if (PHYLOG_ONLY_SKILL_FILE_NAMES.has(file.name.toLowerCase())) {
        await deleteFileRef(file._id);
        deletedFiles.push(`skills/${file.name}`);
      }
    }
  }

  const dailyLogSync = await runDailyLogSync(migrated._id, {});

  return { ok: true, deletedFolders, deletedFiles, readmeCleared, dailyLogSync };
}
