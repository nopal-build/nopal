import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { setGraphLogScheduled } from "robustness-core/data/graphLogSchedule.server";

/**
 * POST /api/graphlog/schedule
 *
 * Enables/disables GraphLog's daily automatic run for one `project-n02`
 * folder (a project OR a `personal` space) — see
 * `graphLogSchedule.server.ts`. Unlike `/run` and `/reset`, this is
 * Admin/Super ONLY, with no owner fallback: scheduling something to run
 * unattended every night is a different kind of call than triggering one
 * run by hand, so it doesn't get the same "or you own it" carve-out.
 * Thin client: the Vault's "More Actions" → Enable/Disable GraphLog
 * Schedule entry (`fruits_.vault.tsx`).
 *
 * Body:
 *   projectFolderId — required.
 *   scheduled       — required, boolean.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!isStaff) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    scheduled?: boolean;
  };
  const { projectFolderId, scheduled } = body;
  if (!projectFolderId || typeof scheduled !== "boolean") {
    return Response.json({ error: "projectFolderId and scheduled are required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });

  const result = await setGraphLogScheduled(folder, scheduled);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  return Response.json({ scheduled: result.scheduled });
}
