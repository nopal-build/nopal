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
export { isFolderShared, canViewFolder } from "./vault.types";
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
  canWriteToRoot,
  isRootPublishable,
  isRootShareable,
  isVaultRootKey,
  type VaultRootKey,
} from "./vaultRoots";
import {
  canCreateFolderType,
  canWriteToFolderType,
  CONTAINER_FOLDER_TYPES,
  isContainerFolderTypeKey,
  isFolderTypePublishable,
  isFolderTypeShareable,
  isSpaceFolderTypeKey,
  isSyncFamilyFolderType,
  isSyncFolderTypeKey,
  SPACE_FOLDER_TYPES,
  SYNC_FOLDER_TYPES,
  type VaultFolderTypeKey,
} from "./vaultFolderTypes";
import { isVaultRootFolder } from "./vault.types";
import type { Role } from "./humans.server";
// File Referencing & Renaming (`fileReferences.server.ts`), `project-n02`
// seeding (`projectN02.server.ts`), and `website` seeding/publish/settings
// (`website.server.ts`) all statically import several read helpers back
// from THIS file — a real mutual cycle, but a safe one: every name involved
// is a hoisted `function` declaration, and nothing in any of these modules
// calls one of these functions at top-level (module-evaluation) time, only
// later from inside other async functions. `website.server.ts` ALSO
// imports `canActAsProjectOwner` from `projectSharing.server.ts`, which
// itself imports back from this file — a third node on the same cycle,
// same safety argument applies (`canActAsProjectOwner`/`isProjectFolder`/
// `findOwningProjectFolder` are all hoisted `function` declarations too).
// A DYNAMIC `import()` here bought nothing beyond exactly the same safety,
// while adding a real bug of its own — concurrent first-ever dynamic
// imports of the same not-yet-cached module could race and hand one
// caller back a not-fully-populated module namespace.
import {
  syncFileReferences,
  dropOutgoingReferences,
  propagateTargetDeletion,
  collectFolderAndDescendantTargets,
  propagateTargetChange,
} from "./fileReferences.server";
import { ensureProjectN02 } from "./projectN02.server";
import { applyWebsiteShape } from "./website.server";

// ─── FileRef CRUD ─────────────────────────────────────────────────────────────

export async function createFileRef(data: {
  human_id: string;
  name: string;
  s3_url?: string | null;
  s3_key?: string | null;
  content?: string | null;
  content_type: string;
  content_hash?: string | null;
  folder_id?: string | null;
  size?: number | null;
  source?: "daily_log" | "daily_log_card";
  /** YYYY-MM-DD — set for daily_log/daily_log_card files. */
  date?: string;
  /** Which project folder a `daily_log_card` file is for. */
  project_folder_id?: string | null;
  /** Use this EXACT id instead of letting SurrealDB generate one — for
   * callers that must keep an id stable across a copy of this record
   * living somewhere else (currently only `scripts/pull-daily-logs.ts`,
   * preserving each production id locally so directive ids embedded in
   * pulled content, e.g. `::file{fileId="..."}`/`::card{file="..."}`,
   * keep resolving correctly without any separate remap pass). Omit for
   * the normal, auto-generated-id path every real upload uses. */
  id?: string;
}): Promise<FileRef | undefined> {
  const now = new Date().toISOString();
  const result = await upsert(data.id ? new RecordId("file_refs", data.id) : "file_refs", {
    human_id: data.human_id,
    name: data.name,
    s3_url: data.s3_url ?? null,
    s3_key: data.s3_key ?? null,
    content: data.content ?? null,
    md_versions: [],
    content_type: data.content_type,
    content_hash: data.content_hash ?? null,
    folder_id: data.folder_id ?? null,
    size: data.size ?? null,
    ...(data.source ? { source: data.source } : {}),
    ...(data.date ? { date: data.date } : {}),
    ...(data.project_folder_id ? { project_folder_id: data.project_folder_id } : {}),
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  const created = record ? formatRecord(record as unknown as FileRef) : undefined;
  if (created) {
    // File Referencing & Renaming — see the import comment above.
    await syncFileReferences(created);
  }
  return created;
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
    content_hash: string | null;
    md_versions: MdVersion[];
    shared_type: FileShareType;
    is_public: boolean;
    /** ISO timestamp to archive the file; null to unarchive. */
    archived_at: string | null;
    /** Same field `createFileRef` already accepts at creation (e.g.
     * `dailyLogSync.server.ts`'s own `date: entryDate` stamp) -- also
     * settable here so a file COPIED in after the fact (an attachment,
     * copied via `copyFileIntoFolder` with no `date` of its own) can be
     * stamped afterward, letting `sync-graph`'s existing `!!f.date`
     * candidate filter pick it up for free. */
    date: string | null;
  }>,
): Promise<FileRef | undefined> {
  const result = await merge("file_refs", id, {
    ...(updates as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  });
  const updated = result ? formatRecord(result as unknown as FileRef) : undefined;
  if (updated) {
    if ("content" in updates) {
      await syncFileReferences(updated);
    }
    if ("name" in updates || "folder_id" in updates) {
      await propagateTargetChange([{ type: "file", id: updated._id }]);
    }
  }
  return updated;
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

/** `copyFileIntoFolder` deliberately shares the SAME `s3_key`/`s3_url`
 * across multiple `file_refs` rows (a "copy" is a second DB row pointing
 * at the same S3 object, never a byte-for-byte S3 duplication) — so
 * deleting one such row must NEVER delete the underlying S3 object out
 * from under every OTHER row that still references it (e.g. the original
 * daily-log photo a project's own filed copy was made from). Checked by
 * `deleteFileRef` before it ever calls `deleteFromS3`. */
async function isS3KeyReferencedElsewhere(
  s3Key: string,
  excludeId: string,
): Promise<boolean> {
  const result = await query<[FileRef[]]>(
    `SELECT id FROM file_refs WHERE s3_key = $s3Key`,
    { s3Key },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);
  return rows.some((r) => r._id !== excludeId);
}

export async function deleteFileRef(id: string): Promise<void> {
  const file = await getFileRefById(id);
  if (file?.s3_key) {
    const sharedElsewhere = await isS3KeyReferencedElsewhere(file.s3_key, id);
    if (!sharedElsewhere) {
      try {
        await deleteFromS3(file.s3_key);
      } catch (err) {
        console.error(`Failed to delete S3 object for file_ref ${id}:`, err);
        // Continue with DB deletion even if S3 fails
      }
    }
  }
  await remove("file_refs", id);
  if (file) {
    // File Referencing & Renaming: mark any dead mention pointing at this
    // now-gone file, and drop its own outgoing/incoming reference rows.
    await propagateTargetDeletion({ type: "file", id }, file.name);
    await dropOutgoingReferences(id);
  }
}

// ─── VaultFolder CRUD ─────────────────────────────────────────────────────────

export async function createVaultFolder(data: {
  human_id: string;
  name: string;
  parent_folder_id?: string | null;
  shared_with?: string[];
  vault_root_key?: VaultRootKey | null;
  /** Explicitly DEFINES this folder as a Vault Folder Type anchor (e.g. a
   * project's own "Skills"/"Syncs" folder, or a sync connector inside one)
   * — see vaultFolderTypes.ts. Omit for an ordinary folder, which instead
   * INHERITS whatever type (if any) its parent already carries. Callers are
   * responsible for validating the type is allowed for this parent (see
   * `validateFolderTypeForParent`) — this function is mechanical only. */
  folder_type?: VaultFolderTypeKey | null;
  /** Use this EXACT id instead of letting SurrealDB generate one — see
   * `createFileRef`'s own doc for why (only `scripts/pull-daily-logs.ts`
   * needs this today). */
  id?: string;
}): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();

  // Inherit the root key from the parent folder when not given explicitly,
  // so every folder carries its Vault Root subtree key (see vaultRoots.ts).
  let rootKey = data.vault_root_key ?? null;
  if (!rootKey && data.parent_folder_id) {
    rootKey = await resolveVaultRootKey(data.parent_folder_id);
  }

  // Same denormalize-for-O(1)-reads trick as vault_root_key, one level
  // deeper: either this folder itself DEFINES a type, or it inherits
  // whatever type (if any) its parent folder already carries.
  let folderType: VaultFolderTypeKey | null = null;
  let isFolderTypeRoot = false;
  let parent: VaultFolder | undefined;
  if (data.parent_folder_id) {
    parent = await getFolderById(data.parent_folder_id);
  }
  if (data.folder_type) {
    folderType = data.folder_type;
    isFolderTypeRoot = true;
  } else if (parent) {
    folderType = parent.folder_type ?? null;
  }

  // A direct child of the `projects` root IS a project — defaults to
  // `project-n02` (forced here, not just in the "New folder" API route, so
  // it's true regardless of caller) unless the caller explicitly passed a
  // different `folder_type` — e.g. `scripts/pull-daily-logs.ts` mirroring a
  // REMOTE project's own real current type. (PhyLog/`project-n01` has been
  // fully retired — every project is `project-n02` now.)
  const isNewProject = !!parent && !parent.parent_folder_id && parent.vault_root_key === "projects";
  if (isNewProject && !data.folder_type) {
    folderType = "project-n02";
    isFolderTypeRoot = true;
  }

  // Same inherit-from-parent trick as vault_root_key/folder_type: a new
  // folder is invisible to anyone the PARENT is shared with unless it
  // starts out with the same shared_with cache — otherwise it silently
  // vanishes from a shared project until the next time sharing is
  // re-saved (which re-cascades to every descendant, see
  // `cascadeShareVaultFolder`).
  const sharedWith = data.shared_with ?? parent?.shared_with ?? [];

  const result = await upsert(data.id ? new RecordId("vault_folders", data.id) : "vault_folders", {
    human_id: data.human_id,
    name: data.name,
    parent_folder_id: data.parent_folder_id ?? null,
    shared_with: sharedWith,
    vault_root_key: rootKey,
    folder_type: folderType,
    is_folder_type_root: isFolderTypeRoot,
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  const folder = record ? formatRecord(record as unknown as VaultFolder) : undefined;

  // Seed the new project's default skills/KNOWLEDGE.md, GRAPH.md,
  // GRAPH_STRUCTURE.md, PROJECT_VIEW.md (`projectN02.server` itself calls
  // back into this function to create that Skills folder — see the import
  // comment above). Gated on the folder's ACTUAL resulting type, not just
  // `isNewProject`.
  if (folder && folder.folder_type === "project-n02" && folder.is_folder_type_root) {
    await ensureProjectN02(folder);
  }
  // Same idea, for a `website` project's own scaffolding (README.md +
  // _site-settings.json) — see `website.server.ts`.
  if (folder && folder.folder_type === "website" && folder.is_folder_type_root) {
    await applyWebsiteShape(folder);
  }

  return folder;
}

/**
 * Validates that `folderType` may be created as a NEW folder directly
 * inside `parent` — the server-side gate behind the "New folder" type
 * picker (see the vault skill). Returns an error string (safe to surface
 * to the human, e.g. in a 4xx response) or null when the creation is OK.
 * Purely a context/singleton check — write-permission (`skills` requiring
 * Admin/Super) is separate, see `canWriteToFolderType`.
 *
 *  - Space types (`skills`, `syncs`): only directly inside a project folder
 *    (a direct child of the `projects` root) or directly inside the
 *    `personal` root itself — and only ONE of each per parent (checked
 *    against the parent's own DIRECT children only, not the whole
 *    subtree — a nested folder inheriting the same type doesn't count).
 *  - Sync types (`sync-one-way`, …): only directly inside a folder whose
 *    OWN `folder_type` is exactly `"syncs"` (not nested any deeper), and
 *    NOT singleton — a `syncs` folder can hold many connectors.
 *  - Container types (`website` — `project-n02` is never passed here, it's
 *    always stamped automatically): only directly inside the `projects`
 *    root itself, not singleton (any number of `website` projects may
 *    exist side by side), and additionally gated by `creatableBy`
 *    (`canCreateFolderType`) — the one case where CREATING a folder of a
 *    given type needs more than context/singleton checks.
 */
export async function validateFolderTypeForParent(
  parent: VaultFolder,
  folderType: VaultFolderTypeKey,
  actingRole: Role,
): Promise<string | null> {
  if (isContainerFolderTypeKey(folderType)) {
    const def = CONTAINER_FOLDER_TYPES[folderType];
    if (!canCreateFolderType(folderType, actingRole)) {
      return `Only a ${def.creatableBy} may create a ${def.label} folder`;
    }
    const isProjectsRoot = !parent.parent_folder_id && parent.vault_root_key === "projects";
    if (!isProjectsRoot) {
      return `${def.label} folders can only be created directly inside Projects`;
    }
    return null;
  }

  if (isSpaceFolderTypeKey(folderType)) {
    const def = SPACE_FOLDER_TYPES[folderType];

    // Every project and `personal` is itself tagged `project-n02` (see
    // `ensureProjectN02`, the `graphlog` skill) — a space type may only be
    // created directly inside one, never nested any deeper.
    const isProjectContainer = parent.folder_type === "project-n02" && parent.is_folder_type_root;
    if (!isProjectContainer) {
      return `${def.label} folders can only be created directly inside a project or your Personal space`;
    }

    if (def.comingSoon) {
      return `${def.label} isn't available yet`;
    }

    const { folders: siblings } = await listFolderChildren(
      parent.human_id,
      parent._id,
    );
    if (siblings.some((f) => f.is_folder_type_root && f.folder_type === folderType)) {
      return `A ${def.label} folder already exists here`;
    }
    return null;
  }

  if (isSyncFolderTypeKey(folderType)) {
    if (parent.folder_type !== "syncs" || !parent.is_folder_type_root) {
      return "Sync folders can only be created directly inside a Syncs folder";
    }
    if (SYNC_FOLDER_TYPES[folderType].comingSoon) {
      return `${SYNC_FOLDER_TYPES[folderType].label} isn't available yet`;
    }
    return null;
  }

  return "Unknown folder type";
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

/** Batch form of `getFolderById` — ONE round trip for many ids, instead of
 * one round trip PER id in a loop (the exact N+1 shape `getDailyLogCards`
 * used to have, resolving each card's project name one at a time). Mirrors
 * `humans.server.ts`'s `getHumansById`. */
export async function getFoldersByIds(ids: string[]): Promise<VaultFolder[]> {
  if (!ids.length) return [];
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE id IN $ids`,
    { ids: ids.map((id) => new RecordId("vault_folders", id)) },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getSharedFoldersForHuman(
  humanId: string,
): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id != $humanId
       AND $humanId IN shared_with
     ORDER BY human_id, name ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/**
 * Top-level shared folders visible to `humanId` — the entry points the
 * Vault sidebar's "Shared with me" section renders. `getSharedFoldersForHuman`
 * returns the ENTIRE shared subtree (sharing cascades `shared_with` onto
 * every descendant at share-time), so this filters that flat list down to
 * folders whose parent isn't itself in the set — i.e. the folder that was
 * actually shared, not one of its descendants (which will render nested
 * under it via the normal folder-tree machinery once its folder skeleton
 * is merged in).
 */
export async function getTopLevelSharedFolders(
  humanId: string,
): Promise<VaultFolder[]> {
  const shared = await getSharedFoldersForHuman(humanId);
  const sharedIds = new Set(shared.map((f) => f._id));
  return shared.filter(
    (f) => !f.parent_folder_id || !sharedIds.has(f.parent_folder_id),
  );
}

export async function updateVaultFolder(
  id: string,
  updates: Partial<{
    name: string;
    shared_with: string[];
    is_public: boolean;
    /** See `projectStatus.server.ts`'s `setProjectStatus` — the only
     * intended writer of these two. */
    project_status: string | null;
    project_status_at: string | null;
  }>,
): Promise<VaultFolder | undefined> {
  const result = await merge("vault_folders", id, {
    ...(updates as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  });
  const updated = result ? formatRecord(result as unknown as VaultFolder) : undefined;
  if (updated && updates.name !== undefined) {
    // File Referencing & Renaming: a folder rename changes the computed
    // mention path of itself AND every descendant folder/file, not just
    // its own name.
    await propagateTargetChange(await collectFolderAndDescendantTargets(id));
  }
  return updated;
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
  shared_with: string[],
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
/**
 * A DETERMINISTIC id for a folder in the system-managed tree
 * `getOrCreateVaultFolder` owns (today: the daily-logs root + its
 * per-date subfolders — see every call site's `name`, always either the
 * literal `"daily-logs"` or a `YYYY-MM-DD` string, never arbitrary user
 * input). Mirrors `dailyLog.server.ts`'s own `logRecordId` pattern for
 * exactly the same reason: a plain "SELECT, then CREATE if missing" check
 * (below) is NOT atomic — two concurrent calls for the SAME conceptual
 * folder (e.g. an upload request and a Card-creation request landing at
 * the same moment) can both miss the SELECT and both create one, leaving
 * REAL, silently duplicate folders behind (confirmed directly against a
 * dev database: multiple "daily-logs" roots, and multiple same-date
 * subfolders, for the same human). Once that happens, later
 * `getOrCreateVaultFolder` calls can non-deterministically resolve to
 * WHICHEVER duplicate a bare `LIMIT 1` (no `ORDER BY`) happens to return,
 * so a file created via one duplicate can become permanently invisible
 * to a later request (e.g. a page reload) that resolves to a different
 * one — this is exactly what caused a freshly-added Daily Log Card to
 * work within the session that created it, then get stuck on "Loading
 * card…" forever after a reload. Using this id with `upsert` (an atomic,
 * single statement at the database level) makes creating the "same"
 * folder twice a no-op rather than a duplicate, closing the race
 * entirely, regardless of how many requests race for it. */
export function systemVaultFolderKey(
  humanId: string,
  name: string,
  parentFolderId: string | null,
): string {
  return `${humanId}_${parentFolderId ?? "root"}_${name}`;
}

export async function getOrCreateVaultFolder(
  humanId: string,
  name: string,
  parentFolderId: string | null = null,
): Promise<VaultFolder> {
  // `ORDER BY created_at ASC` is a deliberate, defensive belt-and-suspenders
  // measure alongside `systemVaultFolderKey` above: it doesn't fix any
  // ALREADY-existing duplicate rows (see that migration, if one has been
  // run), but it guarantees that if duplicates from a past race are still
  // sitting in the database, every caller converges on picking the SAME
  // one (the oldest) instead of a `LIMIT 1` with no explicit order
  // returning a non-deterministic pick per call.
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId
       AND name = $name
       AND parent_folder_id = $parentFolderId
     ORDER BY created_at ASC
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
    // See `systemVaultFolderKey`'s own header — this is what actually
    // closes the race, not just a nicer-looking id.
    id: systemVaultFolderKey(humanId, name, parentFolderId),
  });
  if (!created) throw new Error(`Failed to create vault folder: ${name}`);
  return created;
}

/**
 * File metadata (no content) for every file in the given folders — the
 * manifest half of sync. One query regardless of tree size.
 */
export async function listFilesMetaByFolderIds(
  humanId: string,
  folderIds: string[],
): Promise<FileRefListing[]> {
  if (!folderIds.length) return [];
  const result = await query<[FileRef[]]>(
    `SELECT id, human_id, name, content_type, content_hash, folder_id,
            size, source, date, created_at, updated_at, archived_at,
            (s3_key != NONE AND s3_key != null) AS has_s3
     FROM file_refs
     WHERE human_id = $humanId AND folder_id IN $folderIds
     ORDER BY name ASC`,
    { humanId, folderIds },
  );
  return (result?.[0] ?? []).map(formatRecord) as unknown as FileRefListing[];
}

/**
 * File metadata (no content) for EVERY file the human owns, across their
 * entire vault, in one query — the bulk warm-up `GET /api/vault/all-files`
 * uses to pre-fill the Vault page's per-folder children cache for every
 * folder at once right after the page mounts, instead of each folder only
 * fetching its own files the first time it's expanded. Same shape/behavior
 * as `listFolderChildren`'s own file query (no `archived_at` filtering —
 * callers that care already filter it themselves, e.g. the sync manifest).
 */
export async function getAllFileListingsForHuman(
  humanId: string,
): Promise<FileRefListing[]> {
  const result = await query<[FileRef[]]>(
    `SELECT id, human_id, name, content_type, content_hash, folder_id,
            size, source, date, created_at, updated_at, archived_at,
            (s3_key != NONE AND s3_key != null) AS has_s3
     FROM file_refs
     WHERE human_id = $humanId
     ORDER BY name ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord) as unknown as FileRefListing[];
}

/**
 * Resolves the nearest "published" folder in `folderId`'s own chain —
 * itself or an ancestor with `is_public === true`. Returns null when
 * nothing in the chain is published.
 *
 * Deliberately dynamic rather than cascaded onto descendants at publish
 * time (unlike `shared_with`): a published sync folder keeps publishing
 * new files/sub-folders added long after the Publish action, with nothing
 * to re-cascade.
 */
export async function resolvePublicRootFolder(
  folderId: string,
): Promise<VaultFolder | null> {
  let currentId: string | null = folderId;
  for (let depth = 0; currentId && depth < 50; depth++) {
    const folder: VaultFolder | undefined = await getFolderById(currentId);
    if (!folder) return null;
    if (folder.is_public === true) return folder;
    currentId = folder.parent_folder_id;
  }
  return null;
}

/**
 * Whether a file is publicly viewable — either it was published
 * individually (`is_public`, the original single-card feature), or it sits
 * inside a published folder subtree.
 */
export async function isFileEffectivelyPublic(file: FileRef): Promise<boolean> {
  if (file.is_public === true) return true;
  if (!file.folder_id) return false;
  return (await resolvePublicRootFolder(file.folder_id)) !== null;
}

/**
 * Whether a folder sits inside a `syncs` folder-type subtree (the `syncs`
 * container itself, or any sync connector folder living inside one, at any
 * depth) — the resource check for sync-scoped tokens. Fails closed on
 * missing folders. `folder_type` is denormalized onto every descendant
 * (see vaultFolderTypes.ts / createVaultFolder), so this is a single read.
 */
export async function isFolderUnderSyncs(
  folderId: string | null | undefined,
): Promise<boolean> {
  if (!folderId) return false;
  const folder = await getFolderById(folderId);
  return isSyncFamilyFolderType(folder?.folder_type);
}

/**
 * Combined write-permission check for a folder id: the ROOT policy
 * (`canWriteToRoot`, vaultRoots.ts) AND the folder TYPE policy
 * (`canWriteToFolderType`, vaultFolderTypes.ts) must both allow it — e.g. a
 * `skills`-typed folder requires Admin/Super even though its containing
 * root (`projects`/`personal`) is ordinary `"owner"`-writable. A missing
 * folder id (root-level write) is treated as an ordinary, untyped folder.
 */
export async function canWriteToFolderId(
  folderId: string | null | undefined,
  role: Role,
): Promise<boolean> {
  if (!folderId) return canWriteToRoot(null, role);
  const folder = await getFolderById(folderId);
  const rootKey = folder?.vault_root_key ?? (await resolveVaultRootKey(folderId));
  return (
    canWriteToRoot(rootKey, role) &&
    canWriteToFolderType(folder?.folder_type ?? null, role)
  );
}

/** Combined shareable check for a folder id — root policy AND folder-type
 * policy must both allow it (see `isFolderTypeShareable`). */
export async function isFolderIdShareable(
  folderId: string | null | undefined,
): Promise<boolean> {
  if (!folderId) return false;
  const folder = await getFolderById(folderId);
  const rootKey = folder?.vault_root_key ?? (await resolveVaultRootKey(folderId));
  return (
    isRootShareable(rootKey) && isFolderTypeShareable(folder?.folder_type ?? null)
  );
}

/** Combined publishable check for a folder id — root policy AND folder-type
 * policy must both allow it (see `isFolderTypePublishable`). */
export async function isFolderIdPublishable(
  folderId: string | null | undefined,
): Promise<boolean> {
  if (!folderId) return false;
  const folder = await getFolderById(folderId);
  const rootKey = folder?.vault_root_key ?? (await resolveVaultRootKey(folderId));
  return (
    isRootPublishable(rootKey) &&
    isFolderTypePublishable(folder?.folder_type ?? null)
  );
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
 * Re-stamps `folder_type` across a subtree after a move, WITHOUT touching
 * anchors (folders where `is_folder_type_root` is true — e.g. a nested
 * `syncs` folder's own sync connectors): an anchor's type is sticky and
 * never overwritten by an ancestor moving, but its own descendants still
 * propagate ITS type downward (unaffected by the move, since the anchor
 * itself didn't change). Mirrors `moveVaultFolder`'s `vault_root_key`
 * cascade, one level deeper, and is why folder-type anchors can safely ride
 * along inside a moved subtree (e.g. moving a whole project) without
 * losing their own type.
 */
async function cascadeFolderType(
  folderId: string,
  inheritedType: VaultFolderTypeKey | null,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE parent_folder_id = $folderId`,
    { folderId },
  );
  for (const child of (result?.[0] ?? []).map(formatRecord)) {
    if (child.is_folder_type_root) {
      // Sticky — keeps its own explicit type; still propagates THAT type
      // (unchanged) into its own descendants.
      await cascadeFolderType(child._id, child.folder_type ?? null);
      continue;
    }
    if (child.folder_type !== inheritedType) {
      await merge("vault_folders", child._id, {
        folder_type: inheritedType,
        updated_at: now,
      });
    }
    await cascadeFolderType(child._id, inheritedType);
  }
}

/**
 * Re-parents a folder under `newParent`, re-stamping `vault_root_key` AND
 * `folder_type` on the folder and every descendant (moves may cross root
 * subtrees, e.g. personal → projects, or move a folder into/out of a
 * `skills`/`syncs` subtree).
 *
 * A folder-type ANCHOR's own `folder_type` is sticky — never overwritten by
 * the new parent's type (see `cascadeFolderType`); an ordinary folder
 * inherits the new parent's type, same as it would inherit at create time.
 *
 * Mechanical only — callers are responsible for policy checks (ownership,
 * root containers, shared folders, cycles, and — for a folder-type anchor
 * being moved directly — that anchors aren't movable at all, see the vault
 * skill).
 */
export async function moveVaultFolder(
  folder: VaultFolder,
  newParent: VaultFolder,
  descendants?: VaultFolder[],
): Promise<VaultFolder | undefined> {
  const now = new Date().toISOString();
  const newKey =
    newParent.vault_root_key ?? (await resolveVaultRootKey(newParent._id));
  const newFolderType = folder.is_folder_type_root
    ? (folder.folder_type ?? null)
    : (newParent.folder_type ?? null);

  const updated = await merge("vault_folders", folder._id, {
    parent_folder_id: newParent._id,
    vault_root_key: newKey,
    folder_type: newFolderType,
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

  await cascadeFolderType(folder._id, newFolderType);

  const result = updated ? formatRecord(updated as unknown as VaultFolder) : undefined;
  if (result) {
    // File Referencing & Renaming: a move changes the computed mention
    // path of the folder AND every descendant just as much as a rename
    // does — same propagation call, see `updateVaultFolder` above.
    await propagateTargetChange(await collectFolderAndDescendantTargets(folder._id));
  }
  return result;
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
    // Same check-then-create race `getOrCreateVaultFolder` above documents
    // in full — and the same fix: `ORDER BY` for a stable pick among any
    // ALREADY-existing duplicates, plus a deterministic `id` (below) so a
    // race can never produce a NEW one going forward.
    const result = await query<[VaultFolder[]]>(
      `SELECT * FROM vault_folders
       WHERE human_id = $humanId
         AND parent_folder_id = null
         AND name = $name
       ORDER BY created_at ASC
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

    // `daily-logs` is being retired as an auto-provisioned root — see
    // `resolveDailyLogsFolder`'s own doc (the `graphlog` skill's "Daily
    // Logs symlink" section). A human who already has one gets it
    // backfilled (above) or migrated (by `resolveDailyLogsFolder`);
    // nobody — new or already-migrated — gets a fresh EMPTY one created
    // here anymore. Without this, a migrated human would get one silently
    // resurrected the very next time this function runs (e.g. their next
    // page load), since by then no root-level folder named "daily-logs"
    // exists for this check to find.
    if (key === "daily-logs") continue;

    const created = await createVaultFolder({
      human_id: humanId,
      name: key,
      parent_folder_id: null,
      vault_root_key: key,
      id: systemVaultFolderKey(humanId, key, null),
    });
    if (!created) throw new Error(`Failed to create vault root folder: ${key}`);
    roots.push(created);
  }

  // The `personal` root is itself a `project-n02` container (see the
  // vault skill) — stamp + seed it here, self-healing for any vault that
  // predates this type, same convention as the `vault_root_key` backfill
  // above (see the top-of-file import comment for why a static import
  // of `projectN02.server`'s mutual dependency on this file is safe).
  const personalIndex = roots.findIndex((r) => r.vault_root_key === "personal");
  if (personalIndex !== -1) {
    roots[personalIndex] = await ensureProjectN02(roots[personalIndex]);
  }

  return roots;
}

// Same literal `dailyLogSync.server.ts`'s `DAILY_LOGS_SYNC_FOLDER_NAME`
// uses for every OTHER project's synced-in copy of a Card — duplicated
// here (not imported) to avoid a circular import (`dailyLogSync.server.ts`
// already imports FROM this file). Both names must stay "Daily Logs" if
// either ever changes.
const PERSONAL_DAILY_LOGS_FOLDER_NAME = "Daily Logs";

/** Recursively merges every child of `source` into `dest` (both already-
 * existing folders) — the self-healing path `resolveDailyLogsFolder` uses
 * to recover from its own now-fixed bug (see that function's own doc). A
 * same-named child FOLDER (e.g. the same date, present in both because
 * saves landed in both places for a while) merges recursively, then the
 * now-empty source-side folder is deleted by the caller. A same-named
 * child FILE is kept alongside its sibling via the same auto-dedupe
 * suffix `copyFileIntoFolder` uses (`Name (2).ext`) — favors never
 * silently losing either file over a perfectly clean result; a human can
 * manually reconcile an actual duplicate pair afterward. `source` itself
 * is left empty, never deleted here — callers decide that. */
async function mergeFolderContentsInto(source: VaultFolder, dest: VaultFolder): Promise<void> {
  const { files: sourceFiles, folders: sourceFolders } = await listFolderChildren(
    source.human_id,
    source._id,
  );
  const { files: destFilesInitial } = await listFolderChildren(dest.human_id, dest._id);
  const destNames = new Set(destFilesInitial.map((f) => f.name));

  for (const file of sourceFiles) {
    let name = file.name;
    if (destNames.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (destNames.has(`${base} (${n})${ext}`)) n++;
      name = `${base} (${n})${ext}`;
    }
    await updateFileRef(file._id, name === file.name ? { folder_id: dest._id } : { folder_id: dest._id, name });
    destNames.add(name);
  }

  const { folders: destFoldersFresh } = await listFolderChildren(dest.human_id, dest._id);
  for (const sub of sourceFolders) {
    const matching = destFoldersFresh.find((f) => f.name === sub.name);
    if (matching) {
      await mergeFolderContentsInto(sub, matching);
      await deleteVaultFolderCascade(sub._id);
    } else {
      await moveVaultFolder(sub, dest);
    }
  }
}

/**
 * Resolves the human's own daily-log storage folder — see the `graphlog`
 * skill's "Daily Logs symlink" section for the full design. Canonically
 * `personal/syncs/Daily Logs` going forward, replacing the old vault-wide
 * `daily-logs` ROOT (see `VAULT_ROOTS`) as the actual place reads/writes
 * happen; the root entry itself becomes a plain UI shortcut into this
 * folder (not yet wired up on the client — see the skill's Build status).
 *
 * A human who still has the legacy root (anyone who used Nopal before this
 * shipped) has it MOVED here the first time this runs for them —
 * re-parented via `moveVaultFolder`, never recreated, so every file's own
 * id (a day's `readme.md`, a Card, an attachment) and every date
 * subfolder's own id survives completely unchanged; only
 * `parent_folder_id`/`vault_root_key`/`folder_type`/`name` change. This is
 * what keeps `::card{file="..."}` references, the `daily_logs` cache table
 * (keyed by humanId+date, never by folder path), and anything else
 * addressed by fileId working with no separate content migration needed.
 *
 * Idempotent and safe to call from every daily-log read/write path
 * (`getDailyLogFolderAndReadmeId`/`getDailyLogCards`/`createDailyLogCard`/
 * `workableSaveDailyLog` in `dailyLog.server.ts`, `upsertDailyLogReadme`
 * below, and the daily-log upload routes) — an already-migrated human
 * gets a fast "already there" lookup; a legacy human gets migrated exactly
 * once, the first time any of those paths runs for them after this ships.
 * `ensureVaultRootFolders`'s own "daily-logs" special case (above) is what
 * keeps a migrated human's old root from being silently resurrected on
 * their very next page load.
 *
 * **The legacy root's own EXISTENCE is checked FIRST, always** — a REAL,
 * CONFIRMED bug (found via real local-dev usage, not just review) had
 * this backwards: checking "does a `Daily Logs` destination already
 * exist" before ever looking for the legacy root meant that once ANY
 * folder happened to be created at that destination — including from the
 * exact race the previous version of this doc called "theoretical,
 * accepted" — the real legacy root became PERMANENTLY invisible to every
 * later call, silently orphaning a human's entire daily-log history
 * (confirmed: real `readme.md`/Card files sitting under the untouched
 * legacy root while new saves kept landing in a freshly-created, mostly-
 * empty folder next to it). That's a materially worse outcome than the
 * cosmetic duplicate-folder race `getOrCreateVaultFolder` accepts, so it
 * doesn't get the same "accepted" treatment here — fixed by always
 * resolving the legacy root FIRST, and self-healing an already-bad state
 * (a destination that got created before its own legacy root was ever
 * found) by MERGING the legacy root's real content into it
 * (`mergeFolderContentsInto`) rather than leaving either one stale.
 */
export async function resolveDailyLogsFolder(humanId: string): Promise<VaultFolder> {
  const roots = await ensureVaultRootFolders(humanId);
  const personal = roots.find((r) => r.vault_root_key === "personal");
  if (!personal) throw new Error(`No personal root found for human ${humanId}`);

  const { folders: personalChildren } = await listFolderChildren(humanId, personal._id);
  // Oldest-first + a deterministic `id` on create — the exact same
  // check-then-create race `ensureProjectN02`'s Skills-folder bug had (see
  // the `graphlog` skill), confirmed to have produced real duplicate
  // "Daily Logs" folders here too (this function's own destination-folder
  // create below had the identical gap).
  let syncsFolder: VaultFolder | undefined = personalChildren
    .filter((f) => f.is_folder_type_root && f.folder_type === "syncs")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!syncsFolder) {
    syncsFolder = await createVaultFolder({
      human_id: humanId,
      name: "Syncs",
      parent_folder_id: personal._id,
      folder_type: "syncs",
      id: systemVaultFolderKey(humanId, "Syncs", personal._id),
    });
  }
  if (!syncsFolder) throw new Error("Failed to create personal's syncs folder");

  const legacyResult = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId AND parent_folder_id = null AND vault_root_key = $key
     ORDER BY created_at ASC
     LIMIT 1`,
    { humanId, key: "daily-logs" },
  );
  const legacyRoot = legacyResult?.[0]?.[0] ? formatRecord(legacyResult[0][0]) : null;

  const { folders: syncsChildren } = await listFolderChildren(humanId, syncsFolder._id);
  // Oldest-first for the same reason as `syncsFolder` above — if a past
  // race already left more than one "Daily Logs" folder here, always
  // converge on the same (oldest) one rather than a non-deterministic
  // pick; run `scripts/migrate-merge-duplicate-vault-folders.ts` to fold
  // any leftover duplicates' real content back together.
  const existingDestination = syncsChildren
    .filter((f) => f.name === PERSONAL_DAILY_LOGS_FOLDER_NAME)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  if (legacyRoot) {
    if (existingDestination) {
      // Self-healing path: a destination already exists (an earlier,
      // buggy/raced run) -- merge the legacy root's real content into it
      // rather than trying to move/rename the legacy root itself (which
      // would collide with it).
      await mergeFolderContentsInto(legacyRoot, existingDestination);
      await deleteVaultFolderCascade(legacyRoot._id);
      return existingDestination;
    }
    const moved = await moveVaultFolder(legacyRoot, syncsFolder);
    if (!moved) throw new Error("Failed to migrate the legacy daily-logs root");
    const renamed = await merge("vault_folders", moved._id, {
      name: PERSONAL_DAILY_LOGS_FOLDER_NAME,
      updated_at: new Date().toISOString(),
    });
    return renamed ? formatRecord(renamed as unknown as VaultFolder) : moved;
  }

  if (existingDestination) return existingDestination;

  const created = await createVaultFolder({
    human_id: humanId,
    name: PERSONAL_DAILY_LOGS_FOLDER_NAME,
    parent_folder_id: syncsFolder._id,
    id: systemVaultFolderKey(humanId, PERSONAL_DAILY_LOGS_FOLDER_NAME, syncsFolder._id),
  });
  if (!created) throw new Error("Failed to create personal's syncs/Daily Logs folder");
  return created;
}

/**
 * Every project (a direct child folder of the `projects` vault root) the
 * human owns — the simple, folder-name-is-the-project-name notion the
 * `vault` skill describes, deliberately NOT the heavier `resolveProjectManifest`
 * machinery in `project.server.ts` (which additionally resolves directive-
 * referenced files/folders and exists for the project detail PAGE, not for
 * "what projects exist at all"). Scoped to the human's OWN projects only
 * — see `getAccessibleProjectFolders` below for the superset (also
 * including projects shared with them) that the Daily Log's Card feature
 * actually targets.
 */
export async function getProjectFolders(humanId: string): Promise<VaultFolder[]> {
  const roots = await ensureVaultRootFolders(humanId);
  const projectsRoot = roots.find((r) => r.vault_root_key === "projects");
  if (!projectsRoot) return [];
  const { folders } = await listFolderChildren(humanId, projectsRoot._id);

  // Self-healing retrofit for any project created before `project-n02`
  // existed — same lazy-backfill convention as the root keys above. Only
  // an UNTYPED folder gets force-converted: a folder already carrying a
  // different recognized container type (e.g. `website`) is left alone,
  // or this would silently clobber it back into a GraphLog-managed
  // project-n02 shape the next time this ran (e.g. every dashboard load).
  return Promise.all(
    folders.map((f) =>
      isContainerFolderTypeKey(f.folder_type) && f.is_folder_type_root
        ? f
        : ensureProjectN02(f),
    ),
  );
}

/**
 * Every project folder `humanId` can target for a daily-log Card — their
 * OWN projects, plus any project someone else has shared a Sharing Role
 * with them on (see `projectSharing.server.ts`). Cards are the one place
 * this app lets ANY role (including Observer) "contribute" to a project it
 * doesn't own — see the vault skill's Daily Log/Cards section.
 *
 * `getTopLevelSharedFolders` already returns exactly the top of each
 * shared subtree (a folder whose parent isn't itself shared) — since a
 * project is only ever shared as a whole via `setProjectSharing` (never a
 * nested subfolder individually), that top is always the project folder
 * itself; the `vault_root_key === "projects"` filter is just defensive
 * (excludes anything unexpected, e.g. a future shareable root).
 */
export async function getAccessibleProjectFolders(
  humanId: string,
): Promise<VaultFolder[]> {
  const [owned, sharedTop] = await Promise.all([
    getProjectFolders(humanId),
    getTopLevelSharedFolders(humanId),
  ]);
  const sharedProjects = sharedTop.filter((f) => f.vault_root_key === "projects");
  return [...owned, ...sharedProjects];
}

/** Finds a folder's own `README.md` (case-insensitive), owned by `ownerId`
 * — the shared lookup `projectSharing.server.ts` and `phylogAgent.server.ts`
 * both need (a project's manifest/sharing YAML, or its content for the
 * PhyLog agent to read/propose edits to). `null` when the folder has no
 * README yet. */
export async function getReadmeFileForFolder(
  ownerId: string,
  folderId: string,
): Promise<FileRef | null> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs WHERE human_id = $ownerId AND folder_id = $folderId`,
    { ownerId, folderId },
  );
  const files = (result?.[0] ?? []).map(formatRecord);
  return files.find((f) => f.name.toLowerCase() === "readme.md") ?? null;
}

/**
 * Copies a file's REFERENCE (never its bytes) into another folder — a new
 * `file_refs` row pointing at the exact same `s3_key`/`s3_url`, so nothing
 * is ever duplicated in S3. This is PhyLog's "a Card's file attachment
 * gets added to the project" operation (see the `vault` skill's Release
 * Log section / `sorter.server.ts`), but is a generic vault primitive, not
 * Sorter-specific — the source and destination don't have to belong to
 * the same human (the new row always belongs to the DESTINATION folder's
 * own owner, same convention `createVaultFolder`/`createFileRef` already
 * use elsewhere).
 *
 * Auto-dedupes the destination name (`Name (2).ext`, `Name (3).ext`, ...)
 * rather than silently overwriting or erroring on a collision, matching
 * the existing skip-and-warn convention `fruits_.vault.tsx`'s own upload
 * flow already uses for name clashes.
 */
export async function copyFileIntoFolder(
  sourceFileId: string,
  destFolderId: string,
): Promise<FileRef | undefined> {
  const source = await getFileRefById(sourceFileId);
  if (!source) return undefined;
  const destFolder = await getFolderById(destFolderId);
  if (!destFolder) return undefined;

  const { files: existing } = await listFolderChildren(destFolder.human_id, destFolderId);
  const existingNames = new Set(existing.map((f) => f.name));
  let name = source.name;
  if (existingNames.has(name)) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let n = 2;
    while (existingNames.has(`${base} (${n})${ext}`)) n++;
    name = `${base} (${n})${ext}`;
  }

  return createFileRef({
    human_id: destFolder.human_id,
    name,
    s3_url: source.s3_url,
    s3_key: source.s3_key,
    content: source.content,
    content_type: source.content_type,
    content_hash: source.content_hash,
    folder_id: destFolderId,
    size: source.size,
  });
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

/** The human's most recently updated top-level project folders (direct
 * children of the "projects" vault root) — the fallback `mentionSearch.
 * server.ts` uses for an empty `@` search when there's no selection
 * history yet. Excludes the "projects" root container itself. */
export async function getRecentProjectFolders(
  humanId: string,
  limit = 5,
): Promise<VaultFolder[]> {
  const rootResult = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId AND parent_folder_id = null AND vault_root_key = 'projects'
     LIMIT 1;`,
    { humanId },
  );
  const root = rootResult?.[0]?.[0] ? formatRecord(rootResult[0][0]) : null;
  if (!root) return [];

  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE human_id = $humanId AND parent_folder_id = $rootId
     ORDER BY updated_at DESC
     LIMIT $limit;`,
    { humanId, rootId: root._id, limit },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Builds a folder's full path as an array of names, root container →
 * … → the folder itself, WITHOUT any DB round-trips beyond the one that
 * already fetched every candidate folder — `foldersById` is expected to
 * already contain the human's entire folder set (see `searchVaultEntries`,
 * its one caller), so this is a pure in-memory parent-chain walk, not a
 * repeated `getFolderAncestry` per result. */
function buildFolderPathParts(
  folderId: string,
  foldersById: Map<string, VaultFolder>,
): string[] {
  const parts: string[] = [];
  let current = foldersById.get(folderId);
  for (let depth = 0; current && depth < 50; depth++) {
    parts.unshift(current.name);
    current = current.parent_folder_id
      ? foldersById.get(current.parent_folder_id)
      : undefined;
  }
  return parts;
}

export interface VaultSearchResult {
  name: string;
  /** Slash-joined path relative to the human's own vault root, e.g.
   * "projects/Casa Verde Remodel" — no leading slash, no human id (that
   * prefix is `mentionSearch.server.ts`'s job, not this function's). */
  path: string;
}

/** Searches a human's own folders and files by name — case-insensitive
 * substring match, ranked with prefix matches first (the same "starts
 * with the query wins" tiebreak the old `[[wiki-link]]` popover used).
 * Deliberately fetches the human's full folder/file set and filters/ranks
 * in memory rather than hand-writing SurrealQL string-matching — simpler,
 * and reuses `getFoldersByHuman`/`getFileRefsByHuman` (already real,
 * already correct) instead of a second, parallel query path. Fine at this
 * app's real scale; revisit if a human's vault ever gets large enough for
 * that to matter. */
export async function searchVaultEntries(
  humanId: string,
  searchQuery: string,
  limit = 8,
): Promise<VaultSearchResult[]> {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return [];

  const [folders, files] = await Promise.all([
    getFoldersByHuman(humanId),
    getFileRefsByHuman(humanId),
  ]);
  const foldersById = new Map(folders.map((f) => [f._id, f]));

  const matches: { name: string; path: string; startsWith: boolean }[] = [];

  for (const folder of folders) {
    // Root containers ("projects", "daily-logs", …) are organizational, not
    // real mentionable content.
    if (folder.parent_folder_id === null) continue;
    const lower = folder.name.toLowerCase();
    if (!lower.includes(q)) continue;
    matches.push({
      name: folder.name,
      path: buildFolderPathParts(folder._id, foldersById).join("/"),
      startsWith: lower.startsWith(q),
    });
  }

  for (const file of files) {
    if (file.archived_at) continue;
    const lower = file.name.toLowerCase();
    if (!lower.includes(q)) continue;
    const folderParts = file.folder_id
      ? buildFolderPathParts(file.folder_id, foldersById)
      : [];
    matches.push({
      name: file.name,
      path: [...folderParts, file.name].join("/"),
      startsWith: lower.startsWith(q),
    });
  }

  matches.sort((a, b) => Number(b.startsWith) - Number(a.startsWith));
  return matches.slice(0, limit).map(({ name, path }) => ({ name, path }));
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
          `SELECT id, human_id, name, content_type, content_hash, folder_id,
                  size, source, date, created_at, updated_at, archived_at,
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

  // File Referencing & Renaming: mark any dead mention pointing at each
  // about-to-be-deleted folder BEFORE it (and its name) are gone —
  // deliberately fetched up front, not interleaved with the deletes below.
  const foldersById = new Map(
    (await Promise.all(allFolderIds.map((fid) => getFolderById(fid))))
      .filter((f): f is VaultFolder => !!f)
      .map((f) => [f._id, f] as const),
  );

  for (const fid of allFolderIds) {
    const filesResult = await query<[FileRef[]]>(
      `SELECT * FROM file_refs WHERE folder_id = $fid`,
      { fid },
    );
    const files = (filesResult?.[0] ?? []).map(formatRecord);
    for (const file of files) {
      // `deleteFileRef` itself already calls `propagateTargetDeletion` for
      // each file, so cascade-deleted files are covered without any extra
      // work here.
      await deleteFileRef(file._id);
    }
  }

  for (const fid of allFolderIds) {
    // A folder is only ever a reference TARGET, never a source (only file
    // content can contain a reference) — no outgoing rows to clean up here.
    const name = foldersById.get(fid)?.name ?? fid;
    await propagateTargetDeletion({ type: "folder", id: fid }, name);
    await remove("vault_folders", fid);
  }
}

// ─── New-user vault provisioning ───────────────────────────────────────────────────

/**
 * Upserts the `readme.md` vault file for a given daily-log date.
 *
 * Folder structure created on-demand:
 *   personal/syncs/Daily Logs  (see `resolveDailyLogsFolder`)
 *     └── YYYY-MM-DD
 *           └── readme.md  (content_type text/markdown, source daily_log)
 *
 * On the same calendar day the content is overwritten in-place.
 * On subsequent days the old content is pushed to `md_versions` first
 * (same logic as computeMdUpdate - shouldn't normally happen because the
 * daily-log lock prevents editing past days, but it's handled gracefully).
 */
export async function upsertDailyLogReadme(
  humanId: string,
  dateStr: string, // YYYY-MM-DD
  content: string,
): Promise<FileRef | undefined> {
  try {
    // Ensure folder tree
    const rootFolder = await resolveDailyLogsFolder(humanId);
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
