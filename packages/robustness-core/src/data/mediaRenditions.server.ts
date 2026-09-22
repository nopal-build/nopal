/**
 * Derived images for the browser: a thumb and a display-size WebP for any
 * image, a poster JPEG for a video.
 *
 * Why this exists. The README gallery served each 4 MB original into a
 * three-column grid, which on a phone is a grid of empty boxes, and a
 * `<video>` had no poster. Link expiry was never the cause: `/api/vault/
 * view/:id` signs a fresh URL on every request and nothing stores one.
 *
 * Made once, then stored under `renditions/<hash of the source's s3_key>/`.
 * Keyed by the STORAGE key rather than the file id because an original
 * and every synced copy of it share one `s3_key` (`copyFileIntoFolder`
 * copies the pointer, not the bytes), so one rendition serves the daily
 * log, the project's Syncs copy, and whatever a refile makes next.
 *
 * Images are made at request time in the app: `sharp` and `heic-convert`
 * are both available there and a 4 MB JPEG resizes in well under a second,
 * once. A poster needs ffmpeg, which only the worker image is guaranteed
 * to have, so sync-knowledge writes it (it already has the frames) and the
 * app only names the key and serves what is there.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { heicToJpeg, isHeicContentType } from "./attachmentFrames.server";
import { downloadFileBytes, objectExists, uploadPrivateFileToS3 } from "./file.server";

/** Longest edge, in pixels. `thumb` is a list row; `display` is a gallery
 * cell on any screen we ship to, and a 1600px WebP of a site photo is a
 * few hundred KB where the original is several MB. */
export const RENDITION_SIZES = { thumb: 480, display: 1600 } as const;
export type ImageRenditionSize = keyof typeof RENDITION_SIZES;
export type RenditionSize = ImageRenditionSize | "poster";

export function isImageRenditionSize(value: string | null): value is ImageRenditionSize {
  return value === "thumb" || value === "display";
}

/** Pure. Where a rendition lives, from the source's storage key. */
export function renditionKey(s3Key: string, size: RenditionSize): string {
  const hash = createHash("sha256").update(s3Key).digest("hex").slice(0, 32);
  return `renditions/${hash}/${size}.${size === "poster" ? "jpg" : "webp"}`;
}

export type Rendition = { bytes: Buffer; contentType: string };

/**
 * The stored rendition if it exists, else made from the original, stored,
 * and returned. Two concurrent first requests both make it and both store
 * the same bytes under the same key; that is idempotent and cheaper than
 * a lock.
 *
 * A HEIC/HEIF original is decoded first (`sharp`'s libvips cannot). An
 * animated GIF/WebP is passed through at full size rather than flattened
 * to one frame, the same rule `getImageThumbnail` follows, and is never
 * stored since it is not a rendition of anything.
 */
export async function ensureImageRendition(
  file: { s3_key: string; content_type: string },
  size: ImageRenditionSize,
): Promise<Rendition> {
  const key = renditionKey(file.s3_key, size);
  if (await objectExists(key)) {
    return { bytes: await downloadFileBytes(key), contentType: "image/webp" };
  }
  const original = await downloadFileBytes(file.s3_key);
  const decodable = isHeicContentType(file.content_type) ? await heicToJpeg(original) : original;
  const metadata = await sharp(decodable).metadata();
  if ((metadata.pages ?? 1) > 1) {
    return { bytes: original, contentType: file.content_type };
  }
  const edge = RENDITION_SIZES[size];
  const bytes = await sharp(decodable)
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await uploadPrivateFileToS3(bytes, key);
  return { bytes, contentType: "image/webp" };
}

/** Writes a video's poster frame (a JPEG still) unless one is already
 * there. Returns whether it wrote. The caller supplies the still; this
 * module never runs ffmpeg. */
export async function writeVideoPoster(s3Key: string, jpegBase64: string): Promise<boolean> {
  const key = renditionKey(s3Key, "poster");
  if (await objectExists(key)) return false;
  await uploadPrivateFileToS3(Buffer.from(jpegBase64, "base64"), key);
  return true;
}
