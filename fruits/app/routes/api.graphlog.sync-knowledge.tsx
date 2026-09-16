import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/sync-knowledge
 *
 * Enqueues GraphLog's sync-knowledge stage — see the `graphlog` skill.
 * Agentic (real LLM calls), so unlike `daily-log-sync` this follows
 * PhyLog's own enqueue-then-poll shape (`api.phylog.pre-capture.tsx`'s
 * doc explains why) rather than running synchronously. Returns
 * immediately with a job id; poll `GET /api/graphlog/jobs/:jobId` for
 * progress/results. Thin client: `nopal graphlog sync-knowledge`.
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
  // Same trigger gate as PhyLog's own stages (see the `phylog` skill) —
  // an owner-tier Sharing Role, or being the project/personal owner.
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const jobId = await enqueueGraphLogJob("sync-knowledge", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog sync-knowledge enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue sync-knowledge" },
      { status: 500 },
    );
  }
}
