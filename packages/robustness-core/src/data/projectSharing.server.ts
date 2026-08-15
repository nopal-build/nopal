/**
 * Project Sharing — PhyLog's Sharing Roles. Supersedes the old plain
 * `shared_with: string[] | "everyone"` model entirely (see the `vault`
 * skill's Sharing section): sharing a project now means giving a specific
 * human a named Role (see `sharingRoles.server.ts` for role DEFINITIONS —
 * `name` + `is_owner`), and "everyone" is gone as a concept altogether.
 *
 * The role ASSIGNMENTS themselves (who has which role on THIS project) are
 * stored directly in the project's own README.md front matter — a
 * `sharing` list, `[{ human: humanId, role: roleName }]` — never in a
 * separate database table. That's deliberate: a project's collaborator
 * list should travel with the project's own file, the same way its
 * `title`/`type`/`layout` already do (see `project.types.ts`), so it's
 * visible/portable/diffable just by reading the file, not hidden in a row
 * only the app can see.
 *
 * `vault_folders.shared_with` (still a plain array of human ids — see
 * `vault.types.ts`) is kept as a DERIVED, DENORMALIZED CACHE of this list,
 * recomputed and cascaded to every descendant folder on every change via
 * the existing `cascadeShareVaultFolder` — purely so the pre-existing
 * O(1) view-access plumbing (`canViewFileRef`, `getSharedFoldersForHuman`,
 * the Vault sidebar's "Shared with me") keeps working unchanged. Never
 * write `shared_with` directly for a project folder — always go through
 * `setProjectSharing` here, or the two will drift apart.
 */

import {
  cascadeShareVaultFolder,
  ensureVaultRootFolders,
  createFileRef,
  getFolderAncestry,
  getFolderById,
  getReadmeFileForFolder,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import type { FileRef } from "./vault.types";
import {
  parseProjectSharing,
  withProjectSharing,
  type ProjectSharingEntry,
} from "./project.types";
import { getSharingRoleByName, isOwnerTierRole } from "./sharingRoles.server";

export type { ProjectSharingEntry };

async function getOrCreateReadme(
  ownerId: string,
  folderId: string,
): Promise<FileRef> {
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

/** Whether `folder` is itself a project — a direct child of its OWNER's
 * `projects` vault root. Sharing Roles only ever apply at this level (a
 * role is a project-wide grant); a plain subfolder deep inside a project
 * is never independently shareable/role-bearing. */
export async function isProjectFolder(folder: VaultFolder): Promise<boolean> {
  if (folder.vault_root_key !== "projects") return false;
  const roots = await ensureVaultRootFolders(folder.human_id);
  const projectsRoot = roots.find((r) => r.vault_root_key === "projects");
  return !!projectsRoot && folder.parent_folder_id === projectsRoot._id;
}

/** Walks up from any folder to the top-level PROJECT folder that owns it
 * (e.g. resolves a project's `skills` subfolder, or a file's containing
 * folder, back to the project itself) — `null` when `folder` isn't under
 * `projects` at all (e.g. `personal`). */
export async function findOwningProjectFolder(
  folder: VaultFolder,
): Promise<VaultFolder | null> {
  if (folder.vault_root_key !== "projects") return null;
  if (await isProjectFolder(folder)) return folder;
  const ancestry = await getFolderAncestry(folder._id);
  // `ancestry` runs root container → … → `folder` itself; the project is
  // whichever ancestor is a direct child of the root container (index 1),
  // since a folder that isn't itself the project (checked above) is
  // necessarily nested one level deeper than that.
  return ancestry.length > 1 ? ancestry[1] : null;
}

/** A project's current collaborator list, read straight from its
 * README.md front matter — `[]` for a project with no README yet, no
 * front matter, or no `sharing` key (nobody but its own owner has
 * access). */
export async function getProjectSharing(
  projectFolder: VaultFolder,
): Promise<ProjectSharingEntry[]> {
  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  if (!readme?.content) return [];
  return parseProjectSharing(readme.content);
}

export type ResolvedProjectRole = { role: string; isOwner: boolean };

/**
 * Resolves `humanId`'s role on `projectFolder`. The folder's own creator
 * is always an implicit "Owner" — never needs (or gets) a README entry of
 * their own. Anyone else is looked up in the README's `sharing` list;
 * `null` means `humanId` has no role on this project at all (not
 * necessarily "can't view anything" — that's still governed by the
 * denormalized `shared_with` cache, kept in sync with this list).
 */
export async function getProjectRole(
  projectFolder: VaultFolder,
  humanId: string,
): Promise<ResolvedProjectRole | null> {
  if (projectFolder.human_id === humanId) {
    return { role: "Owner", isOwner: true };
  }
  const sharing = await getProjectSharing(projectFolder);
  const entry = sharing.find((e) => e.human === humanId);
  if (!entry) return null;
  return { role: entry.role, isOwner: await isOwnerTierRole(entry.role) };
}

/** Convenience wrapper for callers that only have a folder ID (e.g. a
 * skills-folder file whose OWN folder isn't the project folder) — resolves
 * the owning project first, then the human's role on it. `null` when
 * there's no owning project (e.g. `personal`) or no role at all. */
export async function getProjectRoleForFolderId(
  folderId: string,
  humanId: string,
): Promise<ResolvedProjectRole | null> {
  const folder = await getFolderById(folderId);
  if (!folder) return null;
  const project = await findOwningProjectFolder(folder);
  if (!project) return null;
  return getProjectRole(project, humanId);
}

/**
 * Whether `actingHumanId` may act with full owner-level privileges on
 * something owned by `ownerHumanId`, living in `folderId` — true when they
 * genuinely ARE that owner, or when they hold an owner-tier Sharing Role
 * (Owner/Crafter) on the project `folderId` lives under. This is what
 * makes an owner-tier collaborator behave like a co-owner for everyday
 * CONTENT actions on a shared project — upload, create folder, rename,
 * move, delete, replace, publish — the same broadening `setProjectSharing`
 * already applies to changing sharing itself.
 *
 * Deliberately NOT used for the project ANCHOR folder's own object-level
 * lifecycle (renaming/deleting/publishing the whole project) — that stays
 * creator-only, the same precedent `projectStatus.server.ts` already set
 * for project status ("a personal organizational tool", unlike the
 * collaborator-facing actions this function gates). Callers operating on
 * an anchor folder should keep checking `folder.human_id === actingHumanId`
 * directly instead.
 */
export async function canActAsProjectOwner(
  actingHumanId: string,
  ownerHumanId: string,
  folderId: string | null | undefined,
): Promise<boolean> {
  if (actingHumanId === ownerHumanId) return true;
  if (!folderId) return false;
  const role = await getProjectRoleForFolderId(folderId, actingHumanId);
  return !!role?.isOwner;
}

export type SetProjectSharingResult =
  | { ok: true; sharing: ProjectSharingEntry[] }
  | { ok: false; error: string };

/**
 * Replaces a project's ENTIRE collaborator list — the only intended writer
 * of a project's `sharing` front matter. Rewrites the README (creating one
 * if the project doesn't have one yet, preserving every other front-matter
 * field untouched), then recomputes and cascades `vault_folders.shared_with`
 * to match, so the pre-existing view-access plumbing keeps working.
 *
 * `actingHumanId` must currently hold an owner-tier role on this project
 * (the creator, or an existing Owner/Crafter) — Observers may not change
 * sharing. Every entry's `role` must name a role that exists in
 * `sharing_roles`. The project's own creator is stripped out if present
 * (always implicit — see `getProjectRole`).
 */
export async function setProjectSharing(
  actingHumanId: string,
  projectFolder: VaultFolder,
  entries: ProjectSharingEntry[],
): Promise<SetProjectSharingResult> {
  if (!(await isProjectFolder(projectFolder))) {
    return { ok: false, error: "Sharing roles only apply to project folders" };
  }

  const actingRole = await getProjectRole(projectFolder, actingHumanId);
  if (!actingRole?.isOwner) {
    return {
      ok: false,
      error: "You don't have permission to change sharing on this project",
    };
  }

  const cleaned = entries.filter((e) => e.human !== projectFolder.human_id);
  for (const entry of cleaned) {
    if (!(await getSharingRoleByName(entry.role))) {
      return { ok: false, error: `Unknown role "${entry.role}"` };
    }
  }

  const readme = await getOrCreateReadme(projectFolder.human_id, projectFolder._id);
  const updatedContent = withProjectSharing(readme.content ?? "", cleaned);
  await updateFileRef(readme._id, { content: updatedContent });

  await cascadeShareVaultFolder(
    projectFolder._id,
    cleaned.map((e) => e.human),
  );

  return { ok: true, sharing: cleaned };
}
