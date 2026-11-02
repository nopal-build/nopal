/**
 * The dictate control (record-in-daily-log seed): one button, and a
 * short note when dictation ends on its own. Words not settled yet go to
 * `onProvisional` when the caller can show them in place (the daily
 * log's editor); a plain text box can't grey part of its text, so there
 * they show greyed beneath the button. Where the settled words go is the caller's:
 * the daily log's editor (`oxmarkdown/DictateButtonPlugin.tsx`) or a
 * plain text box (`DictateIntoText` below).
 *
 * Shown only where a page asks for it. The rule (Austin, 2026-11-02):
 * dictate where someone tells O.No what happened or thinks out loud for
 * the model to read; type by hand where they compose what a client
 * receives. So the letter itself never gets one; the brief's talk-through
 * does.
 */
import { useEffect, useRef, useState } from "react";
import {
  joinWords,
  startDictation,
  type DictationSession,
  type DictationStarter,
  type DictationTarget,
} from "../oxmarkdown/dictation";

export function DictateButton({
  start,
  target,
  onBegin,
  onFinal,
  onProvisional,
}: {
  start: DictationStarter;
  target: DictationTarget;
  /** Called as dictation starts, before any words arrive: read the cursor. */
  onBegin: () => void;
  /** Settled words, in order; insert them. */
  onFinal: (text: string) => void;
  /** Words not settled yet, replacing the last ones ("" clears them). */
  onProvisional?: (text: string) => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "on" | "stopping">("idle");
  const [provisional, setProvisional] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  // The latest `onFinal`, so a re-render mid-dictation is picked up.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onProvisionalRef = useRef(onProvisional ?? setProvisional);
  onProvisionalRef.current = onProvisional ?? setProvisional;

  // Leaving the page stops dictation.
  useEffect(() => () => sessionRef.current?.stop(), []);

  const onClick = async () => {
    if (state === "on") {
      setState("stopping");
      sessionRef.current?.stop();
      return;
    }
    if (state !== "idle") return;
    setNote(null);
    setState("starting");
    onBegin();
    try {
      sessionRef.current = await start(target, {
        onFinal: (text) => onFinalRef.current(text),
        onProvisional: (text) => onProvisionalRef.current(text),
        onEnd: (endNote) => {
          sessionRef.current = null;
          setState("idle");
          setNote(endNote);
        },
      });
      setState((s) => (s === "starting" ? "on" : s));
    } catch (err) {
      setState("idle");
      setNote(err instanceof Error ? err.message : "Couldn't start dictating.");
    }
  };

  const label = state === "on" ? "stop" : state === "starting" ? "starting…" : state === "stopping" ? "finishing…" : "dictate";

  return (
    <div>
      <button
        type="button"
        className="ox-add-file-link"
        onClick={onClick}
        aria-pressed={state === "on"}
        disabled={state === "starting" || state === "stopping"}
        data-dictate
      >
        <MicIcon on={state === "on"} />
        {label}
      </button>
      {provisional && <div className="subtle-text">{provisional}</div>}
      {note && <div className="subtle-text">{note}</div>}
    </div>
  );
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg width="13" height="26" viewBox="0 0 13 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="2" width="6" height="13" rx="3" stroke="currentColor" strokeWidth="2" fill={on ? "currentColor" : "none"} />
      <path d="M1 12.5C1 15.5376 3.46243 18 6.5 18C9.53757 18 12 15.5376 12 12.5M6.5 18V23" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

// The device's own day, as the daily log uses it (`TodayLog`'s
// `localDateString`, not imported: TodayLog imports the editor, which
// imports this). A letter's start ignores it.
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const startToday: DictationStarter = (target, handlers) => startDictation(today(), target, handlers);

/**
 * Dictation into a plain text box. `fieldRef` wraps the box (a stamps
 * `Input`, which doesn't hand out its own element); the words go in at
 * the box's cursor as dictation starts, or at the end if it never had
 * one, and keep following on from there.
 */
export function DictateIntoText({
  target,
  value,
  onChange,
  fieldRef,
}: {
  target: DictationTarget;
  value: string;
  onChange: (value: string) => void;
  fieldRef: { current: HTMLElement | null };
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const posRef = useRef(0);
  // A box that was never focused still reports selectionEnd 0, which
  // would put the words ahead of everything already typed: only trust the
  // cursor once the person has clicked into the box.
  const touchedRef = useRef(false);
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const onFocus = () => (touchedRef.current = true);
    el.addEventListener("focusin", onFocus);
    return () => el.removeEventListener("focusin", onFocus);
  }, [fieldRef]);

  return (
    <DictateButton
      start={startToday}
      target={target}
      onBegin={() => {
        const box = fieldRef.current?.querySelector("textarea, input") as HTMLTextAreaElement | null;
        posRef.current = box && touchedRef.current ? box.selectionEnd : valueRef.current.length;
      }}
      onFinal={(text) => {
        const { next, pos } = insertText(valueRef.current, posRef.current, text);
        valueRef.current = next;
        posRef.current = pos;
        onChange(next);
      }}
    />
  );
}

/** Inserts `text` at `pos` in `value`, joined by `joinWords`. */
export function insertText(value: string, pos: number, text: string): { next: string; pos: number } {
  const at = Math.min(Math.max(pos, 0), value.length);
  const piece = joinWords(value.slice(at - 1, at), text);
  return { next: value.slice(0, at) + piece + value.slice(at), pos: at + piece.length };
}
