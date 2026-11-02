/**
 * The worker's half of a letter's recording (`letterRecordingQueue.server.ts`
 * has the queue): the browser's raw recording (WebM from Chrome and
 * Firefox, MP4 from Safari) becomes the `.web.mp4` the CLI's
 * `nopal video prep` makes (`crates/core/src/video.rs`), stored under the
 * same file id the letter already names, then its poster. Imported by
 * `packages/worker/worker.ts` and nothing in the web app: it runs ffmpeg
 * (ADR-021; `noMediaProcessingInApp.test.ts`).
 *
 * Ported from the CLI, with two values changed for this source:
 * - Height capped at 1080, not 1440: the source is a screen of text and a
 *   face, and the worker's 1 GB also holds Chromium for the letter PDF.
 * - No `-tune film`: film tuning is for camera grain; a page of text
 *   is not film.
 * Everything else is the CLI's: libx264 at CRF 21, preset slow (the
 * screen is mostly still, so it costs little), 30 fps at most, 8-bit
 * 4:2:0, BT.709 tagged on the frames inside the filter chain (output
 * colour flags lose to the frames' own tags), AAC 128k, faststart.
 */

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { ffmpegBinary } from "./attachmentFrames.server";
import { downloadFileStream, uploadPrivateFileToS3 } from "./file.server";
import { repointFileRef } from "./fileReplace.server";
import { merge } from "./generic.server";
import { makeRenditionsForFile } from "./mediaRenditions.server";
import { getFileRefById } from "./vault.server";
import type { LetterRecordingJobResult } from "./letterRecordingQueue.server";

const run = promisify(execFile);

export const RECORDING_CRF = 21;
export const RECORDING_MAX_HEIGHT = 1080;
export const RECORDING_PRESET = "slow";
export const RECORDING_MAX_FPS = 30;
export const WEB_PIX_FMT = "yuv420p";

/** The first video stream's colour, read from ffmpeg's own banner (the
 * worker has ffmpeg-static, which ships no ffprobe). */
export type ColourProbe = { colorSpace: string | null; hdr: boolean };

/** From a banner line like
 * `Stream #0:0: Video: vp8, yuv420p(tv, bt709, progressive), 1280x720`
 * or `... yuv420p10le(tv, bt2020nc/bt2020/smpte2084)`: the matrix is the
 * first name after the range, the transfer the last of a `/` triple. */
export function probeColourFromBanner(banner: string): ColourProbe {
  const line = banner.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l));
  const group = line ? /: Video: [^,]+, \w+\(([^)]*)\)/.exec(line)?.[1] : undefined;
  if (!group) return { colorSpace: null, hdr: false };
  const parts = group.split(",").map((p) => p.trim());
  const colour = parts.find((p) => /^(bt|smpte|gbr|fcc|ycgco|unknown)/.test(p)) ?? null;
  const triple = colour?.split("/") ?? [];
  const colorSpace = triple[0] && triple[0] !== "unknown" ? triple[0] : null;
  const transfer = triple.length === 3 ? triple[2] : colorSpace;
  return { colorSpace, hdr: transfer === "smpte2084" || transfer === "arib-std-b67" };
}

/** `web_filters` in `crates/core/src/video.rs`, the same chain. */
export function webFilters(maxHeight: number | null, probe: ColourProbe | null): string {
  const size = maxHeight ? `-2:min(ih\\,${maxHeight})` : "iw:ih";
  const scale = `scale=${size}:flags=lanczos+accurate_rnd+full_chroma_int:sws_dither=ed`;
  if (probe?.hdr) return `${scale},format=${WEB_PIX_FMT}`;
  // An untagged source is read as BT.709, as browsers do for HD.
  const tagged = ["bt709", "bt470bg", "smpte170m", "bt2020nc"].includes(probe?.colorSpace ?? "");
  const inMatrix = tagged ? "" : ":in_color_matrix=bt709";
  return `${scale}${inMatrix}:out_color_matrix=bt709:out_range=tv,format=${WEB_PIX_FMT},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv`;
}

/** The ffmpeg arguments, apart from the binary. */
export function webMp4Args(input: string, output: string, filters: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    filters,
    "-fpsmax",
    String(RECORDING_MAX_FPS),
    "-c:v",
    "libx264",
    "-crf",
    String(RECORDING_CRF),
    "-preset",
    RECORDING_PRESET,
    "-x264-params",
    "aq-mode=3",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

/** `read-aloud.webm` becomes `read-aloud.web.mp4`; already prepared stays. */
export function webMp4Name(name: string): string {
  if (/\.web\.mp4$/i.test(name)) return name;
  return `${name.replace(/\.[^.]+$/, "")}.web.mp4`;
}

/** The job: one recording made web-safe under its own file id, then its
 * poster. The poster is made after the record is repointed and outside
 * the transcode's own error path, so a poster failure never throws the
 * finished video away. */
export async function prepareLetterRecording(fileId: string, log: (line: string) => void = () => {}): Promise<LetterRecordingJobResult> {
  const file = await getFileRefById(fileId);
  if (!file || !file.s3_key) return { skipped: "no such file, or no stored bytes" };
  if (!file.content_type.startsWith("video/")) return { skipped: `${file.content_type} is not a video` };
  if (/\.web\.mp4$/i.test(file.s3_key)) return { skipped: "already prepared" };

  const dir = await mkdtemp(join(tmpdir(), "letter-recording-"));
  let prepared: { s3Key: string; size: number };
  try {
    const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "") || "bin";
    const input = join(dir, `in.${ext}`);
    const output = join(dir, "out.mp4");
    await pipeline(await downloadFileStream(file.s3_key), createWriteStream(input));

    // `-i` with no output prints the streams and exits nonzero.
    const banner = await run(ffmpegBinary(), ["-hide_banner", "-i", input], { maxBuffer: 1 << 22 }).catch((e: { stderr?: string }) => e);
    const probe = probeColourFromBanner(String(banner.stderr ?? ""));
    const filters = webFilters(RECORDING_MAX_HEIGHT, probe);
    log(`transcoding ${file.s3_key} (${probe.colorSpace ?? "untagged"}${probe.hdr ? ", HDR" : ""})`);
    await run(ffmpegBinary(), webMp4Args(input, output, filters), { maxBuffer: 1 << 22 });

    const size = (await stat(output)).size;
    const s3Key = `${file.s3_key.replace(/\.[^./]+$/, "")}.web.mp4`;
    const s3Url = await uploadPrivateFileToS3(await readFile(output), s3Key);
    // Same row, so the letter's link keeps working; the raw upload is
    // deleted by the repoint.
    await repointFileRef(file, { s3Key, s3Url, contentType: "video/mp4", contentHash: null, size });
    await merge("file_refs", fileId, { name: webMp4Name(file.name) });
    prepared = { s3Key, size };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  let poster = false;
  try {
    poster = (await makeRenditionsForFile(fileId)).written > 0;
  } catch (err) {
    log(`poster for ${fileId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ...prepared, poster };
}

