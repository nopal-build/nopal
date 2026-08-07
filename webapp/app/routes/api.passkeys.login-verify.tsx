import type { ActionFunctionArgs } from "react-router";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyPasskeyAuthentication } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/login-verify
 *
 * Body: { response: AuthenticationResponseJSON }
 *
 * Verifies the response from @simplewebauthn/browser's
 * `startAuthentication()`, identifies the human by the credential's stored
 * humanId, and logs them in (sets the `user` session cookie) on success.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    response?: AuthenticationResponseJSON;
  };

  if (!body.response) {
    return Response.json(
      { error: "Missing authentication response" },
      { status: 400 },
    );
  }

  const { verified, setCookie, error, suspended } =
    await verifyPasskeyAuthentication(request, body.response);

  if (!verified) {
    return Response.json(
      { error: error ?? "Could not verify passkey", suspended },
      { status: 400, headers: { "Set-Cookie": setCookie } },
    );
  }

  return Response.json(
    { verified: true },
    { headers: { "Set-Cookie": setCookie } },
  );
}
