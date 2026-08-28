import type { LoaderFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import {
  getFolderById,
  getDescendantFolders,
  isFolderUnderSyncs,
  listFilesMetaByFolderIds,
} from "robustness-core/data/vault.server";

/**
 * GET /api/vault/sync-manifest?folderId=<id>
 *
 * The entire subtree under one folder in a single response — folders plus
 * file *metadata* (name, content_hash, size, updated_at; never content).
 * This is the "remote state" half of a sync run: the CLI diffs it against
 * the local directory instead of walking the children API per folder.
 *
 * Owner-only; bearer-token auth supported.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  const folderId = new URL(request.url).searchParams.get("folderId");
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  const root = await getFolderById(folderId);
  if (!root || root.human_id !== user._id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (syncScoped && !(await isFolderUnderSyncs(root._id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const descendants = await getDescendantFolders(folderId);
  const allFiles = await listFilesMetaByFolderIds(user._id, [
    folderId,
    ...descendants.map((f) => f._id),
  ]);
  // Archived files are invisible to sync — a local deletion archives the
  // remote file, and it must not come back as a "new remote file".
  const files = allFiles.filter((f) => !f.archived_at);

  return Response.json({
    root: { _id: root._id, name: root.name },
    folders: descendants.map((f) => ({
      _id: f._id,
      name: f.name,
      parent_folder_id: f.parent_folder_id,
    })),
    files: files.map((f) => ({
      _id: f._id,
      name: f.name,
      folder_id: f.folder_id,
      content_hash: f.content_hash ?? null,
      content_type: f.content_type,
      size: f.size,
      updated_at: f.updated_at,
      has_s3: f.has_s3,
    })),
  });
}
