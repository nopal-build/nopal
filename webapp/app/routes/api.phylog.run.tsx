import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { runPhylogPipeline } from "../data/phylogAgent.server";

/**
 * POST /api/phylog/run
 *
 * Runs PhyLog's full three-stage pipeline (`phylogAgent.server.ts`'s
 * `runPhylogPipeline` — pre-capture -> capture -> post-capture) for one
 * project. Thin client: `nopal phylog run`.
 *
 * Body:
 *   projectFolderId — required. A project, or the human's own `personal`.
 *   full             — capture's full-rebuild mode (resets first, then
 *                       reprocesses everything). Defaults to false
 *                       (incremental — only days not yet applied).
 *   since / until     — bound capture's date range (YYYY-MM-DD). Ignored
 *                        when `full` isn't set and unnecessary otherwise.
 *
 * ALWAYS APPLIES — there is no preview/dry-run mode. Requires an owner-tier
 * Sharing Role on the project (or being the project/personal's own owner).
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

  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(projectFolder, user._id);
  if (!role?.isOwner) {
    // 404 (not 403) so a non-collaborator can't probe which project ids exist.
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const log: string[] = [];
  try {
    const result = await runPhylogPipeline(
      user._id,
      projectFolderId,
      { full, since, until },
      (line) => log.push(line),
    );
    if (!result.ok) return Response.json({ error: result.error, log }, { status: 400 });
    return Response.json({ ...result, log });
  } catch (err) {
    console.error("PhyLog run error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "PhyLog run failed", log },
      { status: 500 },
    );
  }
}
