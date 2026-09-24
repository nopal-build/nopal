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
 * `vault_folders.shared_with` (a plain array of human ids, see
 * `vault.types.ts`) is a DERIVED CACHE of this list: everyone on it but a
 * Client (ADR-023), cascaded to every descendant folder by
 * `writeProjectSharing`, its only writer. The O(1) view checks
 * (`canViewFolder`, `canViewFileRef`, the Vault's "Shared with me") read
 * it, which is what refuses a client every Vault folder, file and project
 * page. Never write `shared_with` directly for a project folder.
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
import { parseProjectSharing, withProjectSharing, type ProjectSharingEntry } from "./project.types";
import {
  CLIENT_ROLE,
  GUIDING_ROLE,
  getSharingRoleByName,
  isOwnerTierRole,
  reachesProjectWork,
} from "./sharingRoles.server";
import { query, formatRecord } from "./generic.server";
import { getHumanById } from "./humans.server";

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

/** A project's people, read straight from its README.md front matter.
 * `[]` for a project with no README, no front matter or no `sharing` key. */
export async function getProjectSharing(
  projectFolder: VaultFolder,
): Promise<ProjectSharingEntry[]> {
  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  if (!readme?.content) return [];
  return parseProjectSharing(readme.content);
}

export type ResolvedProjectRole = {
  role: string;
  /** Writes the project's content: Owner and Crafter (`is_owner`). */
  isOwner: boolean;
  /** Runs its people side, name, status and sees others' Steep readings:
   * Owner only (`GUIDING_ROLE`). */
  guiding: boolean;
};

/**
 * Resolves `humanId`'s role on `projectFolder` from the README's `sharing`
 * list, or `null` when they hold none. The creator is listed like anyone
 * else, as Owner (ADR-023); owning the folder decides nothing, so a
 * creator who set themselves to Observer or Client sees it that way.
 */
export async function getProjectRole(
  projectFolder: VaultFolder,
  humanId: string,
): Promise<ResolvedProjectRole | null> {
  const entry = (await getProjectSharing(projectFolder)).find((e) => e.human === humanId);
  if (!entry) return null;
  return {
    role: entry.role,
    isOwner: await isOwnerTierRole(entry.role),
    guiding: entry.role === GUIDING_ROLE,
  };
}

/** The role name `humanId` holds in a sharing list already in hand. */
export function roleIn(sharing: ProjectSharingEntry[], humanId: string): string | null {
  return sharing.find((e) => e.human === humanId)?.role ?? null;
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
 * Whether `actingHumanId` may change content (upload, create, rename,
 * move, delete, replace, publish) living in `folderId`, owned by
 * `ownerHumanId`. Inside a project it is the role: Owner or Crafter.
 * Outside any project (someone's own `personal`, the `projects` root
 * itself) it is ownership.
 *
 * Not used for the project ANCHOR's own lifecycle (renaming, deleting,
 * publishing the whole project): that is the Owner role alone, like
 * status (see `api.vault.folders.$folderId.tsx`).
 */
export async function canActAsProjectOwner(
  actingHumanId: string,
  ownerHumanId: string,
  folderId: string | null | undefined,
): Promise<boolean> {
  if (folderId) {
    const folder = await getFolderById(folderId);
    const project = folder ? await findOwningProjectFolder(folder) : null;
    if (project) return !!(await getProjectRole(project, actingHumanId))?.isOwner;
  }
  return actingHumanId === ownerHumanId;
}

/** Writes a project's list and rebuilds `shared_with` from it: everyone
 * but a Client, on the project folder and every folder under it. The
 * only writer of a project's cache. Checks nothing; `setProjectSharing`
 * is the checked path. */
export async function writeProjectSharing(
  projectFolder: VaultFolder,
  entries: ProjectSharingEntry[],
): Promise<void> {
  const readme = await getOrCreateReadme(projectFolder.human_id, projectFolder._id);
  await updateFileRef(readme._id, { content: withProjectSharing(readme.content ?? "", entries) });
  await cascadeShareVaultFolder(
    projectFolder._id,
    entries.filter((e) => reachesProjectWork(e.role)).map((e) => e.human),
  );
}

/** A new project's creator, written in as Owner. */
export async function writeCreatorAsOwner(projectFolder: VaultFolder): Promise<void> {
  const existing = await getProjectSharing(projectFolder);
  if (existing.some((e) => e.human === projectFolder.human_id)) return;
  await writeProjectSharing(projectFolder, [{ human: projectFolder.human_id, role: GUIDING_ROLE }, ...existing]);
}

export type SetProjectSharingResult =
  | { ok: true; sharing: ProjectSharingEntry[] }
  | { ok: false; error: string };

/**
 * Replaces a project's whole list of people. The acting person must be
 * its Owner, or an admin (the deliberate way an admin gives themselves a
 * role on a project they aren't on). Every role must exist in
 * `sharing_roles`, and the project keeps at least one Owner, so nobody can
 * lock a project out of its own people list.
 */
export async function setProjectSharing(
  actingHumanId: string,
  projectFolder: VaultFolder,
  entries: ProjectSharingEntry[],
): Promise<SetProjectSharingResult> {
  if (!(await isProjectFolder(projectFolder))) {
    return { ok: false, error: "Sharing roles only apply to project folders" };
  }

  const actor = await getHumanById(actingHumanId);
  const actingRole = await getProjectRole(projectFolder, actingHumanId);
  const isAdmin = actor?.role === "Admin" || actor?.role === "Super";
  if (!actingRole?.guiding && !isAdmin) {
    return { ok: false, error: "You don't have permission to change sharing on this project" };
  }

  const seen = new Set<string>();
  const cleaned = entries.filter((e) => (seen.has(e.human) ? false : (seen.add(e.human), true)));
  for (const entry of cleaned) {
    if (!(await getSharingRoleByName(entry.role))) {
      return { ok: false, error: `Unknown role "${entry.role}"` };
    }
  }
  if (!cleaned.some((e) => e.role === GUIDING_ROLE)) {
    return { ok: false, error: "A project needs at least one Owner" };
  }

  await writeProjectSharing(projectFolder, cleaned);
  return { ok: true, sharing: cleaned };
}

// ─── Reads across projects ────────────────────────────────────────────────────

export type ProjectMembership = { folder: VaultFolder; sharing: ProjectSharingEntry[]; role: string };

/** Every project `humanId` holds a role on, Client included, in name
 * order: what the dashboard, the Daily Log's "Add a card" and the
 * Steep-o-meter work from. Two queries: the projects, then their READMEs
 * that mention the person. */
export async function listProjectsFor(humanId: string): Promise<ProjectMembership[]> {
  const roots = await query<[{ id: unknown }[]]>(
    `SELECT id FROM vault_folders WHERE vault_root_key = "projects" AND (parent_folder_id = NONE OR parent_folder_id = NULL)`,
  );
  const rootIds = (roots?.[0] ?? []).map((r) => recordKey(r.id));
  if (rootIds.length === 0) return [];
  const folders = (
    (await query<[VaultFolder[]]>(`SELECT * FROM vault_folders WHERE parent_folder_id IN $rootIds`, { rootIds }))?.[0] ?? []
  ).map(formatRecord);
  if (folders.length === 0) return [];
  const readmes = await query<[{ folder_id: string; human_id: string; content?: string }[]]>(
    `SELECT folder_id, human_id, content FROM file_refs
     WHERE folder_id IN $ids AND string::lowercase(name) = "readme.md" AND string::contains(content ?? "", $humanId)`,
    { ids: folders.map((f) => f._id), humanId },
  );
  const byFolder = new Map(folders.map((f) => [f._id, f]));
  const out: ProjectMembership[] = [];
  for (const row of readmes?.[0] ?? []) {
    const folder = byFolder.get(row.folder_id);
    if (!folder || folder.human_id !== row.human_id) continue;
    const sharing = parseProjectSharing(row.content ?? "");
    const role = roleIn(sharing, humanId);
    if (role) out.push({ folder, sharing, role });
  }
  return out.sort((x, y) => x.folder.name.localeCompare(y.folder.name));
}

/** Whether every role this person holds is Client: they get the client
 * screen and no Vault. Someone on no project isn't a client anywhere. */
export function isClientEverywhere(memberships: ProjectMembership[]): boolean {
  return memberships.length > 0 && memberships.every((m) => m.role === CLIENT_ROLE);
}

/** A SurrealDB record id as the bare key the rest of the app stores. */
function recordKey(id: unknown): string {
  if (id && typeof id === "object" && "id" in id) return String((id as { id: unknown }).id);
  const s = String(id);
  return s.includes(":") ? s.slice(s.indexOf(":") + 1) : s;
}
