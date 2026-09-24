import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { eraseMark, getMark, MARK_TEXT_LIMIT, rewriteMark } from "robustness-core/data/graphLogMarks.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { canViewFolder } from "robustness-core/data/vault.types";

/**
 * POST /api/graphlog/marks/:markId
 *
 * A mark stays its author's own words while it waits to be read: they can
 * keep working on it, or take it back. Once a page run has read it, the
 * page may cite it and an archived version may show it, so it stays as
 * written and the author adds another mark beside it instead.
 *
 * Body: { text } to rewrite, or { action: "delete" }.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const markId = params.markId;
  if (!markId) return Response.json({ error: "Not found" }, { status: 404 });

  // Writing it made it part of a project's record (`Syncs/Marks/`), so
  // changing it needs the project too, not just authorship: somebody who
  // has since lost access does not keep editing that project's files.
  const mark = await getMark(markId);
  const folder = mark ? await getFolderById(mark.project_folder_id) : null;
  if (!mark || !folder || !canViewFolder(user._id, folder)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string; action?: string };

  if (body.action === "delete") {
    const done = await eraseMark(markId, user._id);
    return done.ok
      ? Response.json({ ok: true })
      : Response.json({ error: capitalize(done.reason) }, { status: 409 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "Write something first." }, { status: 400 });
  if (text.length > MARK_TEXT_LIMIT) {
    return Response.json({ error: `Keep a mark under ${MARK_TEXT_LIMIT} characters.` }, { status: 400 });
  }
  const done = await rewriteMark(markId, user._id, text);
  return done.ok ? Response.json({ ok: true }) : Response.json({ error: capitalize(done.reason) }, { status: 409 });
}

function capitalize(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}
