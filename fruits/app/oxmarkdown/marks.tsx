/**
 * The pen: marks on a rendered page, OxMarkdown's side of GraphLog
 * annotations.
 *
 * A reader points at a thought (a heading, a bullet, a sentence, a photo;
 * see `oxmarkdown-core/src/markUnits.ts` for exactly what counts and why
 * nothing smaller does), writes what they think in a small box, and sends.
 * The words move out to the margin in the handwritten font, the way you
 * would write on paper.
 *
 * Plain on purpose. The visual belongs to Gerald; what this owes him is
 * the unit, the mark's fields, and a page that leaves room for a margin.
 *
 * Only switched on when a caller passes `annotations` to `OxRenderer`
 * (today the project page, `ProjectView`). Without it, `OxRenderer`'s
 * output is exactly what it was.
 */

import { useState, type ReactNode } from "react";
import {
  computeMarkUnits,
  markUnitLocator,
  type MarkUnit,
  type OxDocument,
} from "oxmarkdown-core";
import { Input } from "stamps/Input";
import { button } from "stamps/button.css";
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
}

export function buildAnnotationCtx(doc: OxDocument, annotations: OxAnnotations): AnnotationCtx {
  const units = computeMarkUnits(doc, { skipParagraph: annotations.skipParagraph });
  const byLocator = new Map(units.map((u) => [markUnitLocator(u.offset, u.sentence), u]));
  const marksByKey = new Map<string, OxMarkNote[]>();
  for (const mark of annotations.marks) {
    const list = marksByKey.get(mark.unitKey) ?? [];
    list.push(mark);
    marksByKey.set(mark.unitKey, list);
  }
  const marksFor = (key: string) => marksByKey.get(key) ?? [];
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
      <OxPopover anchorEl={anchorEl} open={open} onDismiss={() => setOpen(false)} className="ox-mark-popover">
        {/* Only ever the reader's own words: see `MarkPen`. */}
        <MarkPen unit={unit} ctx={ctx} onDone={() => setOpen(false)} />
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
function MarkPen({ unit, ctx, onDone }: { unit: MarkUnit; ctx: AnnotationCtx; onDone: () => void }) {
  return <MarkComposer unit={unit} ctx={ctx} onDone={onDone} mine={ctx.mineOn(unit.key)} />;
}

/**
 * Filing a passage's entry under the project it belongs to, chosen by the
 * person rather than read out of their sentence (Austin, 2026-09-21).
 *
 * Typing "this is Coronado's" and hoping the next run agrees is a lot to
 * ask of a sentence, and it puts the other project's name in words that
 * live on this project's page. Here the reader picks the entry, the part
 * of it that moves, and the project, and the words they wrote stay an
 * ordinary mark. Only offered on a passage that cites a daily-log entry,
 * because only an entry can be filed anywhere.
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

  if (!ctx.loadMoveOptions || !ctx.onMove || unit.refs.every((r) => !r.fileId)) return null;

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
      <button type="button" className="ox-mark-move__open" onClick={() => void start()}>
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
        <div className="ox-mark-move__row">Nothing on this line came from a daily-log entry.</div>
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
        <button type="button" className={button({ variant: "outline" })} onClick={() => setOpen(false)}>
          Back
        </button>
        <button
          type="button"
          className={button({ variant: "secondary" })}
          disabled={busy || !entry || !destId || needsWords}
          onClick={() => void move()}
        >
          {busy ? "Filing" : entry?.yours ? "File it there" : "Ask to move it"}
        </button>
      </div>
    </div>
  );
}

function MarkComposer({
  unit,
  ctx,
  onDone,
  mine,
}: {
  unit: MarkUnit;
  ctx: AnnotationCtx;
  onDone: () => void;
  /** The reader's own unread mark on this thought, which this is then an
   * edit of rather than a new one. */
  mine?: OxMarkNote;
}) {
  const [text, setText] = useState(mine?.text ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

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

  return (
    <div
      className="ox-mark-composer"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      {!moving && (
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
      )}
      {error && !moving && <div className="ox-mark-error">{error}</div>}
      <MoveControl unit={unit} ctx={ctx} text={text} onDone={onDone} onOpenChange={setMoving} />
      {!moving && (
      <div className="ox-mark-actions">
        {mine && ctx.onErase && (
          <button
            type="button"
            className={`${button({ variant: "outline" })} ox-mark-actions__erase`}
            disabled={sending}
            onClick={() => void erase()}
          >
            Take it back
          </button>
        )}
        <button type="button" className={button({ variant: "outline" })} onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className={button({ variant: "secondary" })}
          disabled={sending || !text.trim()}
          onClick={() => void send()}
        >
          {sending ? "Saving" : mine ? "Save" : "Send"}
        </button>
      </div>
      )}
    </div>
  );
}

/** The margin: every mark on the given units, stacked in the order they
 * were written. Renders nothing when there are none, so an unmarked page
 * has no margin elements at all. */
export function MarkNotes({ ctx, unitKeys }: { ctx: AnnotationCtx; unitKeys: string[] }) {
  const notes = unitKeys.flatMap((k) => ctx.marksFor(k));
  if (notes.length === 0) return null;
  return (
    <span className="ox-mark-notes" role="note">
      {notes.map((n) => (
        <span key={n.id} className={`ox-mark-note${n.authorHumanId === ctx.viewerId ? " ox-mark-note--mine" : ""}`}>
          <span className="ox-mark-note__text">{n.text}</span>
          {n.waiting && <span className="ox-mark-note__waiting">waiting for the next run</span>}
          {n.moved && <span className="ox-mark-note__moved">refiled under another project</span>}
          {n.move?.status === "requested" && (
            <span className="ox-mark-note__moved">asks to file this under another project</span>
          )}
          {n.move && ctx.onMoveAction && <MoveAction move={n.move} onMoveAction={ctx.onMoveAction} />}
          <span className="ox-mark-note__by">
            {firstName(n.authorName)}, {shortDate(n.date)}
          </span>
        </span>
      ))}
    </span>
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
      <button type="button" className={button({ variant: "outline" })} disabled={busy} onClick={() => void run()}>
        {action === "confirm" ? "File it there" : "Put it back"}
      </button>
      {error && <span className="ox-mark-error">{error}</span>}
    </span>
  );
}

function firstName(name: string): string {
  const first = name.trim().split(/[\s@]+/)[0] ?? name;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : name;
}

/** "Sep 18" from `2026-09-18`, formatted by hand so server and client
 * render the same text (no locale or time zone involved). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : date;
}
