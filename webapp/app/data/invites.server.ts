import crypto from "node:crypto";
import {
  createHuman,
  getHumansById,
  setInviteToken,
  type Human,
  type Role,
} from "./humans.server";
import { provisionNewUserVault } from "./dailyLog.server";
import { sendEmail } from "../util/email.server";
import { Welcome } from "../emails/welcome";

// Fallback for contexts with no `Request` available (e.g. scripts). Any
// call site with access to the incoming request should pass it in so the
// links point at the actual host (localhost in dev, nopal.build in prod).
const FALLBACK_APP_BASE_URL = "https://nopal.build";
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAppBaseUrl(request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return FALLBACK_APP_BASE_URL;
}

/**
 * Create a new human and send them a welcome email. This is the entry point
 * that should be used anywhere a human is added to the system (admin panel,
 * relationship invites, etc.) so the welcome email is never skipped.
 *
 * Pass the current `request` so the welcome email's links point at the
 * right host (localhost in dev, nopal.build in prod) instead of always
 * pointing at production.
 */
export async function inviteHuman(
  data: {
    email: string;
    name: string;
    role: Role;
    inviteNote?: string;
    invitedByHumanId?: string;
  },
  request?: Request,
): Promise<Human | undefined> {
  const human = await createHuman(data);
  if (!human) return undefined;

  await provisionNewUserVault(human._id);

  let invitedByName: string | undefined;
  if (data.invitedByHumanId) {
    const [inviter] = await getHumansById([data.invitedByHumanId]);
    invitedByName = inviter?.name;
  }

  const inviteToken = crypto.randomBytes(32).toString("base64url");
  const inviteTokenExpiresAt = new Date(
    Date.now() + INVITE_TOKEN_TTL_MS,
  ).toISOString();
  await setInviteToken(human._id, inviteToken, inviteTokenExpiresAt);

  const appBaseUrl = getAppBaseUrl(request);
  const loginUrl = `${appBaseUrl}/login?email=${encodeURIComponent(human.email)}`;
  const passkeySetupUrl = `${appBaseUrl}/welcome/${inviteToken}`;

  await sendEmail({
    to: [human.email],
    subject: "Welcome to Nopal",
    react: Welcome({
      name: human.name,
      invitedByName,
      inviteNote: data.inviteNote,
      loginUrl,
      passkeySetupUrl,
    }),
  });

  return human;
}
