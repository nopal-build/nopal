/**
 * Client-side "known accounts" list, used by the passkey "switch account"
 * flow to remember which emails have been signed into on this device/
 * browser. This is purely a UX convenience — it's not authoritative, holds
 * no secrets, and the server independently verifies the passkey for
 * whichever email is chosen.
 */

const STORAGE_KEY = "nopal:known-accounts";
const MAX_ACCOUNTS = 8;

export type KnownAccount = { email: string; name: string };

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
