/**
 * Vault Folder Types — special, codified sub-folder kinds a human can pick
 * when creating a new folder, layered ON TOP of the Vault Root Folders
 * (`vaultRoots.ts`). Where a root is a fixed, system-provisioned top-level
 * container (`projects`, `personal`), a folder TYPE is an opt-in tag a
 * human attaches when creating a folder *inside* one of those — it's what
 * used to be the standalone `skills`/`syncs` roots, now generalized so
 * every project (and the `personal` space) can have its own.
 *
 * **PhyLog/`project-n01` has been fully retired** (see the `graphlog`
 * skill) — every project (and `personal`) is `project-n02` now, both for
 * `createVaultFolder`'s own default and for every lazy-retrofit path. Its
 * own space types (`newspapers`, the project-scoped `daily-logs` staging
 * folder) are gone with it; nothing else ever depended on them.
 *
 * Two tiers, each created via the same "New folder → pick a type" flow
 * (container types are the one exception — see below):
 *
 * 0. Container types (`ContainerFolderTypeKey`) — just `project-n02`
 *    today (see the `graphlog` skill). This is the type every
 *    `projects/<name>` folder AND the `personal` root itself carries (see
 *    the `vault` skill's "project-n02 spaces" section). Unlike the other
 *    tier, a human never picks this from the "New folder" dialog — it's
 *    stamped automatically the moment a project (or `personal`) is created
 *    (`createVaultFolder`/`ensureVaultRootFolders`, `vault.server.ts`), and
 *    lazily backfilled onto any project that predates this type.
 *    `README.md` is that space's index; a human may only directly write
 *    into its `skills`/`syncs` child folders — everything else in the
 *    tree (including the `Graph` space) is managed entirely by GraphLog's
 *    own sync-knowledge/sync-graph/graph-project-view stages. Hence
 *    `writable: "system"` (see below) — no human role can write CONTENT
 *    directly into the container; GraphLog's own server functions bypass
 *    this check entirely (they call the data layer directly, never
 *    through the `api.vault.*` write routes this gates). Folder-OBJECT-
 *    level operations on the anchor itself — rename, delete, share, trash
 *    — are a separate, still-owner-writable concern; see
 *    `vault.server.ts`'s `canWriteToFolderId` doc.
 *
 * 1. Space types (`SpaceFolderTypeKey`) — `skills`, `syncs`, and `graph`.
 *    Creatable directly inside a `project-n02` folder (a project, or
 *    `personal`). SINGLETON per parent — at most one of each
 *    (enforced server-side, `validateFolderTypeForParent` in
 *    `vault.server.ts`).
 *      - `skills` codifies the identity of that project/space — instructions
 *        steering how it should be built, organized, and maintained (an
 *        eventual sorting agent's guide, and the project's own equivalent of
 *        this very repo's `.agents/skills/<name>/SKILL.md`). Every
 *        `project-n02` gets one auto-seeded at creation time with default
 *        `KNOWLEDGE.md`/`GRAPH.md`/`GRAPH_STRUCTURE.md`/`PROJECT_VIEW.md`
 *        files (see `projectN02.server.ts`) — the ONE place a human
 *        directly steers the otherwise fully GraphLog-managed tree.
 *      - `syncs` is a data-collection container — see tier 2.
 *      - `graph` is GraphLog's own OUTPUT space — one `graph-log-YYYY-MM-DD.md`
 *        file per day `sync-graph` finds new content for, plus
 *        `graph-structure.md`. `writable: "system"` — GraphLog populates it
 *        directly via the data layer, never through the `api.vault.*`
 *        routes this gates. NOT created at project creation time (unlike
 *        `skills`) — lazily created the first time `sync-graph` actually
 *        has something to write.
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

export type ContainerFolderTypeKey = "project-n02";

export type SpaceFolderTypeKey = "skills" | "syncs" | "graph";

export type SyncFolderTypeKey =
  | "sync-one-way"
  | "sync-two-way"
  | "sync-api"
  | "sync-email"
  | "sync-custom";

export type VaultFolderTypeKey =
  | ContainerFolderTypeKey
  | SpaceFolderTypeKey
  | SyncFolderTypeKey;

export type VaultFolderTypeDef = {
  /** Display name in the "New folder" type picker and folder labels. */
  label: string;
  /** Short explanation shown in the type picker. */
  description: string;
  /** Same policy shape as `VaultRootPolicy.writable` (`vaultRoots.ts`), plus
   * a third tier:
   *   - `"owner"`: the folder's own owner may always write.
   *   - `"admin"`: requires the ACTING human to hold the platform `Admin`/
   *     `Super` role, even inside their own vault. No folder type uses this
   *     today — `skills` used to, but that's superseded by this app's own
   *     project-level Sharing Roles (a SEPARATE, project-Role-aware gate on
   *     top of this one — see the `vault` skill's "Sharing Roles" section);
   *     kept as a mechanism for a future folder type that might still want
   *     a platform-role gate.
   *   - `"system"`: NO human role may write here, full stop — only
   *     GraphLog's own server-side code, which calls the data layer
   *     directly and never goes through the `api.vault.*` write routes
   *     this gates (`canWriteToFolderType`). Used by `project-n02`
   *     (everything outside its `skills`/`syncs` children is
   *     GraphLog-managed) and `graph`. */
  writable: "owner" | "admin" | "system";
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
    // No longer platform-Admin/Super-gated (superseded by this app's own
    // Sharing Roles): a project's own creator can always write here, and an
    // owner-tier collaborator (Crafter) is separately allowed to EDIT
    // existing skills content — see the project-role gate in
    // `api.vault.$fileId.tsx` and the `vault`/`oxmarkdown` skills.
    writable: "owner",
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
  // `graph` — a `project-n02` space type (see the `graphlog` skill),
  // holding one `graph-log-YYYY-MM-DD.md` file per day GraphLog's
  // `sync-graph` stage actually finds new content for. Same policy as
  // `daily-logs` above (system-managed, not directly editable) and the
  // same "lazily created the first time there's something to write"
  // convention — NOT seeded at project creation time, unlike `skills`.
  graph: {
    label: "Graph",
    description:
      "Daily graph-log files GraphLog's sync-graph stage writes here, one per day with new content — the durable record graph-project-view reads to build README.md. System-managed, not directly editable.",
    writable: "system",
    shareable: false,
    publishable: false,
  },
};

export const CONTAINER_FOLDER_TYPES: Record<ContainerFolderTypeKey, VaultFolderTypeDef> = {
  // `project-n02` — GraphLog-managed (see the `graphlog` skill). The
  // successor to `project-n01`/PhyLog, which has been fully retired —
  // every project (and `personal`) is `project-n02` now, both for
  // `createVaultFolder`'s own default and for every retrofit path.
  "project-n02": {
    label: "Project",
    description:
      "A GraphLog-managed space — a project folder, or your Personal space. README.md is its index; only its skills/syncs folders are directly human-editable, everything else (including Graph/) is managed by the GraphLog pipeline.",
    writable: "system",
    shareable: true,
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
  ...CONTAINER_FOLDER_TYPES,
  ...SPACE_FOLDER_TYPES,
  ...SYNC_FOLDER_TYPES,
};

export const CONTAINER_FOLDER_TYPE_KEYS = Object.keys(
  CONTAINER_FOLDER_TYPES,
) as ContainerFolderTypeKey[];
export const SPACE_FOLDER_TYPE_KEYS = Object.keys(
  SPACE_FOLDER_TYPES,
) as SpaceFolderTypeKey[];
export const SYNC_FOLDER_TYPE_KEYS = Object.keys(
  SYNC_FOLDER_TYPES,
) as SyncFolderTypeKey[];

export function isVaultFolderTypeKey(value: unknown): value is VaultFolderTypeKey {
  return typeof value === "string" && value in VAULT_FOLDER_TYPES;
}

export function isContainerFolderTypeKey(
  value: unknown,
): value is ContainerFolderTypeKey {
  return typeof value === "string" && value in CONTAINER_FOLDER_TYPES;
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
 * `canWriteToRoot`. `"system"` (`project-n02`, `graph`) fails closed
 * for EVERY human role, Admin/Super included — only GraphLog's own server
 * code (which never calls this) can touch that content. */
export function canWriteToFolderType(
  folderType: string | null | undefined,
  role: Role,
): boolean {
  if (!folderType) return true;
  const def = isVaultFolderTypeKey(folderType) ? VAULT_FOLDER_TYPES[folderType] : null;
  const writable = def?.writable ?? "admin";
  if (writable === "system") return false;
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
