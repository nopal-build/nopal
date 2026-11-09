import type { ActionFunctionArgs } from "react-router";
import { letterForWriter } from "../data/letterWriter.server";
import { saveTalkDraft, sendTalkThrough } from "robustness-core/data/outline.server";

/**
 * PUT  /api/letter/:fileId/talk   { draft }   what the writer has typed, kept
 * POST /api/letter/:fileId/talk   { text }    the writer's click: the talk is
 *                                             kept on the letter and the
 *                                             outline is asked for, with or
 *                                             without a brief
 *
 * Whoever may write the letter (`letterForWriter`: a guide, or a client
 * on their own). Nothing goes on the project's record
 * here: the talk waits for the letter to be sent (`sendLetter`,
 * `landTalkThrough`), and its Card then follows the daily log's own
 * rules (`appendToCard`: `dailyLog` to write, a suggestion without
 * `feeds`). Someone without `dailyLog` is refused now.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForWriter(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { draft?: unknown; text?: unknown };

  if (request.method === "PUT") {
    await saveTalkDraft(got.project, got.file, typeof body.draft === "string" ? body.draft : "");
    return Response.json({ ok: true });
  }

  const result = await sendTalkThrough(
    got.project,
    got.file,
    { humanId: got.user._id, features: got.role?.features ?? [] },
    { text: typeof body.text === "string" ? body.text : "" },
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ jobId: result.jobId }, { status: 202 });
}
