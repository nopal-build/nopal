import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/sow
 *
 * Sow: turns what is waiting in the project's seed packets into seed
 * (`runSow`, `sow.server.ts`). Each file is read once, however many
 * times this is pressed. A model reads the files, so this enqueues a job
 * and returns its id; poll `GET /api/graphlog/jobs/:jobId`. Seeding is
 * the Guides' (the same gate as the seed push); anyone else gets the 404
 * of a project that isn't there.
 *
 * Body: projectFolderId — required.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: unknown };
  if (typeof body.projectFolderId !== "string") return Response.json({ error: "projectFolderId is required" }, { status: 400 });

  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !(await isProjectFolder(folder)) || !(await getProjectRole(folder, user._id))?.guiding) return Response.json({ error: "Project not found" }, { status: 404 });

  try {
    const jobId = await enqueueGraphLogJob("sow", { actingHumanId: user._id, projectFolderId: folder._id });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog sow enqueue error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to start sowing" }, { status: 500 });
  }
}
