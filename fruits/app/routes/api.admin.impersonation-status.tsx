import type { LoaderFunctionArgs } from "react-router";
import { getImpersonationStatus } from "../modules/auth/auth.server";

/**
 * GET /api/admin/impersonation-status
 *
 * Polled client-side by `AppLayout` on every page to render the "viewing
 * as" banner. Also doubles as the enforcement point for the 1-day
 * impersonation window — GET requests are the one place in this flow that
 * can freely attach a fresh Set-Cookie without an explicit user action, so
 * the auto-revert on expiry happens here (see `getImpersonationStatus`).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const status = await getImpersonationStatus(request);
  return Response.json(
    status,
    status.setCookie ? { headers: { "Set-Cookie": status.setCookie } } : undefined,
  );
}
