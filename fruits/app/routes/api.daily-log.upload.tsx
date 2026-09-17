import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
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
 * The `::file{...}` interactable's real upload path (see the `oxmarkdown`
 * skill and `oxmarkdown/fileDirective.ts`'s `UploadFileFn`) — deliberately
 * a SEPARATE, small endpoint from `/api/vault/upload` rather than teaching
 * that generic one about daily-log date folders: this one only resolves
 * WHICH folder a file lands in (get-or-create the day's own vault folder,
 * exactly the same tree `upsertDailyLogReadme`/`workableSaveDailyLog`
 * already write `readme.md` into), then does the identical upload +
 * `createFileRef` work `/api/vault/upload` does. Marks the file
 * `source: "daily_log"` / `date` — the same convention `isFileRefLocked`
 * already uses to lock a past day's uploads, so an attachment added
 * today automatically becomes read-only once the day is over, just like
 * the day's `readme.md` itself.
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
