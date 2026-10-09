import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { completeMultipartUpload } from "robustness-core/data/file.server";
import { createFileRef, explainWriteRefusal, getFileRefById, getFolderById, isFolderUnderSyncs, canWriteToFolderId } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { fileReplaceRefusal, repointFileRef } from "robustness-core/data/fileReplace.server";

/**
 * POST /api/vault/multipart-complete
 * Body (JSON): { uploadId, key, parts, name, folderId, contentType, size, replaceFileId? }
 * Returns: { url, fileRef }
 *
 * Completes the S3 multipart upload and registers the file_ref in the
 * database — or, with `replaceFileId`, points that existing file_ref at
 * the new object instead (same row, so links keep working; see
 * `fileReplace.server.ts`). The replace checks run again here rather than
 * trusting that `multipart-init` ran them: the key prefix only proves the
 * bytes are this human's, not that the row is theirs to repoint.
 */
export async function action({ request }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped)
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { user, syncScoped } = scoped;

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
    replaceFileId?: string;
  };

  const { uploadId, key, parts, name, folderId, contentType, size, contentHash, replaceFileId } =
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

  const validHash = contentHash && /^[0-9a-f]{64}$/.test(contentHash) ? contentHash : null;

  if (replaceFileId) {
    const existing = await getFileRefById(replaceFileId);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const refusal = await fileReplaceRefusal(scoped, existing);
    if (refusal) {
      return Response.json({ error: refusal.error }, { status: refusal.status });
    }
    try {
      const url = await completeMultipartUpload(key, uploadId, parts);
      const fileRef = await repointFileRef(existing, {
        s3Key: key,
        s3Url: url,
        contentType,
        contentHash: validHash,
        size: size ?? existing.size ?? 0,
      });
      return Response.json({ url, fileRef });
    } catch (err) {
      console.error("Multipart replace error:", err);
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to complete replace" },
        { status: 500 },
      );
    }
  }

  // Sync-scoped tokens may only register files inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(folderId ?? null))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Same policy + ownership/role checks `upload.tsx` applies for a plain
  // (non-multipart) upload — this route previously had NEITHER, since the
  // S3-key-prefix check above only proves the RAW BYTES belong to this
  // human's own upload session, not that folderId is theirs (or shared
  // with them) to register a file_refs row into.
  if (!(await canWriteToFolderId(folderId ?? null, user.role))) {
    return Response.json(
      { error: await explainWriteRefusal(folderId ?? null, user.role) },
      { status: 403 },
    );
  }
  const folder = folderId ? await getFolderById(folderId) : null;
  if (folderId && !folder) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  if (folder && !(await canActAsProjectOwner(user._id, folder.human_id, folderId ?? null))) {
    return Response.json(
      { error: "You don't have permission to upload files here" },
      { status: 403 },
    );
  }

  try {
    const url = await completeMultipartUpload(key, uploadId, parts);

    // Filed under the FOLDER's own owner, not necessarily the acting
    // uploader — see the matching comment in `upload.tsx`.
    const fileRef = await createFileRef({
      human_id: folder ? folder.human_id : user._id,
      name,
      s3_url: url,
      s3_key: key,
      content_type: contentType,
      content_hash: validHash,
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
