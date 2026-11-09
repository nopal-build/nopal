import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { removeDraftLetter } from "robustness-core/data/letterDesk.server";

/**
 * POST /api/letter/:fileId/remove
 *
 * Deletes a draft letter from the desk, with its workings (the brief, a
 * talk-through and an outline that never reached the record). Only for
 * someone who could write the letter (`resolveLetterAtDesk`), and only a draft:
 * a letter that was sent, or whose link was ever on, is refused here on
 * the server, whatever the page offered (Austin, 2026-11-06: a sent
 * letter is in someone's mailbox and stays). The Vault's own Delete is a
 * different, blunter tool and is not this route.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const result = await removeDraftLetter(params.fileId, user);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true });
}
