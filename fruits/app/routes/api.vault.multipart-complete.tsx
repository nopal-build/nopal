import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { completeMultipartUpload } from "robustness-core/data/file.server";
import { createFileRef, getFileRefById } from "robustness-core/data/vault.server";
import { addPacketFile } from "robustness-core/data/seedPackets.server";
import { dailyLogStamp, resolveUploadTarget, uploadTargetFromBody } from "../modules/uploadTarget.server";
import { fileReplaceRefusal, repointFileRef } from "robustness-core/data/fileReplace.server";
import { enqueueRenditionsJob } from "robustness-core/data/mediaQueue.server";

/**
 * POST /api/vault/multipart-complete
 * Body (JSON): { uploadId, key, parts, name, folderId? | target?, contentType, size, contentHash?, replaceFileId?, source?, date? }
 * Returns: { url, fileRef }, or for a seed packet { id, name, outcome }
 *
 * `contentHash` is the browser's sha256 of the file, sent for files under
 * 100 MB (`vaultUpload.ts`): the same hash the server used to compute when
 * it held the bytes, so photo links, sidecars, day hashes and packet
 * dedupe see the same value. Larger files have none, and nothing fills it
 * in later: a hash appearing on an existing file would change every
 * fingerprint built on it (readers fall back to the key or the id).
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
  const { user } = scoped;

  const body = (await request.json()) as {
    uploadId?: string;
    key?: string;
    parts?: Array<{ PartNumber: number; ETag: string }>;
    name?: string;
    folderId?: string | null;
    target?: unknown;
    /** A daily log attachment's stamp (`api.daily-log.upload-target`),
     * kept only when `dailyLogStamp` finds it true. */
    source?: string;
    date?: string;
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

  // The same checks `multipart-init` ran, again: the key prefix above only
  // proves the bytes are this human's, not that the place they're being
  // filed is theirs to write (see `uploadTarget.server.ts`).
  const target = uploadTargetFromBody(body);
  if (!target) return Response.json({ error: "Invalid upload target" }, { status: 400 });
  const resolved = await resolveUploadTarget(scoped, target);
  if (!resolved.ok) return resolved.response;
  const where = resolved.target;

  let url: string;
  try {
    url = await completeMultipartUpload(key, uploadId, parts);
  } catch (err) {
    console.error("Multipart complete error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to complete upload" },
      { status: 500 },
    );
  }

  try {
    if (where.kind === "seedPacket") {
      // A packet is rows, not a Vault folder (`seedPackets.server.ts`);
      // sowing queues the renditions later, from the same key.
      const { file: row, outcome } = await addPacketFile({
        project_folder_id: where.projectFolderId,
        round: where.round,
        human_id: user._id,
        name,
        content_type: contentType,
        size: size ?? 0,
        content_hash: validHash,
        s3_key: key,
        s3_url: url,
        content: null,
      });
      return Response.json({ id: row._id, name: row.name, outcome }, { status: outcome === "added" ? 201 : 200 });
    }

    // A daily log attachment's stamp, only when it is true (see
    // `dailyLogStamp`): `isFileRefLocked` locks by it.
    const stamp = await dailyLogStamp(user._id, where.folderId, body.source, body.date);
    // Filed under the FOLDER's own owner, not necessarily the acting
    // uploader; see the matching comment in `upload.tsx`.
    const fileRef = await createFileRef({
      human_id: where.ownerId,
      name,
      s3_url: url,
      s3_key: key,
      content_type: contentType,
      content_hash: validHash,
      size: size ?? null,
      folder_id: where.folderId,
      ...(stamp ?? {}),
    });
    if (!fileRef?._id) {
      return Response.json({ error: "Failed to create file record" }, { status: 500 });
    }
    // The record is written; the renditions ask is extra and never fails
    // the upload. A large video got no poster until a GraphLog run
    // backfilled it before this ask existed (2026-10-29).
    if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
      await enqueueRenditionsJob(fileRef._id).catch((err) => console.error("Could not enqueue renditions:", err));
    }
    return Response.json({ url, fileRef }, { status: 201 });
  } catch (err) {
    console.error("Multipart complete record error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to record upload" },
      { status: 500 },
    );
  }
}
