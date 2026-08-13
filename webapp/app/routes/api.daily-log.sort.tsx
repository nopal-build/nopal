import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { isSorterEnabled, sortDailyLog } from "robustness-core/data/sorter.server";

/**
 * POST /api/daily-log/sort
 *
 * Triggers the Sorter (`sorter.server.ts`) for the AUTHENTICATED human's
 * own daily log — the same authenticated-tool-surface pattern every
 * `api.vault.*` route already uses, so this is reachable via a real
 * browser session, the CLI's bearer token (`nopal sort run`), or a future
 * sorting agent's `"sorter"`-scoped token (see `apiTokens.server.ts`) —
 * one real implementation, several equally-real callers.
 *
 * Body (all optional):
 *   date  — YYYY-MM-DD. Defaults to yesterday (UTC) when omitted.
 *   force — re-run even if this day was already sorted.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Temporary kill switch — see `isSorterEnabled` in `sorter.server.ts`.
  if (!isSorterEnabled()) {
    return Response.json(
      { error: "Sorting is temporarily disabled." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    date?: string;
    force?: boolean;
  };

  let date = body.date;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!date) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    date = yesterday.toISOString().slice(0, 10);
  }

  try {
    const summary = await sortDailyLog(user._id, date, { force: !!body.force });
    return Response.json(summary);
  } catch (err) {
    console.error("Daily log sort error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Sort failed" },
      { status: 500 },
    );
  }
}
