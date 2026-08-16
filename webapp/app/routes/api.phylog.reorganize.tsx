import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/reorganize
 *
 * Enqueues a dedicated, whole-README reorganization pass for one project
 * (`runReorganize`, `capture.server.ts`) — distinct from `capture`'s own
 * one-day-at-a-time loop: given the ENTIRE current README at once,
 * explicitly asked to evaluate and fix the project's overall structure.
 * The same pass a daily log's own explicit request triggers automatically
 * mid-capture (`request_reorganize`) — this route is for triggering it
 * directly, without writing (or waiting for) such a request. Returns
 * immediately with a job id; poll `GET /api/phylog/jobs/:jobId`. Thin
 * client: `nopal phylog reorganize`.
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
    const jobId = await enqueuePhylogJob("reorganize", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog reorganize enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue reorganize" },
      { status: 500 },
    );
  }
}
