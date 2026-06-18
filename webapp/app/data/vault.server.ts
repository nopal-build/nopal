import { RecordId } from "surrealdb";
import { query, formatRecord, upsert, remove, merge } from "./generic.server";
import { deleteFromS3 } from "./file.server";

// ─── Types (defined in vault.types.ts; re-exported from here for convenience) ──
export type {
  MdVersion,
  FileRef,
  FileShareType,
  VaultFolder,
} from "./vault.types";
import type {
  MdVersion,
  FileRef,
  FileShareType,
  VaultFolder,
} from "./vault.types";

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
}): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();
  const result = await upsert("vault_folders", {
    human_id: data.human_id,
    name: data.name,
    parent_folder_id: data.parent_folder_id ?? null,
    shared_with: data.shared_with ?? [],
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as VaultFolder) : undefined;
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
  });
  if (!created) throw new Error(`Failed to create vault folder: ${name}`);
  return created;
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
