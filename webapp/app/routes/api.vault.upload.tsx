import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { uploadFileToS3 } from "../data/file.server";
import { createFileRef, isFolderUnderSyncs } from "../data/vault.server";

/**
 * POST /api/vault/upload
 *
 * Accepts multipart/form-data:
 *   file     — the File to upload
 *   folderId — (optional) vault folder _id to place the file in
 *
 * Uploads the file to S3 server-side (no browser→S3 CORS required) and
 * creates the corresponding file_ref record.
 */
export async function action({ request }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const folderId = (form.get("folderId") as string | null) || null;

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Sync-scoped tokens may only write inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(folderId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folderSegment = folderId ?? "root";
  const s3Key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;

  try {
    const url = await uploadFileToS3(file, s3Key);

    // The multipart form is already buffered in memory, so hashing here
    // costs one pass over bytes we already hold. Basis for sync diffing.
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
      folder_id: folderId,
    });

    return Response.json({ url, fileRef }, { status: 201 });
  } catch (err) {
    console.error("Vault upload error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
