import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { enqueueRenditionsJob } from "robustness-core/data/mediaQueue.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import {
  createFileRef,
  getOrCreateVaultFolder,
  resolveDailyLogsFolder,
} from "robustness-core/data/vault.server";

/**
 * POST /api/daily-log/upload
 *
 * Accepts multipart/form-data:
 *   file — the File to upload
 *   date — the daily log's YYYY-MM-DD (which day's vault folder to file it under)
 *
 * NOT the editor's real upload path anymore (2026-11-01) — this buffers
 * the whole file into memory TWICE (once parsing the multipart body,
 * again to hash it) with no size cap, which OOM-killed the 1 GB app
 * mid-request on a real video attachment; the browser only ever saw that
 * as a hung, response-less POST. `TodayLog.tsx`'s `uploadDailyLogFile`
 * now calls `POST /api/daily-log/upload-target` (just resolves the day's
 * folder) then uploads straight to S3 via `vaultUpload.ts`'s
 * `uploadToVaultFolder` instead — see the `oxmarkdown` skill. This route
 * is kept only because `scripts/campbell-walk.ts` still posts small
 * (few-byte) test fixtures through it; do not point any real editor path
 * at it again.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const date = String(form.get("date") ?? "");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid or missing date" }, { status: 400 });
  }

  const rootFolder = await resolveDailyLogsFolder(user._id);
  const dateFolder = await getOrCreateVaultFolder(user._id, date, rootFolder._id);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `vault/${user._id}/${dateFolder._id}/${Date.now()}-${safeName}`;

  try {
    const url = await uploadFileToS3(file, s3Key);

    // The multipart form is already buffered in memory, so hashing here
    // costs one pass over bytes we already hold — same basis for sync
    // diffing every other vault upload path uses.
    const contentHash = crypto
      .createHash("sha256")
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");

    const fileRef = await createFileRef({
      human_id: user._id,
      name: file.name,
      s3_url: url,
      s3_key: s3Key,
      content_type: file.type || "application/octet-stream",
      content_hash: contentHash,
      size: file.size,
      folder_id: dateFolder._id,
      source: "daily_log",
      date,
    });

    if (!fileRef) {
      return Response.json({ error: "Failed to create file record" }, { status: 500 });
    }

    // The worker makes the photo's thumbnail and display rendition (or a
    // video's poster) within seconds; this process never decodes media.
    // Best effort: a queue that is down loses nothing, since the next
    // GraphLog run backfills renditions from its own decode.
    if (fileRef.content_type.startsWith("image/") || fileRef.content_type.startsWith("video/")) {
      await enqueueRenditionsJob(fileRef._id).catch((err) => console.error("Could not enqueue renditions:", err));
    }

    return Response.json(
      { fileId: fileRef._id, contentType: fileRef.content_type },
      { status: 201 },
    );
  } catch (err) {
    console.error("Daily log file upload error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
