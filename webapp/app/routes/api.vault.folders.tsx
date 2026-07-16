import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getScopedUserFromRequest,
  getUserFromRequest,
} from "../modules/auth/auth.server";
import {
  createVaultFolder,
  getFolderById,
  getFoldersByHuman,
  isFolderUnderSyncs,
} from "../data/vault.server";

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
  if (!parent || parent.human_id !== user._id) {
    return Response.json({ error: "Parent folder not found" }, { status: 404 });
  }

  // Sync-scoped tokens may only create folders inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(parent._id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const folder = await createVaultFolder({
    human_id: user._id,
    name: body.name,
    parent_folder_id: body.parent_folder_id,
  });

  return Response.json({ folder }, { status: 201 });
}
