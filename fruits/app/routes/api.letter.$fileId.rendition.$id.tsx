import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { letterPageFile } from "robustness-core/data/letters.server";
import { getPresignedViewUrl, objectExists } from "robustness-core/data/file.server";
import { isImageRenditionSize, renditionContentType, renditionKey } from "robustness-core/data/mediaKeys";

/**
 * GET /api/letter/:fileId/rendition/:id?size=thumb|display|poster
 *
 * `/api/vault/rendition/:id` for a public letter page: the same
 * worker-made rendition (or the original while there is none yet), gated
 * by `letterPageFile` instead of a session. Never decodes anything;
 * the web server never processes media (ADR-021). GET only.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fileId, id } = params;
  const file = fileId && id ? await letterPageFile(fileId, id) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  if (!file.s3_key) return Response.json({ error: "No viewable file attached" }, { status: 400 });

  const size = new URL(request.url).searchParams.get("size");
  const isVideo = file.content_type.startsWith("video/");
  const wanted = isVideo ? (size === "poster" ? "poster" : null) : isImageRenditionSize(size) ? size : null;
  if (!wanted) {
    return Response.json({ error: isVideo ? "A video has only a poster rendition" : "size must be thumb or display" }, { status: 400 });
  }

  const key = renditionKey(file.s3_key, wanted);
  if (await objectExists(key)) {
    return redirect(await getPresignedViewUrl(key, 900, renditionContentType(wanted)));
  }
  if (isVideo) return Response.json({ error: "No poster yet" }, { status: 404 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
