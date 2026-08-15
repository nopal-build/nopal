import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import { createMultipartUpload } from "robustness-core/data/file.server";
import { canWriteToFolderId, getFolderById, isFolderUnderSyncs } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";

/**
 * POST /api/vault/multipart-init
 * Body (JSON): { filename, contentType, folderId?, originalName, size }
 * Returns: { uploadId, key }
 *
 * Creates an S3 multipart upload session. The key is returned so the client
 * can reference it in subsequent part and complete requests.
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
  };

  const { filename, contentType, folderId } = body;
  if (!filename || !contentType) {
    return Response.json(
      { error: "filename and contentType are required" },
      { status: 400 },
    );
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
      { error: "You don't have permission to upload files here" },
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

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folderSegment = folderId ?? "root";
  const key = `vault/${user._id}/${folderSegment}/${Date.now()}-${safeName}`;

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
