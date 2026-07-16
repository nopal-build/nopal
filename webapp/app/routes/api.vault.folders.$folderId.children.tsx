import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  getFolderById,
  listFolderChildren,
  ensureVaultRootFolders,
} from "../data/vault.server";

/**
 * GET /api/vault/folders/:folderId/children
 *
 * Lazy tree/folder-view loading for vault v2 — returns one folder's direct
 * children: sub-folders plus file *metadata* (never file content).
 *
 * Pass `root` as the folderId to list the human's Vault Root Folders
 * (daily-logs, projects, personal, …), provisioning them if missing.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { folderId } = params;
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  if (folderId === "root") {
    const folders = await ensureVaultRootFolders(user._id);
    return Response.json({ folders, files: [] });
  }

  const folder = await getFolderById(folderId);
  if (!folder || folder.human_id !== user._id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { folders, files } = await listFolderChildren(user._id, folderId);
  return Response.json({ folders, files });
}
