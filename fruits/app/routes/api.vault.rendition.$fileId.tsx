import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById, canViewFileRef } from "robustness-core/data/vault.server";
import { getPresignedViewUrl, objectExists } from "robustness-core/data/file.server";
import { isVideoContentType } from "robustness-core/data/attachmentFrames.server";
import {
  ensureImageRendition,
  isImageRenditionSize,
  renditionKey,
} from "robustness-core/data/mediaRenditions.server";

/**
 * GET /api/vault/rendition/:fileId?size=thumb|display|poster
 *
 * A browser-sized version of a vault image, or a video's poster frame.
 * Same access check as `/api/vault/view/:fileId`; that route still serves
 * the original, this one exists so a gallery of phone photos is a few
 * hundred KB rather than a hundred MB. See `mediaRenditions.server.ts`.
 *
 * Images stream back as WebP with a year-long private cache: a file id's
 * bytes never change (a new upload is a new row and a new key), so the
 * URL is stable for as long as the row exists. A video's poster is a
 * stored JPEG the worker wrote; it redirects like `view` does, and 404s
 * until the next pipeline run has made one.
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

  if (isVideoContentType(file.content_type)) {
    if (size !== "poster") {
      return Response.json({ error: "A video has only a poster rendition" }, { status: 400 });
    }
    const key = renditionKey(file.s3_key, "poster");
    if (!(await objectExists(key))) {
      return Response.json({ error: "No poster yet" }, { status: 404 });
    }
    return redirect(await getPresignedViewUrl(key, 900, "image/jpeg"));
  }

  if (!file.content_type.startsWith("image/")) {
    return Response.json({ error: "Not an image or video" }, { status: 400 });
  }
  if (!isImageRenditionSize(size)) {
    return Response.json({ error: "size must be thumb or display" }, { status: 400 });
  }

  try {
    const rendition = await ensureImageRendition({ s3_key: file.s3_key, content_type: file.content_type }, size);
    return new Response(new Uint8Array(rendition.bytes), {
      headers: {
        "Content-Type": rendition.contentType,
        "Content-Length": String(rendition.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("Rendition error:", err);
    return Response.json({ error: "Failed to make the rendition" }, { status: 500 });
  }
}
