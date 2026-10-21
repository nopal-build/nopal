import type { LoaderFunctionArgs } from "react-router";
import { resolveSharedDeliverable } from "robustness-core/data/deliverables.server";

/**
 * GET /api/deliverable/:fileId/download
 *
 * The deliverable's markdown source, as a download, with no session:
 * only while its link is on (`resolveSharedDeliverable`). Markdown lives
 * in the file record's own `content` (never S3, see `api.vault.upload`),
 * so this writes the text straight out rather than presigning. The PDF
 * the seed asks for lands beside this in the next round. GET only.
 *
 * 404 (not 403) when the link is off, the same as the page.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const shared = params.fileId ? await resolveSharedDeliverable(params.fileId) : null;
  if (!shared) return Response.json({ error: "Not found" }, { status: 404 });
  const name = shared.file.name.replace(/["\r\n]/g, "");
  return new Response(shared.file.content ?? "", {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
