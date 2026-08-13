import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/capture
 *
 * Enqueues PhyLog's capture stage alone — see `phylogQueue.server.ts`'s
 * own module doc. Returns immediately with a job id; poll
 * `GET /api/phylog/jobs/:jobId` for progress/results. Thin client:
 * `nopal phylog capture`.
 *
 * Body:
 *   projectFolderId — required.
 *   full             — full-rebuild mode: resets the project's managed
 *                       content first (see `resetProjectN01Content`), then
 *                       reprocesses EVERY day from scratch. Defaults to
 *                       false (incremental — only days not yet applied).
 *   since / until     — bound the date range (YYYY-MM-DD).
 *
 * ALWAYS APPLIES — requires an owner-tier Sharing Role.
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

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const jobId = await enqueuePhylogJob("capture", {
      actingHumanId: user._id,
      projectFolderId,
      full: full ?? false,
      since,
      until,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog capture enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue capture" },
      { status: 500 },
    );
  }
}
