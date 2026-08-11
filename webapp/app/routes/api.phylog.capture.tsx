import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { resolveProjectN01 } from "../data/projectN01.server";
import { runCapture } from "../data/capture.server";

/**
 * POST /api/phylog/capture
 *
 * Runs PhyLog's capture stage alone (`capture.server.ts`) — thin client:
 * `nopal phylog capture`.
 *
 * Body:
 *   projectFolderId — required.
 *   full             — full-rebuild mode: resets the project's managed
 *                       content first (see `resetProjectN01Content`), then
 *                       reprocesses EVERY day from scratch. Defaults to
 *                       false (incremental — only days not yet applied).
 *   since / until     — bound the date range (YYYY-MM-DD).
 *
 * ALWAYS APPLIES — requires an owner-tier Sharing Role.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    full?: boolean;
    since?: string;
    until?: string;
  };
  const { projectFolderId, full, since, until } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const resolved = await resolveProjectN01(projectFolderId);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 400 });

  const log: string[] = [];
  try {
    const result = await runCapture(
      user._id,
      resolved.folder,
      { full: full ?? false, since, until },
      (line) => log.push(line),
    );
    if (!result.ok) return Response.json({ error: result.error, log }, { status: 400 });
    return Response.json({ ...result, log });
  } catch (err) {
    console.error("PhyLog capture error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Capture failed", log },
      { status: 500 },
    );
  }
}
