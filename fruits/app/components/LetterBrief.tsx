// The chain on a letter's page (Austin, 2026-10-22 to 28): the brief,
// written by a model from the whole graph when the letter was started;
// the guide's talk-through of it, typed here and put on their Card for
// the day when they ask for the outline; the outline, written by the
// model from the talk and the brief, and edited by the guide. The letter
// itself is written in the editor below. Guides only: the loader hands
// this to a manager and nobody else, and the routes it calls answer
// nobody else.
//
// Who decides what. A person: starting the letter, the talk, "Write the
// outline", editing the outline, "Write it again", and what to make of
// any of it. Code: the jobs and their state, the Card write, that the
// brief and outline are read-only here unless the guide edits the
// outline (`OxRenderer`, no pen). The model: the words.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LetterBriefForPage, LetterJobForPage } from "robustness-core/data/brief.server";
import { splitFrontmatter } from "robustness-core/data/project.types";
import { Cluster } from "stamps/Cluster";
import { Grid } from "stamps/Grid";
import { Input } from "stamps/Input";
import { Stack } from "stamps/Stack";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import OxRenderer from "./OxRenderer";
import { localDateString } from "./TodayLog";

/** The sentence under the New letter form, and the confirms on the
 * controls that run the model: each is a run, and the click is the
 * decision (the print button's rule, Austin, 2026-10-01 and 2026-10-28). */
export const BRIEF_RUN_NOTE = "Starting the letter writes its brief: a model run over everything logged on this project. It takes a few minutes, and each brief costs a run.";
export const BRIEF_AGAIN_ASK = "Write the brief again? It reads everything logged on this project since, replaces this one, and each brief costs a model run.";
export const OUTLINE_ASK = "Put your talk-through on the project's record as yours, today, and write the outline? Each outline costs a model run.";
export const OUTLINE_AGAIN_ASK = "Write the outline again from the same talk-through? It replaces this one, and each outline costs a model run.";

/** A letter not yet written: front matter and its own title heading, and
 * nothing else. The brief opens by itself then. */
export function isLetterOnlyItsHeading(content: string): boolean {
  const body = splitFrontmatter(content).body.trim();
  return body === "" || /^#\s+[^\n]*$/.test(body);
}

/** The brief is its first half; Reference is there to look things up in
 * while writing, and nobody has to read it (Austin, 2026-10-28: the
 * first production brief's Reference ran to 2,100 words). Split on the
 * `# Reference` heading the skill names. Pure. */
export function splitBriefHalves(content: string): { first: string; reference: string | null } {
  const at = content.search(/^#\s+Reference\s*$/m);
  if (at === -1) return { first: content, reference: null };
  const first = content.slice(0, at).replace(/\n---\s*$/, "").trimEnd();
  const reference = content.slice(at).replace(/^#\s+Reference\s*$/m, "").trim();
  return { first, reference: reference || null };
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

/** The words for a job in flight. */
export function briefJobLine(job: LetterJobForPage, now: number, what = "the brief"): string {
  if (job.state === "waiting") return "Waiting its turn…";
  if (job.state === "active") {
    if (job.waitingOnAnotherRun) return "Waiting for another run on this project…";
    const elapsed = job.startedAt ? ` · ${clock(now - new Date(job.startedAt).getTime())}` : "";
    return `Writing ${what}…${elapsed}`;
  }
  return "";
}

const isRunning = (job: LetterJobForPage | null) => job?.state === "waiting" || job?.state === "active";

const twirlStyle = { background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit" } as const;

/** Reference, folded: closed until wanted. */
function BriefReference({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-brief-reference data-open={open ? "true" : "false"}>
      <button type="button" className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} style={twirlStyle}>
        Reference {open ? "▾" : "▸"}
      </button>
      <span className={textSize.xs} style={{ marginLeft: 8, color: semanticColors.textSubtle }}>
        For looking things up while you write. Nobody has to read it.
      </span>
      {open && (
        <div data-brief-reference-body style={{ marginTop: 8 }}>
          <OxRenderer markdown={markdown} className="ox-no-dots ox-no-heading-marks" />
        </div>
      )}
    </div>
  );
}

export function LetterBrief({
  fileId,
  initial,
  hasPurpose,
  openByDefault,
}: {
  fileId: string;
  initial: LetterBriefForPage;
  /** Without a purpose line there is nothing to brief from. */
  hasPurpose: boolean;
  /** Open while the letter is still only its heading: the brief is read
   * before the letter is written. */
  openByDefault: boolean;
}) {
  const [state, setState] = useState<LetterBriefForPage>(initial);
  // The brief stays open until the outline exists; then the outline is
  // what the guide keeps open while writing.
  const [briefOpen, setBriefOpen] = useState(openByDefault && !initial.outline);
  const briefHeading = useRef<HTMLDivElement>(null);
  const foldBrief = () => {
    setBriefOpen(false);
    briefHeading.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [talk, setTalk] = useState(initial.talk.draft ?? "");
  const [talkSaved, setTalkSaved] = useState<"" | "Saving…" | "Saved">("");
  const [editing, setEditing] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState("");
  const alive = useRef(true);
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (talkTimer.current) clearTimeout(talkTimer.current);
    };
  }, []);

  const briefRunning = isRunning(state.job);
  const outlineRunning = isRunning(state.outlineJob);
  const running = briefRunning || outlineRunning;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/letter/${fileId}/brief`);
    if (!res.ok) throw new Error(await readError(res, "Couldn't read the letter's workings."));
    const data = (await res.json()) as LetterBriefForPage;
    if (alive.current) setState(data);
    return data;
  }, [fileId]);

  // While a job runs, the page asks every three seconds and the clock
  // ticks every second. Survives a reload: the loader hands the jobs in.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      refresh().catch((err) => alive.current && setMessage(err instanceof Error ? err.message : "Couldn't read the letter's workings."));
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [running, refresh]);

  // The outline arriving opens itself and folds the brief away.
  const hadOutline = useRef(!!initial.outline);
  useEffect(() => {
    if (state.outline && !hadOutline.current) {
      hadOutline.current = true;
      setOutlineOpen(true);
      setBriefOpen(false);
    }
  }, [state.outline]);

  const post = async (path: string, body?: unknown, method = "POST"): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/letter/${fileId}/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) {
        setMessage(await readError(res, "That didn't go through. Try again."));
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The talk-through's draft, kept after a pause in typing, so nothing is
  // lost before the click that puts it on the record.
  const onTalkChange = (value: string) => {
    setTalk(value);
    setTalkSaved("Saving…");
    if (talkTimer.current) clearTimeout(talkTimer.current);
    talkTimer.current = setTimeout(() => {
      fetch(`/api/letter/${fileId}/talk`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: value }) })
        .then((res) => alive.current && setTalkSaved(res.ok ? "Saved" : ""))
        .catch(() => alive.current && setTalkSaved(""));
    }, 1500);
  };

  const briefFailed = state.job?.state === "failed" ? state.job.error : null;
  const outlineFailed = state.outlineJob?.state === "failed" ? state.outlineJob.error : null;
  const halves = state.brief ? splitBriefHalves(state.brief.content) : { first: "", reference: null };
  const briefState = briefRunning ? "running" : briefFailed ? "failed" : state.brief ? "ready" : "none";
  const outlineState = outlineRunning ? "running" : outlineFailed ? "failed" : state.outline ? "ready" : "none";

  const briefButton = (label: string) => (
    <button
      type="button"
      className={button({ variant: "secondary", size: "compact" })}
      disabled={busy || running || !hasPurpose}
      title={hasPurpose ? undefined : "Say what this letter is for first"}
      onClick={() => {
        if (state.brief && !window.confirm(BRIEF_AGAIN_ASK)) return;
        void post("brief").then((ok) => ok && setBriefOpen(true));
      }}
      data-brief-button
    >
      {label}
    </button>
  );

  return (
    <section className={sprinkles({ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 })} aria-label="The brief, the talk-through and the outline" data-letter-brief data-brief-state={briefState} data-outline-state={outlineState}>
      {/* ── The brief ── */}
      <Cluster gap={3} align="center" ref={briefHeading}>
        <button type="button" className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} onClick={() => setBriefOpen((o) => !o)} aria-expanded={briefOpen} style={twirlStyle}>
          The brief {briefOpen ? "▾" : "▸"}
        </button>
        {briefRunning && state.job && (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }} data-brief-progress>
            {briefJobLine(state.job, now)}
          </span>
        )}
        {!briefRunning && state.brief && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            Written {longDate(state.brief.writtenAt)} by {state.brief.byName}
          </span>
        )}
        {!briefRunning && (state.brief ? briefButton("Write it again") : briefButton("Write the brief"))}
      </Cluster>
      {briefFailed && !briefRunning && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert" data-brief-error>
          The brief didn't get written: {briefFailed}
        </p>
      )}
      {message && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
          {message}
        </p>
      )}
      {!briefRunning && !state.brief && !briefFailed && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
          {hasPurpose ? "This letter has no brief yet." : "This letter has no brief yet. Say what it is for first."}
        </p>
      )}
      {/* The brief and the talk-through side by side while both are up
          (Austin, 2026-10-28: the space to talk should be there while
          reading the brief): Stamps' Grid, two columns when the page is
          wide enough for both, one when it isn't; the talk pinned so it
          stays in view as the brief scrolls. A Stack once the talk is on
          the record. */}
      {(() => {
        const sideBySide = !!(briefOpen && state.brief && !state.talk.sent);
        const Chain = sideBySide ? Grid : Stack;
        return (
      <Chain gap={sideBySide ? 6 : 4} {...(sideBySide ? { minColumnWidth: 320, style: { alignItems: "start" } } : {})} data-chain-layout={sideBySide ? "side-by-side" : "stacked"}>
      {briefOpen && state.brief && (
        <Stack gap={2} data-chain-brief>
          {state.brief.incomplete.length > 0 && (
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-brief-incomplete>
              Not finished: {state.brief.incomplete.join("; ")}. Writing it again may finish it.
            </p>
          )}
          <div data-brief-body>
            <OxRenderer markdown={halves.first} className="ox-no-dots ox-no-heading-marks" />
          </div>
          {halves.reference && <BriefReference markdown={halves.reference} />}
          {/* Folds from the bottom too, so a long brief doesn't have to be
              scrolled back up to close (Austin, 2026-10-28). */}
          <div>
            <button type="button" className={textSize.xs} style={{ ...twirlStyle, color: semanticColors.textSubtle }} onClick={foldBrief} data-brief-fold>
              Fold the brief ▴
            </button>
          </div>
        </Stack>
      )}

      {/* ── The talk-through ── */}
      {state.brief && !state.talk.sent && (
        <Stack gap={2} data-letter-talk style={sideBySide ? { position: "sticky", top: 12 } : undefined}>
          <Input
            type="textarea"
            name="talk"
            label="Talk it through"
            value={talk}
            onChange={(e) => onTalkChange(e.target.value)}
            placeholder="What makes sense, what doesn't, how the pieces fit."
          />
          <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }}>
            In your own words, once, top to bottom. It goes into the project's record as yours, today, when you write the outline.
            {talkSaved ? ` · ${talkSaved}` : ""}
          </p>
          <div>
            <button
              type="button"
              className={button({ variant: "primary", size: "compact" })}
              disabled={busy || running || !talk.trim()}
              onClick={() => {
                if (!window.confirm(OUTLINE_ASK)) return;
                void post("talk", { text: talk, date: localDateString() });
              }}
              data-outline-button
            >
              Write the outline
            </button>
          </div>
        </Stack>
      )}
      </Chain>
        );
      })()}
      {state.talk.sent && (
        <Stack gap={1} data-letter-talk-sent>
          <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>
            Talked through{" "}
            <span className={textSize.xs} style={{ color: semanticColors.textSubtle, fontWeight: "normal" }}>
              · on the record {longDate(state.talk.sent.at)}, {state.talk.sent.byName}'s words
            </span>
          </span>
          <p className={textSize.sm} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {state.talk.sent.text}
          </p>
        </Stack>
      )}

      {/* ── The outline ── */}
      {(state.talk.sent || state.outline || outlineRunning || outlineFailed) && (
        <Stack gap={2} data-letter-outline>
          <Cluster gap={3} align="center">
            <button type="button" className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} onClick={() => setOutlineOpen((o) => !o)} aria-expanded={outlineOpen} style={twirlStyle}>
              The outline {outlineOpen ? "▾" : "▸"}
            </button>
            {outlineRunning && state.outlineJob && (
              <span className={textSize.sm} style={{ color: semanticColors.textSubtle }} data-outline-progress>
                {briefJobLine(state.outlineJob, now, "the outline")}
              </span>
            )}
            {!outlineRunning && state.outline && (
              <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                Written {longDate(state.outline.writtenAt)} by {state.outline.byName}
                {state.outline.editedAt ? `, edited ${longDate(state.outline.editedAt)}` : ""}
              </span>
            )}
            {!outlineRunning && state.outline && !editing && (
              <button
                type="button"
                className={`${link} ${textSize.xs}`}
                disabled={busy}
                onClick={() => {
                  setOutlineDraft(state.outline?.content ?? "");
                  setEditing(true);
                  setOutlineOpen(true);
                }}
                data-outline-edit
              >
                Edit
              </button>
            )}
            {!outlineRunning && state.talk.sent && (
              <button
                type="button"
                className={button({ variant: "secondary", size: "compact" })}
                disabled={busy || running}
                onClick={() => {
                  if (!window.confirm(OUTLINE_AGAIN_ASK)) return;
                  void post("outline").then((ok) => ok && setOutlineOpen(true));
                }}
                data-outline-again
              >
                {state.outline ? "Write it again" : "Write the outline"}
              </button>
            )}
          </Cluster>
          {outlineFailed && !outlineRunning && (
            <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert" data-outline-error>
              The outline didn't get written: {outlineFailed}
            </p>
          )}
          {outlineOpen && state.outline && !editing && (
            <Stack gap={2}>
              {state.outline.incomplete.length > 0 && (
                <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-outline-incomplete>
                  Not finished: {state.outline.incomplete.join("; ")}. Writing it again may finish it.
                </p>
              )}
              <div data-outline-body>
                <OxRenderer markdown={state.outline.content} className="ox-no-dots ox-no-heading-marks" />
              </div>
            </Stack>
          )}
          {editing && (
            <Stack gap={2} data-outline-editing>
              <Input type="textarea" name="outline" label="The outline, in your hands" value={outlineDraft} onChange={(e) => setOutlineDraft(e.target.value)} />
              <Cluster gap={3} align="center">
                <button
                  type="button"
                  className={button({ variant: "primary", size: "compact" })}
                  disabled={busy || !outlineDraft.trim()}
                  onClick={() => void post("outline", { content: outlineDraft }, "PUT").then((ok) => ok && setEditing(false))}
                >
                  Save
                </button>
                <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </Cluster>
            </Stack>
          )}
        </Stack>
      )}
    </section>
  );
}
