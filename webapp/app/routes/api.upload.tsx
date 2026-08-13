import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { uploadFileToS3 } from "robustness-core/data/file.server";
import { createFileRef, getOrCreateVaultFolder } from "robustness-core/data/vault.server";

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const source = (form.get("source") as string | null) ?? null;

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  // For daily-log uploads: use a date-scoped S3 key and auto-provision the
  // matching vault folder tree (daily-logs / YYYY-MM-DD).
  let s3Key: string;
  let folderId: string | null = null;

  if (source === "daily_log") {
    const dateStr = new Date().toISOString().slice(0, 10);
    s3Key = `daily-log/${user._id}/${dateStr}/${Date.now()}-${safeName}`;

    const rootFolder = await getOrCreateVaultFolder(
      user._id,
      "daily-logs",
      null,
    );
    const dateFolder = await getOrCreateVaultFolder(
      user._id,
      dateStr,
      rootFolder._id,
    );
    folderId = dateFolder._id;
  } else {
    s3Key = `daily-log/${user._id}/${Date.now()}-${safeName}`;
  }

  try {
    const url = await uploadFileToS3(file, s3Key);

    const fileRef = await createFileRef({
      human_id: user._id,
      name: file.name,
      s3_url: url,
      s3_key: s3Key,
      content_type: file.type || "application/octet-stream",
      size: file.size,
      folder_id: folderId,
      ...(source === "daily_log" ? { source: "daily_log" as const } : {}),
    });

    // The upload is now stored privately — callers should link to
    // `/api/vault/view/:fileId` (which redirects to a fresh presigned URL
    // on every request) rather than using `url` directly.
    return Response.json({ url, s3Key, folderId, fileId: fileRef?._id });
  } catch (err) {
    console.error("S3 upload error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
