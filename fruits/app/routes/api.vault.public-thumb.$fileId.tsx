import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getFileRefById, isFileEffectivelyPublic } from "robustness-core/data/vault.server";
import { downloadFileBytes, objectExists } from "robustness-core/data/file.server";
import { enqueueRenditionsJob } from "robustness-core/data/mediaQueue.server";
import { renditionKey, renditionContentType } from "robustness-core/data/mediaKeys";

/**
 * GET /api/vault/public-thumb/:fileId
 *
 * A resized, re-encoded (WebP) thumbnail of a public IMAGE file — used as
 * the `<img>` src in the photo-gallery grid on `/public/folder/:folderId`
 * instead of the full-resolution original, so a folder of multi-megabyte
 * photos doesn't ship megabytes of data just to render a few hundred
 * pixels of thumbnail. The full original is still what backs the single-
 * file view (`/api/vault/public-view/:fileId`) and the download path
 * (`/api/vault/public-download/:fileId`) — this route is thumbnails ONLY,
 * never a substitute for those.
 *
 * The web server never processes media (ADR-021, Austin 2026-09-22): this
 * route used to decode and resize the original itself on every request
 * (`sharp`, via a helper this file no longer imports), which is exactly
 * the request-path decode that took the app from 200MB to 900MB on a
 * page of HEIC photos. It now only reads the worker-made `thumb`
 * rendition (`mediaRenditions.server.ts`) — a small pre-resized WebP
 * already sitting in S3 — and streams those bytes as-is; still no
 * decode, so the 1-year immutable Cache-Control from before is
 * unchanged (a real GetObject passthrough, not a computed response).
 *
 * If the rendition isn't there yet (upload routes enqueue one, but the
 * worker takes a few seconds), this asks the worker for one and falls
 * back to a redirect to the full-size original for this one request —
 * same "shows as the original for a few seconds" gap
 * `api.vault.rendition.$fileId.tsx` documents for private files.
 *
 * 404 (not 403) whenever the file isn't public, so this can't be used to
 * probe which file ids exist. 400 for anything that isn't an image — this
 * route has no reason to ever be pointed at a video/PDF/etc.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) {
    return Response.json({ error: "fileId required" }, { status: 400 });
  }

  const file = await getFileRefById(fileId);
  if (!file || !(await isFileEffectivelyPublic(file))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (!file.s3_key || !file.content_type.startsWith("image/")) {
    return Response.json({ error: "Not an image" }, { status: 400 });
  }

  try {
    const key = renditionKey(file.s3_key, "thumb");
    if (await objectExists(key)) {
      const bytes = await downloadFileBytes(key);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": renditionContentType("thumb"),
          "Content-Length": String(bytes.length),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    await enqueueRenditionsJob(file._id).catch((err) => console.error("Could not enqueue renditions:", err));
    return redirect(`/api/vault/public-view/${file._id}`);
  } catch (err) {
    console.error("Public thumbnail error:", err);
    return Response.json({ error: "Failed to load thumbnail" }, { status: 500 });
  }
}
