import type { ActionFunctionArgs } from "react-router";
import { letterForManager } from "../data/letterManager.server";
import { sendLetter } from "robustness-core/data/letterSend.server";

/**
 * POST /api/letter/:fileId/send   { date }
 *
 * The guide's click: the letter as it is now becomes the client's copy
 * (`sendLetter`, the only writer of a letter's sent fields), its words
 * go into the graph, and the PDF is remade if the link is on. Sending
 * again replaces the copy. Guides only (`letterForManager`). `date` is
 * the device's day, clamped by `markDate`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForManager(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { date?: unknown };
  const result = await sendLetter(got.user, got.file, { date: typeof body.date === "string" ? body.date : undefined });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ sentAt: result.sentAt, count: result.count }, { status: 202 });
}
