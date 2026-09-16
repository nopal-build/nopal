import type { LoaderFunctionArgs } from "react-router";
import { getFileRefById, isFileEffectivelyPublic } from "robustness-core/data/vault.server";
import { downloadFileBytes, getImageThumbnail } from "robustness-core/data/file.server";

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
 * Generated on demand (`getImageThumbnail`, `file.server.ts`) rather than
 * persisted anywhere — cheap enough per-request for image sizes, and far
 * simpler than inventing a thumbnail cache/invalidation scheme. The actual
 * caching win comes from the caller appending `?v=<updated_at>` to the URL
 * (see `public.folder.$folderId.tsx`) paired with the long-lived,
 * `immutable` Cache-Control below — the URL itself changes whenever the
 * file is replaced, so it's always safe to cache forever until then.
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
    const original = await downloadFileBytes(file.s3_key);
    const thumb = await getImageThumbnail(original);
    return new Response(new Uint8Array(thumb.bytes), {
      headers: {
        "Content-Type": thumb.contentType,
        "Content-Length": String(thumb.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("Public thumbnail error:", err);
    return Response.json({ error: "Failed to generate thumbnail" }, { status: 500 });
  }
}
