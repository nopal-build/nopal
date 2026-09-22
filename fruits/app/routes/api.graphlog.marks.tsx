import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { pageHash } from "robustness-core/data/pageBody.server";
import {
  createMark,
  markDate,
  MARK_TEXT_LIMIT,
  pageMarkUnits,
  snapshotUnit,
} from "robustness-core/data/graphLogMarks.server";

/**
 * POST /api/graphlog/marks
 *
 * Writes a mark: a person's own words on one thought on a project's
 * Efforts page. Anyone who can view the project can mark it, clients
 * included; there is one kind of mark and it behaves the same whoever
 * writes it.
 *
 * The mark lands on the page version the writer was looking at. If the
 * page changed under them (a run finished while they were writing), the
 * mark is refused with 409 rather than pinned to a passage that may no
 * longer say what they read. The unit is recomputed here from the stored
 * page and never taken from the client.
 *
 * A mark does not start a run. The next run reads it.
 *
 * Body:
 *   projectFolderId, pageHash, unitKey, text — required.
 *   date — the writer's own YYYY-MM-DD, within a day of UTC today.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    pageHash?: string;
    unitKey?: string;
    text?: string;
    date?: string;
  };
  const text = (body.text ?? "").trim();
  if (!body.projectFolderId || !body.pageHash || !body.unitKey) {
    return Response.json({ error: "projectFolderId, pageHash and unitKey are required" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Write something first." }, { status: 400 });
  if (text.length > MARK_TEXT_LIMIT) {
    return Response.json({ error: `Keep a mark under ${MARK_TEXT_LIMIT} characters.` }, { status: 400 });
  }

  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  const raw = readme?.content ?? "";
  if (pageHash(raw) !== body.pageHash) {
    return Response.json(
      { error: "This page was rewritten while you were writing. Reload to mark the new version." },
      { status: 409 },
    );
  }
  const unit = pageMarkUnits(raw).find((u) => u.key === body.unitKey);
  if (!unit) return Response.json({ error: "That passage isn't on this page." }, { status: 400 });

  const mark = await createMark({
    projectFolderId: folder._id,
    authorHumanId: user._id,
    date: markDate(body.date),
    text,
    pageHash: body.pageHash,
    unit: snapshotUnit(unit),
  });
  if (!mark) return Response.json({ error: "The mark didn't save. Try again." }, { status: 500 });
  return Response.json({ id: mark._id }, { status: 201 });
}
