import type { ActionFunctionArgs } from "react-router";
import { pruneOldPhylogUsageEvents } from "../data/phylogMetrics.server";

/**
 * POST /api/phylog/usage-cleanup
 *
 * Deletes raw `phylog_usage_events` rows older than the retention window
 * (see `pruneOldPhylogUsageEvents`, `phylogMetrics.server.ts`) — the
 * durable `phylog_usage_daily` rollup those events already incremented is
 * untouched, so this never loses the ability to show usage trends over
 * time, only the short-lived raw detail behind them. Same `CRON_SECRET`
 * cron pattern as `archive-cleanup`/`trash-cleanup`, wired into `server.js`.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("usage-cleanup: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await pruneOldPhylogUsageEvents();
    return Response.json(result);
  } catch (err) {
    console.error("PhyLog usage cleanup error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Cleanup failed" },
      { status: 500 },
    );
  }
}
