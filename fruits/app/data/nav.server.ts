import { isClientEverywhere, listProjectsFor, type ProjectMembership } from "robustness-core/data/projectSharing.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";

/** What the nav needs to know about a person, for loaders to spread into
 * their data (`useVaultHidden`, `useHome`). Someone on one project, and
 * it active, gets My Project, straight to it; anyone else gets My
 * Projects, the list at `/` (Austin, 2026-09-25: by count, not by group). */
export async function navFor(humanId: string, memberships?: ProjectMembership[]) {
  memberships ??= await listProjectsFor(humanId);
  const only = memberships.length === 1 && getProjectStatus(memberships[0].folder) === "active" ? memberships[0] : null;
  return {
    vaultHidden: isClientEverywhere(memberships),
    home: only ? { plural: false, projectId: only.folder._id } : { plural: true, projectId: null },
  };
}
