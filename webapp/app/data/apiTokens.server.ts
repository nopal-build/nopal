import crypto from "node:crypto";
import { RecordId } from "surrealdb";
import { Data, query, select, formatRecord, upsert, merge } from "./generic.server";

// 30-day CLI session, matching what `nopal login` reports to the user.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// The exchange code only needs to survive the redirect from the approval
// page to the CLI's local callback server — a handful of seconds in
// practice. Kept short since, unlike the token itself, it's briefly visible
// in a browser URL/history.
const EXCHANGE_CODE_TTL_MS = 60 * 1000;

export type ApiToken = Data & {
  humanId: string;
  /** Human-readable label, e.g. "CLI login on Gs-MacBook-Pro.local". */
  name: string;
  /** sha256 hex digest of the raw bearer token — the raw value is never stored long-term. */
  tokenHash: string;
  /**
   * What the token may do. "full" (default) = everything the human can do.
   * "sync" = only the sync-engine endpoints, and only content under the
   * syncs/ vault root — see getScopedUserFromRequest in auth.server.ts.
   * "sorter" = same access as "full" today (it isn't rejected anywhere
   * `getUserFromRequest` is used, the same way "full" isn't) — reserved
   * for an eventual sorting agent authenticating as a human, same "CLI/API
   * is the agent's tool surface" design as `sortDailyLog`/`POST
   * /api/daily-log/sort` itself (see `sorter.server.ts`). No minting UI
   * exists for this scope yet (unlike "sync", which has one on the
   * profile page) — it's declared ahead of that so the sort endpoint
   * already recognizes it once one does.
   */
  scope?: "full" | "sync" | "sorter";
  createdAt: string;
  /** Null = never expires (used by revocable sync-scoped tokens). */
  expiresAt: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  // ─── Ephemeral cli-login handoff — set by `createApiTokenWithExchangeCode`,
  // cleared by the first (and only) call to `consumeExchangeCode`. ─────────
  exchangeCode?: string | null;
  exchangeCodeExpiresAt?: string | null;
  pendingRawToken?: string | null;
};

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a durable 30-day API token for `humanId` and stages it behind a
 * short-lived, single-use exchange code. The raw token itself is handed
 * back to the *browser* only far enough to redirect to the CLI's local
 * callback with the *code* — never the token — so `consumeExchangeCode`
 * (called directly by the CLI over HTTPS, not via the browser) is the only
 * place the raw token is ever revealed.
 */
export async function createApiTokenWithExchangeCode(
  humanId: string,
  name: string,
): Promise<{ code: string } | undefined> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const code = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();

  const result = await upsert("api_tokens", {
    humanId,
    name,
    tokenHash: hashToken(rawToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    exchangeCode: code,
    exchangeCodeExpiresAt: new Date(now + EXCHANGE_CODE_TTL_MS).toISOString(),
    pendingRawToken: rawToken,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? { code } : undefined;
}

/**
 * Single-use: resolves `code` to the raw token/human/expiry it was staged
 * with, then immediately clears the handoff fields so the same code can
 * never be exchanged twice — expired or not, valid or not.
 */
export async function consumeExchangeCode(
  code: string,
): Promise<{ token: string; humanId: string; expiresAt: string } | undefined> {
  const result = await query<[ApiToken[]]>(
    `SELECT * FROM api_tokens WHERE exchangeCode = $exchangeCode;`,
    { exchangeCode: code },
  );
  const record = result?.[0]?.[0];
  if (!record) return undefined;
  const token = formatRecord(record);

  await merge("api_tokens", token._id, {
    exchangeCode: null,
    exchangeCodeExpiresAt: null,
    pendingRawToken: null,
  });

  const stillValid =
    !!token.exchangeCodeExpiresAt &&
    new Date(token.exchangeCodeExpiresAt).getTime() > Date.now();

  if (!stillValid || !token.pendingRawToken) return undefined;

  return {
    token: token.pendingRawToken,
    humanId: token.humanId,
    // Login-flow tokens always carry an expiry (set above); the null case
    // only exists for sync-scoped tokens, which never pass through here.
    expiresAt: token.expiresAt ?? "",
  };
}

export async function getApiTokenByHash(
  tokenHash: string,
): Promise<ApiToken | undefined> {
  const result = await query<[ApiToken[]]>(
    `SELECT * FROM api_tokens WHERE tokenHash = $tokenHash;`,
    { tokenHash },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

export function isApiTokenValid(token: ApiToken): boolean {
  if (token.revokedAt) return false;
  // expiresAt null/absent = never expires (revocation is the kill switch).
  if (!token.expiresAt) return true;
  return new Date(token.expiresAt).getTime() > Date.now();
}

/**
 * Mints a sync-scoped token: never expires, revocable, and only accepted by
 * the sync-engine endpoints (every other route rejects it). Returns the raw
 * token — shown once, never stored.
 */
export async function createSyncScopedToken(
  humanId: string,
  name: string,
): Promise<{ token: string; tokenId: string } | undefined> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const result = await upsert("api_tokens", {
    humanId,
    name,
    tokenHash: hashToken(rawToken),
    scope: "sync",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  });
  const record = Array.isArray(result) ? result[0] : result;
  if (!record) return undefined;
  const formatted = formatRecord(record as unknown as ApiToken);
  return { token: rawToken, tokenId: formatted._id };
}

/** Best-effort — callers should not let a failure here block a request. */
export async function touchApiTokenLastUsed(id: string): Promise<void> {
  await merge("api_tokens", id, { lastUsedAt: new Date().toISOString() });
}

export async function getApiTokensByHuman(humanId: string): Promise<ApiToken[]> {
  const result = await query<[ApiToken[]]>(
    `SELECT * FROM api_tokens WHERE humanId = $humanId AND revokedAt IS NULL ORDER BY createdAt DESC;`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Scoped so a human can only revoke their own tokens — mirrors passkey deletion. */
export async function revokeApiToken(
  id: string,
  humanId: string,
): Promise<boolean> {
  const token = await select<ApiToken>(new RecordId("api_tokens", id));
  if (!token || token.humanId !== humanId) return false;
  await merge("api_tokens", id, { revokedAt: new Date().toISOString() });
  return true;
}
