import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  canViewFolder,
  getFolderById,
  getTopLevelSharedFolders,
  listFolderChildren,
  ensureVaultRootFolders,
} from "robustness-core/data/vault.server";

/**
 * GET /api/vault/folders/:folderId/children
 *
 * Lazy tree/folder-view loading for vault v2 — returns one folder's direct
 * children: sub-folders plus file *metadata* (never file content).
 *
 * Pass `root` as the folderId to list the human's Vault Root Folders
 * (daily-logs, projects, personal, …), provisioning them if missing.
 *
 * `?withShared=1` additionally merges every project someone else has
 * shared with the viewer into the result, WHEN `folderId` is the
 * viewer's own top-level `projects` root container — own projects win on
 * a name collision. Deliberately opt-in, NOT the default: the web
 * Vault's own sidebar already surfaces shared projects as a separate
 * "Shared with me" section (`fruits_.vault.tsx`'s own
 * `topLevelSharedFolders`), so merging them into `projects/`'s own lazy
 * children too would just duplicate that entry point in the tree. The
 * CLI/GUI app (`crates/core/src/vault.rs`'s `Client::children`) has no
 * such separate concept — for a vault PATH to resolve the same way
 * regardless of whether you own or were merely shared a project (e.g.
 * `nopal graphlog run --project "projects/nopal o."` working the same
 * for an Owner and a shared-in Crafter), it always passes this flag.
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

  const withShared = new URL(request.url).searchParams.get("withShared") === "1";

  if (folderId === "root") {
    const folders = await ensureVaultRootFolders(user._id);
    return Response.json({ folders, files: [] });
  }

  const folder = await getFolderById(folderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Children belong to the folder's OWNER, not necessarily the viewer.
  const { folders, files } = await listFolderChildren(
    folder.human_id,
    folderId,
  );

  const isOwnProjectsRoot =
    withShared &&
    folder.human_id === user._id &&
    !folder.parent_folder_id &&
    folder.vault_root_key === "projects";
  if (isOwnProjectsRoot) {
    const ownNames = new Set(folders.map((f) => f.name.toLowerCase()));
    for (const shared of await getTopLevelSharedFolders(user._id)) {
      if (!ownNames.has(shared.name.toLowerCase())) folders.push(shared);
    }
  }

  return Response.json({ folders, files });
}
