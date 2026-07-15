import crypto from "node:crypto";
import { RecordId } from "surrealdb";
import {
  Data,
  Collection,
  query,
  select,
  formatRecord,
  upsert,
  merge,
  remove,
} from "./generic.server";

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_CODE_MAX_ATTEMPTS = 5;

export type Role = "Super" | "Admin" | "Human";

export type Human = Data & {
  email: string;
  name: string;
  role: Role;
  /** Optional note left by the inviter, shown to the invitee for context. */
  inviteNote?: string;
  /** Human id of whoever invited/created this human, if any. */
  invitedByHumanId?: string;
  /**
   * Single-use token embedded in the welcome email, letting a brand new
   * invitee set up a passkey before they've ever logged in — i.e. before
   * we'd otherwise have any session to authorize them with.
   */
  inviteToken?: string;
  inviteTokenExpiresAt?: string;
  /**
   * When the welcome/invite email was last sent (initial invite or a later
   * resend). Used to throttle resends — see `canResendInvite` in
   * invites.server.ts.
   */
  inviteSentAt?: string;
  /**
   * Other email addresses that also sign in to this same account — e.g. if
   * someone was invited under a second address that turned out to belong
   * to an existing human.
   */
  aliasEmails?: string[];
  /**
   * A pending, not-yet-verified email address being added as an alias or
   * swapped in as the primary. Only one pending change is tracked at a
   * time — starting a new one invalidates any previous code.
   */
  pendingEmail?: string;
  pendingEmailType?: "alias" | "primary";
  pendingEmailCode?: string;
  pendingEmailCodeExpiresAt?: string;
  pendingEmailAttempts?: number;
};

export type Humans = Collection<Human>;

export async function getHumans(): Promise<Humans | undefined> {
  return select<Human>(`humans`);
}

export async function getHumanByEmail(
  email: string,
): Promise<Human | undefined> {
  const result = await query<[Human[]]>(
    `SELECT * FROM humans WHERE string::lowercase(email) = $email OR aliasEmails CONTAINS $email;`,
    {
      email: email.trim().toLowerCase(),
    },
  );

  const record = result?.[0]?.[0] || undefined;
  return record ? formatRecord(record) : undefined;
}

export async function createHuman(data: {
  email: string;
  name: string;
  role: Role;
  inviteNote?: string;
  invitedByHumanId?: string;
}): Promise<Human | undefined> {
  const result = await upsert("humans", {
    ...data,
    email: data.email.trim().toLowerCase(),
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as Human) : undefined;
}

export async function updateHuman(
  id: string,
  data: { email: string; name: string; role: Role },
): Promise<Human | undefined> {
  const result = await upsert(`humans:${id}`, {
    ...data,
    email: data.email.trim().toLowerCase(),
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as Human) : undefined;
}

export async function deleteHuman(id: string): Promise<void> {
  await remove("humans", id);
}

export async function getHumanById(id: string): Promise<Human | undefined> {
  return select<Human>(new RecordId("humans", id));
}

export async function setInviteToken(
  id: string,
  inviteToken: string,
  inviteTokenExpiresAt: string,
): Promise<void> {
  await merge("humans", id, {
    inviteToken,
    inviteTokenExpiresAt,
    inviteSentAt: new Date().toISOString(),
  });
}

export async function getHumanByInviteToken(
  token: string,
): Promise<Human | undefined> {
  // Note: the bind parameter is deliberately NOT named `$token` — SurrealDB
  // reserves that name for its own auth/JWT system and rejects queries that
  // try to set it ("'token' is a protected variable and cannot be set"),
  // which silently failed this lookup every time.
  const result = await query<[Human[]]>(
    `SELECT * FROM humans WHERE inviteToken = $inviteToken;`,
    { inviteToken: token },
  );
  const record = result?.[0]?.[0] || undefined;
  return record ? formatRecord(record) : undefined;
}

/** Single-use: clear the token once it's been used to set up a passkey. */
export async function consumeInviteToken(id: string): Promise<void> {
  await merge("humans", id, {
    inviteToken: null,
    inviteTokenExpiresAt: null,
  });
}

export function isInviteTokenValid(human: Human): boolean {
  return Boolean(
    human.inviteToken &&
      human.inviteTokenExpiresAt &&
      new Date(human.inviteTokenExpiresAt).getTime() > Date.now(),
  );
}

/**
 * Record that `aliasEmail` also signs in to `id`'s account. Used when
 * someone was invited under a second address that turns out to belong to an
 * existing human, so they can merge instead of ending up with two accounts.
 */
export async function addAliasEmail(
  id: string,
  aliasEmail: string,
): Promise<Human | undefined> {
  const human = await getHumanById(id);
  if (!human) return undefined;

  const normalized = aliasEmail.trim().toLowerCase();
  const aliasEmails = Array.from(
    new Set([...(human.aliasEmails ?? []), normalized]),
  );
  await merge("humans", id, { aliasEmails });
  return getHumanById(id);
}

export async function removeAliasEmail(
  id: string,
  aliasEmail: string,
): Promise<Human | undefined> {
  const human = await getHumanById(id);
  if (!human) return undefined;

  const normalized = aliasEmail.trim().toLowerCase();
  const aliasEmails = (human.aliasEmails ?? []).filter(
    (e) => e !== normalized,
  );
  await merge("humans", id, { aliasEmails });
  return getHumanById(id);
}

export async function updateHumanName(
  id: string,
  name: string,
): Promise<Human | undefined> {
  await merge("humans", id, { name: name.trim() });
  return getHumanById(id);
}

/**
 * True if `email` is already the primary or an alias of a *different*
 * human. Checked before sending a verification code, and again right
 * before applying it, so two accounts never end up sharing a login
 * address.
 */
export async function isEmailTakenByAnotherHuman(
  email: string,
  excludeHumanId: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await query<[Human[]]>(
    `SELECT * FROM humans WHERE (string::lowercase(email) = $email OR aliasEmails CONTAINS $email) AND id != $excludeId;`,
    { email: normalized, excludeId: new RecordId("humans", excludeHumanId) },
  );
  return (result?.[0]?.length ?? 0) > 0;
}

/**
 * Start a pending email change: generates a fresh 6-digit code, stores it
 * (overwriting any previous pending change), and returns it so the caller
 * can email it. Nothing about the account changes until the code is
 * verified via `applyPendingEmailChange`.
 */
export async function startEmailChange(
  id: string,
  email: string,
  type: "alias" | "primary",
): Promise<{ human: Human; code: string } | undefined> {
  const normalized = email.trim().toLowerCase();
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeExpiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString();

  await merge("humans", id, {
    pendingEmail: normalized,
    pendingEmailType: type,
    pendingEmailCode: code,
    pendingEmailCodeExpiresAt: codeExpiresAt,
    pendingEmailAttempts: 0,
  });

  const human = await getHumanById(id);
  return human ? { human, code } : undefined;
}

export function isPendingEmailCodeValid(human: Human): boolean {
  return Boolean(
    human.pendingEmail &&
      human.pendingEmailCode &&
      human.pendingEmailCodeExpiresAt &&
      new Date(human.pendingEmailCodeExpiresAt).getTime() > Date.now(),
  );
}

export async function clearPendingEmailChange(id: string): Promise<void> {
  await merge("humans", id, {
    pendingEmail: null,
    pendingEmailType: null,
    pendingEmailCode: null,
    pendingEmailCodeExpiresAt: null,
    pendingEmailAttempts: null,
  });
}

/** Record a failed code attempt; clears the pending change once the cap is hit. */
export async function recordFailedEmailCodeAttempt(
  human: Human,
): Promise<{ attemptsRemaining: number }> {
  const attempts = (human.pendingEmailAttempts ?? 0) + 1;
  if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await clearPendingEmailChange(human._id);
    return { attemptsRemaining: 0 };
  }
  await merge("humans", human._id, { pendingEmailAttempts: attempts });
  return { attemptsRemaining: EMAIL_CODE_MAX_ATTEMPTS - attempts };
}

/**
 * Apply a verified pending email change. For an alias, add it. For a
 * primary change, swap the primary email and demote the old one to an
 * alias so it still logs in — nobody gets locked out of their own account
 * by an email edit.
 */
export async function applyPendingEmailChange(
  human: Human,
): Promise<Human | undefined> {
  if (!human.pendingEmail || !human.pendingEmailType) return undefined;

  if (human.pendingEmailType === "alias") {
    await addAliasEmail(human._id, human.pendingEmail);
    await clearPendingEmailChange(human._id);
    // Re-fetch after both writes so the returned record reflects the new
    // alias AND the cleared pending state — `addAliasEmail`'s own return
    // value is a snapshot taken before `clearPendingEmailChange` runs, so
    // returning it directly would leave `pendingEmail` looking still-set.
    return getHumanById(human._id);
  }

  const oldEmail = human.email.trim().toLowerCase();
  const aliasEmails = Array.from(
    new Set([...(human.aliasEmails ?? []), oldEmail]),
  ).filter((e) => e !== human.pendingEmail);

  await merge("humans", human._id, {
    email: human.pendingEmail,
    aliasEmails,
    pendingEmail: null,
    pendingEmailType: null,
    pendingEmailCode: null,
    pendingEmailCodeExpiresAt: null,
    pendingEmailAttempts: null,
  });
  return getHumanById(human._id);
}

export async function getHumansById(ids: string[]): Promise<Human[]> {
  if (!ids.length) return [];
  const result = await query<[Human[]]>(
    `SELECT * FROM humans WHERE id IN $ids`,
    { ids: ids.map((id) => new RecordId("humans", id)) },
  );
  return (result?.[0] ?? []).map(formatRecord);
}
