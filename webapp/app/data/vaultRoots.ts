/**
 * Vault Root Folders — the locked, system-provisioned folders at the top of
 * every human's vault. This list will grow over time (e.g. skills, syncs).
 *
 * Root folders:
 *   - cannot be created, renamed, or deleted by a human (or the API)
 *   - are purely organizational for the Nopal app
 *   - define per-root behavior policies (e.g. whether folders inside that
 *     root subtree may be shared)
 *
 * Every vault folder carries a `vault_root_key` identifying which root
 * subtree it belongs to, denormalized at creation time so policy checks are
 * O(1) — no parent-chain walking. Files derive their root key from their
 * containing folder.
 *
 * This file has NO server-only imports — safe on both client and server.
 */

export type VaultRootKey = "daily-logs" | "projects" | "personal" | "syncs";

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
};

export const VAULT_ROOTS: Record<VaultRootKey, VaultRootPolicy> = {
  "daily-logs": {
    label: "Daily Logs",
    shareable: false,
    // Personal journal entries — not publishable by default.
    publishable: false,
    // Date-named folders (YYYY-MM-DD): latest → oldest.
    childSort: "name-desc",
  },
  projects: {
    label: "Projects",
    shareable: true,
    publishable: true,
    childSort: "name-asc",
  },
  personal: {
    label: "Personal",
    shareable: false,
    publishable: true,
    childSort: "name-asc",
  },
  syncs: {
    label: "Syncs",
    shareable: false,
    publishable: true,
    childSort: "name-asc",
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
