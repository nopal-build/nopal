// "Read it to them" on a letter's page (Austin, 2026-10-27): the guide
// records themselves reading the letter, with the rendered letter as the
// screen and, if they want, their face in a circle bottom right, all in
// one video. The browser captures and encodes; the worker makes it
// web-safe (`letterRecording.server.ts`); the recording becomes the
// letter's first block (`setLeadingRecording`), so it is an unsent change
// until the guide sends again, like any edit.
//
// The capture is the browser's own screen share of this tab, which it
// always asks for: there is no way to record a page without the person
// choosing it. Where the browser can crop a tab share to one element
// (Chrome's Region Capture), the video is the preview pane alone; where
// it can't (Safari, Firefox), it is the whole tab. The camera, when on,
// is drawn onto the same canvas, so nothing about the face is separable.
import { useEffect, useRef, useState } from "react";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { localDateString } from "./TodayLog";
import { uploadToVaultFolder } from "./vaultUpload";
import {
  RECORDING_MINUTES_LIMIT,
  RECORDING_VIDEO_BITS_PER_SECOND,
  clock,
  faceCircle,
  letterHasText,
  pickRecorderMimeType,
  recordingFile,
} from "./letterRecording";

type Phase =
  | { at: "idle" }
  | { at: "setup" }
  | { at: "recording"; seconds: number }
  | { at: "uploading"; fraction: number }
  | { at: "preparing" }
  | { at: "ready" }
  | { at: "failed"; message: string };

/** The longest edge the canvas is drawn at; the worker caps the height
 * at 1080 anyway. Even, for H.264. */
const MAX_CANVAS_HEIGHT = 1080;

type Session = {
  recorder: MediaRecorder;
  tracks: MediaStreamTrack[];
  frame: number | null;
  timer: ReturnType<typeof setInterval> | null;
};

export function LetterRecorder({
  letterFileId,
  folderId,
  body,
  previewElement,
  onRecorded,
}: {
  letterFileId: string;
  /** The letter's own folder: the recording is stored beside it. */
  folderId: string;
  body: string;
  /** The editor's preview pane, cropped to where the browser can. */
  previewElement: () => HTMLElement | null;
  /** Puts the recording on top of the letter in the editor. */
  onRecorded: (recordingFileId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [camera, setCamera] = useState(true);
  const session = useRef<Session | null>(null);

  const release = () => {
    const s = session.current;
    if (!s) return;
    if (s.frame != null) cancelAnimationFrame(s.frame);
    if (s.timer) clearInterval(s.timer);
    for (const t of s.tracks) t.stop();
    session.current = null;
  };
  useEffect(() => release, []);

  const store = async (blob: Blob, mimeType: string) => {
    try {
      setPhase({ at: "uploading", fraction: 0 });
      const file = recordingFile(blob, mimeType, localDateString());
      const recordingFileId = await uploadToVaultFolder(file, folderId, (fraction) => setPhase({ at: "uploading", fraction }));
      onRecorded(recordingFileId);
      const res = await fetch(`/api/letter/${letterFileId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingFileId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "The recording is on the letter, but it couldn't be sent to be prepared.");
      }
      setPhase({ at: "preparing" });
      // The outcome belongs on this page: ask until the worker says.
      for (let i = 0; i < 450; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const state = (await fetch(`/api/letter/${letterFileId}/recording?file=${recordingFileId}`)
          .then((r) => r.json())
          .catch(() => null)) as { state?: string; reason?: string } | null;
        if (state?.state === "ready") return setPhase({ at: "ready" });
        if (state?.state === "failed") throw new Error(`The video couldn't be prepared: ${state.reason ?? "no reason given"}.`);
      }
    } catch (err) {
      setPhase({ at: "failed", message: err instanceof Error ? err.message : "The recording didn't save." });
    }
  };

  const start = async () => {
    const mimeType = typeof MediaRecorder !== "undefined" ? pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t)) : null;
    if (!mimeType || !navigator.mediaDevices?.getDisplayMedia) {
      setPhase({ at: "failed", message: "This browser can't record the page. Try Chrome on a computer." });
      return;
    }
    const tracks: MediaStreamTrack[] = [];
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        // Offer this tab first; the browser still asks.
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
      const [screenTrack] = display.getVideoTracks();
      tracks.push(...display.getTracks());

      // Region Capture: the preview pane alone, where the browser can.
      const pane = previewElement();
      const CropTarget = (window as unknown as { CropTarget?: { fromElement: (el: Element) => Promise<unknown> } }).CropTarget;
      const croppable = screenTrack as MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };
      if (pane && CropTarget && croppable.cropTo) {
        await croppable.cropTo(await CropTarget.fromElement(pane)).catch(() => {});
      }

      const user = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: camera ? { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" } : false,
      });
      tracks.push(...user.getTracks());

      const screen = document.createElement("video");
      screen.muted = true;
      screen.srcObject = new MediaStream([screenTrack]);
      await screen.play();
      const face = camera ? document.createElement("video") : null;
      if (face) {
        face.muted = true;
        face.srcObject = new MediaStream(user.getVideoTracks());
        await face.play();
      }

      // The canvas takes the share's first size, capped, and keeps it.
      const scale = Math.min(1, MAX_CANVAS_HEIGHT / (screen.videoHeight || MAX_CANVAS_HEIGHT));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(((screen.videoWidth || 1280) * scale) / 2) * 2);
      canvas.height = Math.max(2, Math.round(((screen.videoHeight || 720) * scale) / 2) * 2);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't draw the recording.");
      const circle = faceCircle(canvas.width, canvas.height);

      const draw = () => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // The page, fitted whole if the share changed shape.
        const sw = screen.videoWidth || canvas.width;
        const sh = screen.videoHeight || canvas.height;
        const fit = Math.min(canvas.width / sw, canvas.height / sh);
        ctx.drawImage(screen, (canvas.width - sw * fit) / 2, (canvas.height - sh * fit) / 2, sw * fit, sh * fit);
        if (face && face.videoWidth) {
          const side = Math.min(face.videoWidth, face.videoHeight);
          ctx.save();
          ctx.beginPath();
          ctx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(face, (face.videoWidth - side) / 2, (face.videoHeight - side) / 2, side, side, circle.cx - circle.r, circle.cy - circle.r, circle.r * 2, circle.r * 2);
          ctx.restore();
          ctx.beginPath();
          ctx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(2, Math.round(circle.r * 0.04));
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }
        if (session.current) session.current.frame = requestAnimationFrame(draw);
      };

      const stream = canvas.captureStream(30);
      for (const t of user.getAudioTracks()) stream.addTrack(t);
      tracks.push(...stream.getVideoTracks());
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        release();
        void store(new Blob(chunks, { type: mimeType }), mimeType);
      };

      const begun = Date.now();
      session.current = { recorder, tracks, frame: null, timer: null };
      session.current.frame = requestAnimationFrame(draw);
      session.current.timer = setInterval(() => {
        const seconds = (Date.now() - begun) / 1000;
        if (seconds >= RECORDING_MINUTES_LIMIT * 60) stop();
        else setPhase({ at: "recording", seconds });
      }, 500);
      // The browser's own "Stop sharing" ends the recording too.
      screenTrack.addEventListener("ended", () => stop());
      recorder.start(1000);
      setPhase({ at: "recording", seconds: 0 });
    } catch (err) {
      for (const t of tracks) t.stop();
      release();
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setPhase({
        at: "failed",
        message: denied ? "The browser wasn't allowed to share the page or the microphone." : err instanceof Error ? err.message : "The recording didn't start.",
      });
    }
  };

  const stop = () => {
    const s = session.current;
    if (s && s.recorder.state !== "inactive") s.recorder.stop();
  };

  const note = { color: semanticColors.textSubtle } as const;
  const hasText = letterHasText(body);
  return (
    <span className={textSize.xs} style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} data-letter-recorder data-phase={phase.at}>
      {(phase.at === "idle" || phase.at === "ready" || phase.at === "failed") && (
        <button
          type="button"
          className="vault-toolbar-btn"
          disabled={!hasText}
          title={hasText ? undefined : "Write the letter first"}
          onClick={() => setPhase({ at: "setup" })}
        >
          {phase.at === "ready" ? "Record again" : "Read it to them"}
        </button>
      )}
      {phase.at === "setup" && (
        <>
          <span style={note}>Your browser will ask what to share. Pick this tab.</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            Camera
          </label>
          <button type="button" className="vault-toolbar-btn" onClick={() => void start()}>
            Start
          </button>
          <button type="button" className="vault-toolbar-btn" onClick={() => setPhase({ at: "idle" })}>
            Cancel
          </button>
        </>
      )}
      {phase.at === "recording" && (
        <>
          <span style={{ color: semanticColors.textDanger }} role="status">
            Recording {clock(phase.seconds)} of {RECORDING_MINUTES_LIMIT}:00
          </span>
          <button type="button" className="vault-toolbar-btn" onClick={stop}>
            Stop
          </button>
        </>
      )}
      {phase.at === "uploading" && <span style={note}>Saving the recording, {Math.round(phase.fraction * 100)}%</span>}
      {phase.at === "preparing" && <span style={note}>On the letter. Preparing it to play on any phone…</span>}
      {phase.at === "ready" && <span style={note}>On top of the letter. Send to share it.</span>}
      {phase.at === "failed" && (
        <span style={{ color: semanticColors.textDanger }} role="alert">
          {phase.message}
        </span>
      )}
    </span>
  );
}
