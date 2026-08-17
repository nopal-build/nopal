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
  getFolderById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { merge } from "./generic.server";
import {
  DEFAULT_KNOWLEDGE_SKILL,
  DEFAULT_GRAPH_SKILL,
  DEFAULT_PROJECT_VIEW_SKILL,
} from "./graphLogDefaults.server";

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
 * tagged `project-n02` and has a `skills` folder seeded with the three
 * default GraphLog skill files — safe to call on every access (a no-op
 * once everything already exists). Refuses to touch a folder that's
 * already a `project-n01` anchor — retagging that is the explicit
 * migration step, never an implicit side effect of this function. Returns
 * the up-to-date folder record.
 */
export async function ensureProjectN02(folder: VaultFolder): Promise<VaultFolder> {
  if (folder.folder_type === "project-n01" && folder.is_folder_type_root) {
    throw new Error(
      "This is a project-n01 space — migrate it to project-n02 explicitly before calling ensureProjectN02",
    );
  }

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
  let skillsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "skills");
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
      ensureSkillFile(current.human_id, skillsFolder._id, "KNOWLEDGE.md", DEFAULT_KNOWLEDGE_SKILL),
      ensureSkillFile(current.human_id, skillsFolder._id, "GRAPH.md", DEFAULT_GRAPH_SKILL),
      ensureSkillFile(
        current.human_id,
        skillsFolder._id,
        "PROJECT_VIEW.md",
        DEFAULT_PROJECT_VIEW_SKILL,
      ),
    ]);
  }

  return current;
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

async function findProjectGraphFolder(projectFolder: VaultFolder): Promise<VaultFolder | null> {
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
