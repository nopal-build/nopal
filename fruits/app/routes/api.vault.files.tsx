import type { ActionFunctionArgs } from "react-router";
import { getScopedUserFromRequest } from "../modules/auth/auth.server";
import {
  canWriteToFolderId,
  createFileRef,
  explainWriteRefusal,
  getFolderById,
  isFolderUnderSyncs,
} from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";

/**
 * POST /api/vault/files — creates a new, blank markdown file inside a
 * folder. First (and so far only) caller: the "New Page" button in the
 * markdown split editor's merged header (`vault.tsx`'s
 * `handleCreateMarkdownFile`) — mirrors `api.vault.folders.tsx`'s own POST
 * action almost exactly (same permission checks), minus anything folder-
 * type-specific, which a plain markdown file has no equivalent of.
 */
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
    folder_id?: string;
  };

  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.folder_id) {
    return Response.json({ error: "folder_id is required" }, { status: 400 });
  }

  const parent = await getFolderById(body.folder_id);
  if (!parent) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  // Same owner-tier Sharing Role allowance `api.vault.folders.tsx` grants a
  // folder-creation caller — 404 (not 403) either way, so a stranger can't
  // distinguish "doesn't exist" from "exists but I can't write here".
  if (!(await canActAsProjectOwner(user._id, parent.human_id, parent._id))) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  // Sync-scoped tokens may only create files inside syncs/.
  if (syncScoped && !(await isFolderUnderSyncs(parent._id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await canWriteToFolderId(parent._id, user.role))) {
    return Response.json(
      { error: await explainWriteRefusal(parent._id, user.role) },
      { status: 403 },
    );
  }

  const trimmed = body.name.trim().replace(/\.md$/i, "");
  if (!trimmed) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const name = `${trimmed}.md`;

  // Filed under the PARENT's own owner, not necessarily the acting human —
  // same reasoning `api.vault.folders.tsx`'s own `createVaultFolder` call
  // already follows (a collaborator writing into someone else's shared
  // project still files it under THAT project's owner).
  const file = await createFileRef({
    human_id: parent.human_id,
    name,
    content: `# ${trimmed}\n`,
    content_type: "text/markdown",
    folder_id: parent._id,
  });

  return Response.json({ file }, { status: 201 });
}
