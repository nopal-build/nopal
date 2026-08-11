import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { resolveProjectN01 } from "../data/projectN01.server";
import { runPreCapture } from "../data/preCapture.server";

/**
 * POST /api/phylog/pre-capture
 *
 * Runs PhyLog's pre-capture stage alone (`preCapture.server.ts`) — thin
 * client: `nopal phylog pre-capture`.
 *
 * Body:
 *   projectFolderId — required.
 *   date             — optional, YYYY-MM-DD. Process just that day's Card
 *                       attachments (plus, always, a syncs sweep).
 *   fileId           — optional. Process just this one file, ignoring
 *                       `date` entirely.
 *   Omit both `date` and `fileId` to process every day this project has a
 *   Card for, plus the syncs sweep.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    date?: string;
    fileId?: string;
  };
  const { projectFolderId, date, fileId } = body;
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
    const result = await runPreCapture(user._id, resolved.folder, { date, fileId }, (line) => log.push(line));
    if (!result.ok) return Response.json({ error: result.error, log }, { status: 400 });
    return Response.json({ ...result, log });
  } catch (err) {
    console.error("PhyLog pre-capture error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Pre-capture failed", log },
      { status: 500 },
    );
  }
}
