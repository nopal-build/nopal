/**
 * `project-n02` — GraphLog's successor to `project-n01` (see the
 * `graphlog` skill for the full pipeline design, and `vaultFolderTypes.ts`'s
 * "Container types" doc). Mirrors `projectN01.server.ts`'s own shape
 * closely on purpose — same container/space-type architecture, same
 * seed-at-creation-and-lazily-backfill convention — just seeding GraphLog's
 * three skill files instead of PhyLog's, and a `Graph` space folder instead
 * of a `daily-logs` one.
 *
 * This file owns:
 *
 *   - The DEFAULT `skills/KNOWLEDGE.md` / `GRAPH.md` / `PROJECT_VIEW.md`
 *     content every `project-n02` gets seeded with (`graphLogDefaults.server.ts`),
 *     and the seeding logic itself (`ensureProjectN02`).
 *   - The `Graph` space's own find/ensure helpers (`ensureProjectGraphFolder`)
 *     — `sync-graph`'s output location, lazily created the first time
 *     there's an actual `graph-log-*.md` file to write, same convention
 *     `project-n01`'s own `daily-logs` folder uses.
 *
 * Deliberately NOT wired into `createVaultFolder`'s "every new project"
 * default yet, and deliberately does NOT retag an existing `project-n01`
 * folder — that's the explicit migration step (`nopal project
 * migrate-to-n02`, not yet built — see the `graphlog` skill's phased plan),
 * never an automatic side effect of calling anything in this file.
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
 * The actual retag+seed mechanics, with NO opinion on whether `folder` was
 * previously a `project-n01` anchor — split out from `ensureProjectN02` so
 * `migrateToN02.server.ts` can call this directly (explicitly bypassing
 * `ensureProjectN02`'s own n01-refusal guard, since performing exactly
 * that retag IS what migration means) without duplicating the seeding
 * logic a second time. Idempotent either way — safe to call on a folder
 * that's already fully project-n02-shaped.
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
  // Same deterministic-pick + deterministic-id fix as
  // `projectN01.server.ts`'s `ensureProjectN01` — see its own comment for
  // the real, confirmed duplicate-"Skills"-folder bug this closes. The id
  // formula is IDENTICAL to `ensureProjectN01`'s (same `humanId`/`"Skills"`/
  // folder id) on purpose: whichever of n01/n02 seeding ever runs against
  // this project, both converge on the exact same Skills folder row.
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
    // every project created from that point on, same as PhyLog's own
    // `ensureProjectN01` already does.
    const effective = await getAllEffectiveGraphLogDefaultSkills();
    await Promise.all([
      ensureSkillFile(current.human_id, skillsFolder._id, "KNOWLEDGE.md", effective.knowledge.content),
      ensureSkillFile(current.human_id, skillsFolder._id, "GRAPH.md", effective.graph.content),
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
 * tagged `project-n02` and has a `skills` folder seeded with the three
 * default GraphLog skill files — safe to call on every access (a no-op
 * once everything already exists). Refuses to touch a folder that's
 * already a `project-n01` anchor — retagging that is the explicit
 * migration step (see `migrateToN02.server.ts`), never an implicit side
 * effect of this function. Returns the up-to-date folder record.
 */
export async function ensureProjectN02(folder: VaultFolder): Promise<VaultFolder> {
  if (folder.folder_type === "project-n01" && folder.is_folder_type_root) {
    throw new Error(
      "This is a project-n01 space — migrate it to project-n02 explicitly before calling ensureProjectN02",
    );
  }
  return applyProjectN02Shape(folder);
}

/**
 * Resolves `folderId`, verifies it's actually a `project-n02` folder (a
 * project, or `personal`), and retrofits it (stamping the type + seeding
 * default skills) if it predates this type — but only ever for a folder
 * that ISN'T already a `project-n01` anchor (see `ensureProjectN02`'s own
 * doc). This is the chokepoint every GraphLog CLI/API entry point should
 * run a `--project` path through, mirroring `projectN01.server.ts`'s
 * `resolveProjectN01`.
 */
export async function resolveProjectN02(
  folderId: string,
): Promise<{ ok: true; folder: VaultFolder } | { ok: false; error: string }> {
  const folder = await getFolderById(folderId);
  if (!folder) return { ok: false, error: "Folder not found" };

  if (folder.folder_type === "project-n01" && folder.is_folder_type_root) {
    return {
      ok: false,
      error: "This is a project-n01 space — migrate it to project-n02 first",
    };
  }

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

  return { ok: true, folder: await ensureProjectN02(folder) };
}

// ─── Graph space (`sync-graph`'s output) ───────────────────────────────

/** Read-only lookup, no side effect — exported so `sync-graph` can check
 * whether ANY graph-log history already exists yet without forcing the
 * folder into existence just to look. */
export async function findProjectGraphFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  return folders.find((f) => f.is_folder_type_root && f.folder_type === "graph") ?? null;
}

/** Idempotently ensures the project's `Graph` space folder exists — unlike
 * `skills`, NOT auto-seeded at project creation; `sync-graph` calls this
 * lazily, the first time it actually has a `graph-log-*.md` file to write
 * (same convention `project-n01`'s own `ensureProjectDailyLogsFolder`
 * uses). */
export async function ensureProjectGraphFolder(projectFolder: VaultFolder): Promise<VaultFolder> {
  const existing = await findProjectGraphFolder(projectFolder);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: projectFolder.human_id,
    name: "Graph",
    parent_folder_id: projectFolder._id,
    folder_type: "graph",
  });
  if (!created) throw new Error("Failed to create the project's Graph folder");
  return created;
}

// ─── Skill files (read by every GraphLog stage) ─────────────────────
// Deliberately DUPLICATED from `projectN01.server.ts` (same names, same
// logic) rather than imported — kept fully independent so retiring PhyLog
// later (see the `graphlog` skill) never has to touch GraphLog code. Same
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
