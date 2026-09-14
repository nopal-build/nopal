import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { uploadFileToS3, deleteFromS3 } from "robustness-core/data/file.server";
import {
  canWriteToFolderId,
  getFileRefById,
  computeMdUpdate,
  isFolderUnderSyncs,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { isFileRefLocked } from "robustness-core/data/vault.types";
import { merge } from "robustness-core/data/generic.server";
import { cacheDailyLog } from "robustness-core/data/dailyLog.server";

/**
 * POST /api/vault/replace/:fileId
 *
 * Replaces a file's content in place — same file_ref `_id`, new bytes — so
 * existing links, shares, and embeds keep working.
 *
 * Accepts multipart/form-data:
 *   file — the replacement File
 *
 * Behavior by file kind:
 *   - Markdown replacement file (by name/type, under 5MB -- same rule
 *     /api/vault/upload uses): the uploaded text becomes the ref's own
 *     content, versioned through computeMdUpdate like every other
 *     markdown write -- REGARDLESS of whether the file being replaced was
 *     already content-only or (self-healing) still S3-backed from before
 *     the upload route learned this, cleaning up the orphaned S3 object
 *     either way.
 *   - Any other replacement file: uploads the new object, points the ref
 *     at it, then deletes the old object.
 *
 * Owner-only. Locked daily-log files cannot be replaced.
 */
function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Same cap and check as /api/vault/upload -- see that route's own doc for
// why markdown files are stored as DB content, not S3 blobs.
const MAX_INLINE_MARKDOWN_BYTES = 5 * 1024 * 1024;

function isMarkdownUpload(file: File): boolean {
  return file.type === "text/markdown" || file.name.toLowerCase().endsWith(".md");
}

export async function action({ request, params }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const existing = await getFileRefById(fileId);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // An owner-tier project Sharing Role (Owner/Crafter) may replace a file
  // inside someone else's shared project exactly like its own owner could
  // — see `canActAsProjectOwner`.
  if (!(await canActAsProjectOwner(user._id, existing.human_id, existing.folder_id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // Sync-scoped tokens may only replace files inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(existing.folder_id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (!(await canWriteToFolderId(existing.folder_id, user.role))) {
    return Response.json(
      { error: "You don't have permission to modify this file" },
      { status: 403 },
    );
  }
  if (isFileRefLocked(existing)) {
    return Response.json(
      {
        error:
          "This file is locked — daily-log files can only be modified on the day they were uploaded.",
      },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const now = new Date().toISOString();

  try {
    // DB-content refs (markdown cards, skill files, etc.): replace the
    // stored text. Also takes over for a file that's markdown-shaped
    // NOW but was previously S3-backed (e.g. a skill file created before
    // /api/vault/upload learned to store markdown as content -- see that
    // route's own doc) -- self-heals it into content-only storage instead
    // of perpetuating the old, broken S3-blob-with-null-content shape.
    if (
      (existing.content !== null && !existing.s3_key) ||
      (isMarkdownUpload(file) && file.size <= MAX_INLINE_MARKDOWN_BYTES)
    ) {
      const text = await file.text();
      const { content, md_versions } = computeMdUpdate(existing, text);
      const updated = await merge("file_refs", fileId, {
        content,
        md_versions,
        content_hash: sha256(Buffer.from(content, "utf8")),
        content_type: "text/markdown",
        s3_key: null,
        s3_url: null,
        size: file.size,
        updated_at: now,
      });
      if (existing.s3_key) {
        // Switching a previously S3-backed file to content-only storage
        // above -- clean up the now-orphaned object.
        try {
          await deleteFromS3(existing.s3_key);
        } catch (err) {
          console.error(`Failed to delete replaced S3 object ${existing.s3_key}:`, err);
        }
      }
      if (existing.source === "daily_log" && existing.date) {
        await cacheDailyLog(existing.human_id, existing.date, content);
      }
      return Response.json({ fileRef: updated });
    }

    // S3-backed files: upload new bytes, repoint, then clean up the old key.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const folderSegment = existing.folder_id ?? "root";
    const s3Key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;
    const url = await uploadFileToS3(file, s3Key);

    const updated = await merge("file_refs", fileId, {
      s3_url: url,
      s3_key: s3Key,
      content_type: file.type || existing.content_type,
      content_hash: sha256(Buffer.from(await file.arrayBuffer())),
      size: file.size,
      updated_at: now,
    });

    if (existing.s3_key) {
      try {
        await deleteFromS3(existing.s3_key);
      } catch (err) {
        // Old object is orphaned but the replace succeeded — log and move on.
        console.error(`Failed to delete replaced S3 object ${existing.s3_key}:`, err);
      }
    }

    return Response.json({ fileRef: updated });
  } catch (err) {
    console.error("Vault replace error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Replace failed" },
      { status: 500 },
    );
  }
}
