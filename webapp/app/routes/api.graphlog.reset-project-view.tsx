import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/reset-project-view
 *
 * Enqueues deletion of every direct child of a `project-n02` folder
 * EXCEPT its `skills`/`syncs`/`graph` anchors, and clears `README.md`'s
 * body (front matter preserved) — see `resetProjectView`'s own doc
 * (`graphLogReset.server.ts`). Returns immediately with a job id; poll
 * `GET /api/graphlog/jobs/:jobId`. Thin client: `nopal graphlog
 * reset-project-view`. Destructive and NOT run implicitly by anything
 * else — always an explicit, separate call.
 *
 * Body:
 *   projectFolderId — required.
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
    const jobId = await enqueueGraphLogJob("reset-project-view", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog reset-project-view enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue reset-project-view" },
      { status: 500 },
    );
  }
}
