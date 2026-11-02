/**
 * The record button's server half (record-in-daily-log seed). The browser
 * opens a WebSocket at /ws/dictation, sends `{type:"start", ticket}` and
 * then raw 16 kHz mono pcm_s16le frames. This relays them to Soniox
 * real-time with the ticket's terms context, and sends words back as they
 * are recognised:
 *
 *   {type:"provisional", text}   words not settled yet; replace, never keep
 *   {type:"final", text}         settled words, fillers removed; append
 *   {type:"done"}                stream finished after a stop
 *   {type:"capped"}              stopped at the length cap
 *   {type:"error", message}      the engine failed; final words already sent stand
 *
 * No audio is kept (Austin, 2026-11-02: whether to keep it is decided in
 * `correction-ladder`). Nothing outlives the socket, so it doesn't matter
 * which Fly machine a recording lands on.
 *
 * Plain JS beside `server.js`, which runs outside the Vite build; the
 * app's `api.dictation.start` route does the session and Card checks and
 * hands over a signed ticket (`ticket.js`).
 */
import { WebSocketServer, WebSocket } from "ws";
import { verifyTicket } from "./ticket.js";
import { createFinalTextBuffer } from "./fillers.js";

export const DICTATION_PATH = "/ws/dictation";
export const SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
export const SONIOX_MODEL = "stt-rt-v5";
/** A log entry, not a limit of the engine (one stream carries 300 min). */
export const MAX_RECORDING_MS = 10 * 60 * 1000;
/** Soniox closes a stream after ~40 s without audio or a keepalive. */
export const KEEPALIVE_MS = 15_000;
export const SAMPLE_RATE = 16_000;

/**
 * Attaches the relay to `httpServer`'s `upgrade` event for DICTATION_PATH
 * only; every other upgrade (Vite HMR in dev) is left alone.
 */
export function attachDictationRelay(httpServer, options = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url || new URL(req.url, "http://x").pathname !== DICTATION_PATH) return;
    wss.handleUpgrade(req, socket, head, (client) => handleClient(client, options));
  });
  return wss;
}

export function handleClient(client, options = {}) {
  const apiKey = options.apiKey ?? process.env.SONIOX_API_KEY;
  const sonioxUrl = options.sonioxUrl ?? SONIOX_URL;
  const maxMs = options.maxRecordingMs ?? MAX_RECORDING_MS;
  const keepaliveMs = options.keepaliveMs ?? KEEPALIVE_MS;

  let engine = null;
  let engineOpen = false;
  const queued = [];
  let lastAudioAt = Date.now();
  let keepaliveTimer = null;
  let capTimer = null;
  let ending = false;
  let closed = false;
  const finals = createFinalTextBuffer();

  const send = (msg) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepaliveTimer);
    clearTimeout(capTimer);
    if (engine && engine.readyState <= WebSocket.OPEN) engine.close();
    if (client.readyState <= WebSocket.OPEN) client.close();
  };

  const fail = (message) => {
    const tail = finals.flush();
    if (tail) send({ type: "final", text: tail });
    send({ type: "error", message });
    cleanup();
  };

  // An empty TEXT frame ends the stream (an empty binary frame does not).
  const endStream = () => {
    if (ending) return;
    ending = true;
    if (engineOpen) engine.send("");
    else cleanup();
  };

  const start = (ticket) => {
    const payload = verifyTicket(ticket);
    if (!payload) return fail("This recording couldn't be started. Reload the page and try again.");
    if (!apiKey) return fail("Dictation isn't set up on this server yet.");

    engine = new WebSocket(sonioxUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    engine.on("open", () => {
      engineOpen = true;
      engine.send(
        JSON.stringify({
          model: SONIOX_MODEL,
          audio_format: "pcm_s16le",
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          language_hints: ["en", "es"],
          ...(payload.context ? { context: payload.context } : {}),
        }),
      );
      for (const frame of queued.splice(0)) engine.send(frame);
      if (ending) engine.send("");
      send({ type: "ready" });
    });
    engine.on("message", (data) => onEngineMessage(data));
    engine.on("error", () => fail("The transcription service didn't answer."));
    engine.on("close", () => {
      if (closed) return;
      if (ending) {
        const tail = finals.flush();
        if (tail) send({ type: "final", text: tail });
        send({ type: "done" });
        cleanup();
      } else {
        fail("The transcription service hung up.");
      }
    });

    keepaliveTimer = setInterval(() => {
      if (engineOpen && !ending && Date.now() - lastAudioAt >= keepaliveMs) {
        engine.send(JSON.stringify({ type: "keepalive" }));
      }
    }, Math.max(10, Math.floor(keepaliveMs / 3)));

    capTimer = setTimeout(() => {
      send({ type: "capped" });
      endStream();
    }, maxMs);
  };

  const onEngineMessage = (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.error_code || msg.error_message) {
      return fail(msg.error_message || "The transcription service returned an error.");
    }
    const tokens = Array.isArray(msg.tokens) ? msg.tokens : [];
    let finalText = "";
    let provisional = "";
    for (const t of tokens) {
      // Control tokens such as <end> or <fin> are not words.
      if (typeof t.text !== "string" || /^<[a-z]+>$/.test(t.text)) continue;
      if (t.is_final) finalText += t.text;
      else provisional += t.text;
    }
    if (finalText) {
      const ready = finals.push(finalText);
      if (ready) send({ type: "final", text: ready });
    }
    send({ type: "provisional", text: provisional });
    if (msg.finished) {
      const tail = finals.flush();
      if (tail) send({ type: "final", text: tail });
      send({ type: "done" });
      cleanup();
    }
  };

  client.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (!engine || ending) return;
      lastAudioAt = Date.now();
      if (engineOpen) engine.send(data);
      else queued.push(data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start" && !engine) start(msg.ticket);
    else if (msg.type === "stop") endStream();
  });

  // The page went away (locked phone, closed tab): nothing to send back to,
  // so end the engine's stream too.
  client.on("close", cleanup);
  client.on("error", cleanup);
}
