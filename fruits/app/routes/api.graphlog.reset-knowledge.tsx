import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/reset-knowledge
 *
 * Enqueues deletion of every `_knowledge/` sidecar folder nested anywhere
 * under the project's `syncs/` tree — see `resetKnowledge`'s own doc
 * (`graphLogReset.server.ts`). A no-op if there are none yet. Returns
 * immediately with a job id; poll `GET /api/graphlog/jobs/:jobId`. Thin
 * client: `nopal graphlog reset-knowledge`. Destructive and NOT run
 * implicitly by anything else — always an explicit, separate call.
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
    const jobId = await enqueueGraphLogJob("reset-knowledge", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog reset-knowledge enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue reset-knowledge" },
      { status: 500 },
    );
  }
}
