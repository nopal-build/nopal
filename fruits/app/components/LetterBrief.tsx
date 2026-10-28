// The brief on a letter's page (Austin, 2026-10-22 to 28): what the
// project already knows that this letter will need, written by a model
// from the whole graph when the letter was started, or when a guide asks
// again. Guides only: the loader hands this to a manager and nobody
// else, and the route it polls answers nobody else.
//
// Who decides what. A person: starting the letter, "Write it again",
// and what to make of the brief. Code: the job, its state, and that the
// brief is read-only here (`OxRenderer`, no pen). The model: the words.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LetterBriefForPage } from "robustness-core/data/brief.server";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import OxRenderer from "./OxRenderer";
import { splitFrontmatter } from "robustness-core/data/project.types";

/** A letter not yet written: front matter and its own title heading, and
 * nothing else. The brief opens by itself then. */
export function isLetterOnlyItsHeading(content: string): boolean {
  const body = splitFrontmatter(content).body.trim();
  return body === "" || /^#\s+[^\n]*$/.test(body);
}

/** The sentence under the New letter form, and the confirm on "Write it
 * again": a brief is a model run, and the click is the decision (the
 * print button's rule, Austin, 2026-10-01 and 2026-10-28). */
export const BRIEF_RUN_NOTE = "Starting the letter writes its brief: a model run over everything logged on this project. It takes a few minutes, and each brief costs a run.";
export const BRIEF_AGAIN_ASK = "Write the brief again? It reads everything logged on this project since, replaces this one, and each brief costs a model run.";

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
export function briefJobLine(job: NonNullable<LetterBriefForPage["job"]>, now: number): string {
  if (job.state === "waiting") return "Waiting its turn…";
  if (job.state === "active") {
    if (job.waitingOnAnotherRun) return "Waiting for another run on this project…";
    const elapsed = job.startedAt ? ` · ${clock(now - new Date(job.startedAt).getTime())}` : "";
    return `Writing the brief…${elapsed}`;
  }
  return "";
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

/** Reference, folded: closed until wanted. */
function BriefReference({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-brief-reference data-open={open ? "true" : "false"}>
      <button type="button" className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit" }}>
        Reference {open ? "▾" : "▸"}
      </button>
      <span className={textSize.xs} style={{ marginLeft: 8, color: semanticColors.textSubtle }}>
        For looking things up while you write. Nobody has to read it.
      </span>
      {open && (
        <div className="ox-plain" data-brief-reference-body style={{ marginTop: 8 }}>
          <OxRenderer markdown={markdown} />
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
  const [open, setOpen] = useState(openByDefault);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = state.job?.state === "waiting" || state.job?.state === "active";

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/letter/${fileId}/brief`);
    if (!res.ok) throw new Error(await readError(res, "Couldn't read the brief."));
    const data = (await res.json()) as LetterBriefForPage;
    if (alive.current) setState(data);
    return data;
  }, [fileId]);

  // While a job runs, the page asks every three seconds and the clock
  // ticks every second. Survives a reload: the loader hands the job in.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      refresh().catch((err) => alive.current && setMessage(err instanceof Error ? err.message : "Couldn't read the brief."));
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [running, refresh]);

  const ask = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/letter/${fileId}/brief`, { method: "POST" });
      if (!res.ok) {
        setMessage(await readError(res, "That didn't go through. Try again."));
        return;
      }
      await refresh();
      setOpen(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const failed = state.job?.state === "failed" ? state.job.error : null;
  const halves = state.brief ? splitBriefHalves(state.brief.content) : { first: "", reference: null };
  const button_ = (label: string) => (
    <button
      type="button"
      className={button({ variant: "secondary", size: "compact" })}
      disabled={busy || running || !hasPurpose}
      title={hasPurpose ? undefined : "Say what this letter is for first"}
      onClick={() => {
        if (state.brief && !window.confirm(BRIEF_AGAIN_ASK)) return;
        void ask();
      }}
      data-brief-button
    >
      {label}
    </button>
  );

  return (
    <section className={sprinkles({ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 })} aria-label="The brief" data-letter-brief data-brief-state={running ? "running" : failed ? "failed" : state.brief ? "ready" : "none"}>
      <Cluster gap={3} align="center">
        <button type="button" className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit" }}>
          The brief {open ? "▾" : "▸"}
        </button>
        {running && state.job && (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }} data-brief-progress>
            {briefJobLine(state.job, now)}
          </span>
        )}
        {!running && state.brief && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            Written {longDate(state.brief.writtenAt)} by {state.brief.byName}
          </span>
        )}
        {!running && (state.brief ? button_("Write it again") : button_("Write the brief"))}
      </Cluster>
      {failed && !running && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert" data-brief-error>
          The brief didn't get written: {failed}
        </p>
      )}
      {message && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
          {message}
        </p>
      )}
      {!running && !state.brief && !failed && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
          {hasPurpose ? "This letter has no brief yet." : "This letter has no brief yet. Say what it is for first."}
        </p>
      )}
      {open && state.brief && (
        <Stack gap={2}>
          {state.brief.incomplete.length > 0 && (
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-brief-incomplete>
              Not finished: {state.brief.incomplete.join("; ")}. Writing it again may finish it.
            </p>
          )}
          <div className="ox-plain" data-brief-body>
            <OxRenderer markdown={halves.first} />
          </div>
          {halves.reference && (
            <BriefReference markdown={halves.reference} />
          )}
        </Stack>
      )}
    </section>
  );
}
