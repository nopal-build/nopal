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
  merge,
  remove,
} from "./generic.server";
import { RecordId } from "surrealdb";
import type { Group } from "./features";

export type Organization = Data & {
  name: string;
  created_at: string;
  /** The `vault_folders` id of this Organization's `kanban-garden` Projects
   * board anchor (`org/kanban-projects/` — see `garden/3-growing/
   * guide-projects-phases.md`). `null`/absent until the "Ensure Org Kanban
   * Board" admin script provisions it — the Organization entity stays
   * DB-only (no reversal of this module's own Phase A decision); this is
   * just a pointer TO a vault folder, not the Organization living there. */
  kanban_folder_id?: string | null;
  /** Specific dates this Organization observes and is closed for — org-
   * wide, on top of whatever any individual Human's own "professor's
   * hours" (`humans.server.ts`'s `availability`) otherwise say. (Office
   * hours used to live here too, org-wide — superseded 2026-11-03: each
   * Human now sets their own on their Profile page instead, see
   * `garden/3-growing/professors-hours-and-schedulers.md`.) */
  holidays?: OrganizationHoliday[] | null;
  /** Named, multi-person meeting schedulers this Organization has set up
   * — see `MeetingScheduler`'s own doc. `null`/absent/empty means none
   * yet. */
  schedulers?: MeetingScheduler[] | null;
};

export type OrganizationHoliday = {
  /** "YYYY-MM-DD" (a plain calendar date, not tied to any one timezone)
   * — the first (or only) day excluded. */
  date: string;
  /** "YYYY-MM-DD", inclusive — the last day of a multi-day holiday
   * (e.g. a long weekend). `null`/absent/equal-to-`date` means a single
   * day, same as before this field existed. */
  endDate?: string | null;
  name: string;
};

export type MeetingScheduler = {
  /** Stable id (`newRecordId()`), since a scheduler's own `name` can
   * change — what `remove-scheduler`/`add-scheduler-member`/
   * `remove-scheduler-member` (`org.tsx`) key off of. */
  id: string;
  name: string;
  /** Which Humans' own "professor's hours" (`humans.server.ts`'s
   * `availability`) compose this scheduler — e.g. a "Potential Lead"
   * scheduler naming Lucas and Austin, or a "Building" scheduler naming
   * Gerald and Austin. Every Human already has an implicit scheduler of
   * their own (just their own availability, shown on their own Profile)
   * — this is specifically for a NAMED, multi-person one. */
  humanIds: string[];
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

/** Every Organization id `humanId` is a Guide on — in practice today
 * either `[]` or `[NOPAL_ORGANIZATION_ID]`, since Nopal is the only
 * Organization, but written against the general shape so a second
 * Organization needs no change here. Used everywhere Phase C's "an org
 * Guide reaches every one of their Organization's projects, no
 * `sharing` entry needed" (garden/3-growing/organizations.md) has to
 * check several projects/folders at once rather than one. */
export async function getOrganizationIdsWhereGuide(humanId: string): Promise<string[]> {
  const result = await query<[OrganizationMember[]]>(
    `SELECT * FROM organization_members WHERE human_id = $humanId AND role = "Guide"`,
    { humanId },
  );
  return (result?.[0] ?? []).map(formatRecord).map((m) => m.organization_id);
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

/** Points this Organization at its `kanban-garden` Projects board anchor
 * once the "Ensure Org Kanban Board" admin script has created one — the
 * one intended writer of this field. */
export async function setOrganizationKanbanFolderId(
  folderId: string,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Organization | undefined> {
  // `merge`, not `upsert` — this row already exists (seeded by migration
  // `0014_organizations.surql`); `upsert`'s `CONTENT` semantics would
  // REPLACE the whole record (wiping `name`/`created_at`), same pitfall
  // `merge`'s own precedent elsewhere in this codebase exists to avoid.
  const record = await merge("organizations", organizationId, { kanban_folder_id: folderId });
  return record ? formatRecord(record as unknown as Organization) : undefined;
}

/** Replaces this Organization's whole `holidays` list — the Org page
 * (`org.tsx`) reads the current list, adds/removes one, and writes the
 * result back here. The one intended writer of this field. */
export async function setOrganizationHolidays(
  holidays: OrganizationHoliday[],
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Organization | undefined> {
  const record = await merge("organizations", organizationId, { holidays });
  return record ? formatRecord(record as unknown as Organization) : undefined;
}

/** Whether `date` (an ISO "YYYY-MM-DD") falls on an observed holiday —
 * pure, no DB call. Callers compare against whichever calendar day
 * actually matters to them (e.g. a Human's own `timezone`, when checking
 * their own availability against the org's shared holidays — holidays
 * themselves carry no timezone of their own, see `OrganizationHoliday`'s
 * own doc). */
export function isOrganizationHoliday(organization: Pick<Organization, "holidays">, date: string): boolean {
  return (organization.holidays ?? []).some((h) => date >= h.date && date <= (h.endDate || h.date));
}

/** Replaces this Organization's whole `schedulers` list — the Org page
 * (`org.tsx`) reads the current list, adds/renames/removes one or
 * changes its members, and writes the result back here, same
 * "read, change in memory, write the whole array" shape
 * `setOrganizationHolidays` uses. The one intended writer of this field. */
export async function setOrganizationSchedulers(
  schedulers: MeetingScheduler[],
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<Organization | undefined> {
  const record = await merge("organizations", organizationId, { schedulers });
  return record ? formatRecord(record as unknown as Organization) : undefined;
}

export async function removeOrganizationMember(
  humanId: string,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<void> {
  const existing = await findMembership(humanId, organizationId);
  if (!existing) return;
  await remove("organization_members", existing._id);
}
