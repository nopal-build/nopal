/**
 * `project-n02` — GraphLog's own container type (see the `graphlog` skill
 * for the full pipeline design, and `vaultFolderTypes.ts`'s "Container
 * types" doc). PhyLog/`project-n01` (this type's predecessor) has been
 * fully retired — `createVaultFolder` now tags every brand new project
 * (and `personal`) `project-n02` directly, and every retrofit path
 * (`ensureVaultRootFolders`/`getProjectFolders` in `vault.server.ts`)
 * converges on it too.
 *
 * This file owns:
 *
 *   - The DEFAULT `skills/KNOWLEDGE.md` / `GRAPH.md` / `GRAPH_STRUCTURE.md` /
 *     `PROJECT_VIEW.md` content every `project-n02` gets seeded with
 *     (`graphLogDefaults.server.ts`),
 *     and the seeding logic itself (`ensureProjectN02`).
 *   - The `Graph` space's own find/ensure helpers (`ensureProjectGraphFolder`)
 *     — `sync-graph`'s output location, lazily created the first time
 *     there's an actual `graph-log-*.md` file to write (same "create on
 *     first real write" convention `skills` doesn't need, since that one's
 *     seeded up front instead).
 */

import {
  createFileRef,
  createVaultFolder,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { merge } from "./generic.server";
import { getAllEffectiveGraphLogDefaultSkills } from "./graphLogDefaults.server";
import { systemVaultFolderKey } from "./vault.server";
import { CONTAINER_FOLDER_TYPES, isContainerFolderTypeKey } from "./vaultFolderTypes";

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
 * The actual retag+seed mechanics, split out from `ensureProjectN02` as
 * its own function for callers that want the mechanics directly.
 * Idempotent — safe to call on a folder that's already fully
 * project-n02-shaped.
 */
export async function applyProjectN02Shape(folder: VaultFolder): Promise<VaultFolder> {
  let current = folder;
  if (current.folder_type !== "project-n02" || !current.is_folder_type_root) {
    const updated = await merge("vault_folders", current._id, {
      folder_type: "project-n02",
      is_folder_type_root: true,
      updated_at: new Date().toISOString(),
    });
    if (updated) current = (await getFolderById(current._id)) ?? current;
  }

  const { folders } = await listFolderChildren(current.human_id, current._id);
  // Deterministic-pick + deterministic-id, to close a real, confirmed
  // check-then-create race that once produced duplicate "Skills" folders
  // on several real projects (see the `graphlog` skill's own writeup).
  let skillsFolder: VaultFolder | undefined = folders
    .filter((f) => f.is_folder_type_root && f.folder_type === "skills")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!skillsFolder) {
    skillsFolder = await createVaultFolder({
      human_id: current.human_id,
      name: "Skills",
      parent_folder_id: current._id,
      folder_type: "skills",
      id: systemVaultFolderKey(current.human_id, "Skills", current._id),
    });
  }
  if (skillsFolder) {
    // Seeds with the CURRENT effective defaults (an admin's override, if
    // set, else the hardcoded built-in) -- not a stale hardcoded string,
    // so a change made on /fruits/maker/graphlog/defaults applies to
    // every project created from that point on.
    const effective = await getAllEffectiveGraphLogDefaultSkills();
    await Promise.all([
      ensureSkillFile(current.human_id, skillsFolder._id, "KNOWLEDGE.md", effective.knowledge.content),
      ensureSkillFile(current.human_id, skillsFolder._id, "GRAPH.md", effective.graph.content),
      ensureSkillFile(
        current.human_id,
        skillsFolder._id,
        "GRAPH_STRUCTURE.md",
        effective.graphStructure.content,
      ),
      ensureSkillFile(
        current.human_id,
        skillsFolder._id,
        "PROJECT_VIEW.md",
        effective.projectView.content,
      ),
    ]);
  }

  return current;
}

/**
 * Idempotently ensures `folder` (a project, or the `personal` root) is
 * tagged `project-n02` and has a `skills` folder seeded with the four
 * default GraphLog skill files — safe to call on every access (a no-op
 * once everything already exists). Returns the up-to-date folder record.
 */
export async function ensureProjectN02(folder: VaultFolder): Promise<VaultFolder> {
  return applyProjectN02Shape(folder);
}

/**
 * Resolves `folderId`, verifies it's actually a `project-n02` folder (a
 * project, or `personal`), and retrofits it (stamping the type + seeding
 * default skills) if it predates this type. This is the chokepoint every
 * GraphLog CLI/API entry point should run a `--project` path through.
 */
export async function resolveProjectN02(
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
  const alreadyTagged = folder.folder_type === "project-n02" && folder.is_folder_type_root;

  if (!isPersonalRoot && !isProjectFolder && !alreadyTagged) {
    return {
      ok: false,
      error: "This isn't a project — pass a path like 'projects/sunny' or 'personal'",
    };
  }

  // A folder can carry a DIFFERENT recognized container type (today, only
  // `website` — see `vaultFolderTypes.ts`) — fail closed rather than
  // silently retagging it into a GraphLog-managed project-n02 shape, which
  // would clobber it (no Skills folder needed/wanted there, and GraphLog
  // has no business writing into a website project's content).
  if (
    isContainerFolderTypeKey(folder.folder_type) &&
    folder.is_folder_type_root &&
    folder.folder_type !== "project-n02"
  ) {
    return {
      ok: false,
      error: `This is a ${CONTAINER_FOLDER_TYPES[folder.folder_type].label} project, not a GraphLog project`,
    };
  }

  return { ok: true, folder: await ensureProjectN02(folder) };
}

// ─── Graph space (`sync-graph`'s output) ───────────────────────────────

/** Read-only lookup, no side effect — exported so `sync-graph` can check
 * whether ANY graph-log history already exists yet without forcing the
 * folder into existence just to look. */
export async function findProjectGraphFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  // Oldest-first, same defensive convention as `applyProjectN02Shape`'s own
  // Skills-folder pick — belt-and-suspenders against any duplicate a past
  // race already left behind (see `ensureProjectGraphFolder`'s own comment
  // for the actual fix).
  return (
    folders
      .filter((f) => f.is_folder_type_root && f.folder_type === "graph")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null
  );
}

/** Idempotently ensures the project's `Graph` space folder exists — unlike
 * `skills`, NOT auto-seeded at project creation; `sync-graph` calls this
 * lazily, the first time it actually has a `graph-log-*.md` file to
 * write. */
export async function ensureProjectGraphFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const existing = await findProjectGraphFolder(projectFolder);
  if (existing) return existing;
  // Same deterministic-id fix as `applyProjectN02Shape`'s own Skills-folder
  // bug and `dailyLogSync.server.ts`'s syncs/Daily-Logs folders — this
  // check-then-create had the exact same unprotected race (see the
  // `graphlog` skill's "Known, NOT yet checked" note, now confirmed and
  // closed here too).
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: "Graph",
    parent_folder_id: projectFolder._id,
    folder_type: "graph",
    id: systemVaultFolderKey(projectFolder.human_id, "Graph", projectFolder._id),
  });
  if (!created) throw new Error("Failed to create the project's Graph folder");
  return created;
}

// ─── Skill files (read by every GraphLog stage) ───────────────────────
// Kept independent (not shared with any other pipeline) — small, self-
// contained duplication over a cross-module dependency. Same
// reasoning `graphLogDefaults.server.ts` already gives for duplicating
// `SKIP_MARKER`.

const SKIP_MARKER = "skip";

/** True when `content` means "do nothing" for a given GraphLog stage — the
 * first non-blank line is exactly "skip", case-insensitive. Missing/empty
 * content is ALSO treated as skip. */
export function isSkipInstruction(content: string | null | undefined): boolean {
  if (!content) return true;
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return (firstLine?.trim().toLowerCase() ?? "") === SKIP_MARKER;
}

/** Reads a project-n02's `skills/<name>` file content, or null if it (or
 * the skills folder itself) doesn't exist — malformed/missing is always
 * treated as "no instructions", never a hard failure. Shared by every
 * GraphLog stage. */
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

/** The GraphLog skill file names every stage already fetches by name —
 * excluded from `listExtraSkillFiles` below so a reference file never gets
 * folded into a prompt twice. */
const RESERVED_SKILL_FILE_NAMES = new Set([
  "knowledge.md",
  "graph.md",
  "graph_structure.md",
  "project_view.md",
  "skill.md",
]);

/** Any OTHER file a project owner drops into `skills/` — auto-folded into
 * every GraphLog stage's prompt, never gated behind a tool call a model
 * might skip. Sorted by name for stable prompts across runs. */
export async function listExtraSkillFiles(
  projectFolder: { human_id: string; _id: string },
): Promise<{ name: string; content: string }[]> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
  if (!skillsFolder) return [];
  const { files } = await listFolderChildren(projectFolder.human_id, skillsFolder._id);
  const extras = files.filter((f) => !RESERVED_SKILL_FILE_NAMES.has(f.name.toLowerCase()));
  const withContent = await Promise.all(
    extras.map(async (f) => {
      const file = await getFileRefById(f._id);
      return { name: f.name, content: (file?.content ?? "").trim() };
    }),
  );
  return withContent.filter((f) => f.content.length > 0).sort((a, b) => a.name.localeCompare(b.name));
}
