/**
 * Organizations — foundation only (garden/3-growing/organizations.md,
 * Phase A). An Organization groups Humans (membership + role) and Projects.
 * No access-control behavior lives here yet: that's Phase B (org role
 * pre-fills a project's `sharing` entry) and Phase C (an org Guide reaches
 * every one of the org's projects automatically) — see the seed.
 *
 * Exactly one Organization exists today: Nopal, hard-coded below as the
 * default used anywhere an Organization is needed/expected until a second
 * one is ever created (migration `0014_organizations.surql` seeds its row
 * at this exact id).
 */

import {
  Data,
  query,
  select,
  formatRecord,
  upsert,
  remove,
} from "./generic.server";
import { RecordId } from "surrealdb";
import type { Group } from "./features";

export type Organization = Data & {
  name: string;
  created_at: string;
};

/** The one hard-coded Organization — see this module's own doc above. */
export const NOPAL_ORGANIZATION_ID = "nopal";

export type OrganizationMember = Data & {
  organization_id: string;
  human_id: string;
  /** Reuses the existing project-role vocabulary (`features.ts`'s
   * `GROUPS`) rather than a role invented for Organizations. */
  role: Group;
  created_at: string;
  updated_at: string;
};

export async function getOrganization(
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Organization | undefined> {
  return select<Organization>(new RecordId("organizations", organizationId));
}

export async function getOrganizations(): Promise<Organization[]> {
  const result = await query<[Organization[]]>(`SELECT * FROM organizations ORDER BY name ASC`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function findMembership(
  humanId: string,
  organizationId: string,
): Promise<OrganizationMember | undefined> {
  const result = await query<[OrganizationMember[]]>(
    `SELECT * FROM organization_members WHERE human_id = $humanId AND organization_id = $organizationId LIMIT 1`,
    { humanId, organizationId },
  );
  const [row] = result?.[0] ?? [];
  return row ? formatRecord(row) : undefined;
}

/** A Human's role on an Organization, or `null` if they're not a member of
 * it at all. Defaults to Nopal, the one Organization that exists today. */
export async function getOrganizationRole(
  humanId: string,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Group | null> {
  const member = await findMembership(humanId, organizationId);
  return member?.role ?? null;
}

/** Batched `getOrganizationRole` for several Humans at once — one query,
 * not one per person (e.g. a candidates list a Guide picks a collaborator
 * from). Anyone with no membership is simply absent from the returned map,
 * never a `null` entry. */
export async function getOrganizationRolesForHumans(
  humanIds: string[],
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Map<string, Group>> {
  if (humanIds.length === 0) return new Map();
  const result = await query<[OrganizationMember[]]>(
    `SELECT * FROM organization_members WHERE organization_id = $organizationId AND human_id IN $humanIds`,
    { organizationId, humanIds },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);
  return new Map(rows.map((m) => [m.human_id, m.role]));
}

export async function getOrganizationMembers(
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<OrganizationMember[]> {
  const result = await query<[OrganizationMember[]]>(
    `SELECT * FROM organization_members WHERE organization_id = $organizationId ORDER BY created_at ASC`,
    { organizationId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Every Organization a Human belongs to. */
export async function getOrganizationsForHuman(humanId: string): Promise<OrganizationMember[]> {
  const result = await query<[OrganizationMember[]]>(
    `SELECT * FROM organization_members WHERE human_id = $humanId ORDER BY created_at ASC`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Adds a Human to an Organization, or changes their role if already a
 * member — the only intended writer of `organization_members`. */
export async function setOrganizationMemberRole(
  humanId: string,
  role: Group,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<OrganizationMember | undefined> {
  const now = new Date().toISOString();
  const existing = await findMembership(humanId, organizationId);
  const result = await upsert(existing ? new RecordId("organization_members", existing._id) : "organization_members", {
    organization_id: organizationId,
    human_id: humanId,
    role,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as OrganizationMember) : undefined;
}

export async function removeOrganizationMember(
  humanId: string,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<void> {
  const existing = await findMembership(humanId, organizationId);
  if (!existing) return;
  await remove("organization_members", existing._id);
}
