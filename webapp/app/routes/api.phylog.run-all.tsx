import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { runPhylogAgentForRange } from "../data/phylogAgent.server";

/**
 * POST /api/phylog/run-all
 *
 * Runs the PhyLog agent (`phylogAgent.server.ts`) across EVERY day that
 * already has a Card for one project, from `since` through `until` — the
 * "run everything up to today" counterpart to the single-day
 * `/api/phylog/run` (`nopal phylog run` without `--date`), so a caller
 * doesn't have to already know (or enumerate one by one) which specific
 * days have anything to process.
 *
 * Body:
 *   projectFolderId — required.
 *   since             — optional, YYYY-MM-DD. Omit to start from this
 *                        project's very first Card.
 *   until             — optional, YYYY-MM-DD. Defaults to today (UTC).
 *   dryRun            — defaults to true. Pass `false` to actually commit
 *                        each day's change (requires an owner-tier Sharing
 *                        Role on the project, same bar as `/api/phylog/run`).
 *
 * Returns `{ results: ({ date } & PhylogAgentResult)[] }`, one entry per
 * day that had a Card in range, in chronological (oldest-first) order —
 * see `runPhylogAgentForRange`'s own doc for why that order matters for a
 * real `--apply` run.
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
    since?: string;
    until?: string;
    dryRun?: boolean;
  };
  const { projectFolderId, since, until } = body;
  const dryRun = body.dryRun ?? true;

  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }
  for (const [label, value] of [["since", since], ["until", until]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return Response.json({ error: `${label} must be YYYY-MM-DD` }, { status: 400 });
    }
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
    const results = await runPhylogAgentForRange(user._id, projectFolderId, {
      since,
      until,
      dryRun,
    });
    return Response.json({ results });
  } catch (err) {
    console.error("PhyLog agent range run error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "PhyLog run failed" },
      { status: 500 },
    );
  }
}
