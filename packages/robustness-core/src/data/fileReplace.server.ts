/**
 * Replacing a vault file's bytes in place: same `file_refs` row (so links,
 * shares and embeds keep working), new S3 object.
 *
 * Two routes do this. `api.vault.replace.$fileId` takes the whole file in
 * one body, which is fine up to the multipart threshold and fatal past it:
 * the app reads the body into memory, and a ~200 MB video re-encoded by
 * the CLI's sync took the process down (502; the same failure ADR-021
 * describes for media). `api.vault.multipart-init` / `-complete` with
 * `replaceFileId` are the chunked route for anything bigger. Both need the
 * same permission checks and the same repoint-and-clean-up, so they live
 * here once.
 */

import { enqueueRenditionsJob } from "./mediaQueue.server";
import { deleteFromS3 } from "./file.server";
import { merge } from "./generic.server";
import type { Role } from "./humans.server";
import { canActAsProjectOwner } from "./projectSharing.server";
import { canWriteToFolderId, explainWriteRefusal, isFolderUnderSyncs } from "./vault.server";
import { isFileRefLocked, type FileRef } from "./vault.types";

export type ReplaceRefusal = { status: 403; error: string };

/** The facts the decision needs, gathered by `fileReplaceRefusal`. */
export type ReplaceFacts = {
  /** Owner, or an owner-tier Sharing Role on the file's project. */
  actsAsOwner: boolean;
  /** The request came with a sync-scoped token (may only touch syncs/). */
  syncScoped: boolean;
  underSyncs: boolean;
  /** The folder's root/type policy allows writes for this role. */
  folderWritable: boolean;
  /** What to say when it doesn't. */
  writeRefusal: string;
  locked: boolean;
};

/**
 * The replace permission decision, in the order `api.vault.replace.$fileId`
 * has always applied it. Pure so it can be tested without a database.
 */
export function replaceRefusalFor(facts: ReplaceFacts): ReplaceRefusal | null {
  if (!facts.actsAsOwner) return { status: 403, error: "Forbidden" };
  if (facts.syncScoped && !facts.underSyncs) return { status: 403, error: "Forbidden" };
  if (!facts.folderWritable) return { status: 403, error: facts.writeRefusal };
  if (facts.locked) {
    return {
      status: 403,
      error: "This file is locked. Daily log files can only change on the day they were uploaded.",
    };
  }
  return null;
}

/** Gathers `ReplaceFacts` for `existing` and decides. */
export async function fileReplaceRefusal(
  acting: { user: { _id: string; role: Role }; syncScoped: boolean },
  existing: FileRef,
): Promise<ReplaceRefusal | null> {
  const folderWritable = await canWriteToFolderId(existing.folder_id, acting.user.role);
  return replaceRefusalFor({
    actsAsOwner: await canActAsProjectOwner(acting.user._id, existing.human_id, existing.folder_id),
    syncScoped: acting.syncScoped,
    underSyncs: acting.syncScoped ? await isFolderUnderSyncs(existing.folder_id) : true,
    folderWritable,
    writeRefusal: folderWritable ? "" : await explainWriteRefusal(existing.folder_id, acting.user.role),
    locked: isFileRefLocked(existing),
  });
}

export type NewObject = {
  s3Key: string;
  s3Url: string;
  contentType: string;
  /** sha256 hex, or null when nobody could compute it. */
  contentHash: string | null;
  size: number;
};

/**
 * Points `existing` at an object that is already in S3, asks the worker
 * for a fresh poster/rendition (the old one was keyed on the old s3_key),
 * then deletes the old object. Deleting is best-effort: the replace has
 * already succeeded by then, an orphaned object is only storage.
 */
export async function repointFileRef(
  existing: FileRef,
  next: NewObject,
): Promise<Awaited<ReturnType<typeof merge>>> {
  const updated = await merge("file_refs", existing._id, {
    s3_url: next.s3Url,
    s3_key: next.s3Key,
    content_type: next.contentType,
    content_hash: next.contentHash,
    size: next.size,
    updated_at: new Date().toISOString(),
  });

  if (updated && (next.contentType.startsWith("image/") || next.contentType.startsWith("video/"))) {
    await enqueueRenditionsJob(existing._id).catch((err) =>
      console.error("Could not enqueue renditions:", err),
    );
  }

  if (existing.s3_key && existing.s3_key !== next.s3Key) {
    try {
      await deleteFromS3(existing.s3_key);
    } catch (err) {
      console.error(`Failed to delete replaced S3 object ${existing.s3_key}:`, err);
    }
  }

  return updated;
}
