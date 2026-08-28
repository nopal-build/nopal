import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { getGraphLogJobOwner, getGraphLogJobStatus } from "robustness-core/data/graphLogQueue.server";

/**
 * GET /api/graphlog/jobs/:jobId
 *
 * Polled by the CLI (`crates/cli/src/graphlog.rs`) after enqueuing a job
 * via one of the other `api.graphlog.*` routes — mirrors
 * `api.phylog.jobs.$jobId.tsx` exactly, on GraphLog's own queue (see
 * `graphLogQueue.server.ts`).
 *
 * Same access bar as enqueuing: the acting human must hold an owner-tier
 * Sharing Role on the job's own project (or be its owner), OR be
 * Admin/Super (the Vault's own "More Actions" → Run/Reset GraphLog is
 * available to staff on any project, so polling the resulting job has to
 * allow the same) — a job id alone shouldn't leak another human's
 * GraphLog activity to anyone else.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { jobId } = params;
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  const jobData = await getGraphLogJobOwner(jobId);
  if (!jobData) return Response.json({ error: "Job not found" }, { status: 404 });

  const folder = await getFolderById(jobData.projectFolderId);
  if (!folder) return Response.json({ error: "Job not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!role?.isOwner && !isStaff) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const status = await getGraphLogJobStatus(jobId);
  if (!status.ok) return Response.json({ error: status.error }, { status: 404 });
  return Response.json(status);
}
