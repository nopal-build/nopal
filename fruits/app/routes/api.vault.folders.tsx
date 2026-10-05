import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getScopedUserFromRequest,
  getUserFromRequest,
} from "../modules/auth/auth.server";
import {
  canWriteToFolderId,
  createVaultFolder,
  explainWriteRefusal,
  getFolderById,
  getFoldersByHuman,
  isFolderUnderSyncs,
  validateFolderTypeForParent,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner, canStartProject } from "robustness-core/data/projectSharing.server";
import { startProject } from "../data/startProject.server";
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

  // A direct child of a `projects` root is a project. Starting one is
  // `startProject`, the same path the Maker takes (ADR-026): who may, the
  // name, the seeding. A website there (a Super's, `folder_type`) still
  // goes the folder way below, gated the same.
  const atProjectsRoot = !parent.parent_folder_id && parent.vault_root_key === "projects";
  if (atProjectsRoot && !body.folder_type) {
    const started = await startProject(user, body.name);
    if (!started.ok) return Response.json({ error: started.error }, { status: started.status });
    return Response.json({ folder: started.folder }, { status: 201 });
  }
  if (atProjectsRoot && !(await canStartProject(user))) {
    return Response.json({ error: "Start a project in the Maker" }, { status: 403 });
  }

  // Sync-scoped tokens may only create folders inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(parent._id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`.
  //
  // A `kanban-garden` board is a DELIBERATE exception when the parent is a
  // `project-n02` container (a project, or Personal): that container is
  // `writable: "system"` at the content level so a human can never write
  // ARBITRARY content there directly — same reason `skills`/`syncs` can't
  // be created through this generic check either. Those two dodge it by
  // being provisioned straight through server-side data-layer code
  // (`ensureSyncsFolder`/`applyProjectN02Shape`), never through this route.
  // A Kanban Garden board is explicitly meant to be created BY a human/
  // agent calling this exact route (`nopal garden init`), so the
  // exception has to live here instead — `validateFolderTypeForParent`'s
  // own `kanban-garden` branch (below) is still the real authority on
  // whether this specific parent context is allowed; this only skips the
  // generic, type-agnostic content-lock that would otherwise always
  // refuse it before that more specific check ever runs.
  const isKanbanGardenInProjectContainer =
    body.folder_type === "kanban-garden" &&
    parent.folder_type === "project-n02" &&
    parent.is_folder_type_root;
  if (!isKanbanGardenInProjectContainer && !(await canWriteToFolderId(parent._id, user.role))) {
    return Response.json(
      { error: await explainWriteRefusal(parent._id, user.role) },
      { status: 403 },
    );
  }

  let folderType: VaultFolderTypeKey | null = null;
  if (body.folder_type) {
    if (!isVaultFolderTypeKey(body.folder_type)) {
      return Response.json({ error: "Unknown folder type" }, { status: 400 });
    }
    folderType = body.folder_type;
    const validationError = await validateFolderTypeForParent(parent, folderType, user.role);
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
