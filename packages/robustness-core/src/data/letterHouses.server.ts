/**
 * Who is in which house on a project (`letterHouses.ts` has the rule and
 * every pure branch). Read from what already says who a person is here:
 * the project's `sharing` list with its creator (`getProjectSharing`) and
 * the Guides of the Organization that owns the project, the same two
 * sources `getProjectRole` resolves one person from. Nothing is stored.
 */

import { houseMembersFrom, houseOf, type House } from "./letterHouses";
import { isStaff, type Human } from "./humans.server";
import { getOrganizationMembers } from "./organizations.server";
import { getProjectSharing, type ResolvedProjectRole } from "./projectSharing.server";
import { GUIDING_ROLE } from "./sharingRoles.server";
import type { VaultFolder } from "./vault.types";

/** Everyone on the project, each with their house. */
export async function houseMembers(project: VaultFolder): Promise<{ human: string; house: House }[]> {
  const sharing = await getProjectSharing(project);
  const orgGuides = project.organization_id
    ? (await getOrganizationMembers(project.organization_id)).filter((m) => m.role === GUIDING_ROLE).map((m) => m.human_id)
    : [];
  return houseMembersFrom(sharing, orgGuides);
}

/** The house of someone whose role on the project is already in hand.
 * Staff with no role on a project can still send a letter there
 * (`canManageLetters`); they write as the guides' house, and hold no
 * mailbox, since the project's page isn't theirs to open. */
export function houseOfActor(actor: Pick<Human, "role"> | { role?: string | null } | null | undefined, role: Pick<ResolvedProjectRole, "role"> | null | undefined): House | null {
  return houseOf(role?.role) ?? (isStaff(actor) ? "guides" : null);
}
