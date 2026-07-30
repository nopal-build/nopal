import type { ActionFunctionArgs } from "react-router";
import { isSorterEnabled, sortAllDueDailyLogs } from "../data/sorter.server";

/**
 * POST /api/daily-log/sort-all
 *
 * Runs the Sorter (`sorter.server.ts`) over every human's backlog of
 * closed, not-yet-sorted daily logs in one pass. Protected by the SAME
 * `CRON_SECRET` env var `api.vault.archive-cleanup.tsx` uses — this is
 * the "once a day, same time we reset the daily log" trigger, wired into
 * the server's own built-in cron (see `server.js`) right alongside that
 * cleanup call, not a separate scheduling mechanism.
 *
 * You can also trigger it manually:
 *
 *   curl -X POST https://<your-app>.fly.dev/api/daily-log/sort-all \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("sort-all: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Temporary kill switch — see `isSorterEnabled` in `sorter.server.ts`.
  if (!isSorterEnabled()) {
    console.log("sort-all: skipped, SORTER_ENABLED is not \"true\"");
    return Response.json({ processed: 0, results: [], disabled: true });
  }

  const { processed, results } = await sortAllDueDailyLogs();
  const errors = results.filter((r) => r.error);

  console.log(
    `sort-all: processed ${processed} day(s)${errors.length ? `, ${errors.length} errors` : ""}`,
  );

  return Response.json({ processed, results });
}
