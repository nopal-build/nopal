/**
 * Turning an attachment the vision model cannot read into stills it can.
 *
 * Two cases, one shape. The model takes JPEG/PNG/GIF/WebP and nothing
 * else (`anthropicProvider.server.ts`'s `ANTHROPIC_IMAGE_MEDIA_TYPES`),
 * and a phone produces exactly the two things it cannot take: HEIC
 * photos and videos. Both used to be reported as unsupported by
 * `sync-knowledge` -- honestly, since #39, but still tossed -- so a file
 * somebody attached had no path into the graph and the README's "a file
 * is never optional" rule had nothing to carry.
 *
 * - A HEIC/HEIF photo is decoded to one JPEG. `sharp`'s prebuilt libvips
 *   cannot decode HEVC-compressed HEIF (the iPhone default; verified on a
 *   real IMG_*.heic, "bad seek" then a decoder error), so this uses
 *   `heic-convert` (libheif compiled to wasm, HEVC included).
 * - A video becomes a few evenly spaced frames, scaled down, via the
 *   `ffmpeg-static` binary. Frames, not audio: what changes across them is
 *   what the description is asked for. Narration is lost and the sidecar
 *   says so.
 *
 * Everything downstream then sees a video exactly the way it sees a
 * photo: a description sidecar, a description-grounded node, the file's
 * own `?type=video` link carried into the README gallery.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import heicConvert from "heic-convert";
import sharp from "sharp";

const run = promisify(execFile);

/** Frames per video: enough to show a change, few enough to stay one
 * cheap call. Evenly spaced, skipping the first and last few percent so
 * a clip that opens on the ground and ends in a pocket still shows its
 * subject. */
export const VIDEO_FRAME_COUNT = 4;
/** Longest edge of an extracted frame. Detail the model can use without
 * paying for a 4K still. */
const FRAME_MAX_EDGE = 1280;

export type Still = { jpegBase64: string; /** Seconds into the clip; null for a photo. */ atSeconds: number | null };

export function isHeicContentType(contentType: string): boolean {
  return contentType === "image/heic" || contentType === "image/heif";
}

export function isVideoContentType(contentType: string): boolean {
  return contentType.startsWith("video/");
}

/** One JPEG from a HEIC/HEIF photo. */
export async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  const out = await heicConvert({ buffer: new Uint8Array(bytes), format: "JPEG", quality: 0.85 });
  return Buffer.from(out);
}

/** The image formats the vision model takes as-is. Mirrors
 * `anthropicProvider.server.ts`'s own set; anything else is converted. */
const VISION_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * An image the vision model will accept: a JPEG/PNG/GIF/WebP passes
 * through untouched; a HEIC/HEIF is decoded with `heic-convert`; anything
 * else `sharp` can read (TIFF, BMP, AVIF, ...) is re-encoded as JPEG.
 * Throws for a format nothing here can read, which the caller reports as
 * unsupported the way it always did.
 */
export async function normalizeImageForVision(
  bytes: Buffer,
  contentType: string,
): Promise<{ base64: string; mediaType: string }> {
  if (VISION_MEDIA_TYPES.has(contentType)) return { base64: bytes.toString("base64"), mediaType: contentType };
  const jpeg = isHeicContentType(contentType)
    ? await heicToJpeg(bytes)
    : await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
  return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
}

/** Pure: where in a clip of `durationSeconds` to take `count` frames. */
export function frameTimestamps(durationSeconds: number, count: number): number[] {
  if (!(durationSeconds > 0) || count <= 0) return [];
  if (count === 1) return [durationSeconds / 2];
  const start = durationSeconds * 0.05;
  const end = durationSeconds * 0.95;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((start + i * step) * 100) / 100);
}

/** Pure: `Duration: 00:00:14.32` out of ffmpeg's own stderr banner. */
export function parseFfmpegDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary is not available on this platform (ffmpeg-static returned null)");
  return ffmpegPath;
}

/**
 * `VIDEO_FRAME_COUNT` stills from a video, with the clip's duration.
 * Writes the bytes to a temp file (ffmpeg wants a seekable input for
 * `-ss`), extracts one frame per timestamp, and cleans up whatever
 * happens.
 */
export async function videoToStills(
  bytes: Buffer,
  extension: string,
): Promise<{ stills: Still[]; durationSeconds: number }> {
  const dir = await mkdtemp(join(tmpdir(), "graphlog-video-"));
  try {
    const input = join(dir, `in.${extension.replace(/[^a-z0-9]/gi, "") || "bin"}`);
    await writeFile(input, new Uint8Array(bytes));
    // `-i` with no output prints the banner (with Duration) and exits
    // nonzero; the banner is what we want.
    const probe = await run(ffmpeg(), ["-hide_banner", "-i", input, "-f", "null", "-"], { maxBuffer: 1 << 24 }).catch(
      (e: { stderr?: string }) => e,
    );
    const durationSeconds = parseFfmpegDuration(String(probe.stderr ?? ""));
    if (!durationSeconds) throw new Error("could not read the video's duration");

    const stills: Still[] = [];
    for (const t of frameTimestamps(durationSeconds, VIDEO_FRAME_COUNT)) {
      const out = join(dir, `frame-${t}.jpg`);
      await run(ffmpeg(), [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(t),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${FRAME_MAX_EDGE},iw)':-2`,
        "-q:v",
        "3",
        out,
      ]);
      stills.push({ jpegBase64: (await readFile(out)).toString("base64"), atSeconds: t });
    }
    return { stills, durationSeconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `0:14` style, for a prompt and a front-matter line. */
export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
