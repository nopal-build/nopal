import type { ActionFunctionArgs } from "react-router";
import { letterForManager } from "../data/letterManager.server";
import { saveTalkDraft, sendTalkThrough } from "robustness-core/data/outline.server";

/**
 * PUT  /api/letter/:fileId/talk   { draft }        what the guide has typed, kept
 * POST /api/letter/:fileId/talk   { text, date }   the guide's click: the talk
 *                                                  goes onto their Card for the
 *                                                  day on this project, and the
 *                                                  outline is asked for
 *
 * Guides only (`letterForManager`); the Card write follows the daily
 * log's own rules on top (`appendToCard`: `dailyLog` to write, a
 * suggestion without `feeds`). `date` is the device's day, clamped by
 * `markDate`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForManager(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { draft?: unknown; text?: unknown; date?: unknown };

  if (request.method === "PUT") {
    await saveTalkDraft(got.project, got.file, typeof body.draft === "string" ? body.draft : "");
    return Response.json({ ok: true });
  }

  const result = await sendTalkThrough(
    got.project,
    got.file,
    { humanId: got.user._id, features: got.role?.features ?? [] },
    { text: typeof body.text === "string" ? body.text : "", date: typeof body.date === "string" ? body.date : undefined },
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ jobId: result.jobId }, { status: 202 });
}
