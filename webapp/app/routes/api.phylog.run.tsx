import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { runPhylogAgent } from "../data/phylogAgent.server";

/**
 * POST /api/phylog/run
 *
 * Runs the PhyLog agent (`phylogAgent.server.ts`) for one project's Card on
 * one day — same authenticated-tool-surface pattern every `api.daily-log.*`/
 * `api.release-log.*` route already uses (a real browser session, or the
 * CLI's bearer token — `nopal phylog run`).
 *
 * Body:
 *   projectFolderId — required.
 *   date             — required, YYYY-MM-DD.
 *   dryRun           — defaults to true. Pass `false` to actually commit
 *                       the change (requires an owner-tier Sharing Role on
 *                       the project, same bar as sharing/revert).
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    date?: string;
    dryRun?: boolean;
  };
  const { projectFolderId, date } = body;
  const dryRun = body.dryRun ?? true;

  if (!projectFolderId || !date) {
    return Response.json({ error: "projectFolderId and date are required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const role = await getProjectRole(projectFolder, user._id);
  if (!role) {
    // 404 (not 403) so a non-collaborator can't probe which project ids exist.
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  if (!dryRun && !role.isOwner) {
    return Response.json(
      { error: "You don't have permission to apply PhyLog changes on this project" },
      { status: 403 },
    );
  }

  try {
    const result = await runPhylogAgent(user._id, projectFolderId, date, { dryRun });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    console.error("PhyLog agent run error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "PhyLog run failed" },
      { status: 500 },
    );
  }
}
