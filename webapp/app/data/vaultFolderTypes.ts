/**
 * Vault Folder Types — special, codified sub-folder kinds a human can pick
 * when creating a new folder, layered ON TOP of the Vault Root Folders
 * (`vaultRoots.ts`). Where a root is a fixed, system-provisioned top-level
 * container (`projects`, `personal`, `daily-logs`), a folder TYPE is an
 * opt-in tag a human attaches when creating a folder *inside* one of those
 * — it's what used to be the standalone `skills`/`syncs` roots, now
 * generalized so every project (and the `personal` space) can have its own.
 *
 * Two tiers, each created via the same "New folder → pick a type" flow:
 *
 * 1. Space types (`SpaceFolderTypeKey`) — `skills` and `syncs`. Creatable
 *    directly inside a project folder (a direct child of the `projects`
 *    root) or directly inside the `personal` root itself. SINGLETON per
 *    parent — a project (or personal) can have at most one `skills` and one
 *    `syncs` folder (enforced server-side, see `validateFolderTypeForParent`
 *    in `vault.server.ts`).
 *      - `skills` codifies the identity of that project/space — instructions
 *        steering how it should be built, organized, and maintained (an
 *        eventual sorting agent's guide, and the project's own equivalent of
 *        this very repo's `.agents/skills/<name>/SKILL.md`).
 *      - `syncs` is a data-collection container — see tier 2.
 *
 * 2. Sync types (`SyncFolderTypeKey`) — creatable directly inside a `syncs`
 *    folder, one per data source (NOT singleton — a syncs folder can hold
 *    many). Every sync type's job is the same regardless of mechanism: land
 *    plain files in the vault. What differs is HOW those files get there:
 *      - `sync-one-way` / `sync-two-way`: the CLI's folder sync (`nopal sync
 *        add [--two-way]`) — a local directory mirrors in (one-way) or both
 *        ways (two-way).
 *      - `sync-api` / `sync-email` / `sync-custom`: not implemented yet —
 *        placeholders for hooking into an external API, forwarding email/
 *        text, or a one-off hand-built collector. Listed now so the
 *        architecture (and the "New folder" type picker) has somewhere for
 *        them to slot in later without another root/schema change.
 *        `comingSoon: true` keeps them visible-but-disabled in the UI.
 *
 * This file has NO server-only imports — safe on both client and server,
 * same convention as `vaultRoots.ts`.
 */

import type { Role } from "./humans.server";

export type SpaceFolderTypeKey = "skills" | "syncs";

export type SyncFolderTypeKey =
  | "sync-one-way"
  | "sync-two-way"
  | "sync-api"
  | "sync-email"
  | "sync-custom";

export type VaultFolderTypeKey = SpaceFolderTypeKey | SyncFolderTypeKey;

export type VaultFolderTypeDef = {
  /** Display name in the "New folder" type picker and folder labels. */
  label: string;
  /** Short explanation shown in the type picker. */
  description: string;
  /** Same policy shape as `VaultRootPolicy.writable` (`vaultRoots.ts`),
   * applied ON TOP of the containing root's own policy — writing anywhere
   * inside a `skills`-typed folder needs Admin/Super, even inside the
   * owning human's own vault. */
  writable: "owner" | "admin";
  /** Whether a folder of this type may be shared with other humans —
   * independent of whether its containing root permits sharing at all
   * (both must allow it). */
  shareable: boolean;
  /** Whether a folder of this type may be published to a public,
   * unauthenticated URL — independent of the containing root's own
   * publishable policy (both must allow it). */
  publishable: boolean;
  /** Not implemented yet — shown disabled ("coming soon") in the "New
   * folder" type picker rather than hidden, so the architecture already has
   * a slot for it. */
  comingSoon?: boolean;
};

export const SPACE_FOLDER_TYPES: Record<SpaceFolderTypeKey, VaultFolderTypeDef> = {
  skills: {
    label: "Skills",
    description:
      "Instructions that codify this project's (or your Personal space's) identity — guidance for how it should be built, organized, and maintained.",
    writable: "admin",
    shareable: false,
    publishable: false,
  },
  syncs: {
    label: "Syncs",
    description:
      "Data collection. Add typed sync folders inside — one-way/two-way file syncs today, API/email/custom integrations later — everything lands here as plain files.",
    writable: "owner",
    shareable: false,
    publishable: true,
  },
};

export const SYNC_FOLDER_TYPES: Record<SyncFolderTypeKey, VaultFolderTypeDef> = {
  "sync-one-way": {
    label: "One-way file sync",
    description:
      "A local directory mirrors INTO the vault (nopal sync add). Local is always the source of truth — the vault copy is never pulled back down.",
    writable: "owner",
    shareable: false,
    publishable: true,
  },
  "sync-two-way": {
    label: "Two-way file sync",
    description:
      "A local directory mirrors both ways — vault edits pull down, local deletions archive the vault copy, vault deletions remove unchanged local files.",
    writable: "owner",
    shareable: false,
    publishable: true,
  },
  "sync-api": {
    label: "API Integration",
    description: "Hook into an external system's API to pull data in on a schedule.",
    writable: "owner",
    shareable: false,
    publishable: true,
    comingSoon: true,
  },
  "sync-email": {
    label: "Email & Text",
    description: "Forward emails or texts into this folder as files.",
    writable: "owner",
    shareable: false,
    publishable: true,
    comingSoon: true,
  },
  "sync-custom": {
    label: "Custom Integration",
    description: "A one-off, hand-built way of collecting data into this folder.",
    writable: "owner",
    shareable: false,
    publishable: true,
    comingSoon: true,
  },
};

export const VAULT_FOLDER_TYPES: Record<VaultFolderTypeKey, VaultFolderTypeDef> = {
  ...SPACE_FOLDER_TYPES,
  ...SYNC_FOLDER_TYPES,
};

export const SPACE_FOLDER_TYPE_KEYS = Object.keys(
  SPACE_FOLDER_TYPES,
) as SpaceFolderTypeKey[];
export const SYNC_FOLDER_TYPE_KEYS = Object.keys(
  SYNC_FOLDER_TYPES,
) as SyncFolderTypeKey[];

export function isVaultFolderTypeKey(value: unknown): value is VaultFolderTypeKey {
  return typeof value === "string" && value in VAULT_FOLDER_TYPES;
}

export function isSpaceFolderTypeKey(value: unknown): value is SpaceFolderTypeKey {
  return typeof value === "string" && value in SPACE_FOLDER_TYPES;
}

export function isSyncFolderTypeKey(value: unknown): value is SyncFolderTypeKey {
  return typeof value === "string" && value in SYNC_FOLDER_TYPES;
}

/** Whether a folder tagged with this type sits "under syncs" for the
 * purposes of sync-scoped API token access (see `isFolderUnderSyncs`,
 * `vault.server.ts`) — true for the `syncs` container itself and every kind
 * of sync connector folder living directly inside it. */
export function isSyncFamilyFolderType(
  value: string | null | undefined,
): boolean {
  return value === "syncs" || isSyncFolderTypeKey(value);
}

/** Whether `role` may write (create/edit/delete folders or files) into a
 * folder tagged with `folderType` — layered ON TOP of `canWriteToRoot`
 * (`vaultRoots.ts`), never a replacement for it. `null`/absent means an
 * ordinary, untyped folder — no additional restriction. An unrecognized
 * type string fails closed (Admin/Super only), same philosophy as
 * `canWriteToRoot`. */
export function canWriteToFolderType(
  folderType: string | null | undefined,
  role: Role,
): boolean {
  if (!folderType) return true;
  const def = isVaultFolderTypeKey(folderType) ? VAULT_FOLDER_TYPES[folderType] : null;
  const writable = def?.writable ?? "admin";
  if (writable === "owner") return true;
  return role === "Admin" || role === "Super";
}

/** Whether a folder tagged with `folderType` may be shared — combine with
 * `isRootShareable` (both must allow it). `null`/absent (ordinary folder)
 * defers entirely to the root policy. An unrecognized type fails closed. */
export function isFolderTypeShareable(
  folderType: string | null | undefined,
): boolean {
  if (!folderType) return true;
  return isVaultFolderTypeKey(folderType)
    ? VAULT_FOLDER_TYPES[folderType].shareable
    : false;
}

/** Whether a folder tagged with `folderType` may be published — combine
 * with `isRootPublishable` (both must allow it). Same null/unrecognized
 * handling as `isFolderTypeShareable`. */
export function isFolderTypePublishable(
  folderType: string | null | undefined,
): boolean {
  if (!folderType) return true;
  return isVaultFolderTypeKey(folderType)
    ? VAULT_FOLDER_TYPES[folderType].publishable
    : false;
}
