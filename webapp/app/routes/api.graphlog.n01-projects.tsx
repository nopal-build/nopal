import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { listOwnedProjectN01Anchors } from "robustness-core/data/migrateToN02.server";

/**
 * GET /api/graphlog/n01-projects
 *
 * Every `project-n01` anchor the caller OWNS (their own `personal` root,
 * plus every owned project under `projects/` still on `project-n01`) —
 * what `nopal graphlog migrate-to-n02 --full` discovers and converts in
 * one command, and what the Maker GraphLog page lists to migrate by hand.
 * See `migrateToN02.server.ts`'s `listOwnedProjectN01Anchors`.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const anchors = await listOwnedProjectN01Anchors(user._id);
  return Response.json({ anchors });
}
