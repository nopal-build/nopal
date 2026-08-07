import crypto from "node:crypto";
import { Authenticator } from "remix-auth";
import { TOTPStrategy } from "remix-auth-totp";
import { redirect } from "react-router";
import { sessionStorage } from "./session.server";
import { sendEmail } from "../../util/email.server";
import { Human, getHumanByEmail, getHumanById } from "../../data/humans.server";
import { LoginCode } from "../../emails/loginCode";
import { recordImpersonationEvent } from "../../data/impersonationEvents.server";
import {
  getApiTokenByHash,
  isApiTokenValid,
  touchApiTokenLastUsed,
} from "../../data/apiTokens.server";

const IMPERSONATION_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day

// ─── Post-login redirect (used by /cli-login → /login → back to /cli-login) ──

const REDIRECT_COOKIE_NAME = "_redirectTo";
const REDIRECT_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

/** Only ever redirect to a same-origin relative path — never an absolute/external URL. */
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://")
  );
}

function buildRedirectCookie(value: string | null): string {
  const base = `${REDIRECT_COOKIE_NAME}=${value ? encodeURIComponent(value) : ""}; Path=/; HttpOnly; SameSite=Lax`;
  const maxAge = value ? `; Max-Age=${REDIRECT_COOKIE_MAX_AGE_SECONDS}` : "; Max-Age=0";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${base}${maxAge}${secure}`;
}

function getRedirectToCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${REDIRECT_COOKIE_NAME}=`));
  if (!cookie) return null;
  try {
    const value = decodeURIComponent(cookie.slice(REDIRECT_COOKIE_NAME.length + 1));
    return isSafeRedirectPath(value) ? value : null;
  } catch {
    return null;
  }
}

export const authenticator = new Authenticator<Human>();

authenticator.use(
  new TOTPStrategy(
    {
      secret: process.env.ENCRYPTION_SECRET || "NOT_A_STRONG_SECRET",
      magicLinkPath: "/magic-link",
      emailSentRedirect: "/verify",
      successRedirect: "/fruits",
      failureRedirect: "/verify",
      sendTOTP: async ({ email, code, magicLink }) => {
        await sendEmail({
          to: [email],
          subject: "Nopal Login Code",
          react: LoginCode({ code, magicLink }),
        });
      },
    },
    async ({ email, request }) => {
      const human = await getHumanByEmail(email);
      if (!human) throw new Error("No account found for that email address.");
      // `/login`'s action already blocks a suspended account before a code
      // is ever sent — this is a defense-in-depth backstop for the (rare)
      // case where the account was suspended *after* the code went out but
      // before it was entered here. A plain `throw redirect(...)` (like the
      // success path below) sends them straight to /login-error instead of
      // through the strategy's normal failureRedirect-to-/verify handling.
      if (human.suspendedAt) throw redirect("/login-error");
      // Set user in session; strategy will catch this Response, add _totp clearing cookie, and re-throw
      const session = await sessionStorage.getSession(
        request.headers.get("cookie"),
      );
      // A fresh, independently-authenticated login always wins over any
      // stale impersonation state left on this browser's session cookie —
      // otherwise logging in as a third account mid-impersonation could
      // leave the "viewing as" banner/expiry pointed at the old admin.
      session.unset("impersonatorId");
      session.unset("impersonatorName");
      session.unset("impersonatorEmail");
      session.unset("impersonationExpiresAt");
      session.set("user", human);
      // Anchors the invalidation check in `getUser` — any `forceLogoutHuman`/
      // `suspendHuman` call that happens *after* this moment will end this
      // session on its next request.
      session.set("sessionIssuedAt", Date.now());

      // If `/login` was reached via a `redirectTo` (e.g. from `/cli-login`),
      // it stashed the target in its own short-lived cookie — honor it here
      // instead of the default `/fruits`, then clear that cookie.
      const redirectTo = getRedirectToCookie(request);
      const headers = new Headers();
      headers.append("Set-Cookie", await sessionStorage.commitSession(session));
      if (redirectTo) headers.append("Set-Cookie", buildRedirectCookie(null));

      throw redirect(redirectTo ?? "/fruits", { headers });
    },
  ),
  "TOTP",
);

/**
 * Wraps `authenticator.authenticate("TOTP", request)` for the *first* step
 * of the login flow (`/login`'s action, which sends the code) so that an
 * optional `redirectTo` survives the multi-step email-to-code round trip:
 * it's stashed in a short-lived cookie appended to whatever response the
 * strategy throws (redirecting to `/verify`, or back to `/login` on
 * failure), and read back out by the success callback above once the code
 * is confirmed. A no-op when `redirectTo` is absent — existing callers are
 * unaffected either way.
 */
export async function authenticateWithRedirect(
  request: Request,
  redirectTo?: string | null,
): Promise<Human> {
  try {
    return await authenticator.authenticate("TOTP", request);
  } catch (err) {
    if (err instanceof Response && isSafeRedirectPath(redirectTo)) {
      try {
        err.headers.append("Set-Cookie", buildRedirectCookie(redirectTo));
      } catch (e) {
        // Headers may be immutable in some runtimes — worst case the
        // redirectTo is lost and login just lands on /fruits as normal.
        console.error("Failed to attach redirectTo cookie:", e);
      }
    }
    throw err;
  }
}

/** Get authenticated user from session, or null if not logged in */
export async function getUser(request: Request): Promise<Human | null> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const cachedUser: Human | null = session.get("user") ?? null;
  if (!cachedUser) return null;

  // If an impersonation session has outlived its window (see
  // `startImpersonation`), treat the real admin as the authorization
  // principal immediately rather than waiting for the next request that
  // can actually rewrite the cookie. `getImpersonationStatus` (polled by
  // `AppLayout` on every page) is what performs that rewrite and makes the
  // "viewing as" banner disappear — this is just a defensive fallback so
  // authorization is never wrong even a moment past expiry.
  const impersonatorId = session.get("impersonatorId");
  const expiresAt = session.get("impersonationExpiresAt");
  const impersonationExpired =
    Boolean(impersonatorId) &&
    typeof expiresAt === "number" &&
    Date.now() > expiresAt;
  const targetId = impersonationExpired ? impersonatorId : cachedUser._id;

  // Sessions are plain signed cookies with no server-side revocation list —
  // an Admin/Super's "force logout" or "suspend" (see `forceLogoutHuman`/
  // `suspendHuman`) can only take effect on an already-issued cookie by
  // re-checking the live record on every request, rather than trusting the
  // (possibly stale, possibly since-revoked) snapshot cached in the cookie.
  const current = await getHumanById(targetId);
  if (!current || current.suspendedAt) return null;

  // Skip the invalidation-timestamp check when we just fell back to the
  // admin above — that path is re-authenticating as the *admin*, whose own
  // session validity was already established at their original login, not
  // at whatever moment `sessionIssuedAt` reflects (impersonation start).
  if (!impersonationExpired) {
    const sessionIssuedAt = session.get("sessionIssuedAt");
    if (
      current.sessionsInvalidatedAt &&
      (typeof sessionIssuedAt !== "number" ||
        new Date(current.sessionsInvalidatedAt).getTime() > sessionIssuedAt)
    ) {
      return null;
    }
  }

  return current;
}

/**
 * Like `getUser`, but also accepts `Authorization: Bearer <token>` — the
 * only way the `nopal` CLI (which has no browser session cookie) can
 * authenticate. Falls back to the normal cookie-based session check, so
 * every existing browser call site is unaffected.
 *
 * Deliberately opt-in per route (see the `api.vault.*` routes) rather than
 * swapped in everywhere — most routes should keep accepting only a real
 * browser session.
 */
export async function getUserFromRequest(request: Request): Promise<Human | null> {
  const resolved = await resolveBearerHuman(request);
  if (resolved !== undefined) {
    // Bearer path. Sync-scoped tokens are REJECTED here — only the
    // explicitly allow-listed sync endpoints (via getScopedUserFromRequest)
    // accept them, so every other route is closed to them by default.
    if (!resolved || resolved.scope === "sync") return null;
    return resolved.human;
  }
  return getUser(request);
}

export type ScopedUser = {
  user: Human;
  /** True when authenticated with a sync-scoped token — the caller must
   * then restrict the operation to content under the syncs/ vault root. */
  syncScoped: boolean;
};

/**
 * Like getUserFromRequest, but ALSO accepts sync-scoped bearer tokens,
 * reporting the scope so the route can apply resource-level checks. Only
 * the endpoints the sync engine needs should use this.
 */
export async function getScopedUserFromRequest(
  request: Request,
): Promise<ScopedUser | null> {
  const resolved = await resolveBearerHuman(request);
  if (resolved !== undefined) {
    if (!resolved) return null;
    return { user: resolved.human, syncScoped: resolved.scope === "sync" };
  }
  const user = await getUser(request);
  return user ? { user, syncScoped: false } : null;
}

/**
 * Resolves the Authorization: Bearer header.
 *   undefined → no bearer header (caller should fall back to the session)
 *   null      → bearer present but invalid/expired/revoked
 */
async function resolveBearerHuman(
  request: Request,
): Promise<{ human: Human; scope: "full" | "sync" } | null | undefined> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return undefined;

  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) return null;

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const token = await getApiTokenByHash(tokenHash);
  if (!token || !isApiTokenValid(token)) return null;

  const human = await getHumanById(token.humanId);
  if (!human || human.suspendedAt) return null;

  // Best-effort — never let a logging failure block the actual request.
  touchApiTokenLastUsed(token._id).catch((e) =>
    console.error("Failed to update api token last-used:", e),
  );
  return { human, scope: token.scope === "sync" ? "sync" : "full" };
}

function canImpersonate(actor: Human, target: Human): string | null {
  if (target._id === actor._id) return "You can't log in as yourself.";
  if (actor.role === "Super") return null; // Supers can impersonate anyone, including other Supers.
  if (actor.role === "Admin") {
    if (target.role === "Human") return null;
    return "Admins can only log in as regular accounts, not other admins.";
  }
  return "You don't have permission to do that.";
}

/**
 * "Login as user" — lets a signed-in Admin/Super view the app exactly as
 * another human sees it, for debugging. Deliberately unrelated to the
 * passkey "switch account" flow: that requires proving possession of the
 * *target's* own passkey, which an admin debugging someone else's account
 * will never have. Here, authorization comes entirely from the *caller's*
 * current session role (re-checked server-side on every call — never
 * trust the client), not from anything the target account owns.
 *
 * The real admin's id/name/email are stashed in the session alongside the
 * swapped-in `user`, plus a hard expiry (`IMPERSONATION_DURATION_MS`) so a
 * forgotten tab can't stay "logged in as someone else" indefinitely.
 * Nesting is disallowed — you must return to your own account (see
 * `stopImpersonation`) before impersonating anyone else.
 */
export async function startImpersonation(
  request: Request,
  targetHumanId: string,
): Promise<{ setCookie: string; error?: string; human?: Human }> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const actor: Human | null = session.get("user") ?? null;

  if (!actor) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: "You must be signed in to do that.",
    };
  }
  if (actor.role !== "Admin" && actor.role !== "Super") {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: "You don't have permission to do that.",
    };
  }
  if (session.get("impersonatorId")) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error:
        "You're already viewing as another account — return to your own account first.",
    };
  }

  const target = await getHumanById(targetHumanId);
  if (!target) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: "That account no longer exists.",
    };
  }
  if (target.suspendedAt) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: "That account is suspended.",
    };
  }

  const permissionError = canImpersonate(actor, target);
  if (permissionError) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: permissionError,
    };
  }

  session.set("user", target);
  session.set("sessionIssuedAt", Date.now());
  session.set("impersonatorId", actor._id);
  session.set("impersonatorName", actor.name);
  session.set("impersonatorEmail", actor.email);
  session.set("impersonationExpiresAt", Date.now() + IMPERSONATION_DURATION_MS);
  const setCookie = await sessionStorage.commitSession(session);

  await recordImpersonationEvent({
    action: "start",
    adminId: actor._id,
    adminEmail: actor.email,
    adminName: actor.name,
    targetId: target._id,
    targetEmail: target.email,
    targetName: target.name,
  });

  return { setCookie, human: target };
}

/**
 * Ends an impersonation session, restoring the real admin as `user`.
 * `reason` distinguishes a manual "Return to admin" click from an
 * automatic revert once the 1-day window lapses, purely for the audit log.
 */
export async function stopImpersonation(
  request: Request,
  reason: "manual" | "expired" = "manual",
): Promise<{ setCookie: string; error?: string }> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const impersonatorId = session.get("impersonatorId");
  if (!impersonatorId) {
    return {
      setCookie: await sessionStorage.commitSession(session),
      error: "You're not currently viewing as another account.",
    };
  }

  const impersonatedUser: Human | null = session.get("user") ?? null;
  const admin = await getHumanById(impersonatorId);

  session.unset("impersonatorId");
  session.unset("impersonatorName");
  session.unset("impersonatorEmail");
  session.unset("impersonationExpiresAt");
  if (admin) {
    session.set("user", admin);
    session.set("sessionIssuedAt", Date.now());
  }

  const setCookie = await sessionStorage.commitSession(session);

  if (admin && impersonatedUser) {
    await recordImpersonationEvent({
      action: reason === "expired" ? "expire" : "stop",
      adminId: admin._id,
      adminEmail: admin.email,
      adminName: admin.name,
      targetId: impersonatedUser._id,
      targetEmail: impersonatedUser.email,
      targetName: impersonatedUser.name,
    });
  }

  return {
    setCookie,
    error: admin
      ? undefined
      : "Could not restore your original account — please log in again.",
  };
}

/**
 * Read-only status check used by `AppLayout`'s "viewing as" banner (polled
 * on every page load). Also the enforcement point for the 1-day
 * impersonation window: a GET request is the one place in this flow that
 * can freely attach a fresh `Set-Cookie` without the admin taking any
 * action, so the actual auto-revert-and-commit happens here.
 */
export async function getImpersonationStatus(request: Request): Promise<{
  impersonating: boolean;
  adminName?: string;
  adminEmail?: string;
  setCookie?: string;
}> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const impersonatorId = session.get("impersonatorId");
  if (!impersonatorId) return { impersonating: false };

  const expiresAt = session.get("impersonationExpiresAt");
  if (typeof expiresAt === "number" && Date.now() > expiresAt) {
    const result = await stopImpersonation(request, "expired");
    return { impersonating: false, setCookie: result.setCookie };
  }

  return {
    impersonating: true,
    adminName: session.get("impersonatorName"),
    adminEmail: session.get("impersonatorEmail"),
  };
}

/**
 * Update the session's stored user (e.g. after editing a profile) so later
 * requests reflect the change. Returns the `Set-Cookie` header to attach to
 * the response.
 */
export async function updateUserSession(
  request: Request,
  user: Human,
): Promise<string> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  session.set("user", user);
  return sessionStorage.commitSession(session);
}

/** Read error message from the _totp cookie (set by TOTPStrategy on failures) */
export function getAuthError(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const totpCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_totp="));
  if (!totpCookie) return null;
  try {
    const value = decodeURIComponent(totpCookie.slice("_totp=".length));
    return new URLSearchParams(value).get("error");
  } catch {
    return null;
  }
}

/** Read email from the _totp cookie (set by TOTPStrategy during the email→verify flow) */
export function getAuthEmail(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const totpCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_totp="));
  if (!totpCookie) return null;
  try {
    const value = decodeURIComponent(totpCookie.slice("_totp=".length));
    return new URLSearchParams(value).get("email");
  } catch {
    return null;
  }
}
