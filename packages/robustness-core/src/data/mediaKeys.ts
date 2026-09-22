/**
 * Where a rendition lives, and nothing else: pure, so the app can name a
 * rendition and check for it without importing a decoder. The web server
 * never processes media (Austin, 2026-09-22); `mediaRenditions.server.ts`
 * does, in the worker.
 */

import { createHash } from "node:crypto";

/** Longest edge, in pixels. `thumb` is a list row; `display` is a gallery
 * cell on any screen we ship to, and a 1600px WebP of a site photo is a
 * few hundred KB where the original is several MB. */
export const RENDITION_SIZES = { thumb: 480, display: 1600 } as const;
export type ImageRenditionSize = keyof typeof RENDITION_SIZES;
export type RenditionSize = ImageRenditionSize | "poster";

export function isImageRenditionSize(value: string | null): value is ImageRenditionSize {
  return value === "thumb" || value === "display";
}

/** Keyed by the STORAGE key rather than the file id because an original
 * and every synced copy of it share one `s3_key` (`copyFileIntoFolder`
 * copies the pointer, not the bytes), so one rendition serves the daily
 * log, the project's Syncs copy, and whatever a refile makes next. */
export function renditionKey(s3Key: string, size: RenditionSize): string {
  const hash = createHash("sha256").update(s3Key).digest("hex").slice(0, 32);
  return `renditions/${hash}/${size}.${size === "poster" ? "jpg" : "webp"}`;
}

/** The content type a rendition is served as. */
export function renditionContentType(size: RenditionSize): string {
  return size === "poster" ? "image/jpeg" : "image/webp";
}
