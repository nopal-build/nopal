import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { pageHash } from "robustness-core/data/pageBody.server";
import { createMark, pageMarkUnits, snapshotUnit } from "robustness-core/data/graphLogMarks.server";
import { checkMove, recordMove } from "robustness-core/data/graphLogMoves.server";
import { parseSyncedCardFileName } from "robustness-core/data/dailyLogSync.server";

/**
 * POST /api/graphlog/moves
 *
 * Refiles a daily-log entry from the margin: the reader names the entry,
 * which part of it moves, and the project it belongs to. Their own entry
 * moves at once; somebody else's is recorded as a request for its author
 * (see `graphLogMoves.server.ts`).
 *
 * The words they typed, if any, are kept as an ordinary mark beside the
 * passage, so the page still reads why it happened in a person's voice.
 * Nothing here needs the other project's name to be typed anywhere.
 *
 * Body: { projectFolderId, pageHash, unitKey, entryFileId, section, destProjectFolderId, text? }
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    pageHash?: string;
    unitKey?: string;
    entryFileId?: string;
    section?: string | null;
    occurrence?: number;
    destProjectFolderId?: string;
    text?: string;
    date?: string;
  };
  if (!body.projectFolderId || !body.unitKey || !body.entryFileId || !body.destProjectFolderId) {
    return Response.json({ error: "Pick an entry and a project first." }, { status: 400 });
  }

  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const raw = (await getReadmeFileForFolder(folder.human_id, folder._id))?.content ?? "";
  if (pageHash(raw) !== body.pageHash) {
    return Response.json({ error: "This page was rewritten while you were writing. Reload it." }, { status: 409 });
  }
  const unit = pageMarkUnits(raw).find((u) => u.key === body.unitKey);
  if (!unit) return Response.json({ error: "That passage isn't on this page." }, { status: 400 });

  const check = await checkMove({
    markId: null,
    markerHumanId: user._id,
    sourceProject: folder,
    entryFileId: body.entryFileId,
    section: body.section ?? null,
    occurrence: typeof body.occurrence === "number" ? body.occurrence : 0,
    destFolderId: body.destProjectFolderId,
    citedFileIds: unit.refs.map((r) => r.fileId),
    parseSyncedName: parseSyncedCardFileName,
  });
  if (!check.ok) return Response.json({ error: `${check.reason}.` }, { status: 409 });

  // Their own words stay a mark like any other; the move is the action.
  // A request for somebody else must carry words: the mark is the only
  // place its author can see what is being asked and say yes.
  const text = (body.text ?? "").trim();
  if (!text && check.plan.status === "requested") {
    return Response.json(
      { error: "Say why in your mark, so the person who wrote it knows what you're asking." },
      { status: 400 },
    );
  }
  if (text) {
    const mark = await createMark({
      projectFolderId: folder._id,
      authorHumanId: user._id,
      date: body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10),
      text,
      pageHash: body.pageHash ?? pageHash(raw),
      unit: snapshotUnit(unit),
    });
    if (mark) check.plan.markId = mark._id;
  }

  const done = await recordMove(check.plan);
  if (done.reason) return Response.json({ error: `That didn't file: ${done.reason}.` }, { status: 409 });
  return Response.json({ moveId: done.id, status: done.status }, { status: 201 });
}
