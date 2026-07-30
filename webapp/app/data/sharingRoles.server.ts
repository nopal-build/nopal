/**
 * Sharing Role DEFINITIONS — PhyLog's replacement for the old "shared with
 * everyone" / plain-array-of-ids-only sharing model (see the `vault`
 * skill's Sharing section, and `projectSharing.server.ts`). A role is just
 * a `name` + `is_owner` flag: `is_owner` grants owner-tier permissions
 * (today, the only owner-tier-gated action is writing to a project's
 * `skills` folder — see `vaultFolderTypes.ts`'s `skills.writable` and the
 * project-role gate in `api.vault.$fileId.tsx`); without it, permissions
 * stay limited to whatever ordinary sharing already grants (viewing, and
 * contributing a Card to the project's daily log).
 *
 * Deliberately a small DB-backed lookup table, not a fixed TS union like
 * the platform `Role` (`humans.server.ts`) — these are meant to be
 * human-editable later without a code deploy (no editing UI yet; this file
 * only ships the table + the three default roles). A PROJECT's actual role
 * ASSIGNMENTS (who has which role on which project) are never stored here
 * — they live directly in that project's own README.md front matter, see
 * `projectSharing.server.ts`. This table only answers "does this role NAME
 * exist, and is it owner-tier?".
 */

import { query, upsert, formatRecord, defineTable, type Data } from "./generic.server";

export type SharingRole = Data & {
  name: string;
  is_owner: boolean;
};

/** Default roles, seeded into `sharing_roles` the first time it's read and
 * found empty. `Owner` is included here for completeness/editability even
 * though a project's own creator is always an IMPLICIT Owner regardless of
 * this table's contents (see `projectSharing.server.ts`'s `getProjectRole`)
 * — an explicit README `sharing` entry naming "Owner" (e.g. after a future
 * ownership-transfer feature) would still resolve correctly against it. */
const DEFAULT_SHARING_ROLES: Array<{ name: string; is_owner: boolean }> = [
  { name: "Owner", is_owner: true },
  { name: "Crafter", is_owner: true },
  { name: "Observer", is_owner: false },
];

async function seedDefaultSharingRoles(): Promise<void> {
  for (const role of DEFAULT_SHARING_ROLES) {
    await upsert("sharing_roles", role);
  }
}

/** Every defined sharing role — seeds the three defaults on first call if
 * the table is still empty (same lazy-seed pattern `ensureVaultRootFolders`
 * uses for vault roots), so a fresh environment never needs a separate
 * migration/seed step run by hand.
 *
 * `defineTable` runs first because SurrealDB only auto-creates a table on
 * its first INSERT/UPSERT — a `SELECT`/`DELETE` against a table that has
 * NEVER been written to in this database yet fails with "table does not
 * exist" rather than just returning zero rows. A brand new environment
 * (e.g. a freshly seeded local dev DB) hits this on the very first call;
 * an already-seeded one no-ops here (`IF NOT EXISTS`). */
export async function getSharingRoles(): Promise<SharingRole[]> {
  await defineTable("sharing_roles");
  const result = await query<[SharingRole[]]>(
    `SELECT * FROM sharing_roles ORDER BY name ASC`,
  );
  const existing = (result?.[0] ?? []).map(formatRecord);
  if (existing.length > 0) return existing;

  await seedDefaultSharingRoles();
  const seeded = await query<[SharingRole[]]>(
    `SELECT * FROM sharing_roles ORDER BY name ASC`,
  );
  return (seeded?.[0] ?? []).map(formatRecord);
}

export async function getSharingRoleByName(
  name: string,
): Promise<SharingRole | null> {
  const roles = await getSharingRoles();
  return roles.find((r) => r.name === name) ?? null;
}

/** Whether `roleName` grants owner-tier permissions. Fails CLOSED (false)
 * for an unrecognized role name — e.g. a name left behind in a project's
 * README after its definition was later removed from `sharing_roles`. */
export async function isOwnerTierRole(roleName: string): Promise<boolean> {
  const role = await getSharingRoleByName(roleName);
  return role?.is_owner ?? false;
}
