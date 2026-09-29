// app/data/projectPeople.server.ts
// A project's people, for the Maker (ADR-026): who is on it with pending
// invites marked, whom the viewer may pick from, and the one action that
// adds, invites, regroups, removes or withdraws. Every change goes through
// `setProjectSharing` or `inviteToProject`, the checked paths, so the
// project page in the Maker and the admins' Humans page behave alike.
import {
  deleteHuman,
  getHumanById,
  getHumans,
  getHumansById,
  isHumanInvited,
  type Human,
} from "robustness-core/data/humans.server";
import { deleteRelationshipsForHuman, getRelatedHumans } from "robustness-core/data/relationships.server";
import {
  getProjectRole,
  getProjectSharing,
  isProjectFolder,
  listEveryProject,
  setProjectSharing,
} from "robustness-core/data/projectSharing.server";
import { getFolderById } from "robustness-core/data/vault.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
import { GROUPS, groupOf } from "robustness-core/data/features";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
import { inviteToProject } from "./projectInvites.server";
import { displayName } from "robustness-core/data/humanNames";

export type PersonRow = { id: string; name: string; email: string };
export type MemberRow = PersonRow & { group: string; invited: boolean };
export type PeopleProject = { id: string; name: string; href: string; members: MemberRow[] };

export function isStaff(role: string | undefined): boolean {
  return role === "Admin" || role === "Super";
}

/** Whether `viewer` runs this project's people: its Guide, or an admin. */
export async function runsPeople(viewer: Pick<Human, "_id" | "role">, folder: VaultFolder): Promise<boolean> {
  if (!(await isProjectFolder(folder))) return false;
  return isStaff(viewer.role) || !!(await getProjectRole(folder, viewer._id))?.guiding;
}

const personRow = (h: Human): PersonRow => ({ id: h._id, name: displayName(h), email: h.email });

const groupOrder = (group: string) => {
  const g = groupOf(group);
  return g ? GROUPS.indexOf(g) : GROUPS.length;
};

/** Who is on `folder`, Guides first then by name, each once, with a
 * pending invite marked. The token itself never leaves the server. */
export async function peopleOn(folder: VaultFolder): Promise<PeopleProject> {
  return (await peopleOnMany([{ folder, sharing: await getProjectSharing(folder) }]))[0];
}

/** The same for several projects at once, one humans query for all. */
export async function peopleOnMany(
  projects: { folder: VaultFolder; sharing: { human: string; role: string }[] }[],
): Promise<PeopleProject[]> {
  const ids = [...new Set(projects.flatMap((p) => p.sharing.map((e) => e.human)))];
  const byId = new Map((await getHumansById(ids)).map((h) => [h._id, h]));
  return projects.map(({ folder, sharing }) => ({
    id: folder._id,
    name: folder.name,
    href: isWebsiteFolder(folder) ? `/vault?folder=${folder._id}` : `/newspaper/${folder._id}`,
    members: sharing
      .flatMap((e) => {
        const h = byId.get(e.human);
        return h ? [{ ...personRow(h), group: e.role, invited: isHumanInvited(h) }] : [];
      })
      .sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.name.localeCompare(b.name)),
  }));
}

/** Whom `viewer` may pick from: an admin, everyone; a Guide, the people
 * they know (what the share modal offered), so a guide isn't handed the
 * whole directory. A full email typed still finds anyone with an account
 * (`inviteToProject` looks them up), or invites someone new. */
export async function candidatesFor(viewer: Human): Promise<PersonRow[]> {
  const humans = isStaff(viewer.role) ? ((await getHumans())?.data ?? []) : await getRelatedHumans(viewer);
  return humans
    .filter((h) => h._id !== viewer._id)
    .map(personRow)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PeopleActionResult = { ok: true; invited?: string } | { error: string };

/**
 * The Maker's one people action. Form fields: `projectId`; then either
 * `intent=invite` with `email`, `name` and `group`; `intent=withdraw` with
 * `humanId`; or `humanId` and `group`, where "" takes them off. Only the
 * project's Guide or an admin gets past the first line; the checked paths
 * below decide the rest (only an admin makes a Guide, the creator stays
 * until someone else guides, removal scraps the last day).
 */
export async function peopleAction(viewer: Human, form: FormData, request: Request): Promise<PeopleActionResult> {
  const projectId = String(form.get("projectId") ?? "");
  const folder = projectId ? await getFolderById(projectId) : undefined;
  if (!folder || !(await runsPeople(viewer, folder))) return { error: "Not found" };

  const intent = String(form.get("intent") ?? "");
  const humanId = String(form.get("humanId") ?? "");
  const group = String(form.get("group") ?? "");

  if (intent === "invite") {
    const result = await inviteToProject(
      viewer,
      { email: String(form.get("email") ?? ""), name: String(form.get("name") ?? ""), project: folder, role: group || "Client" },
      request,
    );
    return result.ok ? { ok: true, invited: result.human.email } : { error: result.error };
  }
  if (!humanId) return { error: "Not found" };
  if (intent === "withdraw") return withdrawInvite(viewer, folder, humanId);
  if (group && !groupOf(group)) return { error: `Unknown group "${group}"` };

  const others = (await getProjectSharing(folder)).filter((e) => e.human !== humanId);
  const result = await setProjectSharing(viewer._id, folder, group ? [...others, { human: humanId, role: group }] : others);
  return result.ok ? { ok: true } : { error: result.error };
}

/** An invite withdrawn before it was accepted: off the project and, when
 * no project names them any more, the placeholder account goes too, so
 * the emailed link stops working (`welcome.$token` finds no row). There is
 * no invite object to cancel; the invite is the account plus the role.
 * Someone who has accepted is a member: take them off instead. */
async function withdrawInvite(viewer: Human, folder: VaultFolder, humanId: string): Promise<PeopleActionResult> {
  const human = await getHumanById(humanId);
  if (!human) return { error: "Not found" };
  if (!isHumanInvited(human)) return { error: "They've already joined. Take them off instead." };
  const others = (await getProjectSharing(folder)).filter((e) => e.human !== humanId);
  const result = await setProjectSharing(viewer._id, folder, others);
  if (!result.ok) return { error: result.error };
  // Websites count: `listEveryProject`, not `listProjectsFor`, which skips them.
  const elsewhere = (await listEveryProject()).some((p) => p.sharing.some((e) => e.human === humanId));
  if (!elsewhere) {
    await deleteRelationshipsForHuman(humanId);
    await deleteHuman(humanId);
  }
  return { ok: true };
}
