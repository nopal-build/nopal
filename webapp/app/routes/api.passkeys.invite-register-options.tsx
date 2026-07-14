import type { ActionFunctionArgs } from "react-router";
import {
  getHumanByInviteToken,
  isInviteTokenValid,
} from "../data/humans.server";
import { generatePasskeyRegistrationOptions } from "../modules/auth/webauthn.server";

/**
 * POST /api/passkeys/invite-register-options
 *
 * Body: { token: string }
 *
 * Like /api/passkeys/register-options, but for a brand new invitee who
 * doesn't have a session yet. Authorization comes from the single-use
 * invite token embedded in their welcome email instead of a logged-in user.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as { token?: string };
  if (!body.token) {
    return Response.json({ error: "Missing invite token" }, { status: 400 });
  }

  const human = await getHumanByInviteToken(body.token);
  if (!human || !isInviteTokenValid(human)) {
    return Response.json(
      { error: "This invite link has expired." },
      { status: 400 },
    );
  }

  const { options, setCookie } = await generatePasskeyRegistrationOptions(
    request,
    human,
  );

  return Response.json(options, { headers: { "Set-Cookie": setCookie } });
}
