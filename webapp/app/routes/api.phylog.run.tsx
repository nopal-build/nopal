import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/run
 *
 * Enqueues PhyLog's full three-stage pipeline (pre-capture -> capture ->
 * post-capture) for one project — see `phylogQueue.server.ts`'s own
 * module doc for why this is a queued job (`worker.ts`) rather than run
 * inline. Returns immediately with a job id; poll
 * `GET /api/phylog/jobs/:jobId` for progress/results. Thin client:
 * `nopal phylog run`.
 *
 * Body:
 *   projectFolderId — required. A project, or the human's own `personal`.
 *   full             — capture's full-rebuild mode (resets first, then
 *                       reprocesses everything). Defaults to false
 *                       (incremental — only days not yet applied).
 *   since / until     — bound capture's date range (YYYY-MM-DD). Ignored
 *                        when `full` isn't set and unnecessary otherwise.
 *
 * ALWAYS APPLIES — there is no preview/dry-run mode. Requires an owner-tier
 * Sharing Role on the project (or being the project/personal's own owner).
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    full?: boolean;
    since?: string;
    until?: string;
  };
  const { projectFolderId, full, since, until } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(projectFolder, user._id);
  if (!role?.isOwner) {
    // 404 (not 403) so a non-collaborator can't probe which project ids exist.
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const jobId = await enqueuePhylogJob("run", {
      actingHumanId: user._id,
      projectFolderId,
      full,
      since,
      until,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog run enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue PhyLog run" },
      { status: 500 },
    );
  }
}
