/**
 * Vault Root Folders — the locked, system-provisioned folders at the top of
 * every human's vault. This list will grow over time.
 *
 * Root folders:
 *   - cannot be created, renamed, or deleted by a human (or the API)
 *   - are purely organizational for the Nopal app
 *   - define per-root behavior policies (e.g. whether folders inside that
 *     root subtree may be shared, or who may write into them at all)
 *
 * Every vault folder carries a `vault_root_key` identifying which root
 * subtree it belongs to, denormalized at creation time so policy checks are
 * O(1) — no parent-chain walking. Files derive their root key from their
 * containing folder.
 *
 * This file has NO server-only imports — safe on both client and server.
 * `Role` is imported as a TYPE ONLY (`import type`, erased at compile time)
 * so this stays true even though `Role` is declared in a `.server.ts` file.
 */

import type { Role } from "./humans.server";

export type VaultRootKey = "daily-logs" | "projects" | "personal";

export type VaultRootPolicy = {
  /** Display name in the UI. */
  label: string;
  /** Whether folders *within* this root subtree may be shared with other
   * humans. The root container itself is never shareable. */
  shareable: boolean;
  /** Whether folders *within* this root subtree may be published to a
   * public, unauthenticated URL. The root container itself is never
   * publishable. Distinct from `shareable` — sharing grants access to
   * specific Nopal humans; publishing is fully public, no account needed. */
  publishable: boolean;
  /** Default sort for the root folder's direct children. */
  childSort: "name-asc" | "name-desc";
  /** Who may create/edit/delete folders and files *within* this root
   * subtree (the root container itself is never writable by anyone,
   * regardless of this setting — see the "cannot be created, renamed, or
   * deleted" rule above). `"owner"` is the rule every root uses today (the
   * owning human may write to their own vault). `"admin"` would
   * additionally require the ACTING human to hold the `Admin` or `Super`
   * role — none of today's roots need it (that restriction now lives one
   * level deeper, on the `skills` FOLDER TYPE — see `vaultFolderTypes.ts`),
   * but the mechanism stays here for a future root that might. Enforced
   * server-side in every `api.vault.*` write route, not just a hidden
   * button — see the `vault` skill. */
  writable: "owner" | "admin";
};

export const VAULT_ROOTS: Record<VaultRootKey, VaultRootPolicy> = {
  "daily-logs": {
    label: "Daily Logs",
    shareable: false,
    // Personal journal entries — not publishable by default.
    publishable: false,
    // Date-named folders (YYYY-MM-DD): latest → oldest.
    childSort: "name-desc",
    writable: "owner",
  },
  projects: {
    label: "Projects",
    shareable: true,
    publishable: true,
    childSort: "name-asc",
    writable: "owner",
  },
  personal: {
    label: "Personal",
    shareable: false,
    publishable: true,
    childSort: "name-asc",
    writable: "owner",
  },
};

export const VAULT_ROOT_KEYS = Object.keys(VAULT_ROOTS) as VaultRootKey[];

export function isVaultRootKey(value: unknown): value is VaultRootKey {
  return typeof value === "string" && value in VAULT_ROOTS;
}

/** Whether content under the given root may be shared. Unknown/missing keys
 * are treated as NOT shareable — fail closed. */
export function isRootShareable(key: string | null | undefined): boolean {
  return isVaultRootKey(key) ? VAULT_ROOTS[key].shareable : false;
}

/** Whether content under the given root may be published publicly. Unknown/
 * missing keys are treated as NOT publishable — fail closed. */
export function isRootPublishable(key: string | null | undefined): boolean {
  return isVaultRootKey(key) ? VAULT_ROOTS[key].publishable : false;
}

/** Whether `role` may write (create/edit/delete folders or files) into the
 * given root subtree — the ownership check (is this even the acting
 * human's OWN vault?) is separate and always happens FIRST in every
 * `api.vault.*` route; this is the ADDITIONAL role gate on top of that.
 * See `canWriteToFolderType` (`vaultFolderTypes.ts`) for the equivalent,
 * ADDITIONAL gate on the more granular folder TYPE a folder may carry
 * (e.g. `skills`) — both must pass. Unknown/missing keys are treated as
 * `"owner"`-only content by an unrecognized role — fail closed by
 * requiring Admin/Super, never silently allowing a plain `Human` write
 * into something this function doesn't recognize. */
export function canWriteToRoot(
  key: string | null | undefined,
  role: Role,
): boolean {
  const policy = isVaultRootKey(key) ? VAULT_ROOTS[key] : null;
  const writable = policy?.writable ?? "admin";
  if (writable === "owner") return true;
  return role === "Admin" || role === "Super";
}
