// The letter's recording, read aloud (Austin, 2026-10-27): the parts
// that are rules, apart from the browser APIs, so a test reads them.
// The recording is the letter's first block, a one-item gallery holding
// a `?type=video` link: the form the renderer already plays as a video
// with a poster, on the guide's preview and, rewritten to the letter's
// own routes, on the client's page (`publicLetterBody`). A bare link
// outside a gallery renders as a link, not a player.

/** The most a guide records in one go: long enough to read a letter
 * and talk around it, short enough that the upload and the worker's
 * transcode stay minutes, not an hour. */
export const RECORDING_MINUTES_LIMIT = 10;

/** The bitrate the browser encodes at; the worker re-encodes anyway, so
 * this only bounds the upload (10 minutes is about 190 MB). */
export const RECORDING_VIDEO_BITS_PER_SECOND = 2_500_000;

/** The caption under the player. */
export const RECORDING_LABEL = "Read aloud";

const LEADING_RECORDING = /^\s*:::gallery[^\n]*\n\s*\[[^\]\n]*\]\(\/api\/vault\/view\/([A-Za-z0-9]+)\?type=video\)\s*\n:::[ \t]*(?:\n+|$)/;

/** The block for one recording. */
export function recordingBlock(fileId: string, label = RECORDING_LABEL): string {
  return `:::gallery\n[${label}](/api/vault/view/${fileId}?type=video)\n:::`;
}

/** The recording at the top of the letter, if there is one: a gallery
 * holding exactly one video and nothing else, as the first block. */
export function leadingRecordingId(body: string): string | null {
  return LEADING_RECORDING.exec(body)?.[1] ?? null;
}

/** The letter with this recording as its first block: a new recording
 * replaces the one on top (the old file stays on the project); a letter
 * without one gets it above everything else. */
export function setLeadingRecording(body: string, fileId: string): string {
  const block = recordingBlock(fileId);
  const m = LEADING_RECORDING.exec(body);
  if (m) return `${block}\n\n${body.slice(m[0].length)}`;
  const rest = body.replace(/^\s+/, "");
  return rest ? `${block}\n\n${rest}` : `${block}\n`;
}

/** Whether there is a letter to read: some text besides a recording. */
export function letterHasText(body: string): boolean {
  const m = LEADING_RECORDING.exec(body);
  return (m ? body.slice(m[0].length) : body).trim().length > 0;
}

/** The first container this browser can record, in order of preference:
 * WebM where it exists (Chrome, Firefox), MP4 (Safari). The worker
 * takes either. */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"]) {
    if (isTypeSupported(type)) return type;
  }
  return null;
}

/** The file the recording is stored as: the container without its codec
 * parameters, named for the day. */
export function recordingFile(blob: Blob, mimeType: string, day: string): File {
  const type = mimeType.split(";")[0] || "video/webm";
  const ext = type === "video/mp4" ? "mp4" : "webm";
  return new File([blob], `read-aloud-${day}.${ext}`, { type });
}

/** Where the face sits: a circle in the bottom right, sized to the
 * frame. Pure, so the layout is one test. */
export function faceCircle(width: number, height: number): { cx: number; cy: number; r: number } {
  const r = Math.round(Math.min(width, height) * 0.12);
  const margin = Math.round(Math.min(width, height) * 0.04);
  return { cx: width - margin - r, cy: height - margin - r, r };
}

/** `m:ss`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
