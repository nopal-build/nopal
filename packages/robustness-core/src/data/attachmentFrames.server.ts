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

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
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

/** A HEIF container (HEIC included) opens with an ISO-BMFF `ftyp` box. */
function isHeifContainer(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp";
}

/** One JPEG from a HEIC/HEIF photo. The type comes from the file's name,
 * and a photo exported as JPEG can keep its `.HEIC` one: 81 of a
 * project's iPhone photos were JPEG bytes the HEIC decoder refused
 * ("input buffer is not a HEIC image"), so none were described and none
 * got renditions (2026-10-30). Bytes that are not HEIF go to `sharp`. */
export async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  if (!isHeifContainer(bytes)) return sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
  const turn = heicTurn.then(() => decodeHeicInChild(bytes));
  heicTurn = turn.catch(() => {});
  return turn;
}

/** One HEIC decode at a time in this process, whichever job asks. */
let heicTurn: Promise<unknown> = Promise.resolve();

/** Long enough for any phone photo (about a second each); a decode
 * still going after this is stuck, not slow. */
const HEIC_DECODE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * The decoder runs in a Node process of its own, one per photo. The
 * WebAssembly decoder holds ~130-250 MB per decode and never gives it
 * back, so in the worker's own process a run's memory only climbed: a
 * GraphLog run on a project of iPhone photos died at the same photo on
 * two runs ("Worker exited unexpectedly", 2026-10-30; ten decodes in one
 * process measured 82 MB to a 541 MB peak). A child returns its memory
 * when it exits, and asks the kernel to kill it first under memory
 * pressure (`oom_score_adj`), so a photo too big for the machine fails
 * as that one photo, unread, and the run goes on.
 */
const HEIC_CHILD_SCRIPT = `
try { require("fs").writeFileSync("/proc/self/oom_score_adj", "1000"); } catch {}
const convert = require(process.argv[1]);
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  try {
    const out = await convert({ buffer: new Uint8Array(Buffer.concat(chunks)), format: "JPEG", quality: 0.85 });
    process.stdout.write(Buffer.from(out));
  } catch (err) {
    process.stderr.write(String((err && err.message) || err));
    process.exitCode = 1;
  }
});
`;

const requireHere = createRequire(import.meta.url);

function decodeHeicInChild(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", HEIC_CHILD_SCRIPT, requireHere.resolve("heic-convert")], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: HEIC_DECODE_TIMEOUT_MS,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    // A child that dies before reading its input closes the pipe; the
    // exit below says why.
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(out));
      const said = Buffer.concat(err).toString().trim();
      reject(
        new Error(
          signal
            ? `the HEIC decoder was stopped (${signal}), likely out of memory or time`
            : said || `the HEIC decoder exited ${code}`,
        ),
      );
    });
    child.stdin.end(bytes);
  });
}

/** The image formats the vision model takes as-is. Mirrors
 * `anthropicProvider.server.ts`'s own set; anything else is converted. */
const VISION_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** What the bytes say they are, from their first few: one of the four the
 * model takes, HEIF, or null for anything else. */
export function imageTypeFromBytes(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (isHeifContainer(bytes)) return "image/heif";
  return null;
}

/**
 * An image the vision model will accept: a JPEG/PNG/GIF/WebP passes
 * through untouched; a HEIC/HEIF is decoded with `heic-convert`; anything
 * else `sharp` can read (TIFF, BMP, AVIF, ...) is re-encoded as JPEG.
 * Throws for a format nothing here can read, which the caller reports as
 * unsupported the way it always did.
 *
 * The format is read from the bytes; the stored type comes from the
 * file's name, and a name can be wrong. Four screenshots named `.PNG`
 * were JPEGs, sent as `image/png`, and the API refused them ("the image
 * appears to be a image/jpeg", 2026-10-30).
 */
export async function normalizeImageForVision(
  bytes: Buffer,
  contentType: string,
): Promise<{ base64: string; mediaType: string }> {
  const actual = imageTypeFromBytes(bytes);
  if (actual && VISION_MEDIA_TYPES.has(actual)) return { base64: bytes.toString("base64"), mediaType: actual };
  const jpeg = actual === "image/heif" || (!actual && isHeicContentType(contentType))
    ? await heicToJpeg(bytes)
    : await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
  return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
}

/** The longest edge the vision model reads at full detail. Larger images
 * are scaled down by the API anyway, so nothing is lost by sending this. */
export const VISION_MAX_EDGE = 1568;
/** Under the API's 5 MB per-image limit with room to spare. */
const VISION_MAX_BYTES = 3_500_000;

/**
 * The copy of an image sent to the model: as it is when it is already
 * small enough, else scaled to `VISION_MAX_EDGE` on its longest edge as a
 * JPEG. A phone's JPEG went to the model untouched, and one over the
 * API's 5 MB limit was refused ("oversized image"), so its photo was never
 * described and never reached the graph, every night (2026-10-02). Only
 * what the model reads; renditions are made from the full image.
 */
export async function fitImageForVision(image: { base64: string; mediaType: string }): Promise<{ base64: string; mediaType: string }> {
  const bytes = Buffer.from(image.base64, "base64");
  const meta = await sharp(bytes).metadata().catch(() => null);
  const edge = Math.max(meta?.width ?? 0, meta?.height ?? 0);
  if (bytes.length <= VISION_MAX_BYTES && edge > 0 && edge <= VISION_MAX_EDGE) return image;
  const jpeg = await sharp(bytes)
    .rotate()
    .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
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

/** The last `time=` a decode reported: how much of the clip it read. */
export function parseFfmpegDecodedTime(stderr: string): number | null {
  const all = [...stderr.matchAll(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return seconds > 0 ? seconds : null;
}

/** Whether this process can run ffmpeg at all. The worker image has it;
 * an app process may not, and a caller that would download a whole
 * video first should ask this before it does. */
export function hasFfmpeg(): boolean {
  return !!ffmpegPath;
}

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary is not available on this platform (ffmpeg-static returned null)");
  return ffmpegPath;
}

/** The same binary, for another worker-only module that runs ffmpeg
 * (`letterRecording.server.ts`). */
export function ffmpegBinary(): string {
  return ffmpeg();
}

/**
 * `frameCount` stills (default `VIDEO_FRAME_COUNT`) from a video, with the
 * clip's duration. One frame is the midpoint, which is what a poster wants.
 * Writes the bytes to a temp file (ffmpeg wants a seekable input for
 * `-ss`), extracts one frame per timestamp, and cleans up whatever
 * happens.
 */
export async function videoToStills(
  bytes: Buffer,
  extension: string,
  frameCount = VIDEO_FRAME_COUNT,
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
    // A browser's MediaRecorder WebM carries no duration in its header
    // ("Duration: N/A"); the decode to null that printed the banner also
    // printed how far it got, which is the length.
    const durationSeconds = parseFfmpegDuration(String(probe.stderr ?? "")) ?? parseFfmpegDecodedTime(String(probe.stderr ?? ""));
    if (!durationSeconds) throw new Error("could not read the video's duration");

    const stills: Still[] = [];
    for (const t of frameTimestamps(durationSeconds, frameCount)) {
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
