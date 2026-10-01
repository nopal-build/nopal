/**
 * The groups a person can hold on a project, and what each one reaches,
 * come from the features list (`features.ts`, 2026-09-25). This module
 * keeps the names the rest of the server already imports.
 *
 * The `sharing_roles` table this used to read (a name and an `is_owner`
 * flag) is no longer read: two sources for one answer is how a label the
 * screen reads drifts from the one the server checks. The rows stay in
 * the database, unused.
 */

import { CLIENT, GUIDE, featuresOf, groupOf } from "./features";

/** Runs a project's people side, its name, status and deletion, and sees
 * other people's Steep readings. Owner folded into it (2026-09-25). */
export const GUIDING_ROLE = GUIDE;

/** Reaches the project through the features list only, never through
 * `shared_with` (ADR-023), so a Vault folder, a file or a page the list
 * doesn't give them is refused. */
export const CLIENT_ROLE = CLIENT;

/** Whether a member with this role goes into `shared_with`: every group
 * but Client. A name that isn't a group reaches nothing, the cache
 * included. */
export function reachesProjectWork(roleName: string): boolean {
  const group = groupOf(roleName);
  return group !== null && group !== CLIENT_ROLE;
}

/** Whether `roleName` changes the project's content. Unknown names get
 * nothing. */
export function isOwnerTierRole(roleName: string): boolean {
  return featuresOf(roleName).includes("edit");
}
