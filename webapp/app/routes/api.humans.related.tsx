import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getRelatedHumans } from "../data/relationships.server";

/**
 * GET /api/humans/related
 *
 * The humans this user can share vault folders with — the same list the
 * vault page's loader feeds its ShareModal, exposed as JSON so the CLI
 * (`nopal vault share --with <email>`) can resolve emails to human ids.
 * Accepts bearer-token auth via getUserFromRequest.
 *
 * Deliberately minimal fields: no roles, no alias emails, nothing beyond
 * what the share UI already shows.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const related = await getRelatedHumans(user);
  return Response.json({
    humans: related.map((h) => ({
      _id: h._id,
      name: h.name,
      email: h.email,
    })),
  });
}
