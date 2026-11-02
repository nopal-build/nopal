/**
 * The record button's browser half (record-in-daily-log seed). The phone
 * is only the mic: audio goes out as 16 kHz mono pcm_s16le frames over a
 * WebSocket to our server (`fruits/dictation/relay.js`), which relays to
 * Soniox and sends words back while the person talks. Nothing is
 * recorded or uploaded as a file.
 *
 * `OxEditor` stays ignorant of days and Cards, the same way it does for
 * uploads: the page provides a `DictationStarter` through
 * `DictationContext`, and each editor says which entry it is
 * (`DictationTarget`).
 */
import { createContext } from "react";
import { withScreenAwake } from "../util/wakeLock";

/** What a recording is for, which decides its terms and who may start
 * it: a daily log Card (its `::card{file}` name), a letter's brief
 * (`letterFile`, its file id), or the day's own prose when neither is set. */
export type DictationTarget = { cardFile?: string; letterFile?: string };

export type DictationHandlers = {
  /** Settled words, fillers already removed. Append; never changes. */
  onFinal: (text: string) => void;
  /** Words not settled yet. Replaces the previous provisional text. */
  onProvisional: (text: string) => void;
  /** Recording is over. `note` says why, when it wasn't the person's stop. */
  onEnd: (note: string | null) => void;
};

export type DictationSession = { stop: () => void };

export type DictationStarter = (target: DictationTarget, handlers: DictationHandlers) => Promise<DictationSession>;

export const DictationContext = createContext<DictationStarter | undefined>(undefined);

const TARGET_RATE = 16_000;
/** ~100 ms of audio per frame sent. */
const FRAME_SAMPLES = 1_600;

// Runs on the audio thread: downsample whatever the device gives (44.1 or
// 48 kHz) to 16 kHz by linear interpolation and post Int16 frames.
const WORKLET_SOURCE = `
class PcmFramer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.pos = 0;
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const s = input[i] * (1 - f) + input[i + 1] * f;
      this.frame[this.filled++] = Math.max(-1, Math.min(1, s)) * 0x7fff;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(${FRAME_SAMPLES});
        this.filled = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor("pcm-framer", PcmFramer);
`;

/**
 * Starts a recording for `date`. Resolves once the mic is live and the
 * socket is open; rejects with a person-readable message otherwise.
 */
export async function startDictation(
  date: string,
  target: DictationTarget,
  handlers: DictationHandlers,
): Promise<DictationSession> {
  const res = await fetch("/api/dictation/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, cardFile: target.cardFile, letterFile: target.letterFile }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ticket) throw new Error(body?.error ?? "Couldn't start dictating.");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    throw new Error("The microphone isn't available. Check the browser's permission for this site.");
  }

  const audio = new AudioContext();
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await audio.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const source = audio.createMediaStreamSource(stream);
  const framer = new AudioWorkletNode(audio, "pcm-framer");
  source.connect(framer);

  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/dictation`);
  ws.binaryType = "arraybuffer";

  let ended = false;
  // `stopped`: no more audio goes out (the person's stop, or the cap).
  let stopped = false;
  let userStopped = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  void withScreenAwake(() => done);

  const end = (note: string | null) => {
    if (ended) return;
    ended = true;
    framer.port.onmessage = null;
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void audio.close().catch(() => {});
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    handlers.onProvisional("");
    handlers.onEnd(note);
    resolveDone();
  };

  framer.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (ws.readyState === WebSocket.OPEN && !stopped) ws.send(e.data);
  };

  ws.onmessage = (e) => {
    let msg: { type?: string; text?: string; message?: string };
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (msg.type === "final" && msg.text) handlers.onFinal(msg.text);
    else if (msg.type === "provisional") handlers.onProvisional(msg.text ?? "");
    else if (msg.type === "capped") stopped = true;
    else if (msg.type === "done") end(stopped && !userStopped ? CAPPED_NOTE : null);
    else if (msg.type === "error") end(`${msg.message ?? "Dictation stopped."} What was heard is already in.`);
  };
  ws.onclose = () => end(stopped ? null : DROPPED_NOTE);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", ticket: body.ticket }));
      resolve();
    };
    ws.onerror = () => {
      end(null);
      reject(new Error("Couldn't reach the server to dictate."));
    };
  });
  ws.onerror = null;

  return {
    stop: () => {
      if (stopped || ended) return;
      stopped = true;
      userStopped = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
      else end(null);
    },
  };
}

export const CAPPED_NOTE = "Dictation stopped at 10 minutes. Press dictate to keep going.";
export const DROPPED_NOTE = "Dictation stopped. What was heard is already in; press dictate to keep going.";

/**
 * How a piece of dictated text joins the text before it. The engine's
 * words carry their own leading space: dropped at the start of a line or
 * after a space already there, added when the text before ends mid-word.
 * `prevChar` is the one character before the insertion point ("" at the
 * start).
 */
export function joinWords(prevChar: string, text: string): string {
  if (prevChar === "" || /\s/.test(prevChar)) return text.replace(/^\s+/, "");
  if (!/^\s/.test(text) && /^[\p{L}\p{N}]/u.test(text)) return ` ${text}`;
  return text;
}
