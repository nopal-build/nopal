import type { LoaderFunctionArgs } from "react-router";
import { resolveSentLetterForMember, resolveSharedLetter, sentCopyOf } from "robustness-core/data/letters.server";
import { getUser } from "../modules/auth/auth.server";

/**
 * GET /api/letter/:fileId/download
 *
 * The letter's markdown source as it was sent, as a download: with no
 * session while its link is on (`resolveSharedLetter`), or to someone
 * on the project once the letter is sent (`resolveSentLetterForMember`).
 * Never the draft. Markdown lives in the file record's own `content`
 * (never S3, see `api.vault.upload`), so this writes the text straight
 * out rather than presigning. GET only.
 *
 * 404 (not 403) for anyone else, the same as the page.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const shared = params.fileId ? await resolveSharedLetter(params.fileId) : null;
  const viewer = !shared && params.fileId ? await getUser(request) : null;
  const found = shared ?? (viewer && params.fileId ? await resolveSentLetterForMember(params.fileId, viewer._id) : null);
  const sent = found ? sentCopyOf(found.file) : null;
  if (!found || !sent) return Response.json({ error: "Not found" }, { status: 404 });
  const name = found.file.name.replace(/["\r\n]/g, "");
  return new Response(sent.content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
