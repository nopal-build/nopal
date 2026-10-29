/**
 * The letter's recording, read aloud (`record-the-letter`, 2026-10-29).
 * What code holds: the recording is the letter's first block and a new
 * one replaces it; that block plays as a video with a poster on the
 * guide's preview and on the client's page, and never prints; the
 * worker turns a browser's WebM into the CLI's `.web.mp4` shape (run
 * here with the same ffmpeg the worker has); only a guide asks for it.
 * What a person judges: one recorded letter, watched on a phone.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import {
  RECORDING_MINUTES_LIMIT,
  faceCircle,
  leadingRecordingId,
  letterHasText,
  pickRecorderMimeType,
  recordingBlock,
  recordingFile,
  setLeadingRecording,
} from "../components/letterRecording";
import { bodyOpensWithTitle, publicLetterBody } from "robustness-core/data/letters.server";
import { ffmpegBinary, hasFfmpeg, parseFfmpegDecodedTime } from "robustness-core/data/attachmentFrames.server";
import { probeColourFromBanner, webFilters, webMp4Args, webMp4Name, RECORDING_MAX_HEIGHT } from "robustness-core/data/letterRecording.server";
import { recordingStateFromJob } from "robustness-core/data/letterRecordingQueue.server";

const here = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const LETTER = "# Madison attic\n\nAir seal the ceiling plane first.\n";

describe("the first block", () => {
  it("goes on top of a letter, and a second recording replaces the first, the text untouched", () => {
    const once = setLeadingRecording(LETTER, "rec1");
    expect(once.startsWith(recordingBlock("rec1"))).toBe(true);
    expect(once.endsWith(LETTER)).toBe(true);
    expect(leadingRecordingId(once)).toBe("rec1");
    const twice = setLeadingRecording(once, "rec2");
    expect(leadingRecordingId(twice)).toBe("rec2");
    expect(twice).not.toContain("rec1");
    expect(twice.endsWith(LETTER)).toBe(true);
    expect(twice.match(/:::gallery/g)).toHaveLength(1);
  });

  it("is only a gallery holding one video, first: a gallery of pictures, or a video further down, is the guide's and stays", () => {
    const pictures = ":::gallery\n![hatch](/api/vault/view/pic1)\n:::\n\n" + LETTER;
    expect(leadingRecordingId(pictures)).toBeNull();
    expect(setLeadingRecording(pictures, "rec1")).toContain("![hatch](/api/vault/view/pic1)");
    const lower = LETTER + "\n" + recordingBlock("vid9") + "\n";
    expect(leadingRecordingId(lower)).toBeNull();
    expect(setLeadingRecording(lower, "rec1")).toContain("vid9");
  });

  it("needs a letter to read: a recording alone is not text", () => {
    expect(letterHasText("")).toBe(false);
    expect(letterHasText(recordingBlock("rec1") + "\n")).toBe(false);
    expect(letterHasText(setLeadingRecording(LETTER, "rec1"))).toBe(true);
  });

  it("plays as a video with a poster in the guide's preview and on the client's page", () => {
    const body = setLeadingRecording(LETTER, "rec1");
    const render = (markdown: string) =>
      renderToStaticMarkup(<OxRenderer markdown={markdown} directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })} servedFileIds={{}} className="ox-no-dots" />);
    const preview = render(body);
    expect(preview).toMatch(/<video[^>]*src="\/api\/vault\/view\/rec1"/);
    expect(preview).toContain('poster="/api/vault/rendition/rec1?size=poster"');
    const client = render(publicLetterBody(body, "L1"));
    expect(client).toMatch(/<video[^>]*src="\/api\/letter\/L1\/view\/rec1"/);
    expect(client).toContain('poster="/api/letter/L1/rendition/rec1?size=poster"');
    expect(client).toContain("Air seal the ceiling plane first.");
  });

  it("doesn't make the page repeat the title: the letter's heading still counts as its first words", () => {
    const body = setLeadingRecording(LETTER, "rec1");
    expect(bodyOpensWithTitle(body)).toBe(true);
    expect(bodyOpensWithTitle(publicLetterBody(body, "L1"))).toBe(true);
    expect(bodyOpensWithTitle(setLeadingRecording("Air seal first.\n", "rec1"))).toBe(false);
  });

  it("never prints: the paper block hides a video and its gallery cell, in both copies", () => {
    for (const file of ["../styles/oxmarkdown.css", "../../../webapp/app/styles/oxmarkdown.css"]) {
      const css = readFileSyncText(path.join(here, file));
      const print = css.slice(css.indexOf("/* ── Paper "));
      expect(print, file).toMatch(/\.ox-content \.ox-gallery-item:has\(video\),\s*\.ox-content video \{\s*display: none;/);
    }
  });
});

describe("the browser's half", () => {
  it("records WebM where it can and MP4 where that's all there is, and names the file without codecs", () => {
    expect(pickRecorderMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickRecorderMimeType((t) => t.startsWith("video/mp4"))).toBe("video/mp4;codecs=avc1,mp4a");
    expect(pickRecorderMimeType(() => false)).toBeNull();
    const file = recordingFile(new Blob(["x"]), "video/webm;codecs=vp9,opus", "2026-10-29");
    expect(file.name).toBe("read-aloud-2026-10-29.webm");
    expect(file.type).toBe("video/webm");
    expect(recordingFile(new Blob(["x"]), "video/mp4;codecs=avc1,mp4a", "2026-10-29").name).toBe("read-aloud-2026-10-29.mp4");
  });

  it("draws the face in a circle in the bottom right, inside the frame", () => {
    const { cx, cy, r } = faceCircle(1920, 1080);
    expect(cx + r).toBeLessThan(1920);
    expect(cy + r).toBeLessThan(1080);
    expect(cx).toBeGreaterThan(1920 * 0.75);
    expect(cy).toBeGreaterThan(1080 * 0.6);
  });

  it("has a limit in minutes", () => {
    expect(RECORDING_MINUTES_LIMIT).toBeGreaterThan(0);
    expect(RECORDING_MINUTES_LIMIT).toBeLessThanOrEqual(20);
  });

  it("is offered to a guide on a letter they can edit, and lands through the editor's own autosave", () => {
    const vault = readFileSyncText(path.join(here, "../routes/vault.tsx"));
    expect(vault).toContain("recordable={!!letterSend}");
    expect(vault).toContain("recordable && editable && folderId");
    expect(vault).toContain("updateBody((prev) => setLeadingRecording(prev, recordingFileId))");
    // The picker stays images-only; the recording arrives only through the control.
    expect(vault).toContain('candidates.filter((f) => f.type.startsWith("image/"))');
  });
});

describe("the worker's half", () => {
  it("asks only for a guide, and only for a video beside the letter", () => {
    const route = readFileSyncText(path.join(here, "../routes/api.letter.$fileId.recording.tsx"));
    expect(route).toContain("letterForManager(request, fileId)");
    expect(route).toContain("recording.folder_id !== got.file.folder_id");
    expect(route).toContain('recording.content_type.startsWith("video/")');
    expect(route).not.toMatch(/ffmpeg|letterRecording\.server"/);
  });

  it("reads the colour from ffmpeg's banner, as the CLI reads it from ffprobe", () => {
    expect(probeColourFromBanner("  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, bt709, progressive), 1280x720, SAR 1:1")).toEqual({ colorSpace: "bt709", hdr: false });
    expect(probeColourFromBanner("  Stream #0:0(eng): Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160")).toEqual({ colorSpace: "bt2020nc", hdr: true });
    expect(probeColourFromBanner("  Stream #0:0: Video: vp8, yuv420p(progressive), 1280x720")).toEqual({ colorSpace: null, hdr: false });
    expect(probeColourFromBanner("no streams")).toEqual({ colorSpace: null, hdr: false });
  });

  it("builds the CLI's filter chain: untagged read as BT.709, tags set on the frames, HDR left alone", () => {
    // `web_filters` in crates/core/src/video.rs, for the same inputs.
    expect(webFilters(1080, { colorSpace: null, hdr: false })).toBe(
      "scale=-2:min(ih\\,1080):flags=lanczos+accurate_rnd+full_chroma_int:sws_dither=ed:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
    );
    expect(webFilters(1080, { colorSpace: "smpte170m", hdr: false })).not.toContain("in_color_matrix");
    expect(webFilters(1080, { colorSpace: "bt2020nc", hdr: true })).toBe("scale=-2:min(ih\\,1080):flags=lanczos+accurate_rnd+full_chroma_int:sws_dither=ed,format=yuv420p");
    const args = webMp4Args("in.webm", "out.mp4", "F").join(" ");
    for (const flag of ["-c:v libx264", "-crf 21", "-preset slow", "-fpsmax 30", "-x264-params aq-mode=3", "-c:a aac", "-b:a 128k", "-movflags +faststart", "-f mp4"]) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain("-color_primaries");
    expect(webMp4Name("read-aloud-2026-10-29.webm")).toBe("read-aloud-2026-10-29.web.mp4");
    expect(webMp4Name("x.web.mp4")).toBe("x.web.mp4");
  });

  it("turns a browser-style WebM into a faststart H.264/AAC MP4 tagged BT.709, and the poster can read its length", async () => {
    if (!hasFfmpeg()) return;
    const ffmpegPath = ffmpegBinary();
    const dir = await mkdtemp(path.join(tmpdir(), "letter-recording-test-"));
    try {
      const webm = path.join(dir, "in.webm");
      const mp4 = path.join(dir, "out.mp4");
      // What MediaRecorder makes: VP9 and Opus, no colour tags, and a
      // live-style header with no duration.
      await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-live", "1", webm]);
      const banner = String(((await run(ffmpegPath, ["-hide_banner", "-i", webm]).catch((e: { stderr?: string }) => e)) as { stderr?: string }).stderr ?? "");
      const probe = probeColourFromBanner(banner);
      await run(ffmpegPath, webMp4Args(webm, mp4, webFilters(RECORDING_MAX_HEIGHT, probe)));
      const out = String(((await run(ffmpegPath, ["-hide_banner", "-i", mp4]).catch((e: { stderr?: string }) => e)) as { stderr?: string }).stderr ?? "");
      expect(out).toMatch(/Video: h264 .*yuv420p\(tv, bt709/);
      expect(out).toMatch(/Audio: aac/);
      expect(out).toMatch(/Duration: 00:00:0[12]/);
      // faststart: the index (moov) comes before the media (mdat).
      const bytes = await readFile(mp4);
      expect(bytes.indexOf("moov")).toBeLessThan(bytes.indexOf("mdat"));
      // The decode the poster runs reads the length even when a header
      // carries none.
      const decoded = String(((await run(ffmpegPath, ["-hide_banner", "-i", webm, "-f", "null", "-"]).catch((e: { stderr?: string }) => e)) as { stderr?: string }).stderr ?? "");
      expect(parseFfmpegDecodedTime(decoded)).toBeGreaterThan(1.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("says on the page how it went, not in the worker's log", () => {
    expect(recordingStateFromJob(null)).toEqual({ state: "none" });
    expect(recordingStateFromJob({ state: "active" })).toEqual({ state: "preparing" });
    expect(recordingStateFromJob({ state: "completed", returnvalue: { s3Key: "k", size: 1, poster: true } })).toEqual({ state: "ready" });
    expect(recordingStateFromJob({ state: "completed", returnvalue: { skipped: "not a video" } })).toEqual({ state: "failed", reason: "not a video" });
    expect(recordingStateFromJob({ state: "failed", failedReason: "ffmpeg exited 1" })).toEqual({ state: "failed", reason: "ffmpeg exited 1" });
  });
});

function readFileSyncText(file: string): string {
  return readFileSync(file, "utf8");
}
