import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { createMark, fileActText, markDate, MARK_TEXT_LIMIT, type FileAct } from "robustness-core/data/graphLogMarks.server";
import { fileMarkUnit, loadProjectFiles } from "robustness-core/data/fileFolders.server";
import { filingValuesHash, isFilingKind } from "robustness-core/data/syncFiling.server";

/**
 * POST /api/graphlog/file-marks
 *
 * A person's act on one attached file, or their own words on it. An act
 * is one tap: "file this as a receipt", "this cost is correct", "this
 * cost is accepted". Code writes the sentence in the person's name
 * (`fileActText`), and it is stored as a mark like any other, so it lands
 * in `Syncs/Marks/` and the graph on the next run. Nothing is set on the
 * file: the files view derives the kind and the status from the latest
 * act (Austin, 2026-09-22).
 *
 * Authorised by the record, not by the file: the original id must be
 * attached to one of this project's Cards. A collaborator can view the
 * project's copy and not the original, so `canViewFileRef` would refuse
 * exactly the people the guide wants confirming costs.
 *
 * A confirmation names the reading it confirms (`of`, the values hash of
 * the current filing record), computed here and never taken from the
 * client, so a later re-read with different values reads unconfirmed.
 *
 * Body: projectFolderId, fileId (original), and either
 *   act: { kind: "file-as", fileKind } | { kind: "confirm-cost", verdict }
 *   or text (the person's own words). date as on /api/graphlog/marks.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    fileId?: string;
    act?: { kind?: string; fileKind?: string; verdict?: string };
    text?: string;
    date?: string;
  };
  if (!body.projectFolderId || !body.fileId) {
    return Response.json({ error: "projectFolderId and fileId are required" }, { status: 400 });
  }
  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // The same projection the files view shows, so a confirmation names
  // exactly the reading the person was looking at.
  const row = (await loadProjectFiles(folder)).find((r) => r.fileId === body.fileId);
  if (!row) return Response.json({ error: "That file is not attached to this project's daily logs." }, { status: 400 });

  let act: FileAct | null = null;
  let text: string;
  if (body.act) {
    if (body.act.kind === "file-as") {
      if (!isFilingKind(body.act.fileKind) || body.act.fileKind === "video") {
        return Response.json({ error: "Pick a kind from the list." }, { status: 400 });
      }
      act = { kind: "file-as", fileKind: body.act.fileKind };
    } else if (body.act.kind === "confirm-cost") {
      if (body.act.verdict !== "correct" && body.act.verdict !== "accepted") {
        return Response.json({ error: "A cost is confirmed correct or accepted." }, { status: 400 });
      }
      const filing = row.filing;
      if (!filing?.cost) {
        return Response.json({ error: "There is no cost reading on this file to confirm yet." }, { status: 409 });
      }
      act = {
        kind: "confirm-cost",
        verdict: body.act.verdict,
        of: filingValuesHash(filing),
        vendor: filing.cost.vendor,
        amount: filing.cost.amount,
        currency: filing.cost.currency,
        date: filing.cost.date,
      };
    } else {
      return Response.json({ error: "Unknown act." }, { status: 400 });
    }
    text = fileActText(act);
  } else {
    text = (body.text ?? "").trim();
    if (!text) return Response.json({ error: "Write something first." }, { status: 400 });
    if (text.length > MARK_TEXT_LIMIT) {
      return Response.json({ error: `Keep a mark under ${MARK_TEXT_LIMIT} characters.` }, { status: 400 });
    }
  }

  const mark = await createMark({
    projectFolderId: folder._id,
    authorHumanId: user._id,
    date: markDate(body.date),
    text,
    pageHash: null,
    unit: fileMarkUnit(row),
    act,
  });
  if (!mark) return Response.json({ error: "The mark didn't save. Try again." }, { status: 500 });
  return Response.json({ id: mark._id, text }, { status: 201 });
}
