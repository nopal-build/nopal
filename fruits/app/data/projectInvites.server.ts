import { getHumanByEmail, type Human } from "robustness-core/data/humans.server";
import { createRelationship } from "robustness-core/data/relationships.server";
import {
  getProjectRole,
  getProjectSharing,
  isProjectFolder,
  setProjectSharing,
} from "robustness-core/data/projectSharing.server";
import { getSharingRoleByName } from "robustness-core/data/sharingRoles.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
import { inviteHuman } from "./invites.server";

export type InviteToProjectResult =
  | { ok: true; human: Human; created: boolean }
  | { ok: false; error: string };

/**
 * An invite names a person, one project and one role (ADR-023). Someone
 * new gets an account (`inviteHuman`: the welcome email and their vault)
 * and the role; someone who already exists is just given the role. Only
 * the project's Owner, or an admin, may invite; everything is checked
 * before anything is created, so a refused invite leaves no half-made
 * person behind.
 */
export async function inviteToProject(
  actor: Human,
  input: { email: string; name?: string; project: VaultFolder; role: string },
  request?: Request,
): Promise<InviteToProjectResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "That doesn't look like an email address" };
  if (!(await isProjectFolder(input.project))) return { ok: false, error: "Not found" };

  const isAdmin = actor.role === "Admin" || actor.role === "Super";
  if (!isAdmin && !(await getProjectRole(input.project, actor._id))?.guiding) {
    return { ok: false, error: "Not found" };
  }
  if (!(await getSharingRoleByName(input.role))) return { ok: false, error: `Unknown role "${input.role}"` };

  let human = await getHumanByEmail(email);
  const created = !human;
  if (!human) {
    if (!input.name?.trim()) return { ok: false, error: "Someone new needs a name" };
    human = await inviteHuman(
      { email, name: input.name.trim(), role: "Human", invitedByHumanId: actor._id },
      request,
    );
    if (!human) return { ok: false, error: "Couldn't create that person" };
  }

  const others = (await getProjectSharing(input.project)).filter((e) => e.human !== human._id);
  const result = await setProjectSharing(actor._id, input.project, [...others, { human: human._id, role: input.role }]);
  if (!result.ok) return { ok: false, error: result.error };
  // The people picker shows whom you know; an invite is how you come to
  // know someone.
  await createRelationship(actor._id, human._id, actor._id);
  return { ok: true, human, created };
}
