import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getPresignedUploadUrl, getFileContentType } from "robustness-core/data/file.server";
import { getOrCreateVaultFolder, resolveDailyLogsFolder } from "robustness-core/data/vault.server";

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const {
    filename: rawName,
    contentType: rawContentType,
    source,
  } = (await request.json()) as {
    filename?: string;
    contentType?: string;
    source?: "daily_log";
  };

  if (!rawName) {
    return Response.json({ error: "filename is required" }, { status: 400 });
  }

  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const contentType = rawContentType ?? getFileContentType(safeName);

  // For daily-log uploads, organise under daily-logs/{YYYY-MM-DD}/ in S3
  // and auto-provision the matching vault folder tree.
  let s3Key: string;
  let folderId: string | undefined;

  if (source === "daily_log") {
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    s3Key = `daily-log/${user._id}/${dateStr}/${Date.now()}-${safeName}`;

    // Ensure  personal/syncs/Daily Logs  (see resolveDailyLogsFolder)  →  YYYY-MM-DD  (child)
    const rootFolder = await resolveDailyLogsFolder(user._id);
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
    const { presignedUrl, publicUrl } = await getPresignedUploadUrl(
      s3Key,
      contentType,
    );
    return Response.json({ presignedUrl, publicUrl, s3Key, folderId });
  } catch (err) {
    console.error("Presign error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Presign failed" },
      { status: 500 },
    );
  }
}
