import type { ActionFunctionArgs } from "react-router";
import { pauseCheck } from "robustness-core/data/billingPlans.server";
import { sendPlanNotices } from "../data/billingNotices.server";

/**
 * POST /api/billing/pause-check
 *
 * The daily pause check (payments seed): a plan paused five months gets
 * an email to its Clients; at six months with no resume request, its
 * guide hears. Each goes once per pause (`pauseCheck`). Protected by the
 * same CRON_SECRET as `api.vault.trash-cleanup.tsx` and wired into the
 * server's daily cron next to it (server.js).
 *
 * The server calls itself on localhost, so the email links take
 * APP_BASE_URL, falling back to the production app.
 *
 *   curl -X POST https://<your-app>.fly.dev/api/billing/pause-check \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("pause-check: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const notices = await pauseCheck();
  await sendPlanNotices(notices, process.env.APP_BASE_URL || "https://o.nopal.build");
  const count = (type: string) => notices.filter((n) => n.type === type).length;
  return Response.json({ warned: count("pause_warn"), alerted: count("pause_alert"), held: count("work_on_hold") });
}
