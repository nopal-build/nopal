import type { ActionFunctionArgs } from "react-router";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  getHumanByInviteToken,
  isInviteTokenValid,
  consumeInviteToken,
} from "../data/humans.server";
import { verifyPasskeyRegistration } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/invite-register-verify
 *
 * Body: { token: string, response: RegistrationResponseJSON, name?: string }
 *
 * Like /api/passkeys/register-verify, but for a brand new invitee acting on
 * their single-use welcome-email invite token. The token is consumed on
 * success so it can't be replayed.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    token?: string;
    response?: RegistrationResponseJSON;
    name?: string;
  };

  if (!body.token || !body.response) {
    return Response.json(
      { error: "Missing invite token or registration response" },
      { status: 400 },
    );
  }

  const human = await getHumanByInviteToken(body.token);
  if (!human || !isInviteTokenValid(human)) {
    return Response.json(
      { error: "This invite link has expired." },
      { status: 400 },
    );
  }

  const { verified, setCookie, error } = await verifyPasskeyRegistration(
    request,
    human,
    body.response,
    body.name ?? "",
  );

  if (!verified) {
    return Response.json(
      { error: error ?? "Could not verify passkey" },
      { status: 400, headers: { "Set-Cookie": setCookie } },
    );
  }

  await consumeInviteToken(human._id);

  return Response.json(
    { verified: true, email: human.email },
    { headers: { "Set-Cookie": setCookie } },
  );
}
