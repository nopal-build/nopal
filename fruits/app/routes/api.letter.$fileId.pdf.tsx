import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveReadableLetter } from "robustness-core/data/letters.server";
import { getUser } from "../modules/auth/auth.server";
import { letterPdfFileName, letterPdfStatus, ensureLetterPdfJob, preparingPage } from "robustness-core/data/letterPdf.server";
import { getPresignedDownloadUrl } from "robustness-core/data/file.server";

/**
 * GET /api/letter/:fileId/pdf
 *
 * The letter's PDF, for whoever may read the sent copy
 * (`resolveReadableLetter`): anyone while the link is on, or someone on
 * the project once it is sent; 404 otherwise. The worker prints a
 * link-off letter under a render pass. The PDF is of the sent copy
 * (`letterPdf.server.ts`), keyed by the sent copy's hash and rendered
 * ahead of the click (share-on, each send while the link is on). When it is there,
 * this redirects to a short-lived presigned download. When it is not
 * (the first ask after a change, a render that failed), this asks the
 * worker for it and answers with a plain page that refreshes itself
 * every few seconds until the file is ready: no script, nothing to
 * click. GET only; this route renders nothing itself (ADR-021).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = params.fileId ? await getUser(request) : null;
  const shared = params.fileId ? await resolveReadableLetter(params.fileId, { viewerHumanId: viewer?._id ?? null }) : null;
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
