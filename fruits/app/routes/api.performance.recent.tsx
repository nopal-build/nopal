import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { listRecentPerfRequests } from "robustness-core/data/requestPerf.server";

const MAX_LIMIT = 200;

/**
 * GET /api/performance/recent?limit=50
 *
 * Most recent traced requests, newest first — see `requestPerf.server.ts`.
 * Admin/Super only, same gate as `/maker/performance`. The machine-
 * readable hook for `nopal perf recent`; each row's `_id` is the value to
 * pass to `nopal perf show <id>` for the full event timeline.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : 50;

  const requests = await listRecentPerfRequests(limit);
  return Response.json({ requests });
}
