import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getPerfSummary } from "robustness-core/data/requestPerf.server";

/**
 * GET /api/performance/summary?days=7|30
 *
 * High-level server request-performance stats — see
 * `requestPerf.server.ts`'s own header for what's actually measured
 * (server-side only, real wall-clock durations). Admin/Super only, same
 * gate as `/maker/performance`. The direct machine-readable hook for
 * `nopal perf summary` (`crates/cli/src/perf.rs`) — the intent is that an
 * AI agent inspecting slowness reaches for this instead of parsing the
 * dashboard's HTML.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = url.searchParams.get("days") === "30" ? 30 : 7;

  const summary = await getPerfSummary(days);
  return Response.json({ days, summary });
}
