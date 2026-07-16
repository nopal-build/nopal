import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { uploadFileToS3, deleteFromS3 } from "../data/file.server";
import { getFileRefById, computeMdUpdate } from "../data/vault.server";
import { isFileRefLocked } from "../data/vault.types";
import { merge } from "../data/generic.server";
import { cacheDailyLog } from "../data/dailyLog.server";

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
 *   - S3-backed files: uploads the new object, points the ref at it, then
 *     deletes the old object.
 *   - Markdown/text refs (content stored in the DB): the uploaded file's text
 *     becomes the new content, versioned through computeMdUpdate like every
 *     other markdown write.
 *
 * Owner-only. Locked daily-log files cannot be replaced.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

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
  if (existing.human_id !== user._id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
    // DB-content refs (markdown cards, etc.): replace the stored text.
    if (existing.content !== null && !existing.s3_key) {
      const text = await file.text();
      const { content, md_versions } = computeMdUpdate(existing, text);
      const updated = await merge("file_refs", fileId, {
        content,
        md_versions,
        size: file.size,
        updated_at: now,
      });
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
