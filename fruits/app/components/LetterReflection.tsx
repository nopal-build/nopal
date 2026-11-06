// Talking a letter through while reading it (Austin, 2026-11-06: "There
// should be an option to talk through the letter while you are viewing
// it"). The reader's own thinking about the letter in front of them,
// typed or spoken, shown to them and nobody else here. Keeping it is a
// click, and that is what puts it on the project's record as theirs
// (`letterReflection.server.ts`). It is not a reply: nothing here is
// addressed to the writer, and the letter stays one letter on its page.
//
// It asks two things, the `reply-pause` seed's (Austin, 2026-10-29): what
// the letter stirred, and what is on your mind about the project that it
// didn't touch, "where they can collide together and become a new, more
// interesting thing".
//
// Once kept, someone who may write letters is offered a way to start one
// from it: the ordinary New letter form, with this as its talk-through.
// A separate, deliberate step, never a box under the letter.
//
// Two pieces, because of where they sit. `ReflectionTwirl` is the one
// line under the letter's header. `LetterReflection` is the box, after
// the letter in a wrapping row: beside it on a wide screen, under it on
// a narrow one. The page owns whether it is open and makes the room; the
// box stays mounted while closed, so folding it loses no words. Both are
// hidden in print.
//
// Who decides what. A person: the words, keeping them, writing a letter.
// Code: who is given the box, the draft's autosave, the Card.
import { useEffect, useRef, useState } from "react";
import type { ReflectionForPage } from "robustness-core/data/letterReflection.server";
import { Input } from "stamps/Input";
import { Stack } from "stamps/Stack";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { hideInPrint } from "stamps/print.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { DictateIntoText } from "./DictateButton";
import { localDateString } from "./TodayLog";

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const REFLECT_LABEL = "Talk it through";
export const REFLECT_PROMPTS = ["What did this letter stir?", "What's on your mind about the project that it didn't touch?"] as const;
export const REFLECT_HINT = "In your own words. Only you see this until you keep it.";
export const REFLECT_KEEP = "Keep it";
export const REFLECT_KEEP_ASK = "Keep this? It goes on the project's record as yours, today.";
export const REFLECT_KEPT = "Kept";
export const REFLECT_KEPT_NOTE = "On the project's record as yours.";
export const REFLECT_KEPT_SUGGESTION = "With a guide as a suggestion from you.";
export const REFLECT_WRITE_BACK = "Write a letter from this";

function longDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const twirlStyle = { background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit" } as const;

/** The path that starts a letter from the kept reflection on `fileId`. */
export function writeBackPath(projectFolderId: string, fileId: string): string {
  return `/newspaper/${projectFolderId}?tab=letters&from=${fileId}`;
}

/** The one line under the letter's header. */
export function ReflectionTwirl({ open, keptDate, onToggle }: { open: boolean; keptDate: string | null; onToggle: () => void }) {
  return (
    <p className={`${hideInPrint} ${textSize.sm}`} style={{ margin: 0 }} data-reflection-line>
      <button type="button" className={sprinkles({ fontWeight: "semibold" })} onClick={onToggle} aria-expanded={open} style={twirlStyle} data-reflection-twirl>
        {REFLECT_LABEL} {open ? "▾" : "▸"}
      </button>
      {keptDate && (
        <span className={textSize.xs} style={{ marginLeft: 8, color: semanticColors.textSubtle }} data-reflection-kept-on>
          {REFLECT_KEPT} {longDay(keptDate)}
        </span>
      )}
    </p>
  );
}

export function LetterReflection({
  fileId,
  initial,
  writeBackIn,
  open,
  onKept,
}: {
  fileId: string;
  initial: ReflectionForPage;
  /** The project a letter can be started in, for someone who may write
   * letters there; null for everyone else. */
  writeBackIn: string | null;
  open: boolean;
  onKept: (date: string) => void;
}) {
  const [kept, setKept] = useState(initial.kept);
  const [text, setText] = useState(initial.draft ?? "");
  const [saved, setSaved] = useState<"" | "Saving…" | "Saved">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  // On a narrow screen the box is under the letter: opening it brings it
  // into view. Beside the letter it is already there, and nothing moves.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    wasOpen.current = open;
  }, [open]);

  // Kept after a pause in typing, so nothing is lost before the click.
  const onChange = (value: string) => {
    setText(value);
    setSaved("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch(`/api/letter/${fileId}/reflection`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: value }) })
        .then((res) => alive.current && setSaved(res.ok ? "Saved" : ""))
        .catch(() => alive.current && setSaved(""));
    }, 1500);
  };

  const keep = async () => {
    if (!window.confirm(REFLECT_KEEP_ASK)) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    try {
      const date = localDateString();
      const res = await fetch(`/api/letter/${fileId}/reflection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, date }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; suggestion?: boolean };
      if (!res.ok) {
        setError(data.error ?? "That couldn't be kept. Try again.");
        return;
      }
      setKept({ text: text.trim(), date, suggestion: !!data.suggestion });
      onKept(date);
    } catch {
      setError("That couldn't be kept. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <section ref={panelRef} aria-label={REFLECT_LABEL} data-letter-reflection data-reflection-state={kept ? "kept" : "open"}>
      <Stack gap={2}>
        {!kept && (
          <>
            <div className={textSize.sm} style={{ color: semanticColors.textSubtle }} data-reflection-prompts>
              {REFLECT_PROMPTS.map((prompt) => (
                <p key={prompt} style={{ margin: 0 }}>
                  {prompt}
                </p>
              ))}
            </div>
            <div ref={fieldRef}>
              <Input type="textarea" name="reflection" label={REFLECT_LABEL} hideLabel value={text} onChange={(e) => onChange(e.target.value)} />
            </div>
            {/* Thinking out loud is the point here, so it can be dictated. */}
            <DictateIntoText target={{ reflectOn: fileId }} value={text} onChange={onChange} fieldRef={fieldRef} />
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }}>
              {REFLECT_HINT}
              {saved ? ` · ${saved}` : ""}
            </p>
            {error && (
              <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
                {error}
              </p>
            )}
            <div>
              <button type="button" className={button({ variant: "primary", size: "compact" })} disabled={busy || !text.trim()} onClick={() => void keep()} data-reflection-keep>
                {REFLECT_KEEP}
              </button>
            </div>
          </>
        )}
        {kept && (
          <>
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-reflection-kept-note>
              {kept.suggestion ? REFLECT_KEPT_SUGGESTION : REFLECT_KEPT_NOTE}
            </p>
            <p className={textSize.sm} style={{ margin: 0, whiteSpace: "pre-wrap" }} data-reflection-kept>
              {kept.text}
            </p>
            {writeBackIn && (
              <div>
                <a href={writeBackPath(writeBackIn, fileId)} className={`${link} ${textSize.sm}`} data-reflection-write-back>
                  {REFLECT_WRITE_BACK}
                </a>
              </div>
            )}
          </>
        )}
      </Stack>
    </section>
  );
}
