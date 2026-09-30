import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { isStaff } from "robustness-core/data/humans.server";
import { wipeSeed } from "robustness-core/data/seed.server";

/**
 * POST /api/graphlog/seed-wipe
 *
 * Removes what the seed alone added — the `Syncs/Seed/` folder, the
 * graph days only it fed, and the up-to-date stamp on days it shared
 * with live entries so the next run rebuilds those from the live
 * entries — see `wipeSeed` (`seed.server.ts`). Never a Card, a `Daily
 * Logs/` copy, a mark or the Budget. An admin's move (Austin,
 * 2026-09-29), and they must be on the project; anyone else gets the
 * same 404 a project they can't see would give. Synchronous: no model
 * call. Thin client: `nopal graphlog seed-wipe --yes`. The Efforts page
 * keeps the seed's words until the next run rewrites it.
 *
 * Body:
 *   projectFolderId — required.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: unknown };
  if (typeof body.projectFolderId !== "string") {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(body.projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role || !isStaff(user)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const report = await wipeSeed(folder);
    return Response.json(report);
  } catch (err) {
    console.error("seed-wipe error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "seed-wipe failed" }, { status: 500 });
  }
}
