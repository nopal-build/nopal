import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  getSyncTargetById,
  touchSyncTarget,
  deleteSyncTarget,
} from "../data/syncTargets.server";

/**
 * PATCH  /api/sync-targets/:targetId — mark a sync as completed (bumps
 *        lastSyncedAt; the only mutable field for now)
 * DELETE /api/sync-targets/:targetId — unregister the target. Does NOT
 *        touch the vault folder — the CLI decides whether to also delete
 *        the folder (`nopal sync rm` vs `--keep-remote`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { targetId } = params;
  if (!targetId) {
    return Response.json({ error: "targetId required" }, { status: 400 });
  }

  const target = await getSyncTargetById(targetId);
  if (!target || target.humanId !== user._id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    const updated = await touchSyncTarget(targetId);
    return Response.json({ target: updated });
  }

  if (request.method === "DELETE") {
    await deleteSyncTarget(targetId);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
