/**
 * Marks: a person's words written on a thought on the Efforts page.
 *
 * A mark is an entry, the way a daily-log Card is: dated, authored, in the
 * writer's own words, never rewritten. This table is where it is typed
 * once. Everything else is derived from it: the margin note on the page
 * version it was written on, the `Syncs/Marks/` file sync-graph extracts
 * like any log (`syncMarksProjection`), and the block the next page run
 * reads as outranking its own reading.
 *
 * Nothing replies to a mark and nothing resolves it. A mark is answered
 * when the words on the page change: the run reads it, the passage is
 * rewritten, and the new page cites the entry the mark became.
 *
 * Anchors are units and citations, never node ids or character offsets. A
 * unit is only meaningful on the frozen body it was computed from (marks
 * never carry forward), and a citation names a person's synced day, which
 * survives re-extraction where node ids do not. The unit's words are copied
 * onto the mark so it keeps its record in words after the page moves on.
 */

import { RecordId } from "surrealdb";
import { computeMarkUnitsFromMarkdown, type MarkUnit, type MarkUnitRef } from "oxmarkdown-core";
import { pageHash } from "./pageBody.server";
import { defineTable, formatRecord, merge, query, remove, upsert, type Data } from "./generic.server";
import { getHumansById } from "./humans.server";
import { listFolderChildren } from "./vault.server";
import type { VaultFolder } from "./vault.types";
import { isIncompleteBannerText, parseProjectManifest } from "./project.types";

const TABLE = "graphlog_marks";

/** Moves live in `graphLogMoves.server.ts`, which imports this module, so
 * the little this one needs of them is read here directly rather than
 * importing back the other way. */
const MOVES_TABLE = "graphlog_moves";

export type MarkMoveStatus = "requested" | "applied" | "undone";

export const MARK_KINDS = ["correction", "addition", "thought", "structural"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const MARK_TEXT_LIMIT = 2000;

/** The unit a mark was written on, as the server computed it from the
 * stored page. Never taken from the client. */
export type MarkUnitSnapshot = Pick<MarkUnit, "key" | "kind" | "section" | "effort" | "text" | "refs" | "attachmentId">;

export type GraphLogMark = Data & {
  project_folder_id: string;
  author_human_id: string;
  /** `YYYY-MM-DD`, the writer's own day. */
  date: string;
  created_at: string;
  /** Verbatim. Never edited. */
  text: string;
  /** Which version of the page it was written on (`pageHash`). */
  page_hash: string;
  unit: MarkUnitSnapshot;
  /** What the page run decided the mark was doing. Recorded to count
   * later, never shown. Null until a run reads it. */
  kind: MarkKind | null;
  read_at: string | null;
  read_date: string | null;
  /** A routing override this mark asked for, if any. */
  move_id: string | null;
};

/** A mark as the page shows it: who, when, what. */
export type PageMark = {
  id: string;
  unitKey: string;
  authorHumanId: string;
  authorName: string;
  date: string;
  text: string;
  moveId: string | null;
  /** The mark moved a daily-log chunk off this project (an active
   * routing override). The page says so and never says where. */
  moved: boolean;
  /** Where the move it asked for stands, if it asked for one. */
  moveStatus: MarkMoveStatus | null;
  /** Whose entry the move is about: only they confirm a request. */
  moveAuthorHumanId: string | null;
  /** Where it went. The caller shows the mark's own words only to a
   * reader who can see that project, and the placeholder to everyone
   * else. Never sent to the browser. */
  moveDestFolderId: string | null;
  /** Written on a version of the page that has since been rewritten, and
   * no run has read it yet. It is shown next to the nearest thing it was
   * about, saying so, rather than disappearing before anything answered
   * it. */
  waiting: boolean;
};

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  // The moves table too: this module reads it (see `MOVES_TABLE`), and
  // selecting from a table SurrealDB has never seen is an error, which
  // the driver logs with a stack trace and treats as a dropped
  // connection. A project that has never had a move would print that on
  // every sync.
  await defineTable(MOVES_TABLE);
  tableEnsured = true;
}

/** The markable units of a stored README, exactly as the page renders
 * them (`parseProjectManifest(...).body`, the same body the newspaper
 * loader hands `ProjectView`). The incomplete-build banner is a system
 * warning, not a thought, so it is not markable. */
export function pageMarkUnits(rawReadme: string): MarkUnit[] {
  return computeMarkUnitsFromMarkdown(parseProjectManifest(rawReadme).body, {
    skipParagraph: isIncompleteBannerText,
  });
}

export function snapshotUnit(unit: MarkUnit): MarkUnitSnapshot {
  return {
    key: unit.key,
    kind: unit.kind,
    section: unit.section,
    effort: unit.effort,
    text: unit.text,
    refs: unit.refs,
    attachmentId: unit.attachmentId,
  };
}

/** Random id in the shape SurrealDB generates (20 lowercase alnum). */
function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createMark(input: {
  projectFolderId: string;
  authorHumanId: string;
  date: string;
  text: string;
  pageHash: string;
  unit: MarkUnitSnapshot;
}): Promise<GraphLogMark | null> {
  await ensureTable();
  const id = newId();
  const result = await upsert(new RecordId(TABLE, id), {
    project_folder_id: input.projectFolderId,
    author_human_id: input.authorHumanId,
    date: input.date,
    created_at: new Date().toISOString(),
    text: input.text,
    page_hash: input.pageHash,
    unit: input.unit,
    kind: null,
    read_at: null,
    read_date: null,
    move_id: null,
  });
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatRecord(record as unknown as GraphLogMark) : null;
}

async function selectMarks(where: string, params: Record<string, unknown>): Promise<GraphLogMark[]> {
  await ensureTable();
  const result = await query<[GraphLogMark[]]>(
    `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY created_at ASC`,
    params,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export function listMarksForProject(projectFolderId: string): Promise<GraphLogMark[]> {
  return selectMarks("project_folder_id = $projectFolderId", { projectFolderId });
}

/** Marks no clean page run has read yet, oldest first. */
export function listUnreadMarks(projectFolderId: string): Promise<GraphLogMark[]> {
  return selectMarks("project_folder_id = $projectFolderId AND (read_at = NONE OR read_at = NULL)", { projectFolderId });
}

export async function getMark(id: string): Promise<GraphLogMark | null> {
  await ensureTable();
  const result = await query<[GraphLogMark[]]>(`SELECT * FROM ${TABLE} WHERE id = $id`, {
    id: new RecordId(TABLE, id),
  });
  const row = result?.[0]?.[0];
  return row ? formatRecord(row) : null;
}

/**
 * The marks the live page shows, each beside the thought it was written
 * on.
 *
 * THE MARGIN HOLDS WHAT THE SYSTEM HAS NOT READ YET (Austin,
 * 2026-09-21). A mark is in the margin until a run reads it and turns it
 * into a node. After that the page speaks for it, citing the entry it
 * became, and the words themselves stay in `Syncs/Marks/`, a project's
 * record of what people wrote on it: synced, readable by anyone who can
 * see the project, and read by the pipeline, exactly like the daily logs
 * beside it. A page that kept every mark it had ever taken in would stop
 * being a page anybody could read.
 *
 * The one thing that must not happen is a mark disappearing BEFORE
 * anything has read it. So an unread mark outlives the rewrite: it
 * re-anchors, in order, to a line citing the same entry, then to its own
 * section's heading, then to the top of the page, and says it is waiting.
 */
export async function listMarksOnPage(projectFolderId: string, rawReadme: string): Promise<PageMark[]> {
  const units = pageMarkUnits(rawReadme);
  const live = pageHash(rawReadme);
  // Unread marks, plus any mark still carrying a move somebody has to
  // decide on: the margin note is the only place that request can be
  // confirmed, and a run stamping the mark read must not take the
  // decision away with it.
  const unread = await listUnreadMarks(projectFolderId);
  const pending = await marksWithPendingMoves(projectFolderId);
  const seen = new Set(unread.map((m) => m._id));
  const marks = [...unread, ...pending.filter((m) => !seen.has(m._id))].flatMap((m) => {
    // On its own passage while the page it was written on still stands;
    // beside the nearest thing it was about once that page is rewritten.
    const anchor = m.page_hash === live ? m.unit.key : anchorMark(units, m.unit);
    return anchor ? [{ mark: m, anchor }] : [];
  });
  const names = await authorNames(marks.map(({ mark }) => mark.author_human_id));
  const moves = await movesById(marks.flatMap(({ mark }) => (mark.move_id ? [mark.move_id] : [])));
  return marks.map(({ mark: m, anchor }) => ({
    id: m._id,
    unitKey: anchor,
    authorHumanId: m.author_human_id,
    authorName: names.get(m.author_human_id) ?? m.author_human_id,
    date: m.date,
    text: m.text,
    moveId: m.move_id,
    moved: m.move_id != null && moves.get(m.move_id)?.status === "applied",
    moveStatus: (m.move_id && moves.get(m.move_id)?.status) || null,
    moveAuthorHumanId: (m.move_id && moves.get(m.move_id)?.author) || null,
    moveDestFolderId: (m.move_id && moves.get(m.move_id)?.dest) || null,
    waiting: m.page_hash !== live,
  }));
}

/**
 * Which thought on the page an unread mark sits beside, or null when the
 * page has nothing left to sit it beside. Pure, so the rules above can be
 * read as rules rather than inferred from a query.
 */
export function anchorMark(units: readonly MarkUnit[], snapshot: MarkUnitSnapshot): string | null {
  const exact = units.find((u) => u.key === snapshot.key);
  if (exact) return exact.key;
  const citedIds = new Set(snapshot.refs.map((r) => r.fileId).filter((id): id is string => !!id));
  // An effort heading carries the citations of everything under it, so it
  // matches almost any entry. A line that cites the same entry is what
  // the mark was about; the heading is only a last resort among matches.
  const citing = units.filter((u) => u.refs.some((r) => r.fileId && citedIds.has(r.fileId)));
  const citesSame =
    citing.find((u) => u.kind === snapshot.kind && u.kind !== "heading") ??
    citing.find((u) => u.kind !== "heading") ??
    citing[0];
  if (citesSame) return citesSame.key;
  const heading = units.find((u) => u.kind === "heading" && u.text === snapshot.section);
  if (heading) return heading.key;
  return units[0]?.key ?? null;
}

/** Marks whose move is still a request nobody has confirmed or refused. */
async function marksWithPendingMoves(projectFolderId: string): Promise<GraphLogMark[]> {
  await ensureTable();
  const open = await query<[{ mark_id: string | null }[]]>(
    `SELECT mark_id FROM ${MOVES_TABLE} WHERE source_project_folder_id = $projectFolderId AND status = "requested"`,
    { projectFolderId },
  );
  const ids = (open?.[0] ?? []).map((r) => r.mark_id).filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const result = await query<[GraphLogMark[]]>(`SELECT * FROM ${TABLE} WHERE id IN $ids`, {
    ids: ids.map((id) => new RecordId(TABLE, id)),
  });
  return (result?.[0] ?? []).map(formatRecord);
}

/** Where these moves stand. Read here directly (not through
 * `graphLogMoves.server.ts`, which imports this module) so the two stay
 * one-directional. */
async function movesById(
  moveIds: string[],
): Promise<Map<string, { status: MarkMoveStatus; author: string; dest: string | null }>> {
  if (moveIds.length === 0) return new Map();
  await ensureTable();
  const result = await query<
    [{ id: RecordId; status: MarkMoveStatus; author_human_id: string; dest_project_folder_id: string | null }[]]
  >(
    `SELECT id, status, author_human_id, dest_project_folder_id FROM ${MOVES_TABLE} WHERE id IN $ids`,
    { ids: moveIds.map((id) => new RecordId(MOVES_TABLE, id)) },
  );
  return new Map(
    (result?.[0] ?? []).map((r) => [
      String(r.id.id),
      { status: r.status, author: r.author_human_id, dest: r.dest_project_folder_id ?? null },
    ]),
  );
}

export async function authorNames(humanIds: string[]): Promise<Map<string, string>> {
  const humans = await getHumansById([...new Set(humanIds)]);
  return new Map(humans.map((h) => [h._id, h.name || h.email]));
}

/** Called on a clean page run only, with the ids that run was OFFERED
 * (a mark written mid-run stays unread for the next one). A mark the run
 * never classified is stamped read with no kind. */
export async function stampMarksRead(
  ids: readonly string[],
  kindsById: ReadonlyMap<string, MarkKind>,
  date: string,
): Promise<void> {
  const readAt = new Date().toISOString();
  for (const id of ids) {
    await merge(TABLE, id, { read_at: readAt, read_date: date, kind: kindsById.get(id) ?? null });
  }
}

export async function setMarkMove(id: string, moveId: string): Promise<void> {
  await merge(TABLE, id, { move_id: moveId });
}

/**
 * A mark is its author's own words, and theirs to keep working on the way
 * a daily-log entry is, until a page run has read it (Austin,
 * 2026-09-21). After that a page may cite it, so it stays as written and
 * the author writes another mark instead. Both of these refuse rather than silently doing nothing.
 */
export async function rewriteMark(
  id: string,
  authorHumanId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const mark = await getMark(id);
  if (!mark) return { ok: false, reason: "that mark is gone" };
  if (mark.author_human_id !== authorHumanId) return { ok: false, reason: "a mark belongs to whoever wrote it" };
  if (mark.read_at) return { ok: false, reason: "the page has read this one, so it stays as it was written" };
  await merge(TABLE, id, { text });
  return { ok: true };
}

export async function eraseMark(
  id: string,
  authorHumanId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const mark = await getMark(id);
  if (!mark) return { ok: true };
  if (mark.author_human_id !== authorHumanId) return { ok: false, reason: "a mark belongs to whoever wrote it" };
  if (mark.read_at) return { ok: false, reason: "the page has read this one, so it stays" };
  // A mark that refiled an entry is the only handle anyone has on that
  // move: delete it and the words stay moved with nothing left to undo
  // them from. Put the entry back first, then take the mark back.
  if (mark.move_id) {
    const open = (await movesById([mark.move_id])).get(mark.move_id);
    if (open && open.status !== "undone") {
      return { ok: false, reason: "this mark moved an entry; put that back first, then take the mark back" };
    }
  }
  await remove(TABLE, id);
  return { ok: true };
}

/** How a citation reads in words: "Gerald L's 2026-09-09 entry". */
export function describeRef(ref: MarkUnitRef): string {
  return `${ref.name}'s ${ref.date} entry`;
}

// ── The graph's copy ─────────────────────────────────────────────────────────
//
// Marks reach the graph the way a Card does: code writes one dated file per
// person per day under the project's `Syncs/Marks/`, named like a synced
// Card (`<date>-<humanId>.md`), so sync-graph attributes it to the writer
// and extracts it like any log. The file is a projection of the mark rows,
// rebuilt from them, never edited by hand.
//
// Each mark keeps its record in WORDS, not links: which passage, where on
// the page, and whose day that passage cites. Node ids are renumbered
// whenever a day re-extracts, and the page it was written on is replaced
// by the next run, so words are the only anchor that survives both.
//
// The context line is code-written page text, not the marker's words.
// sync-graph highlights only what sits inside a mark's own text
// (`parseMarkTexts`), so a quotation of the page is never attributed to
// the person who marked it (ADR-012).

export const MARKS_SYNC_FOLDER_NAME = "Marks";

const MARK_CONTEXT_PREFIX = "On the Efforts page, at";
const MARK_SEPARATOR = "\n\n---\n\n";
const MOVE_TRACE_PREFIX = "Moved off this project:";

const UNIT_KIND_WORDS: Record<MarkUnitSnapshot["kind"], string> = {
  heading: "the heading",
  bullet: "the line",
  sentence: "the sentence",
  photo: "the photo",
};

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** The code-written line that says where a mark was written. */
export function markContextLine(unit: MarkUnitSnapshot): string {
  const where = [unit.section || "the opening", unit.effort].filter(Boolean).join(" · ");
  const quoted = unit.text ? ` "${clip(unit.text, 200)}"` : "";
  const cites = unit.refs.length > 0 ? `; it cites ${unit.refs.map(describeRef).join(", ")}` : "";
  return `${MARK_CONTEXT_PREFIX} ${UNIT_KIND_WORDS[unit.kind]}${quoted} (${where}${cites}):`;
}

/** A move's trace, in words, on the project the chunk left.
 *
 * NEVER NAMES WHERE IT WENT. A reader here may have no access to the other
 * project, and its existence is not theirs to learn (Austin, 2026-09-21).
 * This line replaces the mark's own words in this project's graph, because
 * a person writing "this belongs to Coronado" names it themselves. */
export function moveTraceLine(input: {
  authorName: string;
  date: string;
  section: string;
  markerName: string;
  markedOn: string;
  status: MarkMoveStatus;
}): string {
  const what = input.section ? `the section "${input.section}"` : "the whole entry";
  const moved =
    input.status === "applied"
      ? `was filed here by mistake and now belongs to another project`
      : `was filed here by mistake, and ${input.markerName} has asked its author to move it to another project`;
  return `${MOVE_TRACE_PREFIX} ${input.authorName}'s ${input.date} entry, ${what}, ${moved}. Recorded on ${input.markedOn}.`;
}

/** What a reader who cannot see the destination is shown in place of a
 * mark that named it. */
export const MOVED_MARK_PLACEHOLDER = "Says this belongs to another project.";

/** What one reader is allowed to read of a mark that asked for a move.
 *
 * The marker usually names the project in their own words ("this belongs
 * to Coronado"). Whoever can open that project reads the mark as written.
 * To everyone else the other project's existence is not theirs to learn
 * (Austin, 2026-09-21), so they get the placeholder, and `moveDestFolderId`
 * never leaves the server. An undone move is nothing to hide. */
export function readableMark<T extends { text: string; moveStatus: MarkMoveStatus | null; moveDestFolderId: string | null }>(
  mark: T,
  canSeeDestination: boolean,
): Omit<T, "moveDestFolderId"> {
  const { moveDestFolderId, ...rest } = mark;
  const hide = !!moveDestFolderId && mark.moveStatus !== "undone" && !canSeeDestination;
  return hide ? { ...rest, text: MOVED_MARK_PLACEHOLDER } : rest;
}

/** One person's marks for one day, as the file sync-graph reads. Marks in
 * the order they were written; move traces after them. */
export function buildMarksFileContent(
  marks: readonly Pick<GraphLogMark, "text" | "unit">[],
  traces: readonly string[] = [],
): string {
  const chunks = [
    ...marks.map((m) => `${markContextLine(m.unit)}\n\n${m.text.trim()}`),
    ...traces,
  ];
  return `${chunks.join(MARK_SEPARATOR)}\n`;
}

/** The marker's own words in a marks file: everything but the context
 * lines and move traces. What sync-graph may highlight. */
export function parseMarkTexts(content: string): string[] {
  return content
    .split(MARK_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith(MARK_CONTEXT_PREFIX))
    .map((chunk) => {
      const blank = chunk.indexOf("\n\n");
      return blank === -1 ? "" : chunk.slice(blank + 2).trim();
    })
    .filter(Boolean);
}

/** Whether `text` is the marker's own words: contained in one of the mark
 * texts, compared with whitespace collapsed. */
export function isInsideMarkText(text: string, markTexts: readonly string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const needle = norm(text);
  return needle.length > 0 && markTexts.some((m) => norm(m).includes(needle));
}

/** The ids of the project's marks files, so a stage can tell a node that
 * came from a mark from one that came from a log. Empty (one listing, no
 * writes) on a project nobody has marked. */
export async function listMarksSourceFileIds(projectFolder: VaultFolder): Promise<Set<string>> {
  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return new Set();
  const marks = (await listFolderChildren(projectFolder.human_id, syncs._id)).folders.find(
    (f) => f.name === MARKS_SYNC_FOLDER_NAME,
  );
  if (!marks) return new Set();
  const { files } = await listFolderChildren(projectFolder.human_id, marks._id);
  return new Set(files.map((f) => f._id));
}

/** The synced file a node's citation points at. */
export function refLineFileId(refLine: string): string | null {
  return /[?&]file=([A-Za-z0-9]+)/.exec(refLine)?.[1] ?? null;
}

/** What the marks file needs to say about a move, read straight from the
 * moves table for the same one-direction reason as `movesById`. Undone
 * moves are left out: there is nothing to say about them. */
export async function movesByMark(
  projectFolderId: string,
  markIds: string[],
): Promise<Map<string, { authorHumanId: string; date: string; section: string; decidedBy: string; status: MarkMoveStatus }>> {
  if (markIds.length === 0) return new Map();
  await ensureTable();
  const result = await query<
    [
      {
        mark_id: string;
        author_human_id: string;
        date: string;
        chunk: { kind: "section" | "whole"; heading: string };
        decided_by: string;
        status: MarkMoveStatus;
      }[],
    ]
  >(
    `SELECT mark_id, author_human_id, date, chunk, decided_by, status FROM ${MOVES_TABLE}
     WHERE source_project_folder_id = $projectFolderId AND status != "undone" AND mark_id IN $markIds`,
    { projectFolderId, markIds },
  );
  return new Map(
    (result?.[0] ?? [])
      .filter((m) => !!m.mark_id)
      .map((m) => [
        m.mark_id,
        {
          authorHumanId: m.author_human_id,
          date: m.date,
          section: m.chunk?.kind === "whole" ? "" : m.chunk?.heading ?? "",
          decidedBy: m.decided_by,
          status: m.status,
        },
      ]),
  );
}
