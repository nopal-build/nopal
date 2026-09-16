import type { ActionFunctionArgs } from "react-router";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getUser } from "../modules/auth/auth.server";
import { verifyPasskeyRegistration } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/register-verify
 *
 * Body: { response: RegistrationResponseJSON, name?: string }
 *
 * Verifies the response from @simplewebauthn/browser's `startRegistration()`
 * against the challenge stashed in the session, and saves the credential.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    response?: RegistrationResponseJSON;
    name?: string;
  };

  if (!body.response) {
    return Response.json(
      { error: "Missing registration response" },
      { status: 400 },
    );
  }

  const { verified, setCookie, error } = await verifyPasskeyRegistration(
    request,
    user,
    body.response,
    body.name ?? "",
  );

  if (!verified) {
    return Response.json(
      { error: error ?? "Could not verify passkey" },
      { status: 400, headers: { "Set-Cookie": setCookie } },
    );
  }

  return Response.json({ verified: true }, { headers: { "Set-Cookie": setCookie } });
}
