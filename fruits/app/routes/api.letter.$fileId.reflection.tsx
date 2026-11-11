import type { ActionFunctionArgs } from "react-router";
import { letterForReader } from "../data/letterReader.server";
import { keepReflection, saveReflectionDraft } from "robustness-core/data/letterReflection.server";

/**
 * PUT  /api/letter/:fileId/reflection   { draft }        what the reader has said so far, kept
 *                                                        for them alone
 * POST /api/letter/:fileId/reflection   { text, date }   the reader's click: their words go
 *                                                        onto their Card for the day on this
 *                                                        project, once
 *
 * Anyone the sent letter is shown to (`letterForReader`), a Client
 * included; never an admin looking as them. The Card write follows the
 * daily log's own rules (`appendToCard`: `dailyLog` to write, a
 * suggestion without `feeds`). `date` is the device's day, clamped by
 * `markDate`. There is no GET: the page's loader hands the reader their
 * own reflection and nobody else's.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST" && request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForReader(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { draft?: unknown; text?: unknown; date?: unknown };

  const result =
    request.method === "PUT"
      ? await saveReflectionDraft(got.project, got.file, got.user._id, typeof body.draft === "string" ? body.draft : "")
      : await keepReflection(
          got.project,
          got.file,
          { humanId: got.user._id, features: got.role?.features ?? [] },
          { text: typeof body.text === "string" ? body.text : "", date: typeof body.date === "string" ? body.date : undefined },
        );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, suggestion: "suggestion" in result ? result.suggestion : undefined });
}
