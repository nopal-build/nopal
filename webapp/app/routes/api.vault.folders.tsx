import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getScopedUserFromRequest,
  getUserFromRequest,
} from "../modules/auth/auth.server";
import {
  canWriteToFolderId,
  createVaultFolder,
  getFolderById,
  getFoldersByHuman,
  isFolderUnderSyncs,
  validateFolderTypeForParent,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import {
  isVaultFolderTypeKey,
  type VaultFolderTypeKey,
} from "robustness-core/data/vaultFolderTypes";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const folders = await getFoldersByHuman(user._id);
  return Response.json({ folders });
}

export async function action({ request }: ActionFunctionArgs) {
  const scoped = await getScopedUserFromRequest(request);
  if (!scoped) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { user, syncScoped } = scoped;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    name?: string;
    parent_folder_id?: string | null;
    /** Explicitly create this folder as a Vault Folder Type anchor (e.g.
     * "Skills"/"Syncs", or a sync connector inside a "Syncs" folder) — see
     * the vault skill and vaultFolderTypes.ts. Omit for an ordinary folder. */
    folder_type?: string | null;
  };

  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  // The vault root is locked — only system-provisioned Vault Root Folders
  // live there. Humans create folders *inside* a root subtree.
  if (!body.parent_folder_id) {
    return Response.json(
      { error: "Folders can only be created inside a vault root folder" },
      { status: 403 },
    );
  }

  const parent = await getFolderById(body.parent_folder_id);
  if (!parent) {
    return Response.json({ error: "Parent folder not found" }, { status: 404 });
  }
  // An owner-tier project Sharing Role (Owner/Crafter) may create folders
  // inside someone else's shared project exactly like its own owner could
  // — see `canActAsProjectOwner`. 404 (not 403) either way, so a stranger
  // can't distinguish "doesn't exist" from "exists but I can't write here".
  if (!(await canActAsProjectOwner(user._id, parent.human_id, parent._id))) {
    return Response.json({ error: "Parent folder not found" }, { status: 404 });
  }

  // Sync-scoped tokens may only create folders inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(parent._id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  if (!(await canWriteToFolderId(parent._id, user.role))) {
    return Response.json(
      { error: "You don't have permission to create folders here" },
      { status: 403 },
    );
  }

  let folderType: VaultFolderTypeKey | null = null;
  if (body.folder_type) {
    if (!isVaultFolderTypeKey(body.folder_type)) {
      return Response.json({ error: "Unknown folder type" }, { status: 400 });
    }
    folderType = body.folder_type;
    const validationError = await validateFolderTypeForParent(parent, folderType);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 409 });
    }
  }

  // Filed under the PARENT's own owner, not necessarily the acting human
  // — `listFolderChildren` (and everything else that lists a folder's
  // contents) queries by the parent owner's human_id, so a folder created
  // by a collaborator with any other human_id would be invisible in the
  // very tree it was just added to. Equivalent to `user._id` in the
  // ordinary self-owned case.
  const folder = await createVaultFolder({
    human_id: parent.human_id,
    name: body.name,
    parent_folder_id: body.parent_folder_id,
    folder_type: folderType,
  });

  return Response.json({ folder }, { status: 201 });
}
