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

/** The face's frame: a circle nudged toward the green pad from the "no."
 * logo (as in `CactusProgress`), its full end down. Austin, 2026-11-04: a
 * subtle departure from a circle, organic, fuller at the bottom than the
 * top and not symmetrical. It's the pad's broad outline (its first three
 * harmonics) weighted to keep the lopsidedness and drop most of the
 * stretch, in a 0 to 1 box. One path serves the screen (an SVG clip in
 * box units) and the recording (scaled onto the canvas). */
export const PAD_UNIT_PATH =
  "M0.9947 0.4614C0.9992 0.5002 1.0019 0.5403 0.9984 0.5810C0.9950 0.6217 0.9885 0.6650 0.9740 0.7057C0.9596 0.7463 0.9391 0.7890 0.9116 0.8251C0.8840 0.8613 0.8482 0.8964 0.8089 0.9227C0.7695 0.9490 0.7223 0.9702 0.6755 0.9831C0.6287 0.9959 0.5769 1.0011 0.5281 0.9998C0.4794 0.9986 0.4292 0.9894 0.3829 0.9756C0.3367 0.9618 0.2914 0.9414 0.2507 0.9173C0.2101 0.8931 0.1715 0.8635 0.1389 0.8307C0.1063 0.7979 0.0769 0.7600 0.0551 0.7205C0.0333 0.6810 0.0166 0.6369 0.0079 0.5937C-0.0008 0.5505 -0.0021 0.5042 0.0029 0.4614C0.0080 0.4187 0.0213 0.3756 0.0382 0.3369C0.0551 0.2982 0.0790 0.2619 0.1044 0.2294C0.1299 0.1968 0.1598 0.1677 0.1909 0.1416C0.2221 0.1154 0.2558 0.0921 0.2914 0.0724C0.3269 0.0527 0.3649 0.0352 0.4044 0.0232C0.4438 0.0112 0.4864 0.0022 0.5281 0.0004C0.5699 -0.0013 0.6144 0.0022 0.6550 0.0124C0.6955 0.0227 0.7364 0.0403 0.7713 0.0619C0.8062 0.0836 0.8381 0.1124 0.8645 0.1423C0.8910 0.1722 0.9122 0.2069 0.9300 0.2413C0.9479 0.2757 0.9608 0.3120 0.9716 0.3487C0.9824 0.3854 0.9902 0.4227 0.9947 0.4614Z";
/** The pad's width over its height. */
export const PAD_ASPECT = 0.9486;

/** Where the face sits: the pad in the bottom right, sized to the
 * frame. Pure, so the layout is one test. */
export function facePad(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const h = Math.round(Math.min(width, height) * 0.25);
  const w = Math.round(h * PAD_ASPECT);
  const margin = Math.round(Math.min(width, height) * 0.04);
  return { x: width - margin - w, y: height - margin - h, w, h };
}

/** The middle of a camera frame cut to the pad's shape, as a source
 * rectangle to draw from. */
export function padCrop(videoWidth: number, videoHeight: number): { sx: number; sy: number; sw: number; sh: number } {
  const sw = Math.min(videoWidth, videoHeight * PAD_ASPECT);
  const sh = sw / PAD_ASPECT;
  return { sx: (videoWidth - sw) / 2, sy: (videoHeight - sh) / 2, sw, sh };
}

/** `m:ss`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The cameras or mics the browser lists, as picker options (Austin,
 * 2026-11-03: pick the camera and mic, and see them, before recording).
 * A browser hides names until it's been allowed the devices once; then
 * they're numbered. */
export function deviceOptions(devices: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[], kind: "videoinput" | "audioinput"): { value: string; label: string }[] {
  const noun = kind === "videoinput" ? "Camera" : "Microphone";
  // A device listed twice under one name (a virtual machine's bridge can
  // leave old copies) shows once: the first, which the browser lists live.
  const seen = new Set<string>();
  return devices
    .filter((d) => d.kind === kind && d.deviceId)
    .map((d, i) => ({ value: d.deviceId, label: d.label || `${noun} ${i + 1}` }))
    .filter((o) => !seen.has(o.label) && !!seen.add(o.label));
}

export const MEDIA_DENIED = "The browser wasn't allowed the camera or microphone. Allow them in the address bar, then try again.";
export const CAMERA_FAILED = "The camera didn't open, so this records voice only.";
export const MIC_FAILED = "The microphone didn't open.";

/** What opening the camera and mic came to: the stream to preview and
 * record, whether it has no camera, and what to tell the guide. */
export type MediaOpened = { stream: MediaStream | null; voiceOnly: boolean; error: string | null };

function deniedError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
}

/** Opens the camera and mic together, and when that fails for a reason
 * other than permission, tries the mic alone: a missing, broken or busy
 * camera still leaves voice. A remembered device that's gone
 * (`OverconstrainedError`) is thrown for the caller to retry on defaults. */
export async function openMedia(
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>,
  audio: MediaTrackConstraints | true,
  video: MediaTrackConstraints | false,
): Promise<MediaOpened> {
  try {
    return { stream: await getUserMedia({ audio, video }), voiceOnly: !video, error: null };
  } catch (err) {
    if (err instanceof DOMException && err.name === "OverconstrainedError") throw err;
    if (deniedError(err)) return { stream: null, voiceOnly: !video, error: MEDIA_DENIED };
    if (!video) return { stream: null, voiceOnly: true, error: MIC_FAILED };
  }
  try {
    return { stream: await getUserMedia({ audio, video: false }), voiceOnly: true, error: CAMERA_FAILED };
  } catch (err) {
    return { stream: null, voiceOnly: true, error: deniedError(err) ? MEDIA_DENIED : MIC_FAILED };
  }
}

/** How loud the mic is, 0 to 1, from an analyser's time-domain samples
 * (128 is silence): enough to see it's hearing you. */
export function micLevel(samples: Uint8Array): number {
  let sum = 0;
  for (const v of samples) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 4);
}
