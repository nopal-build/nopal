import { RecordId } from "surrealdb";
import { query, formatRecord, upsert, remove, merge } from "./generic.server";
import { deleteFromS3 } from "./file.server";

// ─── Types (defined in vault.types.ts; re-exported from here for convenience) ──
export type {
  MdVersion,
  FileRef,
  FileRefListing,
  FileShareType,
  VaultFolder,
} from "./vault.types";
export { isFolderShared } from "./vault.types";
import type {
  MdVersion,
  FileRef,
  FileRefListing,
  FileShareType,
  VaultFolder,
} from "./vault.types";
import {
  VAULT_ROOT_KEYS,
  VAULT_ROOTS,
  isVaultRootKey,
  type VaultRootKey,
} from "./vaultRoots";

// ─── FileRef CRUD ─────────────────────────────────────────────────────────────

export async function createFileRef(data: {
  human_id: string;
  name: string;
  s3_url?: string | null;
  s3_key?: string | null;
  content?: string | null;
  content_type: string;
  folder_id?: string | null;
  size?: number | null;
  source?: "daily_log";
  /** YYYY-MM-DD — set for daily_log files. */
  date?: string;
}): Promise<FileRef | undefined> {
  const now = new Date().toISOString();
  const result = await upsert("file_refs", {
    human_id: data.human_id,
    name: data.name,
    s3_url: data.s3_url ?? null,
    s3_key: data.s3_key ?? null,
    content: data.content ?? null,
    md_versions: [],
    content_type: data.content_type,
    folder_id: data.folder_id ?? null,
    size: data.size ?? null,
    ...(data.source ? { source: data.source } : {}),
    ...(data.date ? { date: data.date } : {}),
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as FileRef) : undefined;
}

export async function getFileRefsByHuman(humanId: string): Promise<FileRef[]> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE human_id = $humanId ORDER BY created_at DESC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getFileRefsByFolderIds(
  folderIds: string[],
): Promise<FileRef[]> {
  if (!folderIds.length) return [];
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE folder_id IN $folderIds ORDER BY created_at DESC`,
    { folderIds },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getFileRefById(id: string): Promise<FileRef | undefined> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE id = $rid`,
    { rid: new RecordId("file_refs", id) },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

/**
 * Whether `humanId` is allowed to view (not necessarily download/manage)
 * `file` — either because they own it, or because it sits in a folder
 * they've been granted view access to. Mirrors the visibility FileCard
 * already grants shared-folder viewers (thumbnails/open-link), so this is
 * the single place that logic should live for server-side checks.
 */
export async function canViewFileRef(
  humanId: string,
  file: FileRef,
): Promise<boolean> {
  if (file.human_id === humanId) return true;
  if (!file.folder_id) return false;
  const folder = await getFolderById(file.folder_id);
  if (!folder) return false;
  if (folder.shared_with === "everyone") return true;
  return (
    Array.isArray(folder.shared_with) && folder.shared_with.includes(humanId)
  );
}

export async function updateFileRef(
  id: string,
  updates: Partial<{
    name: string;
    folder_id: string | null;
    content: string;
    md_versions: MdVersion[];
    shared_type: FileShareType;
    is_public: boolean;
    /** ISO timestamp to archive the file; null to unarchive. */
    archived_at: string | null;
  }>,
): Promise<FileRef | undefined> {
  const result = await merge("file_refs", id, {
    ...(updates as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  });
  return result ? formatRecord(result as unknown as FileRef) : undefined;
}

/**
 * Returns all file_refs where archived_at is set and older than `olderThanDays` days.
 * Used by the archive cleanup job to find files due for permanent deletion.
 */
export async function getArchivedFilesForCleanup(
  olderThanDays = 30,
): Promise<FileRef[]> {
  const cutoff = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE archived_at != NONE
       AND archived_at != null
       AND archived_at <= $cutoff`,
    { cutoff },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function deleteFileRef(id: string): Promise<void> {
  const file = await getFileRefById(id);
  if (file?.s3_key) {
    try {
      await deleteFromS3(file.s3_key);
    } catch (err) {
      console.error(`Failed to delete S3 object for file_ref ${id}:`, err);
      // Continue with DB deletion even if S3 fails
    }
  }
  await remove("file_refs", id);
}

// ─── VaultFolder CRUD ─────────────────────────────────────────────────────────

export async function createVaultFolder(data: {
  human_id: string;
  name: string;
  parent_folder_id?: string | null;
  shared_with?: string[] | "everyone";
  vault_root_key?: VaultRootKey | null;
}): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();

  // Inherit the root key from the parent folder when not given explicitly,
  // so every folder carries its Vault Root subtree key (see vaultRoots.ts).
  let rootKey = data.vault_root_key ?? null;
  if (!rootKey && data.parent_folder_id) {
    rootKey = await resolveVaultRootKey(data.parent_folder_id);
  }

  const result = await upsert("vault_folders", {
    human_id: data.human_id,
    name: data.name,
    parent_folder_id: data.parent_folder_id ?? null,
    shared_with: data.shared_with ?? [],
    vault_root_key: rootKey,
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as VaultFolder) : undefined;
}

/**
 * Resolves which Vault Root subtree a folder belongs to.
 * Reads the denormalized `vault_root_key` when present; walks the parent
 * chain as a fallback for legacy records that predate root keys.
 */
export async function resolveVaultRootKey(
  folderId: string,
): Promise<VaultRootKey | null> {
  let currentId: string | null = folderId;
  // Bounded walk — protects against accidental parent cycles.
  for (let depth = 0; currentId && depth < 50; depth++) {
    const folder: VaultFolder | undefined = await getFolderById(currentId);
    if (!folder) return null;
    if (isVaultRootKey(folder.vault_root_key)) return folder.vault_root_key;
    if (!folder.parent_folder_id && isVaultRootKey(folder.name)) {
      // Legacy root container created by name before root keys existed.
      return folder.name;
    }
    currentId = folder.parent_folder_id;
  }
  return null;
}

export async function getFoldersByHuman(
  humanId: string,
): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE human_id = $humanId ORDER BY name ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getFolderById(
  id: string,
): Promise<VaultFolder | undefined> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE id = $rid`,
    { rid: new RecordId("vault_folders", id) },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

export async function getSharedFoldersForHuman(
  humanId: string,
): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id != $humanId
       AND (shared_with = 'everyone' OR $humanId IN shared_with)
     ORDER BY human_id, name ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function updateVaultFolder(
  id: string,
  updates: Partial<{
    name: string;
    shared_with: string[] | "everyone";
  }>,
): Promise<VaultFolder | undefined> {
  const result = await merge("vault_folders", id, {
    ...(updates as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  });
  return result ? formatRecord(result as unknown as VaultFolder) : undefined;
}

/**
 * Updates `shared_with` on a folder AND every descendant folder.
 *
 * Use this instead of `updateVaultFolder` whenever the sharing setting
 * changes so sub-folders (and the files inside them) are always visible to
 * exactly the same audience as their parent.
 */
export async function cascadeShareVaultFolder(
  folderId: string,
  shared_with: string[] | "everyone",
): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();

  // Update the target folder itself
  const rootResult = await merge("vault_folders", folderId, {
    shared_with,
    updated_at: now,
  });

  // Propagate to every descendant (depth-first via the existing helper)
  const descendantIds = await getAllNestedFolderIds(folderId);
  for (const id of descendantIds) {
    await merge("vault_folders", id, { shared_with, updated_at: now });
  }

  return rootResult
    ? formatRecord(rootResult as unknown as VaultFolder)
    : undefined;
}

async function getAllNestedFolderIds(parentId: string): Promise<string[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE parent_folder_id = $parentId`,
    { parentId },
  );
  const children = (result?.[0] ?? []).map(formatRecord);
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child._id);
    const nested = await getAllNestedFolderIds(child._id);
    ids.push(...nested);
  }
  return ids;
}

/** Strip `removedHumanId` out of every folder `ownerId` owns that lists it in `shared_with`. */
async function unshareFolderFromHuman(
  ownerId: string,
  removedHumanId: string,
): Promise<void> {
  const folders = await getFoldersByHuman(ownerId);
  for (const folder of folders) {
    if (
      Array.isArray(folder.shared_with) &&
      folder.shared_with.includes(removedHumanId)
    ) {
      await updateVaultFolder(folder._id, {
        shared_with: folder.shared_with.filter((id) => id !== removedHumanId),
      });
    }
  }
}

/**
 * Clean up any direct folder sharing between two humans (in either
 * direction) — used when the relationship that granted them visibility into
 * each other is removed. Folders shared with `"everyone"` are left alone,
 * since that's a blanket setting rather than something tied to this
 * specific relationship.
 */
export async function removeFolderSharingBetweenHumans(
  humanAId: string,
  humanBId: string,
): Promise<void> {
  await unshareFolderFromHuman(humanAId, humanBId);
  await unshareFolderFromHuman(humanBId, humanAId);
}

/**
 * Find an existing folder matching (humanId + name + parentFolderId) or create it.
 * Useful for auto-provisioning the daily-logs folder tree.
 */
export async function getOrCreateVaultFolder(
  humanId: string,
  name: string,
  parentFolderId: string | null = null,
): Promise<VaultFolder> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId
       AND name = $name
       AND parent_folder_id = $parentFolderId
     LIMIT 1`,
    { humanId, name, parentFolderId },
  );
  const existing = result?.[0]?.[0];
  if (existing) return formatRecord(existing);

  const created = await createVaultFolder({
    human_id: humanId,
    name,
    parent_folder_id: parentFolderId,
    // Root-level folders created through this path are the system containers
    // themselves (e.g. "daily-logs" from the daily-log write path).
    vault_root_key:
      parentFolderId === null && isVaultRootKey(name) ? name : undefined,
  });
  if (!created) throw new Error(`Failed to create vault folder: ${name}`);
  return created;
}

/** Every descendant folder record (BFS) of the given folder. */
export async function getDescendantFolders(
  folderId: string,
): Promise<VaultFolder[]> {
  const out: VaultFolder[] = [];
  const queue = [folderId];
  while (queue.length) {
    const parentId = queue.shift()!;
    const result = await query<[VaultFolder[]]>(
      `SELECT * FROM vault_folders WHERE parent_folder_id = $parentId`,
      { parentId },
    );
    for (const child of (result?.[0] ?? []).map(formatRecord)) {
      out.push(child);
      queue.push(child._id);
    }
  }
  return out;
}

/**
 * Re-parents a folder under `newParent`, re-stamping `vault_root_key` on the
 * folder and every descendant (moves may cross root subtrees, e.g.
 * personal → projects).
 *
 * Mechanical only — callers are responsible for policy checks (ownership,
 * root containers, shared folders, cycles).
 */
export async function moveVaultFolder(
  folder: VaultFolder,
  newParent: VaultFolder,
  descendants?: VaultFolder[],
): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();
  const newKey =
    newParent.vault_root_key ?? (await resolveVaultRootKey(newParent._id));

  const updated = await merge("vault_folders", folder._id, {
    parent_folder_id: newParent._id,
    vault_root_key: newKey,
    updated_at: now,
  });

  for (const child of descendants ?? (await getDescendantFolders(folder._id))) {
    if (child.vault_root_key !== newKey) {
      await merge("vault_folders", child._id, {
        vault_root_key: newKey,
        updated_at: now,
      });
    }
  }

  return updated ? formatRecord(updated as unknown as VaultFolder) : undefined;
}

/**
 * Ensures the human has every Vault Root container (daily-logs, projects,
 * personal, …), tagging pre-existing name-matched root folders with their
 * `vault_root_key` when the tag is missing. Returns the containers ordered
 * as declared in VAULT_ROOTS.
 */
export async function ensureVaultRootFolders(
  humanId: string,
): Promise<VaultFolder[]> {
  const roots: VaultFolder[] = [];
  for (const key of VAULT_ROOT_KEYS) {
    const result = await query<[VaultFolder[]]>(
      `SELECT * FROM vault_folders
       WHERE human_id = $humanId
         AND parent_folder_id = null
         AND name = $name
       LIMIT 1`,
      { humanId, name: key },
    );
    const existing = result?.[0]?.[0] ? formatRecord(result[0][0]) : null;

    if (existing) {
      if (existing.vault_root_key !== key) {
        const updated = await merge("vault_folders", existing._id, {
          vault_root_key: key,
          updated_at: new Date().toISOString(),
        });
        roots.push(
          updated
            ? formatRecord(updated as unknown as VaultFolder)
            : { ...existing, vault_root_key: key },
        );
      } else {
        roots.push(existing);
      }
      continue;
    }

    const created = await createVaultFolder({
      human_id: humanId,
      name: key,
      parent_folder_id: null,
      vault_root_key: key,
    });
    if (!created) throw new Error(`Failed to create vault root folder: ${key}`);
    roots.push(created);
  }
  return roots;
}

/**
 * Ancestor chain for a folder, ordered root container → … → the folder
 * itself. Used for breadcrumbs and revealing the tree path on deep links.
 */
export async function getFolderAncestry(
  folderId: string,
): Promise<VaultFolder[]> {
  const chain: VaultFolder[] = [];
  let currentId: string | null = folderId;
  for (let depth = 0; currentId && depth < 50; depth++) {
    const folder: VaultFolder | undefined = await getFolderById(currentId);
    if (!folder) break;
    chain.unshift(folder);
    currentId = folder.parent_folder_id;
  }
  return chain;
}

/**
 * Direct children (sub-folders + file metadata) of one folder — the unit of
 * lazy tree/folder-view loading in vault v2. Never returns file content.
 *
 * Sub-folder sort follows the root policy (e.g. daily-logs date folders are
 * listed latest → oldest); files are always name ASC.
 */
export async function listFolderChildren(
  humanId: string,
  folderId: string | null,
): Promise<{ folders: VaultFolder[]; files: FileRefListing[] }> {
  const [foldersResult, filesResult] = await Promise.all([
    query<[VaultFolder[]]>(
      `SELECT * FROM vault_folders
       WHERE human_id = $humanId AND parent_folder_id = $folderId
       ORDER BY name ASC`,
      { humanId, folderId },
    ),
    folderId
      ? query<[FileRef[]]>(
          `SELECT id, human_id, name, content_type, folder_id, size, source,
                  date, created_at, updated_at, archived_at,
                  (s3_key != NONE AND s3_key != null) AS has_s3
           FROM file_refs
           WHERE human_id = $humanId AND folder_id = $folderId
           ORDER BY name ASC`,
          { humanId, folderId },
        )
      : Promise.resolve([[]] as [FileRef[]]),
  ]);

  let folders = (foldersResult?.[0] ?? []).map(formatRecord);
  const files = (filesResult?.[0] ?? []).map(formatRecord) as unknown as
    FileRefListing[];

  // Root-policy child sort (only applies to a root container's own children).
  if (folderId) {
    const parent = await getFolderById(folderId);
    if (
      parent &&
      parent.parent_folder_id === null &&
      isVaultRootKey(parent.vault_root_key) &&
      VAULT_ROOTS[parent.vault_root_key].childSort === "name-desc"
    ) {
      folders = folders.reverse();
    }
  }

  return { folders, files };
}

export async function deleteVaultFolderCascade(
  folderId: string,
): Promise<void> {
  const allFolderIds = await getAllNestedFolderIds(folderId);
  allFolderIds.push(folderId);

  for (const fid of allFolderIds) {
    const filesResult = await query<[FileRef[]]>(
      `SELECT * FROM file_refs WHERE folder_id = $fid`,
      { fid },
    );
    const files = (filesResult?.[0] ?? []).map(formatRecord);
    for (const file of files) {
      await deleteFileRef(file._id);
    }
  }

  for (const fid of allFolderIds) {
    await remove("vault_folders", fid);
  }
}

// ─── New-user vault provisioning ───────────────────────────────────────────────────

/**
 * Upserts the `readme.md` vault file for a given daily-log date.
 *
 * Folder structure created on-demand:
 *   daily-logs  (root, parent_folder_id = null)
 *     └── YYYY-MM-DD
 *           └── readme.md  (content_type text/markdown, source daily_log)
 *
 * On the same calendar day the content is overwritten in-place.
 * On subsequent days the old content is pushed to `md_versions` first
 * (same logic as computeMdUpdate — shouldn't normally happen because the
 * daily-log lock prevents editing past days, but it's handled gracefully).
 */
export async function upsertDailyLogReadme(
  humanId: string,
  dateStr: string, // YYYY-MM-DD
  content: string,
): Promise<FileRef | undefined> {
  try {
    // Ensure folder tree
    const rootFolder = await getOrCreateVaultFolder(
      humanId,
      "daily-logs",
      null,
    );
    const dateFolder = await getOrCreateVaultFolder(
      humanId,
      dateStr,
      rootFolder._id,
    );

    // Find existing readme.md in this date folder
    const result = await query<[FileRef[]]>(
      `SELECT * FROM file_refs
       WHERE human_id = $humanId
         AND folder_id = $folderId
         AND name = 'readme.md'
       LIMIT 1`,
      { humanId, folderId: dateFolder._id },
    );
    const existing = result?.[0]?.[0]
      ? formatRecord(result[0][0] as FileRef)
      : null;

    if (existing) {
      const { content: newContent, md_versions } = computeMdUpdate(
        existing,
        content,
      );
      return updateFileRef(existing._id, { content: newContent, md_versions });
    }

    return createFileRef({
      human_id: humanId,
      name: "readme.md",
      content,
      content_type: "text/markdown",
      folder_id: dateFolder._id,
      source: "daily_log",
      date: dateStr,
    });
  } catch (err) {
    console.error("upsertDailyLogReadme failed:", err);
    return undefined;
  }
}

// ─── .md versioning helper ────────────────────────────────────────────────────

export function computeMdUpdate(
  file: FileRef,
  newContent: string,
): { content: string; md_versions: MdVersion[] } {
  const today = new Date().toISOString().slice(0, 10);
  const lastUpdatedDay = file.updated_at.slice(0, 10);

  if (lastUpdatedDay === today) {
    return { content: newContent, md_versions: file.md_versions ?? [] };
  }

  const newVersion: MdVersion = {
    content: file.content ?? "",
    date: lastUpdatedDay,
  };
  return {
    content: newContent,
    md_versions: [...(file.md_versions ?? []), newVersion],
  };
}
