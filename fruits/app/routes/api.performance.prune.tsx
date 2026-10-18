import type { ActionFunctionArgs } from "react-router";
import { pruneOldPerfRequests } from "robustness-core/data/requestPerf.server";

/**
 * POST /api/performance/prune
 *
 * Deletes traced requests (and their events) older than the retention
 * window (`DEFAULT_REQUEST_RETENTION_DAYS` in `requestPerf.server.ts`,
 * 14 days today). Protected by the CRON_SECRET environment variable,
 * same pattern as `/api/vault/archive-cleanup`.
 *
 * Why prune at all, given SurrealDB storage is cheap: the per-request
 * EVENT rows are the real volume driver (each traced request writes one
 * `perf_requests` row plus roughly 5-10 `perf_request_events` rows), and
 * an ever-growing table makes `listRecentPerfRequests`/`getPerfSummary`'s
 * own scans slower over time -- this feature becoming a performance
 * problem itself would be a bad joke. More importantly: nobody drills
 * into one specific request's function/DB timeline from weeks ago, so
 * detail past the retention window has near-zero remaining value. Same
 * reasoning GraphLog's own `pruneOldGraphLogRuns` already applied to the
 * same category of data (`graphlog_runs`/`graphlog_run_events`).
 *
 * You can also trigger it manually:
 *
 *   curl -X POST https://<your-app>.fly.dev/api/performance/prune \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("performance/prune: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await pruneOldPerfRequests();
  console.log(
    `performance/prune: deleted ${result.deletedRequests} request(s), ${result.deletedEvents} event(s)`,
  );
  return Response.json(result);
}
