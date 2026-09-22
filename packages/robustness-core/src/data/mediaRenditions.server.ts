/**
 * Derived images for the browser: a thumb and a display-size WebP for any
 * image, a poster JPEG for a video. Made in the WORKER, stored in S3
 * under `renditions/<hash of the source's s3_key>/` (`mediaKeys.ts`),
 * served by the app with a redirect and never made there.
 *
 * Why this exists. The README gallery served each 4 MB original into a
 * three-column grid, which on a phone is a grid of empty boxes, and a
 * `<video>` had no poster.
 *
 * Why the worker. The first version made renditions on the request path
 * in the app. A HEIC is decoded in WebAssembly and each decode holds
 * about 130 MB the module never gives back; five phone photos requested
 * together took the 1 GB app process to 900 MB and Fly answered 502
 * while it restarted (2026-09-22). Austin's rule since: the web server
 * never processes media. The worker already decodes every attachment to
 * describe it, and has ffmpeg, so it does this too: once at upload
 * (`mediaQueue.server.ts`), and as a backfill from sync-knowledge's own
 * decode. Decodes are bounded here because a burst of uploads can do to
 * the worker what a page did to the app.
 */

import sharp from "sharp";
import { heicToJpeg, hasFfmpeg, isHeicContentType, isVideoContentType, normalizeImageForVision, videoToStills } from "./attachmentFrames.server";
import { downloadFileBytes, objectExists, uploadPrivateFileToS3 } from "./file.server";
import { renditionKey, RENDITION_SIZES, type ImageRenditionSize } from "./mediaKeys";
import { getFileRefById } from "./vault.server";
import { isImageContentType } from "./sorter.server";

export { renditionKey, RENDITION_SIZES, isImageRenditionSize, type ImageRenditionSize, type RenditionSize } from "./mediaKeys";

/**
 * A gate that lets `limit` callers through at a time and queues the rest
 * in order. Per process, which is the unit that runs out of memory.
 */
export function createLimiter(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T,>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/** One HEIC decode at a time: the WebAssembly decoder's memory is the
 * whole reason this module is bounded. */
const heicLimiter = createLimiter(1);
/** A few resizes at a time: libvips is fast and frugal, but a decoded
 * 12-megapixel JPEG is still tens of MB while it is being resized. */
const resizeLimiter = createLimiter(3);

/** One size from decodable bytes, or null for an animated image (left as
 * the original rather than flattened to one frame). */
async function renderRendition(decodable: Buffer, size: ImageRenditionSize): Promise<Buffer | null> {
  return resizeLimiter(async () => {
    const image = sharp(decodable);
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) return null;
    const edge = RENDITION_SIZES[size];
    return image
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  });
}

/**
 * Both image renditions from bytes a caller has already decoded, written
 * only where missing. sync-knowledge calls this with the JPEG it made to
 * describe a photo, so the decode that costs the most happens once.
 * Returns how many it wrote.
 */
export async function writeImageRenditions(s3Key: string, decodable: Buffer): Promise<number> {
  let written = 0;
  for (const size of ["thumb", "display"] as const) {
    const key = renditionKey(s3Key, size);
    if (await objectExists(key)) continue;
    const rendered = await renderRendition(decodable, size);
    if (!rendered) continue;
    await uploadPrivateFileToS3(rendered, key);
    written += 1;
  }
  return written;
}

/** Whether both image renditions already exist. */
export async function imageRenditionsExist(s3Key: string): Promise<boolean> {
  return (await objectExists(renditionKey(s3Key, "thumb"))) && (await objectExists(renditionKey(s3Key, "display")));
}

/** Writes a video's poster frame (a JPEG still) unless one is already
 * there. Returns whether it wrote. */
export async function writeVideoPoster(s3Key: string, jpegBase64: string): Promise<boolean> {
  const key = renditionKey(s3Key, "poster");
  if (await objectExists(key)) return false;
  await uploadPrivateFileToS3(Buffer.from(jpegBase64, "base64"), key);
  return true;
}

export type RenditionsOutcome = { written: number; skipped: string | null };

/**
 * The media queue's job: every rendition one file can have, made from a
 * single download and a single decode, written only where missing. A
 * file that is neither image nor video is skipped and says so; a video
 * in a process without ffmpeg is skipped too, and sync-knowledge in the
 * worker will write its poster on the next run.
 */
export async function makeRenditionsForFile(fileId: string): Promise<RenditionsOutcome> {
  const file = await getFileRefById(fileId);
  if (!file || !file.s3_key) return { written: 0, skipped: "no such file, or no stored bytes" };
  if (isImageContentType(file.content_type)) {
    if (await imageRenditionsExist(file.s3_key)) return { written: 0, skipped: "already made" };
    const bytes = await downloadFileBytes(file.s3_key);
    const decoded = isHeicContentType(file.content_type)
      ? await heicLimiter(() => heicToJpeg(bytes))
      : Buffer.from((await normalizeImageForVision(bytes, file.content_type)).base64, "base64");
    return { written: await writeImageRenditions(file.s3_key, decoded), skipped: null };
  }
  if (isVideoContentType(file.content_type)) {
    if (!hasFfmpeg()) return { written: 0, skipped: "no ffmpeg in this process" };
    if (await objectExists(renditionKey(file.s3_key, "poster"))) return { written: 0, skipped: "already made" };
    const bytes = await downloadFileBytes(file.s3_key);
    const { stills } = await videoToStills(bytes, file.name.split(".").pop() ?? "bin", 1);
    const still = stills[0];
    if (!still) return { written: 0, skipped: "no frame could be read" };
    return { written: (await writeVideoPoster(file.s3_key, still.jpegBase64)) ? 1 : 0, skipped: null };
  }
  return { written: 0, skipped: `${file.content_type} has no rendition` };
}
