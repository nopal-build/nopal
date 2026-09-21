import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { applyMove, getMove, undoMove } from "robustness-core/data/graphLogMoves.server";

/**
 * POST /api/graphlog/moves/:moveId
 *
 * Confirms or undoes a move a mark asked for (see
 * `graphLogMoves.server.ts`). A move refiles somebody's words under the
 * project they belong to without changing a word of them, so both
 * directions are safe; the two projects catch up on their next runs.
 *
 * Body:
 *   action — "confirm": only the entry's author, and only a request.
 *            "undo": the author, whoever made the mark, or an owner of the
 *            project the entry came from.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const move = params.moveId ? await getMove(params.moveId) : null;
  if (!move) return Response.json({ error: "Move not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  if (body.action === "confirm") {
    if (move.author_human_id !== user._id) {
      return Response.json({ error: "Only the person who wrote the entry can move it." }, { status: 403 });
    }
    if (move.status !== "requested") return Response.json({ error: "There's nothing waiting to confirm." }, { status: 409 });
    const done = await applyMove(move);
    if (!done.ok) return Response.json({ error: `That didn't move: ${done.reason}.` }, { status: 409 });
    return Response.json({ status: "applied" });
  }

  if (body.action === "undo") {
    const source = await getFolderById(move.source_project_folder_id);
    const allowed =
      move.author_human_id === user._id ||
      move.decided_by === user._id ||
      (source ? await canActAsProjectOwner(user._id, source.human_id, source._id) : false);
    if (!allowed) return Response.json({ error: "You can't undo this move." }, { status: 403 });
    if (move.status === "undone") return Response.json({ status: "undone" });
    const back = await undoMove(move, user._id);
    if (!back.ok) return Response.json({ error: `That didn't go back: ${back.reason}.` }, { status: 409 });
    return Response.json({ status: "undone" });
  }

  return Response.json({ error: 'action must be "confirm" or "undo"' }, { status: 400 });
}
