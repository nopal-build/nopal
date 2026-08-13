import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueuePhylogJob } from "robustness-core/data/phylogQueue.server";

/**
 * POST /api/phylog/pre-capture
 *
 * Enqueues PhyLog's pre-capture stage alone — see `phylogQueue.server.ts`'s
 * own module doc. Returns immediately with a job id; poll
 * `GET /api/phylog/jobs/:jobId` for progress/results. Thin client:
 * `nopal phylog pre-capture`.
 *
 * Body:
 *   projectFolderId — required.
 *   date             — optional, YYYY-MM-DD. Process just that day's Card
 *                       attachments (plus, always, a syncs sweep).
 *   fileId           — optional. Process just this one file, ignoring
 *                       `date` entirely.
 *   Omit both `date` and `fileId` to process every day this project has a
 *   Card for, plus the syncs sweep.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    date?: string;
    fileId?: string;
  };
  const { projectFolderId, date, fileId } = body;
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
    const jobId = await enqueuePhylogJob("pre-capture", {
      actingHumanId: user._id,
      projectFolderId,
      date,
      fileId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("PhyLog pre-capture enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue pre-capture" },
      { status: 500 },
    );
  }
}
