import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { createMultipartUpload } from "robustness-core/data/file.server";
import { canWriteToFolderId, explainWriteRefusal, getFileRefById, getFolderById, isFolderUnderSyncs } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { fileReplaceRefusal } from "robustness-core/data/fileReplace.server";

/**
 * POST /api/vault/multipart-init
 * Body (JSON): { filename, contentType, folderId?, originalName, size, replaceFileId? }
 * Returns: { uploadId, key }
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
  const { user, syncScoped } = scoped;

  const body = (await request.json()) as {
    filename?: string;
    contentType?: string;
    folderId?: string | null;
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

  let folderId = body.folderId;
  if (replaceFileId) {
    const existing = await getFileRefById(replaceFileId);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const refusal = await fileReplaceRefusal(scoped, existing);
    if (refusal) {
      return Response.json({ error: refusal.error }, { status: refusal.status });
    }
    folderId = existing.folder_id;
    return startSession(user._id, folderId, filename, contentType);
  }

  // Sync-scoped tokens may only write inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(folderId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (!(await canWriteToFolderId(folderId, user.role))) {
    return Response.json(
      { error: await explainWriteRefusal(folderId, user.role) },
      { status: 403 },
    );
  }

  // Whose folder is this actually? An owner-tier project Sharing Role
  // (Owner/Crafter) may upload into someone else's shared project exactly
  // like its own owner could — see `canActAsProjectOwner`.
  const folder = folderId ? await getFolderById(folderId) : null;
  if (folderId && !folder) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  if (folder && !(await canActAsProjectOwner(user._id, folder.human_id, folderId))) {
    return Response.json(
      { error: "You don't have permission to upload files here" },
      { status: 403 },
    );
  }

  return startSession(user._id, folderId, filename, contentType);
}

/** Opens the S3 session under this human's own key prefix (which
 * `multipart-part`/`-complete` check) and returns what the client needs. */
async function startSession(
  humanId: string,
  folderId: string | null | undefined,
  filename: string,
  contentType: string,
): Promise<Response> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folderSegment = folderId ?? "root";
  const key = `vault/${humanId}/${folderSegment}/${Date.now()}-${safeName}`;

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
