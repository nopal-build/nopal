import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getGraphLogRunSpends, getGraphLogUsageSummary } from "robustness-core/data/graphLogMetrics.server";
import { listRecentGraphLogRuns } from "robustness-core/data/graphLogPerf.server";
import { getFolderById } from "robustness-core/data/vault.server";

const DEFAULT_RUNS = 20;
const MAX_RUNS = 200;

/**
 * GET /api/graphlog/usage?range=7|30&runs=N
 *
 * What `/maker/graphlog` shows, as JSON, for a bearer token as well as a
 * browser session: the range summary (`getGraphLogUsageSummary`) and the
 * most recent runs, each with its spend by stage (`getGraphLogRunSpends`).
 * Admin/Super only, the same gate as the Maker page. The read path for
 * checking cost from a terminal without a browser.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = url.searchParams.get("range") === "30" ? 30 : 7;
  const requested = Number(url.searchParams.get("runs"));
  const runLimit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_RUNS) : DEFAULT_RUNS;

  const [usage, runs] = await Promise.all([getGraphLogUsageSummary(days), listRecentGraphLogRuns(runLimit)]);
  const spendByRunId = await getGraphLogRunSpends(runs);

  const projectIds = [...new Set([...runs.map((r) => r.project_folder_id), ...usage.byProject.map((p) => p.projectFolderId)])];
  const folders = await Promise.all(projectIds.map((id) => getFolderById(id)));
  const projectNameById = Object.fromEntries(projectIds.map((id, i) => [id, folders[i]?.name ?? "(deleted project)"]));

  return Response.json({
    days,
    usage,
    projectNameById,
    runs: runs.map((run) => ({
      id: run._id,
      jobName: run.job_name,
      projectFolderId: run.project_folder_id,
      projectName: projectNameById[run.project_folder_id],
      startedAt: run.started_at,
      durationMs: run.duration_ms,
      ok: run.ok,
      incomplete: run.incomplete,
      nodesWritten: run.nodes_written,
      daysWritten: run.days_written,
      graphNodeCount: run.graph_node_count,
      readmeChanged: run.readme_changed,
      spend: spendByRunId[run._id],
    })),
  });
}
