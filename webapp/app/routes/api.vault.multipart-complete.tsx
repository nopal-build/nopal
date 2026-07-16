import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { completeMultipartUpload } from "../data/file.server";
import { createFileRef } from "../data/vault.server";

/**
 * POST /api/vault/multipart-complete
 * Body (JSON): { uploadId, key, parts, name, folderId, contentType, size }
 * Returns: { url, fileRef }
 *
 * Completes the S3 multipart upload and registers the file_ref in the database.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user)
    return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as {
    uploadId?: string;
    key?: string;
    parts?: Array<{ PartNumber: number; ETag: string }>;
    name?: string;
    folderId?: string | null;
    contentType?: string;
    size?: number;
    /** Client-computed sha256 hex — the server never held the whole file,
     * so this is the only place the hash can come from. */
    contentHash?: string;
  };

  const { uploadId, key, parts, name, folderId, contentType, size, contentHash } =
    body;

  if (!uploadId || !key || !parts?.length || !name || !contentType) {
    return Response.json(
      {
        error:
          "uploadId, key, parts, name, and contentType are required",
      },
      { status: 400 },
    );
  }

  // Security: ensure the key belongs to this user
  if (!key.startsWith(`vault/${user._id}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const url = await completeMultipartUpload(key, uploadId, parts);

    const fileRef = await createFileRef({
      human_id: user._id,
      name,
      s3_url: url,
      s3_key: key,
      content_type: contentType,
      content_hash:
        contentHash && /^[0-9a-f]{64}$/.test(contentHash) ? contentHash : null,
      size: size ?? null,
      folder_id: folderId ?? null,
    });

    return Response.json({ url, fileRef }, { status: 201 });
  } catch (err) {
    console.error("Multipart complete error:", err);
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to complete upload",
      },
      { status: 500 },
    );
  }
}
