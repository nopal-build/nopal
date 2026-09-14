import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getGraphLogProjectStatus } from "robustness-core/data/graphLogQueue.server";

/**
 * GET /api/graphlog/status?projectFolderId=...
 *
 * The Vault's permanent GraphLog status line (`fruits_.vault.tsx`) polls
 * this — is a job currently running/queued for this project, when did
 * the last one finish (if ever), and is the project enrolled in the
 * nightly automatic run (see `graphLogSchedule.server.ts`). Also what
 * `nopal graphlog schedule status --project <path>` prints, so the CLI
 * and the Vault UI read from exactly the same source. See
 * `getGraphLogProjectStatus` (`graphLogQueue.server.ts`) for exactly what
 * backs the running/last-run half (the durable `graphlog_runs` table,
 * cross-checked against the job's real BullMQ state so a crashed worker
 * can't leave a project stuck reporting "running" forever).
 *
 * Admin/Super only, same as the Run/Reset/Schedule/Stop actions this
 * status line sits alongside.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!isStaff) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const projectFolderId = url.searchParams.get("projectFolderId");
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });

  const status = await getGraphLogProjectStatus(projectFolderId);
  return Response.json({ ...status, scheduled: folder.graphlog_scheduled === true });
}
