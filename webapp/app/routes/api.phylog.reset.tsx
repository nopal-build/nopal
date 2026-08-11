import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { resetProject } from "../data/phylogAgent.server";

/**
 * POST /api/phylog/reset
 *
 * Deletes every direct child of a `project-n01` folder (a project, or the
 * human's own `personal`) EXCEPT its `skills`/`syncs`/`newspapers` anchors
 * — see `resetProjectN01Content`'s own doc (`projectN01.server.ts`) for
 * exactly what this does and why it also clears the project's Release Log
 * history. Thin client: `nopal phylog reset`. Destructive and NOT run
 * implicitly by anything else — always an explicit, separate call.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: string };
  const { projectFolderId } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await resetProject(projectFolderId);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json(result);
  } catch (err) {
    console.error("PhyLog reset error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Reset failed" },
      { status: 500 },
    );
  }
}
