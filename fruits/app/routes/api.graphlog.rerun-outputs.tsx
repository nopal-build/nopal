import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob, getGraphLogProjectStatus } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/rerun-outputs
 *
 * Enqueues GraphLog's two view stages (graph-structure, then
 * graph-project-view) with `rebuildStale`: each re-threads / rewrites
 * only if its own stamp says an older skill wrote it, and otherwise makes
 * no model call. The graph itself is never touched -- that is
 * `reset-graph`, kept separate and destructive on purpose. See
 * `composeStageSkill` in `projectN02.server.ts` and the `graphlog` skill.
 * Thin client: `nopal graphlog rerun-outputs`. Vault: More Actions ->
 * "Rerun GraphLog Outputs".
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
  // Same staff override as `api.graphlog.run.tsx`: the Vault entry is
  // gated to Admin the same way client-side.
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!role?.isOwner && !isStaff) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Same backstop as `run`: never two pipelines on one project at once.
  const status = await getGraphLogProjectStatus(projectFolderId);
  if (status.running) {
    return Response.json(
      { error: "GraphLog is already running for this project. Stop it first, or wait for it to finish." },
      { status: 409 },
    );
  }

  try {
    const jobId = await enqueueGraphLogJob("rerun-outputs", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog rerun-outputs enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue rerun-outputs" },
      { status: 500 },
    );
  }
}
