/**
 * Client-side "known accounts" list, used by the passkey "switch account"
 * flow to remember which emails have been signed into on this device/
 * browser. This is purely a UX convenience — it's not authoritative, holds
 * no secrets, and the server independently verifies the passkey for
 * whichever email is chosen.
 */

const STORAGE_KEY = "nopal:known-accounts";
const MAX_ACCOUNTS = 8;

export type KnownAccount = {
  email: string;
  name: string;
  /**
   * How this account was reached, so the "switch account" modal knows how
   * to switch back to it:
   * - undefined/"passkey" (default): a real account the browser has a
   *   passkey for — switching re-runs the WebAuthn login flow.
   * - "impersonation": reached via an admin's "Login as user" tool.
   *   Switching re-POSTs the impersonation endpoint instead, since the
   *   admin doesn't hold (and never needs) this account's own passkey.
   *   Purely a client-side hint — the server independently re-verifies
   *   the *caller's* admin/super role on every impersonation request, so
   *   a stale or spoofed flag here can't grant access on its own.
   */
  via?: "passkey" | "impersonation";
};

export function getKnownAccounts(): KnownAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is KnownAccount =>
        !!entry &&
        typeof entry.email === "string" &&
        typeof entry.name === "string",
    );
  } catch {
    return [];
  }
}

/** Remembers an account, moving it to the front if already known. */
export function rememberAccount(account: KnownAccount): void {
  if (typeof window === "undefined") return;
  const rest = getKnownAccounts().filter(
    (a) => a.email.toLowerCase() !== account.email.toLowerCase(),
  );
  const updated = [account, ...rest].slice(0, MAX_ACCOUNTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function forgetAccount(email: string): void {
  if (typeof window === "undefined") return;
  const updated = getKnownAccounts().filter(
    (a) => a.email.toLowerCase() !== email.toLowerCase(),
  );
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
