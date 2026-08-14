import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/reset-pre-capture
 *
 * The DEEPER of PhyLog's two reset depths (see the `phylog` skill's
 * "Reset" section) -- everything `POST /api/phylog/reset` wipes, PLUS the
 * project's own `daily-logs` staging folder (pre-capture's own output).
 * Requires `nopal phylog pre-capture` (to restage `daily-logs`) before
 * `capture --full` has anything to rebuild from again. Returns
 * immediately with a job id; poll `GET /api/phylog/jobs/:jobId`. Thin
 * client: `nopal phylog reset-pre-capture`. Destructive and NOT run
 * implicitly by anything else -- always an explicit, separate call.
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
    const jobId = await enqueuePhylogJob("reset-pre-capture", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog reset-pre-capture enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue reset-pre-capture" },
      { status: 500 },
    );
  }
}
