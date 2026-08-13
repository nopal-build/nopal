import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/post-capture
 *
 * Enqueues PhyLog's post-capture stage alone (currently mostly a
 * placeholder — see `postCapture.server.ts`). Returns immediately with a
 * job id; poll `GET /api/phylog/jobs/:jobId`. Thin client:
 * `nopal phylog post-capture`.
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
    const jobId = await enqueuePhylogJob("post-capture", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog post-capture enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue post-capture" },
      { status: 500 },
    );
  }
}
