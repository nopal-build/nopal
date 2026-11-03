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
// choosing it. For the length of a recording the editor shows the
// rendered letter alone, filling the window (`setReading`), so the guide
// reads what the client will see. Where the browser can crop a tab share
// to one element (Chrome's Region Capture), the video is that letter
// alone; where it can't (Safari, Firefox), it is the whole tab, which is
// now the letter with the recording controls above it. The camera, when on,
// is drawn onto the same canvas, so nothing about the face is separable.
//
// While recording, the guide's face floats over the letter where the
// video puts it, with the clock and Stop beside it (Austin, 2026-10-29).
// Where Chrome can restrict a share to one element (Element Capture),
// the bubble is outside that element, so the video has the drawn face
// and no Stop button; where it can only crop, the drawn face covers the
// bubble and the Stop button shows in the corner of the video.
//
// Before recording, a setup window picks the camera (or none) and the mic
// and shows them live: the face as the circle will frame it, and a level
// bar for the mic (Austin, 2026-11-03). The recording uses that same
// stream, so what was previewed is what's recorded. The picks are
// remembered on this device.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { Modal } from "stamps/Modal";
import { Select } from "stamps/Select";
import { Stack } from "stamps/Stack";
import { localDateString } from "./TodayLog";
import { uploadToVaultFolder } from "./vaultUpload";
import {
  RECORDING_MINUTES_LIMIT,
  RECORDING_VIDEO_BITS_PER_SECOND,
  clock,
  deviceOptions,
  faceCircle,
  micLevel,
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

const DEVICE_KEY = "letter-recorder-devices";
const NO_CAMERA = "none";
type DevicePicks = { camera: string; mic: string };
function rememberedPicks(): DevicePicks {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null") as Partial<DevicePicks> | null;
    return { camera: saved?.camera ?? "", mic: saved?.mic ?? "" };
  } catch {
    return { camera: "", mic: "" };
  }
}
function rememberPicks(picks: DevicePicks) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(picks));
  } catch {
    // A browser that won't keep it just asks again next time.
  }
}

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
  setReading,
  onRecorded,
}: {
  letterFileId: string;
  /** The letter's own folder: the recording is stored beside it. */
  folderId: string;
  body: string;
  /** The editor's preview pane, cropped to where the browser can. */
  previewElement: () => HTMLElement | null;
  /** Shows the rendered letter alone, filling the window, or puts the
   * editor back. */
  setReading: (reading: boolean) => void;
  /** Puts the recording on top of the letter in the editor. */
  onRecorded: (recordingFileId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const session = useRef<Session | null>(null);
  // Setup: the live camera and mic the guide picked, kept for the recording.
  const [picks, setPicks] = useState<DevicePicks>({ camera: "", mic: "" });
  const [devices, setDevices] = useState<{ cameras: { value: string; label: string }[]; mics: { value: string; label: string }[] }>({ cameras: [], mics: [] });
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [setupError, setSetupError] = useState<string | null>(null);
  const camera = picks.camera !== NO_CAMERA;

  const stopPreview = () => {
    for (const t of previewRef.current?.getTracks() ?? []) t.stop();
    previewRef.current = null;
    setPreview(null);
  };

  /** Open (or reopen) the camera and mic the guide picked, and list what
   * else there is. */
  const acquire = async (want: DevicePicks): Promise<void> => {
    stopPreview();
    setSetupError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setSetupError("This browser can't use a camera or microphone here.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, ...(want.mic ? { deviceId: { exact: want.mic } } : {}) },
        video:
          want.camera === NO_CAMERA
            ? false
            : { width: { ideal: 640 }, height: { ideal: 640 }, ...(want.camera ? { deviceId: { exact: want.camera } } : { facingMode: "user" }) },
      });
      previewRef.current = stream;
      setPreview(stream);
      const listed = await navigator.mediaDevices.enumerateDevices();
      setDevices({ cameras: deviceOptions(listed, "videoinput"), mics: deviceOptions(listed, "audioinput") });
      const used = {
        camera: want.camera === NO_CAMERA ? NO_CAMERA : (stream.getVideoTracks()[0]?.getSettings().deviceId ?? want.camera),
        mic: stream.getAudioTracks()[0]?.getSettings().deviceId ?? want.mic,
      };
      setPicks(used);
      rememberPicks(used);
    } catch (err) {
      // A remembered device that's gone: try the defaults once.
      if (err instanceof DOMException && err.name === "OverconstrainedError" && (want.camera || want.mic)) {
        return acquire({ camera: want.camera === NO_CAMERA ? NO_CAMERA : "", mic: "" });
      }
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setSetupError(denied ? "The browser wasn't allowed the camera or microphone. Allow them in the address bar, then try again." : "The camera or microphone didn't open.");
    }
  };

  const openSetup = () => {
    setPhase({ at: "setup" });
    void acquire(rememberedPicks());
  };
  const cancelSetup = () => {
    stopPreview();
    setPhase({ at: "idle" });
  };

  // The mic's level while setting up.
  const settingUp = phase.at === "setup";
  useEffect(() => {
    if (!settingUp || !preview || preview.getAudioTracks().length === 0) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream(preview.getAudioTracks())).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      setLevel(micLevel(samples));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
      setLevel(0);
    };
  }, [settingUp, preview]);
  // The floating bubble: the camera on its own (the canvas has its own
  // copy), and where on the screen the video's face circle lands.
  const [faceStream, setFaceStream] = useState<MediaStream | null>(null);
  const [bubble, setBubble] = useState<{ left: number; top: number; size: number } | null>(null);

  const release = () => {
    const s = session.current;
    if (!s) return;
    if (s.frame != null) cancelAnimationFrame(s.frame);
    if (s.timer) clearInterval(s.timer);
    for (const t of s.tracks) t.stop();
    session.current = null;
    setReading(false);
    setFaceStream(null);
    setBubble(null);
  };
  useEffect(
    () => () => {
      release();
      stopPreview();
    },
    [],
  );

  // The bubble follows the letter's pane if the window changes size.
  const recording = phase.at === "recording";
  useEffect(() => {
    if (!recording) return;
    const place = () => {
      const pane = previewElement();
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      const c = faceCircle(rect.width, rect.height);
      setBubble({ left: rect.left + c.cx - c.r, top: rect.top + c.cy - c.r, size: c.r * 2 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [recording, previewElement]);

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
    // Before the share starts, so the browser's picker and the crop both
    // see the letter as it will be recorded.
    setReading(true);
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

      // The preview pane alone, where the browser can: Element Capture
      // first (the pane and nothing drawn over it, so not the bubble),
      // then Region Capture (whatever is on screen in the pane's box).
      const pane = previewElement();
      const targets = window as unknown as {
        RestrictionTarget?: { fromElement: (el: Element) => Promise<unknown> };
        CropTarget?: { fromElement: (el: Element) => Promise<unknown> };
      };
      const narrowable = screenTrack as MediaStreamTrack & {
        restrictTo?: (target: unknown) => Promise<void>;
        cropTo?: (target: unknown) => Promise<void>;
      };
      if (pane) {
        const restricted =
          targets.RestrictionTarget && narrowable.restrictTo
            ? await narrowable.restrictTo(await targets.RestrictionTarget.fromElement(pane)).then(
                () => true,
                () => false,
              )
            : false;
        if (!restricted && targets.CropTarget && narrowable.cropTo) {
          await narrowable.cropTo(await targets.CropTarget.fromElement(pane)).catch(() => {});
        }
      }

      // The camera and mic previewed in setup, handed over as they are.
      const user =
        previewRef.current ??
        (await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: camera ? { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" } : false,
        }));
      previewRef.current = null;
      setPreview(null);
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
      if (camera) setFaceStream(new MediaStream(user.getVideoTracks()));
      setPhase({ at: "recording", seconds: 0 });
    } catch (err) {
      for (const t of tracks) t.stop();
      release();
      setReading(false);
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
          onClick={openSetup}
        >
          {phase.at === "ready" ? "Record again" : "Read it to them"}
        </button>
      )}
      <Modal open={phase.at === "setup"} onClose={cancelSetup} title="Read it to them">
        <Stack gap={3}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div
              style={{ width: 128, height: 128, borderRadius: "50%", overflow: "hidden", background: "#222", border: "3px solid #ffffff", boxShadow: "0 0 0 1px #ccc", flexShrink: 0 }}
              data-letter-recorder-preview
            >
              {camera && preview && preview.getVideoTracks().length > 0 ? (
                <video
                  autoPlay
                  muted
                  playsInline
                  ref={(el) => {
                    if (el && el.srcObject !== preview) el.srcObject = preview;
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transform: "scaleX(-1)" }}
                />
              ) : (
                <span className={textSize.xs} style={{ color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                  {camera ? "Opening…" : "No camera"}
                </span>
              )}
            </div>
            <Stack gap={2}>
              <Select
                label="Camera"
                name="camera"
                options={[...devices.cameras, { value: NO_CAMERA, label: "No camera, voice only" }]}
                value={picks.camera || devices.cameras[0]?.value || NO_CAMERA}
                onChange={(e) => void acquire({ ...picks, camera: e.target.value })}
              />
              <Select
                label="Microphone"
                name="mic"
                options={devices.mics.length ? devices.mics : [{ value: "", label: "Default microphone" }]}
                value={picks.mic || devices.mics[0]?.value || ""}
                onChange={(e) => void acquire({ ...picks, mic: e.target.value })}
              />
              <div aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level} style={{ height: 6, borderRadius: 3, background: "#e5e5e5", overflow: "hidden" }}>
                <div style={{ width: `${Math.round(level * 100)}%`, height: "100%", background: semanticColors.textBrand, transition: "width 80ms linear" }} />
              </div>
              <span style={note}>Say something: the bar moves when the mic hears you.</span>
            </Stack>
          </div>
          {setupError && (
            <span style={{ color: semanticColors.textDanger }} role="alert">
              {setupError}
            </span>
          )}
          <span style={note}>After Start, your browser asks what to share. Pick this tab.</span>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="vault-toolbar-btn" onClick={cancelSetup}>
              Cancel
            </button>
            <button type="button" className="vault-toolbar-btn" disabled={!preview} onClick={() => void start()}>
              Start recording
            </button>
          </div>
        </Stack>
      </Modal>
      {phase.at === "recording" &&
        bubble &&
        createPortal(
          <div
            data-letter-recording-bubble
            style={{
              position: "fixed",
              left: bubble.left,
              top: bubble.top,
              width: bubble.size,
              height: bubble.size,
              zIndex: 400,
            }}
          >
            {faceStream && (
              <video
                autoPlay
                muted
                playsInline
                ref={(el) => {
                  if (el && el.srcObject !== faceStream) el.srcObject = faceStream;
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "50%",
                  border: "3px solid #ffffff",
                  boxSizing: "border-box",
                  display: "block",
                }}
              />
            )}
            <span
              className={textSize.xs}
              style={{
                position: "absolute",
                right: 0,
                bottom: "100%",
                marginBottom: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: semanticColors.textDanger }} role="status">
                {clock(phase.seconds)} of {RECORDING_MINUTES_LIMIT}:00
              </span>
              <button type="button" className="vault-toolbar-btn" onClick={stop}>
                Stop
              </button>
            </span>
          </div>,
          document.body,
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
