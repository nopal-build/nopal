import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import { letterPublicPath, setLetterShared } from "robustness-core/data/letters.server";
import { enqueueLetterPdfIfSent } from "robustness-core/data/letterPdf.server";

/**
 * POST   /api/letter/:fileId/share   turn the letter's link on
 * DELETE /api/letter/:fileId/share   turn it off
 *
 * A Guide on the project or staff (`setLetterShared`). Thin client:
 * the share control on the project's Letters tab.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const file = params.fileId ? await getFileRefById(params.fileId) : null;
  if (!file) return Response.json({ error: "Letter not found" }, { status: 404 });

  const result = await setLetterShared(user, file, request.method === "POST");
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  // The PDF is rendered ahead of the click: turning the link on asks the
  // worker for it now (`letterPdf.server.ts`). Only a sent letter gets
  // this far (`letterShareRefusal`), so there is a sent copy to print.
  if (result.sharedAt) await enqueueLetterPdfIfSent({ ...file, shared_at: result.sharedAt });
  return Response.json({ sharedAt: result.sharedAt, path: letterPublicPath(file._id) });
}
