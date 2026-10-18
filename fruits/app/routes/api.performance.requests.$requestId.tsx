import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getPerfRequest } from "robustness-core/data/requestPerf.server";

/**
 * GET /api/performance/requests/:requestId
 *
 * One traced request plus its full "fn"/"db" event timeline, in order —
 * see `requestPerf.server.ts`. Admin/Super only, same gate as
 * `/maker/performance`. The machine-readable hook for `nopal perf show
 * <id>` — the intent is an AI agent can pull this directly (route, total
 * duration, every function/DB-call duration in order) to find the real
 * bottleneck, rather than a human reading the dashboard and describing it
 * back in words.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestId = params.requestId;
  if (!requestId) return Response.json({ error: "requestId required" }, { status: 400 });

  const found = await getPerfRequest(requestId);
  if (!found) return Response.json({ error: "Request not found" }, { status: 404 });

  return Response.json(found);
}
