/**
 * The pen: marks on a rendered page, OxMarkdown's side of GraphLog
 * annotations.
 *
 * A reader points at a thought (a heading, a bullet, a sentence, a photo;
 * see `oxmarkdown-core/src/markUnits.ts` for exactly what counts and why
 * nothing smaller does), writes what they think in a small box, and shares
 * it. The words move out to the margin in the handwritten font, the way
 * you would write on paper, with an arrow back to what they are about
 * (`MarkMargin.tsx`); where there is no margin they wait behind a small
 * mark at the end of the thought (`MarkNotes`). Either way a note is
 * never in the text's own flow, so it never makes the page taller.
 *
 * Plain on purpose. The visual belongs to Gerald; what this owes him is
 * the unit, the mark's fields, and a page that leaves room for a margin.
 *
 * Only switched on when a caller passes `annotations` to `OxRenderer`
 * (today the project page, `ProjectView`). Without it, `OxRenderer`'s
 * output is exactly what it was.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  computeMarkUnits,
  markUnitLocator,
  type MarkUnit,
  type OxDocument,
} from "oxmarkdown-core";
import { Input } from "stamps/Input";
import { Surface } from "stamps/Surface";
import { copyButton } from "stamps/copyField.css";
import { link } from "stamps/link.css";
import { box, divider, footerArea, well } from "stamps/searchCollection.css";
import OxPopover from "./OxPopover";

/** A mark as the page shows it. */
export interface OxMarkNote {
  id: string;
  unitKey: string;
  authorHumanId: string;
  authorName: string;
  /** `YYYY-MM-DD`. */
  date: string;
  text: string;
  /** The passage it was written on has been rewritten and no run has read
   * it yet, so it sits next to the nearest thing it was about and says
   * so, rather than vanishing before anything answers it. */
  waiting?: boolean;
  /** A suggestion a Guide hasn't taken yet: only its writer and the
   * project's Guides see it. */
  suggestion?: boolean;
  /** Set when the mark refiled a daily-log entry under another project;
   * the note then says so, never which one. */
  moved?: boolean;
  /** A move the mark asked for, when it asked for one. */
  move?: {
    id: string;
    status: "requested" | "applied" | "undone";
    /** The viewer wrote the entry and can confirm a request. */
    canConfirm: boolean;
    /** The viewer can put it back. */
    canUndo: boolean;
  };
}

/** What a caller hands `OxRenderer` to turn the pen on. */
export interface OxAnnotations {
  marks: OxMarkNote[];
  /** Who is reading. A person only ever edits their own words. */
  viewerId: string;
  /** Whether this reader may write. False leaves every unit rendered
   * exactly as it was, with no pen. */
  canMark: boolean;
  /** Writes a new mark, or rewrites one of the reader's own that no run
   * has read yet. Resolves to an error message, or null once saved. */
  onSend?: (unitKey: string, text: string, markId?: string) => Promise<string | null>;
  /** Takes back one of the reader's own unread marks. */
  onErase?: (markId: string) => Promise<string | null>;
  /** What this passage's citations could be refiled as, and where the
   * reader could file them. Loaded only when they ask. */
  loadMoveOptions?: (unitKey: string) => Promise<MoveOptions | string>;
  /** Refiles one entry (or one of its sections) under another project,
   * keeping whatever the reader typed as an ordinary mark. */
  onMove?: (input: {
    unitKey: string;
    entryFileId: string;
    section: string | null;
    occurrence: number;
    destProjectFolderId: string;
    text: string;
  }) => Promise<string | null>;
  /** Confirms or undoes a move a mark asked for. Resolves to an error
   * message, or null once done. */
  onMoveAction?: (moveId: string, action: "confirm" | "undo") => Promise<string | null>;
  /** The daily logs a passage came from, for "Read the full log". Only
   * passed for a reader whose group has the Logbook. */
  loadLog?: (unitKey: string) => Promise<CitedLogsForPen | string>;
  /** The passages with a daily log behind them (`unitKeysWithLogs`). The
   * pen offers "Read the full log" only on these (Austin, 2026-10-02). */
  logUnitKeys?: readonly string[];
  /** The same for one cited file, from a citation's `*`: its Source row
   * opens the reader instead of the Vault (2026-10-02). */
  loadRefLog?: (fileId: string) => Promise<CitedLogsForPen | string>;
  /** The cited files with a daily log behind them; only their `*` offers
   * the reader. */
  logFileIds?: readonly string[];
  /** Paragraphs that are not thoughts (a system banner). Must match what
   * the server uses to validate a mark, or keys will disagree. */
  skipParagraph?: (text: string) => boolean;
}

/** The entries a passage cites, as the margin offers them. */
export interface MoveOptions {
  entries: {
    fileId: string;
    date: string;
    authorName: string;
    /** The reader wrote it, so it moves rather than asking. */
    yours: boolean;
    /** `occurrence` tells two sections with the same heading apart. */
    sections: { heading: string; occurrence: number; words: number }[];
  }[];
  projects: { id: string; name: string }[];
}

/** The logs a passage came from, as the Logbook shows them
 * (`api.graphlog.cited-logs.tsx`). */
export interface CitedLogsForPen {
  entries: { fileId: string; who: string; date: string; seeded: boolean; markdown: string }[];
  /** Something it cites is not a daily log (a note, a seeded document). */
  other: boolean;
  /** The id each Card attachment loads by (`servedFileIds`). */
  fileIds: Record<string, string>;
}

/** Draws a Card. The pen sits inside `OxRenderer` and can't import it, so
 * the renderer hands this over when it builds the pen's context. */
export type RenderCard = (markdown: string, servedFileIds?: Record<string, string>) => ReactNode;

/** What the tree walk carries: the page's units, found by the offset of
 * the node being rendered, and the marks on each. */
export interface AnnotationCtx {
  unitAt: (node: { position?: { start: { offset?: number } } }, sentence: number | null) => MarkUnit | undefined;
  marksFor: (unitKey: string) => OxMarkNote[];
  /** The reader's own mark on this thought, if they wrote one. What the
   * pen opens with, and the only text it ever holds. */
  mineOn: (unitKey: string) => OxMarkNote | undefined;
  canMark: boolean;
  viewerId: string;
  onSend?: OxAnnotations["onSend"];
  onErase?: OxAnnotations["onErase"];
  loadMoveOptions?: OxAnnotations["loadMoveOptions"];
  onMove?: OxAnnotations["onMove"];
  onMoveAction?: OxAnnotations["onMoveAction"];
  loadLog?: OxAnnotations["loadLog"];
  /** Whether this passage has a daily log to read. */
  hasLog: (unitKey: string) => boolean;
  loadRefLog?: OxAnnotations["loadRefLog"];
  /** The reader for one cited file, when it has a log behind it. */
  refLog: (fileId: string | null) => (() => Promise<CitedLogsForPen | string>) | undefined;
  renderCard?: RenderCard;
}

export function buildAnnotationCtx(doc: OxDocument, annotations: OxAnnotations, renderCard?: RenderCard): AnnotationCtx {
  const units = computeMarkUnits(doc, { skipParagraph: annotations.skipParagraph });
  const byLocator = new Map(units.map((u) => [markUnitLocator(u.offset, u.sentence), u]));
  const marksByKey = new Map<string, OxMarkNote[]>();
  for (const mark of annotations.marks) {
    const list = marksByKey.get(mark.unitKey) ?? [];
    list.push(mark);
    marksByKey.set(mark.unitKey, list);
  }
  const marksFor = (key: string) => marksByKey.get(key) ?? [];
  const logKeys = new Set(annotations.logUnitKeys ?? []);
  const logFiles = new Set(annotations.logFileIds ?? []);
  const loadRefLog = annotations.loadRefLog;
  return {
    unitAt: (node, sentence) => {
      const offset = node.position?.start.offset;
      return offset == null ? undefined : byLocator.get(markUnitLocator(offset, sentence));
    },
    marksFor,
    mineOn: (key) => marksFor(key).find((m) => m.authorHumanId === annotations.viewerId),
    canMark: annotations.canMark,
    viewerId: annotations.viewerId,
    onSend: annotations.onSend,
    onErase: annotations.onErase,
    loadMoveOptions: annotations.loadMoveOptions,
    onMove: annotations.onMove,
    onMoveAction: annotations.onMoveAction,
    loadLog: annotations.loadLog,
    hasLog: (key) => logKeys.has(key),
    loadRefLog,
    refLog: (fileId) => (loadRefLog && fileId && logFiles.has(fileId) ? () => loadRefLog(fileId) : undefined),
    renderCard,
  };
}

/** Clicks on these inside a unit do their own thing (open a citation,
 * follow a link, play a video) instead of opening the pen. */
const OWN_CLICK = "a, button, video, .ox-ref-marker, .ox-popover, .ox-popover-backdrop, textarea, input";

/** One markable thought. Hover shows it can be marked; click opens a small
 * box in place. `as` is the wrapper element: a span inside a sentence or a
 * heading, a div around a bullet's own blocks or a photo. */
export function MarkableUnit({
  unit,
  ctx,
  as = "span",
  children,
}: {
  unit: MarkUnit;
  ctx: AnnotationCtx;
  as?: "span" | "div";
  children: ReactNode;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  // A Card wants more room than a mark does.
  const [reading, setReading] = useState(false);
  const marked = ctx.marksFor(unit.key).length > 0;
  const Tag = as;
  const className = `ox-markable${ctx.canMark ? " ox-markable--pen" : ""}${marked ? " ox-markable--marked" : ""}${open ? " ox-markable--open" : ""}`;

  if (!ctx.canMark) {
    return (
      <Tag className={className} data-mark-unit={unit.key}>
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      ref={setAnchorEl as React.Ref<never>}
      className={className}
      data-mark-unit={unit.key}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(OWN_CLICK)) return;
        setOpen(true);
      }}
    >
      {children}
      <OxPopover
        anchorEl={anchorEl}
        open={open}
        onDismiss={() => {
          setOpen(false);
          setReading(false);
        }}
        className={`ox-mark-popover${reading ? " ox-mark-popover--reading" : ""}`}
      >
        {/* Only ever the reader's own words: see `MarkPen`. */}
        <MarkPen
          unit={unit}
          ctx={ctx}
          onDone={() => {
            setOpen(false);
            setReading(false);
          }}
          onReadingChange={setReading}
        />
      </OxPopover>
    </Tag>
  );
}

/**
 * The pen, open on one thought.
 *
 * IT ONLY EVER HOLDS THE READER'S OWN WORDS (Austin, 2026-09-21). The
 * first build showed everyone's marks above the box, which reads as a
 * thread, and a thread is the one thing this is not. On paper other
 * people's notes are already beside the line, in the margin, and you
 * write your own next to them. So: click a line and you get your own
 * note, blank if you have not written one, loaded and editable if you
 * have.
 *
 * Once a run has read a mark it leaves the page (it is a node in the
 * graph and a line in the project's `Syncs/Marks/` record), so the box
 * opens blank again and what you write is a new one.
 */
function MarkPen({
  unit,
  ctx,
  onDone,
  onReadingChange,
}: {
  unit: MarkUnit;
  ctx: AnnotationCtx;
  onDone: () => void;
  onReadingChange: (reading: boolean) => void;
}) {
  return <MarkComposer unit={unit} ctx={ctx} onDone={onDone} onReadingChange={onReadingChange} mine={ctx.mineOn(unit.key)} />;
}

/**
 * "Read the full log": the daily logs a passage came from, read in the
 * pen's own box (Austin, 2026-10-01).
 *
 * In place of the writing, the way the move form is, and not a second
 * popover: `OxPopover` closes on any press outside itself, so a popover
 * opened from the pen would close the pen. Back returns to whatever was
 * typed. Others' words are never stacked over your box (the pen is not a
 * thread); while you read, there is no box.
 *
 * Each Card is the whole day as the Logbook shows it. A citation names a
 * person's day, not a sentence, so this never claims to show "the line".
 *
 * Also what a citation's `*` opens from its Source row (2026-10-02), in
 * its own popover the same way.
 */
export function LogReader({
  load,
  renderCard,
  onBack,
}: {
  load: () => Promise<CitedLogsForPen | string>;
  renderCard?: RenderCard;
  onBack: () => void;
}) {
  const [loaded, setLoaded] = useState<CitedLogsForPen | string | null>(null);
  // Loaded once, when the reader opens; `load` is a fresh closure on
  // every render of whoever holds it.
  const loadOnce = useRef(load);
  useEffect(() => {
    let live = true;
    void loadOnce.current().then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="ox-mark-log">
      {loaded === null && <div className="ox-mark-move__row">Looking…</div>}
      {typeof loaded === "string" && <div className="ox-mark-error">{loaded}</div>}
      {loaded && typeof loaded !== "string" && <LogEntries logs={loaded} renderCard={renderCard} />}
      <div className="ox-mark-actions">
        <button type="button" className={QUIET} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** The logs themselves, labelled the way the Logbook labels its cards.
 * Exported so a test can draw it without the pen around it. */
export function LogEntries({ logs, renderCard }: { logs: CitedLogsForPen; renderCard?: RenderCard }) {
  if (logs.entries.length === 0) {
    return <div className="ox-mark-move__note">There's no daily log to show for this line.</div>;
  }
  return (
    <>
      {logs.entries.map((e) => (
        <section key={e.fileId} className="ox-mark-log__entry" data-cited-log>
          <div className="ox-mark-log__label">
            {e.who} · {longDate(e.date)}
            {e.seeded ? " · seeded history" : ""}
          </div>
          {/* A seed day is the project's own file: it names no one's originals. */}
          {renderCard?.(e.markdown, e.seeded ? undefined : logs.fileIds)}
        </section>
      ))}
      {logs.other && (
        <div className="ox-mark-move__note">Part of this line comes from a note or a seeded document, not a daily log.</div>
      )}
    </>
  );
}

/** "Tue, Sep 9", as the Logbook writes a day. */
function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Filing a passage's entry under the project it belongs to, chosen by the
 * person rather than read out of their sentence (Austin, 2026-09-21).
 *
 * Typing "this is Coronado's" and hoping the next run agrees is a lot to
 * ask of a sentence, and it puts the other project's name in words that
 * live on this project's page. Here the reader picks the entry, the part
 * of it that moves, and the project, and the words they wrote stay an
 * ordinary mark.
 *
 * Offered on every thought, including one that cites nothing. Hiding it
 * there looked like the feature had gone (Austin, 2026-09-21): only a
 * daily-log entry can be filed anywhere, but which lines carry one is not
 * something a reader should have to work out from whether an option
 * appeared. A passage with nothing behind it says so when asked.
 */
function MoveControl({
  unit,
  ctx,
  text,
  onDone,
  onOpenChange,
}: {
  unit: MarkUnit;
  ctx: AnnotationCtx;
  text: string;
  onDone: () => void;
  /** So the box it sits in can step out of the way while this is open. */
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange(next);
  };
  const [options, setOptions] = useState<MoveOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entryFileId, setEntryFileId] = useState("");
  /** Index into the chosen entry's sections, so a repeated heading is
   * still one choice; "" only when the whole entry moves. */
  const [sectionAt, setSectionAt] = useState("");
  const [destId, setDestId] = useState("");

  if (!ctx.loadMoveOptions || !ctx.onMove) return null;

  const start = async () => {
    setOpen(true);
    setBusy(true);
    const loaded = await ctx.loadMoveOptions!(unit.key);
    setBusy(false);
    if (typeof loaded === "string") {
      setError(loaded);
      return;
    }
    setOptions(loaded);
    const first = loaded.entries[0];
    if (first) {
      setEntryFileId(first.fileId);
      // Always a real choice, never a blank select that files something
      // the reader never saw.
      setSectionAt(first.sections.length > 0 ? "0" : "");
    }
  };

  if (!open) {
    return (
      <button type="button" className={`${link} ox-mark-move__open`} onClick={() => void start()}>
        This belongs to another project
      </button>
    );
  }

  const entry = options?.entries.find((e) => e.fileId === entryFileId);
  const chosen = entry && sectionAt !== "" ? entry.sections[Number(sectionAt)] : undefined;
  // Somebody else's entry does not move on a bare click: they are being
  // asked, and a request with no words is one nobody can answer.
  const needsWords = !!entry && !entry.yours && !text.trim();

  const move = async () => {
    if (!entry || !destId || needsWords) return;
    setBusy(true);
    setError(null);
    const failure = await ctx.onMove!({
      unitKey: unit.key,
      entryFileId: entry.fileId,
      section: chosen ? chosen.heading : null,
      occurrence: chosen ? chosen.occurrence : 0,
      destProjectFolderId: destId,
      text,
    });
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onDone();
  };

  return (
    <div className="ox-mark-move">
      {busy && !options && <div className="ox-mark-move__row">Looking…</div>}
      {options && options.entries.length === 0 && (
        <div className="ox-mark-move__note">
          Nothing on this line came from a daily log, so there's nothing to move.
        </div>
      )}
      {options && options.entries.length > 0 && (
        <>
          <label className="ox-mark-move__row">
            <span>Entry</span>
            <select
              value={entryFileId}
              onChange={(e) => {
                setEntryFileId(e.target.value);
                const next = options.entries.find((x) => x.fileId === e.target.value);
                setSectionAt(next && next.sections.length > 0 ? "0" : "");
              }}
            >
              {options.entries.map((e) => (
                <option key={e.fileId} value={e.fileId}>
                  {e.authorName}, {e.date}
                  {e.yours ? "" : " (theirs)"}
                </option>
              ))}
            </select>
          </label>
          {entry && entry.sections.length > 1 && (
            <label className="ox-mark-move__row">
              <span>Part</span>
              <select value={sectionAt} onChange={(e) => setSectionAt(e.target.value)}>
                {entry.sections.map((sec, i) => (
                  <option key={`${sec.heading}-${sec.occurrence}`} value={String(i)}>
                    {sec.heading || "the opening"} ({sec.words} words)
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ox-mark-move__row">
            <span>Belongs to</span>
            <select value={destId} onChange={(e) => setDestId(e.target.value)}>
              <option value="">Pick a project</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ox-mark-move__note">
            {entry?.yours
              ? "The words move to that project's card for the same day, exactly as you wrote them."
              : `${entry?.authorName ?? "Its author"} wrote this, so they get asked before anything moves.${needsWords ? " Say why in your mark first." : ""}`}
          </div>
        </>
      )}
      {error && <div className="ox-mark-error">{error}</div>}
      <div className="ox-mark-actions">
        <button type="button" className={QUIET} onClick={() => setOpen(false)}>
          Back
        </button>
        <button
          type="button"
          className={ACT}
          disabled={busy || !entry || !destId || needsWords}
          onClick={() => void move()}
        >
          {busy ? "Filing" : entry?.yours ? "File it there" : "Ask to move it"}
        </button>
      </div>
    </div>
  );
}

/** The pen's buttons, from the `CopyField` stamp (Austin, 2026-09-28): the
 * one action is its small copy button, everything else a quiet link. */
const ACT = `btn-secondary ${copyButton}`;
const QUIET = `${link} ox-mark-quiet`;

function MarkComposer({
  unit,
  ctx,
  onDone,
  onReadingChange,
  mine,
}: {
  unit: MarkUnit;
  ctx: AnnotationCtx;
  onDone: () => void;
  onReadingChange: (reading: boolean) => void;
  /** The reader's own unread mark on this thought, which this is then an
   * edit of rather than a new one. */
  mine?: OxMarkNote;
}) {
  const [text, setText] = useState(mine?.text ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [reading, setReadingState] = useState(false);
  const setReading = (next: boolean) => {
    setReadingState(next);
    onReadingChange(next);
  };
  // The writing steps out of the way while either is open.
  const away = moving || reading;

  const send = async () => {
    if (!text.trim() || !ctx.onSend) return;
    setSending(true);
    setError(null);
    const failure = await ctx.onSend(unit.key, text.trim(), mine?.id);
    setSending(false);
    if (failure) {
      setError(failure);
      return;
    }
    if (!mine) setText("");
    onDone();
  };

  const erase = async () => {
    if (!mine || !ctx.onErase) return;
    setSending(true);
    setError(null);
    const failure = await ctx.onErase(mine.id);
    setSending(false);
    if (failure) {
      setError(failure);
      return;
    }
    onDone();
  };

  // Built like the stamp `SearchCollection` (Austin, 2026-09-28): a
  // `Surface` card, the writing in its well on top, the stamp divider, and
  // the footer with what else you can do and the buttons.
  return (
    <Surface
      className={`${box} ox-mark-composer`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !reading) {
          e.preventDefault();
          void send();
        }
      }}
    >
      {!away && (
        <div className={well}>
          <Input
            type="textarea"
            label="Your mark"
            hideLabel
            name={`mark-${unit.key}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            autoFocus
          />
        </div>
      )}
      {!away && <hr className={divider} />}
      <div className={footerArea}>
      {error && !away && <div className="ox-mark-error">{error}</div>}
      {/* One quiet row: the other things you can do on the left, the
          stamp's small copy action on the right. */}
      <div className="ox-mark-footer">
      {reading ? (
        <LogReader load={() => ctx.loadLog!(unit.key)} renderCard={ctx.renderCard} onBack={() => setReading(false)} />
      ) : (
        <div className={`ox-mark-footer__links${moving ? " ox-mark-footer__links--open" : ""}`}>
          {!moving && ctx.loadLog && ctx.hasLog(unit.key) && (
            <button type="button" className={`${link} ox-mark-move__open`} onClick={() => setReading(true)}>
              Read the full log
            </button>
          )}
          <MoveControl unit={unit} ctx={ctx} text={text} onDone={onDone} onOpenChange={setMoving} />
        </div>
      )}
      {!away && (
      <div className="ox-mark-actions">
        {mine && ctx.onErase && (
          <button type="button" className={`${QUIET} ox-mark-actions__erase`} disabled={sending} onClick={() => void erase()}>
            Take it back
          </button>
        )}
        <button type="button" className={QUIET} onClick={onDone}>
          Cancel
        </button>
        <button type="button" className={ACT} disabled={sending || !text.trim()} onClick={() => void send()}>
          {sending ? "Saving" : mine ? "Save" : "Share"}
        </button>
      </div>
      )}
      </div>
      </div>
    </Surface>
  );
}

/** The words of the notes on one thought, and nothing else: no name and
 * no date (Austin, 2026-10-01: "we want only the words of the
 * annotation"). What a note is waiting on, and the one thing to do about
 * a move, stay: they are the page talking, not a byline. Your own note is
 * drawn a little heavier, which is how you know which one the pen opens.
 *
 * Shown in two places and never in the text itself, so a note cannot
 * make the page taller: in the margin on a screen with room for one
 * (`MarkMargin.tsx`), and behind a small mark at the end of the thought
 * where there is none (`MarkNotes`, below). */
export function MarkNoteList({
  notes,
  viewerId,
  onMoveAction,
}: {
  notes: OxMarkNote[];
  viewerId: string;
  onMoveAction?: OxAnnotations["onMoveAction"];
}) {
  return (
    <>
      {notes.map((n) => (
        <span key={n.id} className={`ox-mark-note${n.authorHumanId === viewerId ? " ox-mark-note--mine" : ""}`}>
          <span className="ox-mark-note__text">{n.text}</span>
          {n.suggestion ? (
            <span className="ox-mark-note__waiting">a suggestion, waiting for a Guide</span>
          ) : (
            n.waiting && <span className="ox-mark-note__waiting">waiting for the next run</span>
          )}
          {n.moved && <span className="ox-mark-note__moved">refiled under another project</span>}
          {n.move?.status === "requested" && (
            <span className="ox-mark-note__moved">asks to file this under another project</span>
          )}
          {n.move && onMoveAction && <MoveAction move={n.move} onMoveAction={onMoveAction} />}
        </span>
      ))}
    </>
  );
}

/**
 * The notes on a thought, where the screen has no margin: a small mark at
 * the end of the thought that opens them, the way a citation's `*` opens
 * its source (`RefDirectiveMarker`, `OxRenderer.tsx`). Same component
 * underneath, `OxPopover`: beside the mark on a tablet, a sheet from the
 * bottom on a phone.
 *
 * The notes used to sit under their line here, in the flow, which made
 * the text taller by every note on it. Now the only thing in the flow is
 * the mark. On a screen with a margin the stylesheet takes the mark away
 * and `MarkMargin.tsx` shows the same words beside the text.
 *
 * Renders nothing when the units have no marks, so an unmarked page has
 * nothing of the pen's in it at all.
 */
export function MarkNotes({ ctx, unitKeys }: { ctx: AnnotationCtx; unitKeys: string[] }) {
  const notes = unitKeys.flatMap((k) => ctx.marksFor(k));
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  return (
    <>
      <button
        ref={setAnchorEl}
        type="button"
        className="ox-mark-handle"
        aria-expanded={open}
        aria-label={notes.length === 1 ? "Read the note on this" : `Read the ${notes.length} notes on this`}
        onClick={() => setOpen((o) => !o)}
      >
        <NoteGlyph />
      </button>
      <OxPopover anchorEl={anchorEl} open={open} onDismiss={() => setOpen(false)} className="ox-mark-notes-popover">
        <div className="ox-mark-notes" role="note">
          <MarkNoteList notes={notes} viewerId={ctx.viewerId} onMoveAction={ctx.onMoveAction} />
        </div>
      </OxPopover>
    </>
  );
}

/** The mark: the margin's arrow, small, pointing back at the words. */
function NoteGlyph() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden="true">
      <path d="M13 2.5C8.5 1.5 4.5 3.5 2.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M1 4.5L2.5 8.8L6.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The one thing a person can do with a move from the page: the entry's
 * author confirms a request, and the author or the marker can put an
 * active move back. */
function MoveAction({
  move,
  onMoveAction,
}: {
  move: NonNullable<OxMarkNote["move"]>;
  onMoveAction: NonNullable<OxAnnotations["onMoveAction"]>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action =
    move.status === "requested" && move.canConfirm ? "confirm" : move.status === "applied" && move.canUndo ? "undo" : null;
  if (!action) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    const failure = await onMoveAction(move.id, action);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <span className="ox-mark-note__action">
      <button type="button" className={ACT} disabled={busy} onClick={() => void run()}>
        {action === "confirm" ? "File it there" : "Put it back"}
      </button>
      {error && <span className="ox-mark-error">{error}</span>}
    </span>
  );
}
