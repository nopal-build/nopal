import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { getPhylogJobOwner, getPhylogJobStatus } from "robustness-core/data/phylogQueue.server";

/**
 * GET /api/phylog/jobs/:jobId
 *
 * Polled by the CLI (`crates/cli/src/phylog.rs`) after enqueuing a job via
 * any of the other `api.phylog.*` routes — returns the job's current
 * state, its progress log so far (see `phylogQueue.server.ts`'s own doc
 * on why the FULL log is returned every time, not a delta), and its
 * result/error once finished.
 *
 * Same access bar as enqueuing: the acting human must hold an owner-tier
 * Sharing Role on the job's own project (or be its owner) — a job id
 * alone shouldn't leak another human's PhyLog activity.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { jobId } = params;
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  const jobData = await getPhylogJobOwner(jobId);
  if (!jobData) return Response.json({ error: "Job not found" }, { status: 404 });

  const folder = await getFolderById(jobData.projectFolderId);
  if (!folder) return Response.json({ error: "Job not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const status = await getPhylogJobStatus(jobId);
  if (!status.ok) return Response.json({ error: status.error }, { status: 404 });
  return Response.json(status);
}
