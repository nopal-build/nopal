import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { createMultipartUpload } from "robustness-core/data/file.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { resolveUploadTarget, uploadTargetFromBody } from "../modules/uploadTarget.server";
import { fileReplaceRefusal } from "robustness-core/data/fileReplace.server";

/**
 * POST /api/vault/multipart-init
 * Body (JSON): { filename, contentType, folderId? | target?, originalName, size, replaceFileId? }
 * Returns: { uploadId, key }
 *
 * `target` (see `uploadTarget.server.ts`) names a daily log day or a seed
 * packet instead of a folder; `folderId` alone is a folder. The parts then
 * go straight to storage on URLs from `multipart-sign`.
 *
 * Creates an S3 multipart upload session. The key is returned so the client
 * can reference it in subsequent part and complete requests.
 *
 * With `replaceFileId`, the parts are the new bytes of an EXISTING file
 * (same row, new object — see `fileReplace.server.ts`). The permission
 * checks are then the replace route's, against that file's own folder,
 * and `folderId` is ignored.
 */
export async function action({ request }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped)
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { user } = scoped;

  const body = (await request.json()) as {
    filename?: string;
    contentType?: string;
    folderId?: string | null;
    target?: unknown;
    originalName?: string;
    replaceFileId?: string;
  };

  const { filename, contentType, replaceFileId } = body;
  if (!filename || !contentType) {
    return Response.json(
      { error: "filename and contentType are required" },
      { status: 400 },
    );
  }

  if (replaceFileId) {
    const existing = await getFileRefById(replaceFileId);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const refusal = await fileReplaceRefusal(scoped, existing);
    if (refusal) {
      return Response.json({ error: refusal.error }, { status: refusal.status });
    }
    return startSession(user._id, existing.folder_id ?? "root", filename, contentType);
  }

  const target = uploadTargetFromBody(body);
  if (!target) return Response.json({ error: "Invalid upload target" }, { status: 400 });
  const resolved = await resolveUploadTarget(scoped, target);
  if (!resolved.ok) return resolved.response;

  return startSession(user._id, resolved.target.keySegment, filename, contentType);
}

/** Opens the S3 session under this human's own key prefix (which
 * `multipart-part`/`-complete` check) and returns what the client needs. */
async function startSession(
  humanId: string,
  keySegment: string,
  filename: string,
  contentType: string,
): Promise<Response> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `vault/${humanId}/${keySegment}/${Date.now()}-${safeName}`;

  try {
    const uploadId = await createMultipartUpload(key, contentType);
    return Response.json({ uploadId, key });
  } catch (err) {
    console.error("Multipart init error:", err);
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to initiate upload",
      },
      { status: 500 },
    );
  }
}
