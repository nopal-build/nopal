import crypto from "node:crypto";
import {
  createHuman,
  getHumanById,
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
/** Minimum time between invite emails to the same human — see `canResendInvite`. */
export const INVITE_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute

function getAppBaseUrl(request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return FALLBACK_APP_BASE_URL;
}

/**
 * Generate a fresh invite token for `human` and email them the welcome
 * message. Shared by the initial invite and any later resend, so both
 * paths always produce an identical email/link shape.
 */
async function sendInviteEmail(human: Human, request?: Request): Promise<void> {
  let invitedByName: string | undefined;
  if (human.invitedByHumanId) {
    const [inviter] = await getHumansById([human.invitedByHumanId]);
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
      inviteNote: human.inviteNote,
      loginUrl,
      passkeySetupUrl,
    }),
  });
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
  await sendInviteEmail(human, request);

  return getHumanById(human._id);
}

/**
 * True once at least `INVITE_RESEND_COOLDOWN_MS` has passed since the last
 * invite email was sent to this human (or if none has been sent yet).
 */
export function canResendInvite(human: Human): boolean {
  if (!human.inviteSentAt) return true;
  return (
    Date.now() - new Date(human.inviteSentAt).getTime() >=
    INVITE_RESEND_COOLDOWN_MS
  );
}

/**
 * Re-send the welcome/invite email to a human who hasn't finished setting
 * up their account yet (generates a fresh token so old links stop working).
 * Throttled via `canResendInvite` — callers should check that first and
 * surface a friendly error instead of calling this blindly.
 */
export async function resendInvite(
  human: Human,
  request?: Request,
): Promise<Human | undefined> {
  if (!canResendInvite(human)) return undefined;
  await sendInviteEmail(human, request);
  return getHumanById(human._id);
}
