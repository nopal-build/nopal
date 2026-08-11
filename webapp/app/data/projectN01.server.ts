/**
 * `project-n01` — the space type every `projects/<name>` folder AND the
 * `personal` root itself now carry (see the `vault` skill and
 * `vaultFolderTypes.ts`'s "Container types" doc). This file owns:
 *
 *   - The DEFAULT `skills/PRE_CAPTURE.md` / `CAPTURE.md` / `POST_CAPTURE.md`
 *     content every `project-n01` gets seeded with, and the seeding logic
 *     itself (`ensureProjectN01`) — called both at CREATION time (a brand
 *     new project, or the `personal` root the first time a vault is
 *     provisioned) and LAZILY, as a self-healing retrofit for any
 *     project/personal folder that predates this type (same "backfill on
 *     next touch" convention `ensureVaultRootFolders` already established
 *     for root folders).
 *   - `resetProjectN01Content` — the "delete everything PhyLog manages and
 *     start over" operation `nopal phylog reset` calls. Deletes every
 *     direct child of a `project-n01` folder EXCEPT its `skills`/`syncs`/
 *     `newspapers` anchors (the only human-writable parts), and clears out
 *     this project's own Release Log history (see its own doc below for
 *     why that's required, not optional).
 *
 * PhyLog's pre-capture/capture/post-capture stages (`preCapture.server.ts`,
 * `capture.server.ts`, `postCapture.server.ts`) read the three skill files
 * this module seeds — see the `phylog` skill for the full pipeline design.
 */

import {
  createFileRef,
  createVaultFolder,
  deleteFileRef,
  deleteVaultFolderCascade,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { merge } from "./generic.server";

// ─── Default skill file content ────────────────────────────────────────

/** The exact marker a skill file's body must START WITH (after any front
 * matter) to mean "do nothing" — checked case-insensitively against the
 * first non-blank line. Shared by all three stages. */
const SKIP_MARKER = "skip";

export const DEFAULT_PRE_CAPTURE_SKILL = `${SKIP_MARKER}

PhyLog's pre-capture stage does nothing until you replace this with real
instructions. When it runs, it looks at every file attached to this
project's daily-log Cards, and every file inside this project's own
\`syncs/\` folder, that doesn't already have a sibling \`*-summary.md\` next
to it — and asks an AI to decide (per the instructions you write here)
whether to write one, and what it should focus on.

For example, you might replace this with something like:

- Describe every photo attachment factually — what it shows, not what it
  means.
- Summarize any PDF or text file dropped into syncs/ in 2-3 sentences.
- Skip anything that's just a screenshot of a chat.

Leaving this file as "skip" means pre-capture is a complete no-op — capture
will still run, it just won't have any pre-written summaries to draw on.
`;

export const DEFAULT_CAPTURE_SKILL = `File every new attachment from this project's daily-log Cards into this
project, and keep README.md as a clear, organized index linking to
everything that's been filed. Reorganize into subfolders only when it
clearly helps keep things navigable — don't create structure for its own
sake. Never invent progress, dates, or facts that aren't grounded in the
Card content, any pre-capture summaries, or README.md's own existing
content.

Replace this file with your own instructions to change how this project
gets organized — e.g. "group photos by month" or "keep a running task
list at the top of the README."
`;

export const DEFAULT_POST_CAPTURE_SKILL = `${SKIP_MARKER}

Post-capture is reserved for processing that happens after this project's
structure and README have already been captured — for example, the
planned "newspapers" space (a generated daily/individual digest). Nothing
runs here yet; replace this file once there's something you want done
after every capture.
`;

/** True when `content`'s body (front matter already stripped by the
 * caller, if any) means "do nothing" for a given stage — the first
 * non-blank line is exactly "skip", case-insensitive. Missing/empty
 * content is ALSO treated as skip (no skill file = nothing to do), same
 * "absence means off" convention the rest of PhyLog uses. */
export function isSkipInstruction(content: string | null | undefined): boolean {
  if (!content) return true;
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return (firstLine?.trim().toLowerCase() ?? "") === SKIP_MARKER;
}

// ─── Seeding ────────────────────────────────────────────────────────────

async function ensureSkillFile(
  humanId: string,
  skillsFolderId: string,
  name: string,
  defaultContent: string,
): Promise<void> {
  const { files } = await listFolderChildren(humanId, skillsFolderId);
  if (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;
  await createFileRef({
    human_id: humanId,
    name,
    content: defaultContent,
    content_type: "text/markdown",
    folder_id: skillsFolderId,
  });
}

/**
 * Idempotently ensures `folder` (a project, or the `personal` root) is
 * tagged `project-n01` and has a `skills` folder seeded with the three
 * default stage skill files — safe to call on every access (a no-op once
 * everything already exists). Returns the up-to-date folder record.
 */
export async function ensureProjectN01(folder: VaultFolder): Promise<VaultFolder> {
  let current = folder;
  if (current.folder_type !== "project-n01" || !current.is_folder_type_root) {
    const updated = await merge("vault_folders", current._id, {
      folder_type: "project-n01",
      is_folder_type_root: true,
      updated_at: new Date().toISOString(),
    });
    if (updated) current = await getFolderById(current._id) ?? current;
  }

  const { folders } = await listFolderChildren(current.human_id, current._id);
  let skillsFolder = folders.find(
    (f) => f.is_folder_type_root && f.folder_type === "skills",
  );
  if (!skillsFolder) {
    skillsFolder = await createVaultFolder({
      human_id: current.human_id,
      name: "Skills",
      parent_folder_id: current._id,
      folder_type: "skills",
    });
  }
  if (skillsFolder) {
    await Promise.all([
      ensureSkillFile(current.human_id, skillsFolder._id, "PRE_CAPTURE.md", DEFAULT_PRE_CAPTURE_SKILL),
      ensureSkillFile(current.human_id, skillsFolder._id, "CAPTURE.md", DEFAULT_CAPTURE_SKILL),
      ensureSkillFile(current.human_id, skillsFolder._id, "POST_CAPTURE.md", DEFAULT_POST_CAPTURE_SKILL),
    ]);
  }

  return current;
}

/**
 * Resolves `folderId`, verifies it's actually a `project-n01` folder (a
 * project, or `personal`), and retrofits it (stamping the type + seeding
 * default skills) if it predates this type. This is the chokepoint every
 * PhyLog CLI/API entry point runs a `--project` path through before doing
 * any real work, so no caller needs to remember to backfill.
 */
export async function resolveProjectN01(
  folderId: string,
): Promise<{ ok: true; folder: VaultFolder } | { ok: false; error: string }> {
  const folder = await getFolderById(folderId);
  if (!folder) return { ok: false, error: "Folder not found" };

  const isPersonalRoot = !folder.parent_folder_id && folder.vault_root_key === "personal";
  let isProjectFolder = false;
  if (!isPersonalRoot && folder.parent_folder_id) {
    const parent = await getFolderById(folder.parent_folder_id);
    isProjectFolder = !!parent && !parent.parent_folder_id && parent.vault_root_key === "projects";
  }
  const alreadyTagged = folder.folder_type === "project-n01" && folder.is_folder_type_root;

  if (!isPersonalRoot && !isProjectFolder && !alreadyTagged) {
    return {
      ok: false,
      error: "This isn't a project — pass a path like 'projects/sunny' or 'personal'",
    };
  }

  return { ok: true, folder: await ensureProjectN01(folder) };
}

// ─── Reset ──────────────────────────────────────────────────────────────

/** Folder types that survive a reset — the only human-writable parts of a
 * `project-n01` folder, per the `vault` skill. */
const SURVIVES_RESET = new Set(["skills", "syncs", "newspapers"]);

export type ResetSummary = {
  deletedFolders: string[];
  deletedFiles: string[];
};

/**
 * Deletes every direct child of a `project-n01` folder EXCEPT its
 * `skills`/`syncs`/`newspapers` anchors (and everything nested under
 * them) — the "everything else is disposable, PhyLog-managed" rule the
 * `vault` skill defines. Also clears this project's own Release Log
 * history (`release_log_entries`/`release_log_changesets`): those rows
 * describe state (which files got filed, what the README used to say)
 * that this reset just deleted, so leaving them behind would make a
 * subsequent `capture --full` think everything was already applied and
 * silently skip re-processing it. Regenerates both release-log.md
 * reflections (now empty) afterward.
 *
 * Deliberately NOT run automatically by `capture --full` on its own
 * schedule — always an explicit, separate call (`nopal phylog reset`), so
 * a human can inspect the emptied-out state before re-running capture.
 */
export async function resetProjectN01Content(
  folder: VaultFolder,
): Promise<ResetSummary> {
  const { folders, files } = await listFolderChildren(folder.human_id, folder._id);
  const summary: ResetSummary = { deletedFolders: [], deletedFiles: [] };

  for (const child of folders) {
    if (child.is_folder_type_root && SURVIVES_RESET.has(child.folder_type ?? "")) continue;
    await deleteVaultFolderCascade(child._id);
    summary.deletedFolders.push(child.name);
  }
  for (const file of files) {
    await deleteFileRef(file._id);
    summary.deletedFiles.push(file.name);
  }

  const { clearReleaseLogForProject } = await import("./releaseLog.server");
  await clearReleaseLogForProject(folder._id);

  return summary;
}

/** Reads a project-n01's `skills/<name>` file content, or null if it (or
 * the skills folder itself) doesn't exist — malformed/missing is always
 * treated as "no instructions", never a hard failure. Shared by all three
 * pipeline stages. */
export async function getProjectStageSkill(
  projectFolder: { human_id: string; _id: string },
  name: string,
): Promise<string | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) return null;
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);
  const listing = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (!listing) return null;
  const file = await getFileRefById(listing._id);
  return file?.content ?? null;
}
