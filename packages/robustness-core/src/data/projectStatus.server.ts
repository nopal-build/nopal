/**
 * Project Status — Active / Completed / Trashed (see the `vault` skill's
 * Projects section). Mirrors `projectSharing.server.ts`'s architecture: a
 * project's own README.md front matter (`status`) is the source of truth
 * (see `project.types.ts`), and `vault_folders.project_status` /
 * `project_status_at` are a DENORMALIZED CACHE kept in sync here — reads
 * that only need "what status is this project" (the dashboard's project
 * list, the trash-cleanup cron) go straight to the cache instead of
 * fetching and parsing a README on every read.
 *
 * Unlike Sharing Roles, status is NOT cascaded to descendant folders — it's
 * a single flag on the project folder itself, not a view-access grant that
 * needs to propagate.
 */

import { formatRecord, query } from "./generic.server";
import {
  createFileRef,
  getReadmeFileForFolder,
  updateFileRef,
  updateVaultFolder,
  type VaultFolder,
} from "./vault.server";
import type { FileRef } from "./vault.types";
import {
  DEFAULT_PROJECT_STATUS,
  PROJECT_STATUSES,
  withProjectStatus,
  type ProjectStatus,
} from "./project.types";
import { isProjectFolder } from "./projectSharing.server";

export type { ProjectStatus };

async function getOrCreateReadme(ownerId: string, folderId: string): Promise<FileRef> {
  const existing = await getReadmeFileForFolder(ownerId, folderId);
  if (existing) return existing;
  const created = await createFileRef({
    human_id: ownerId,
    name: "README.md",
    content: "",
    content_type: "text/markdown",
    folder_id: folderId,
  });
  if (!created) throw new Error("Failed to create README.md");
  return created;
}

/** A project folder's current status — reads the denormalized cache
 * directly (see module doc); defaults to "active" for a project folder
 * that predates this field. */
export function getProjectStatus(projectFolder: VaultFolder): ProjectStatus {
  return (projectFolder.project_status as ProjectStatus | null | undefined) ?? DEFAULT_PROJECT_STATUS;
}

export type SetProjectStatusResult =
  | { ok: true; status: ProjectStatus }
  | { ok: false; error: string };

/**
 * Sets a project's status — the only intended writer of both the README's
 * `status` front matter AND the `vault_folders.project_status`/
 * `project_status_at` cache. Only the project's own creator may change it
 * (status is a personal organizational tool, unlike the collaborator-facing
 * Sharing Roles which any owner-tier role can change).
 */
export async function setProjectStatus(
  actingHumanId: string,
  projectFolder: VaultFolder,
  status: ProjectStatus,
): Promise<SetProjectStatusResult> {
  if (!(await isProjectFolder(projectFolder))) {
    return { ok: false, error: "Status only applies to project folders" };
  }
  if (!PROJECT_STATUSES.includes(status)) {
    return { ok: false, error: `Unknown status "${status}"` };
  }
  if (projectFolder.human_id !== actingHumanId) {
    return {
      ok: false,
      error: "You don't have permission to change this project's status",
    };
  }

  const readme = await getOrCreateReadme(projectFolder.human_id, projectFolder._id);
  const updatedContent = withProjectStatus(readme.content ?? "", status);
  await updateFileRef(readme._id, { content: updatedContent });

  await updateVaultFolder(projectFolder._id, {
    project_status: status,
    project_status_at: new Date().toISOString(),
  });

  return { ok: true, status };
}

/**
 * Every project folder currently marked "trashed" whose status was set at
 * least `olderThanDays` ago — what the trash-cleanup cron
 * (`api.vault.trash-cleanup.tsx`) permanently deletes. A direct query
 * against the denormalized cache (same trick `getArchivedFilesForCleanup`
 * uses for `file_refs.archived_at`) rather than a per-human README scan
 * across every human's vault.
 */
export async function getTrashedProjectFoldersForCleanup(
  olderThanDays = 30,
): Promise<VaultFolder[]> {
  const cutoff = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE project_status = 'trashed'
       AND project_status_at != NONE
       AND project_status_at != null
       AND project_status_at <= $cutoff`,
    { cutoff },
  );
  return (result?.[0] ?? []).map(formatRecord);
}
