import type { ActionFunctionArgs } from "react-router";
import { stopImpersonation } from "../modules/auth/auth.server";

/**
 * POST /api/admin/stop-impersonating
 *
 * Ends the current "login as user" session and restores the real admin.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { setCookie, error } = await stopImpersonation(request);

  if (error) {
    return Response.json(
      { error },
      { status: 400, headers: { "Set-Cookie": setCookie } },
    );
  }

  return Response.json(
    { success: true },
    { headers: { "Set-Cookie": setCookie } },
  );
}
