import type { ActionFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { generatePasskeyRegistrationOptions } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/register-options
 *
 * Generates WebAuthn registration options for the logged-in user, to be
 * passed into @simplewebauthn/browser's `startRegistration()`. Stashes the
 * challenge in the session so it can be checked in register-verify.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { options, setCookie } = await generatePasskeyRegistrationOptions(
    request,
    user,
  );

  return Response.json(options, { headers: { "Set-Cookie": setCookie } });
}
