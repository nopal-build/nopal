/**
 * The dictate control (record-in-daily-log seed): one button, and a
 * short note when dictation ends on its own. Nothing else is ever drawn
 * by the button (ADR-032): every word, settled or not, lands where typing
 * would. The daily log's editor shows the unsettled ones greyed in the
 * entry (`oxmarkdown/DictateButtonPlugin.tsx`); a plain text box shows
 * them plain, since a textarea can't grey part of its text
 * (`DictatedTextBox` below). Neither saves them: the editor's sync skips
 * them, and the box keeps them out of its caller's value until they
 * settle.
 *
 * Shown only where a page asks for it. The rule (Austin, 2026-11-02):
 * dictate where someone tells O.No what happened or thinks out loud for
 * the model to read; type by hand where they compose what a client
 * receives. So the letter itself never gets one; the brief's talk-through
 * does.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "stamps/Input";
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
  /** Words not settled yet, replacing the last ones ("" clears them).
   * Shown in place by the caller, never by the button. */
  onProvisional: (text: string) => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "on" | "stopping">("idle");
  const [note, setNote] = useState<string | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  // The latest `onFinal`, so a re-render mid-dictation is picked up.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const onProvisionalRef = useRef(onProvisional);
  onProvisionalRef.current = onProvisional;

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
 * A plain text box that can be dictated into: a stamps `Input` with the
 * dictate button under it. `value` and `onChange` carry settled words
 * only. Words not settled yet show in the box at the point the next
 * settled ones will go, plain (a textarea can't grey part of itself),
 * and leave the box as they settle or when dictation ends; the caller
 * never sees them, so a draft's autosave never stores them. The words go
 * in at the box's cursor as dictation starts, or at the end if it never
 * had one, and keep following on from there. Typing while unsettled words
 * show takes the box over: the guess is taken back out of what was typed
 * before it reaches the caller (ADR-032: unsettled words are never
 * saved), and the words that settle after it go in at the cursor as
 * usual.
 */
export function DictatedTextBox({
  target,
  value,
  onChange,
  name,
  label,
  placeholder,
  start = startToday,
}: {
  target: DictationTarget;
  value: string;
  onChange: (value: string) => void;
  name: string;
  label: string;
  placeholder?: string;
  /** Tests hand in their own. */
  start?: DictationStarter;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const [provisional, setProvisional] = useState("");
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
  }, []);

  return (
    <>
      <div ref={fieldRef}>
        <Input
          type="textarea"
          name={name}
          label={label}
          hideLabel
          value={shownText(value, posRef.current, provisional)}
          placeholder={placeholder}
          onChange={(e) => {
            setProvisional("");
            onChange(provisional ? withoutGuess(e.target.value, provisional) : e.target.value);
          }}
        />
      </div>
      <DictateButton
        start={start}
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
        onProvisional={setProvisional}
      />
    </>
  );
}

/** Typed text with the engine's unsettled guess taken back out of it
 * (its first occurrence; the guess was inserted whole). Pure. */
export function withoutGuess(typed: string, guess: string): string {
  const at = typed.indexOf(guess);
  return at === -1 ? typed : typed.slice(0, at) + typed.slice(at + guess.length);
}

/** What the box shows: the settled words, with the unsettled ones (if
 * any) where the next settled words will go. */
export function shownText(value: string, pos: number, provisional: string): string {
  return provisional ? insertText(value, pos, provisional).next : value;
}

/** Inserts `text` at `pos` in `value`, joined by `joinWords`. */
export function insertText(value: string, pos: number, text: string): { next: string; pos: number } {
  const at = Math.min(Math.max(pos, 0), value.length);
  const piece = joinWords(value.slice(at - 1, at), text);
  return { next: value.slice(0, at) + piece + value.slice(at), pos: at + piece.length };
}
