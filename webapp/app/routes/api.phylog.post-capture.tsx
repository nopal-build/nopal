import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "../data/vault.server";
import { getProjectRole } from "../data/projectSharing.server";
import { resolveProjectN01 } from "../data/projectN01.server";
import { runPostCapture } from "../data/postCapture.server";

/**
 * POST /api/phylog/post-capture
 *
 * Runs PhyLog's post-capture stage alone (`postCapture.server.ts`) — thin
 * client: `nopal phylog post-capture`. Currently mostly a placeholder — see
 * that file's own doc.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: string };
  const { projectFolderId } = body;
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
    const result = await runPostCapture(user._id, resolved.folder, (line) => log.push(line));
    return Response.json({ ...result, log });
  } catch (err) {
    console.error("PhyLog post-capture error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Post-capture failed", log },
      { status: 500 },
    );
  }
}
