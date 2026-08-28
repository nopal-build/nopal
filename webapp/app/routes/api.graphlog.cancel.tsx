import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { cancelGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/cancel
 *
 * Stops whatever GraphLog job is currently running/queued for a project
 * (`cancelGraphLogJob`, `graphLogQueue.server.ts`) — a queued-but-not-yet-
 * started job is removed outright; an already-active one gets a
 * cooperative cancellation flag and stops at its own next safe
 * checkpoint (between pipeline stages, once per turn/file/day — see that
 * file's own "Cooperative cancellation" section), never instantly.
 *
 * Admin/Super only, same as Run/Reset/Schedule — this is a more, not
 * less, consequential action than those.
 *
 * Body:
 *   projectFolderId — required.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!isStaff) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: string };
  const { projectFolderId } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });

  const result = await cancelGraphLogJob(projectFolderId);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  return Response.json({ wasActive: result.wasActive });
}
