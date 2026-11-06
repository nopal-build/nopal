import type { ActionFunctionArgs } from "react-router";
import { letterForWriter } from "../data/letterWriter.server";
import { sendLetter } from "robustness-core/data/letterSend.server";

/**
 * POST /api/letter/:fileId/send   { date, to? }
 *
 * The guide's click: the letter as it is now becomes its readers' copy
 * (`sendLetter`, the only writer of a letter's sent fields and of its
 * houses), its words go into the graph, the receiving house's flags go
 * up, and the PDF is remade if the link is on. Sending again replaces
 * the copy. Whoever may write the letter (`letterForWriter`: a guide for
 * the guides' letters, a client for their own; `sendLetter` asks the same
 * again). `date` is the device's
 * day, clamped by `markDate`. `to` is the house a guide picked, "clients"
 * or "guides": needed the first time on a project with clients, ignored
 * once the letter has a house (`houseAtSend`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const got = await letterForWriter(request, params.fileId);
  if (got instanceof Response) return got;
  const body = (await request.json().catch(() => ({}))) as { date?: unknown; to?: unknown };
  const result = await sendLetter(got.user, got.file, { date: typeof body.date === "string" ? body.date : undefined, toHouse: body.to });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ sentAt: result.sentAt, count: result.count, to: result.toHouse }, { status: 202 });
}
