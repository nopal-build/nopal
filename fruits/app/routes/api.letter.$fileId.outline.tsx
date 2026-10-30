import type { ActionFunctionArgs } from "react-router";
import { letterForManager } from "../data/letterManager.server";
import { requestOutline, saveOutlineEdit } from "robustness-core/data/outline.server";

/**
 * POST /api/letter/:fileId/outline                "Write it again": the same
 *                                                 talk, a new outline
 * PUT  /api/letter/:fileId/outline  { content }   the guide's own edit; it
 *                                                 re-runs nothing
 *
 * Guides only (`letterForManager`). The outline is read with the rest of
 * the letter's workings on `GET /api/letter/:fileId/brief`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForManager(request, params.fileId);
  if (got instanceof Response) return got;

  if (request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    const saved = await saveOutlineEdit(got.project, got.file, typeof body.content === "string" ? body.content : "");
    if (!saved.ok) return Response.json({ error: saved.error }, { status: saved.status });
    return Response.json({ ok: true });
  }

  const result = await requestOutline(got.project, got.file, got.user._id);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ jobId: result.jobId }, { status: 202 });
}
