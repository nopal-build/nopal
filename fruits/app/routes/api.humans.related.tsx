import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getRelatedHumans } from "robustness-core/data/relationships.server";
import { getOrganizationRolesForHumans } from "robustness-core/data/organizations.server";

/**
 * GET /api/humans/related
 *
 * The humans this user can share vault folders with — the same list the
 * vault page's loader feeds its ShareModal, exposed as JSON so the CLI
 * (`nopal vault share --with <email>`) can resolve emails to human ids.
 * Accepts bearer-token auth via getUserFromRequest.
 *
 * Deliberately minimal fields: no roles, no alias emails, nothing beyond
 * what the share UI already shows — `organizationRole` is the one
 * exception (Phase B, garden/3-growing/organizations.md): the CLI's
 * `nopal vault share --with <email>` (no `:ROLE`) uses it as the DEFAULT
 * role when adding someone, same as the Maker's "Add" control.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const related = await getRelatedHumans(user);
  const organizationRoles = await getOrganizationRolesForHumans(related.map((h) => h._id));
  return Response.json({
    humans: related.map((h) => ({
      _id: h._id,
      name: h.name,
      email: h.email,
      organizationRole: organizationRoles.get(h._id) ?? null,
    })),
  });
}
