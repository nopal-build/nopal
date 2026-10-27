import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveSharedLetter } from "robustness-core/data/letters.server";
import { letterPdfFileName, letterPdfStatus, ensureLetterPdfJob, preparingPage } from "robustness-core/data/letterPdf.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/letter/:fileId/pdf
 *
 * The letter's PDF, with no session: only while its link is on
 * (`resolveSharedLetter`), 404 otherwise, the same as the page.
 * The PDF is the public page printed by the worker
 * (`letterPdf.server.ts`), keyed by the file's content hash and
 * rendered ahead of the click (share-on, replace). When it is there,
 * this redirects to a short-lived presigned download. When it is not
 * (the first ask after a change, a render that failed), this asks the
 * worker for it and answers with a plain page that refreshes itself
 * every few seconds until the file is ready: no script, nothing to
 * click. GET only; this route renders nothing itself (ADR-021).
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const shared = params.fileId ? await resolveSharedLetter(params.fileId) : null;
  if (!shared) return Response.json({ error: "Not found" }, { status: 404 });

  const status = await letterPdfStatus(shared.file);
  if (status.ready) {
    return redirect(await getPresignedDownloadUrl(status.s3Key, letterPdfFileName(shared.file.name)));
  }
  await ensureLetterPdfJob(shared.file);
  return new Response(preparingPage(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
