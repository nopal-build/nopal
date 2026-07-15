import type { ActionFunctionArgs } from "react-router";
import { consumeExchangeCode } from "../data/apiTokens.server";
import { getHumanById } from "../data/humans.server";

/**
 * POST /api/cli-auth/exchange
 * Body (JSON): { code }
 * Returns: { token, email, expires_at }
 *
 * Called directly by the `nopal` CLI over HTTPS (never by the browser) once
 * it receives the one-time `code` on its local callback server. This is the
 * only place the real 30-day bearer token is ever revealed — deliberately
 * kept out of any browser-visible URL. No session/cookie is required here;
 * possession of the short-lived, single-use `code` is the credential.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code;
  if (!code || typeof code !== "string") {
    return Response.json({ error: "code is required" }, { status: 400 });
  }

  const exchanged = await consumeExchangeCode(code);
  if (!exchanged) {
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  const human = await getHumanById(exchanged.humanId);
  if (!human) {
    return Response.json({ error: "Account no longer exists" }, { status: 404 });
  }

  return Response.json({
    token: exchanged.token,
    email: human.email,
    expires_at: exchanged.expiresAt.slice(0, 10),
  });
}
