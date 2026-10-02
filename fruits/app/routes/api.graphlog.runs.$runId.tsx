import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getGraphLogRunSpend } from "robustness-core/data/graphLogMetrics.server";
import { effortsDecisionFromEvents, getGraphLogRun } from "robustness-core/data/graphLogPerf.server";
import { getFolderById } from "robustness-core/data/vault.server";

/**
 * GET /api/graphlog/runs/:runId
 *
 * One run as JSON: the run row, its spend by stage, and what
 * graph-project-view decided about the Efforts page. `?events=1` adds the
 * full timeline. Admin/Super only; accepts a bearer token. The terminal
 * twin of `/maker/graphlog/runs/:runId`.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const runId = params.runId;
  if (!runId) return Response.json({ error: "Missing run id" }, { status: 400 });

  const found = await getGraphLogRun(runId);
  if (!found) return Response.json({ error: "Run not found" }, { status: 404 });

  const [spend, folder] = await Promise.all([getGraphLogRunSpend(found.run), getFolderById(found.run.project_folder_id)]);
  const withEvents = new URL(request.url).searchParams.get("events") === "1";

  return Response.json({
    run: found.run,
    projectName: folder?.name ?? "(deleted project)",
    spend,
    effortsDecision: effortsDecisionFromEvents(found.events),
    ...(withEvents ? { events: found.events } : {}),
  });
}
