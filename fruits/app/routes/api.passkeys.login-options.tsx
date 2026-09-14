import type { ActionFunctionArgs } from "react-router";
import { generatePasskeyAuthenticationOptions } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/login-options
 *
 * Body (optional): { email?: string }
 *
 * With no email, generates "usernameless" WebAuthn authentication options
 * (no `allowCredentials`), to be passed into @simplewebauthn/browser's
 * `startAuthentication()`. Doesn't require an existing session, since this
 * is how a signed-out user logs in.
 *
 * With an email, scopes `allowCredentials` to that account's passkeys —
 * used by the "switch account" flow, where the target account is already
 * known and we want the browser to prompt for that account specifically
 * rather than showing every passkey on the device.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let email: string | undefined;
  try {
    const body = (await request.json()) as { email?: string };
    email = body.email?.trim() || undefined;
  } catch {
    // No JSON body — that's fine, falls back to usernameless login.
  }

  const { options, setCookie, error } =
    await generatePasskeyAuthenticationOptions(request, email);

  if (!options) {
    return Response.json(
      { error: error ?? "Could not start passkey login." },
      { status: 400, headers: { "Set-Cookie": setCookie } },
    );
  }

  return Response.json(options, { headers: { "Set-Cookie": setCookie } });
}
