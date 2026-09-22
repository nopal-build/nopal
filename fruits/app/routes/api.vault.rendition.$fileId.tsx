import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById, canViewFileRef } from "robustness-core/data/vault.server";
import { getPresignedViewUrl, objectExists } from "robustness-core/data/file.server";
import { isImageRenditionSize, renditionContentType, renditionKey } from "robustness-core/data/mediaKeys";

/**
 * GET /api/vault/rendition/:fileId?size=thumb|display|poster
 *
 * A browser-sized version of a vault image, or a video's poster frame,
 * IF THE WORKER HAS MADE IT; otherwise the original, exactly what
 * `/api/vault/view/:fileId` serves. Same access check as that route.
 *
 * This route never decodes or resizes anything. The web server never
 * processes media (Austin, 2026-09-22): renditions are made in the
 * worker (`mediaRenditions.server.ts`, fed by `mediaQueue.server.ts` at
 * upload and by sync-knowledge's backfill) and stored in S3, and this
 * route only checks for one and redirects. The gap between an upload
 * and its rendition is seconds; during it a HEIC photo shows as the
 * original, which Safari renders and Chrome does not, the same as
 * before renditions existed.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canViewFileRef(user._id, file))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!file.s3_key) {
    return Response.json({ error: "No viewable file attached" }, { status: 400 });
  }

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
  if (isVideo) {
    // No poster yet: nothing to show before play.
    return Response.json({ error: "No poster yet" }, { status: 404 });
  }
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
