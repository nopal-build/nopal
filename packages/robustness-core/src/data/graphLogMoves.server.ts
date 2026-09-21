/**
 * Refiling a daily-log entry that was written under the wrong project.
 *
 * The log never asserted which project it was about. A Card's project is
 * addressing, the envelope around somebody's words, so fixing it is
 * redirecting mail rather than rewriting a diary ("Logs, corrections and
 * tasks", 2026-09-18). A move is exactly that and nothing more: the words
 * are cut out of the Card they were filed under and put, unchanged, into a
 * Card for the project they belong to, on the same day, under the same
 * person's name. Who did it and when is recorded, and it can be put back.
 *
 * WHY THE DAILY LOG ITSELF IS CORRECTED (Austin, 2026-09-21). The first
 * build left the Card untouched and had the sync deliver the chunk
 * elsewhere. It produced the same two pages and left the person's own
 * daily log still showing the entry under the wrong project forever, with
 * the correction living only in a table. Editing the Cards is both what a
 * person means by "fix it" and far less machinery: every stage downstream
 * already rebuilds from the Cards, so the entry leaves one project's graph
 * and page and arrives in the other's with no routing layer at all.
 *
 * What is never edited: anybody's words. A chunk moves verbatim, and undo
 * puts it back. Redaction, when it comes, is the one path that destroys
 * content, and it is deliberately not this one.
 *
 * Who may move what: only somebody's own entry, and only to a project both
 * they and the marker can see. A mark asking to move someone else's words
 * is recorded as a request for its author to confirm.
 */

import { RecordId } from "surrealdb";
import { createHash } from "node:crypto";
import { defineTable, formatRecord, merge, query, upsert, type Data } from "./generic.server";
import {
  createDailyLogCard,
  getDailyLogByDate,
  getDailyLogCards,
  saveDailyLog,
  saveDailyLogCard,
} from "./dailyLog.server";
import { appendCardDirectiveMarkdown, cardFileName } from "oxmarkdown-core";
import {
  deleteFileRef,
  getAccessibleProjectFolders,
  getFileRefById,
  getFolderById,
  listFolderChildren,
} from "./vault.server";
import { canViewFolder, type VaultFolder } from "./vault.types";
import { extractFileAttachments } from "./sorter.server";
import { DAILY_LOGS_SYNC_FOLDER_NAME, syncedAttachmentFileName } from "./dailyLogSync.server";
import { MARKS_SYNC_FOLDER_NAME } from "./graphLogMarks.server";
import { setMarkMove, type GraphLogMark } from "./graphLogMarks.server";

const TABLE = "graphlog_moves";

export type ChunkRef = {
  /** A `##` section of the Card, or the whole Card. */
  kind: "section" | "whole";
  /** The section's heading as written, "" for the intro (everything before
   * the first `##`). Unused for "whole". */
  heading: string;
  /** Which section, when the same heading appears more than once. */
  occurrence: number;
};

export type MoveStatus = "requested" | "applied" | "undone";

export type GraphLogMove = Data & {
  author_human_id: string;
  date: string;
  source_project_folder_id: string;
  /** Null is reserved for redaction: filed nowhere. Nothing here assumes
   * a destination exists. */
  dest_project_folder_id: string | null;
  chunk: ChunkRef;
  /** The words that moved, exactly as written. What undo puts back, and
   * what proves the move changed nobody's text. */
  chunk_text: string;
  chunk_hash: string;
  source_card_file_id: string;
  dest_card_file_id: string | null;
  mark_id: string | null;
  decided_by: string;
  decided_at: string;
  status: MoveStatus;
  applied_at: string | null;
  undone_by: string | null;
  undone_at: string | null;
};

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

// ── Chunks (pure) ────────────────────────────────────────────────────────────

export type CardChunk = ChunkRef & {
  /** The chunk's exact lines, joined. */
  text: string;
  /** Line range in the Card, [start, end). */
  start: number;
  end: number;
};

const H2_LINE = /^##\s+(.+?)\s*#*\s*$/;

/** A Card's `##` sections, in order, each with its exact text. Everything
 * before the first `##` is the intro, heading "", and is only a chunk when
 * it holds something. Split by line, never re-joined through a markdown
 * serializer, so a chunk is byte-for-byte what the person wrote. */
export function cardChunks(content: string): CardChunk[] {
  const lines = content.split("\n");
  const starts: { heading: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = H2_LINE.exec(line);
    if (m && !line.startsWith("###")) starts.push({ heading: m[1].trim(), line: i });
  });
  const chunks: CardChunk[] = [];
  const seen = new Map<string, number>();
  const push = (heading: string, start: number, end: number) => {
    const key = heading.toLowerCase();
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    chunks.push({ kind: "section", heading, occurrence, text: lines.slice(start, end).join("\n"), start, end });
  };
  const firstStart = starts[0]?.line ?? lines.length;
  if (lines.slice(0, firstStart).join("\n").trim()) push("", 0, firstStart);
  starts.forEach((s, i) => push(s.heading, s.line, starts[i + 1]?.line ?? lines.length));
  return chunks;
}

export function findChunk(content: string, ref: ChunkRef): CardChunk | null {
  if (ref.kind === "whole") {
    const lines = content.split("\n");
    return { ...ref, text: content, start: 0, end: lines.length };
  }
  return (
    cardChunks(content).find(
      (c) => c.heading.toLowerCase() === ref.heading.toLowerCase() && c.occurrence === ref.occurrence,
    ) ?? null
  );
}

export function chunkHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/** The Card without that chunk. A Card that held nothing else comes back
 * empty rather than deleted: the person's day keeps its card, and the
 * empty synced copy is what takes the day out of the project's graph. */
export function removeChunk(content: string, ref: ChunkRef): string {
  if (ref.kind === "whole") return "";
  // A section that is not there leaves the Card exactly as it was.
  // Emptying it instead would delete somebody's day over a heading that
  // had been edited, which is the one mistake this must never make.
  const chunk = findChunk(content, ref);
  if (!chunk) return content;
  return content
    .split("\n")
    .filter((_, i) => i < chunk.start || i >= chunk.end)
    .join("\n")
    .trim();
}

/** The Card with that chunk added, after whatever it already held. */
export function addChunk(content: string, text: string): string {
  return [content.trim(), text.trim()].filter(Boolean).join("\n\n");
}

/**
 * The Card without exactly those words, for undo.
 *
 * NOT `removeChunk`: the destination may have held its own words before
 * the move, and a whole-entry move has no heading to find it by, so
 * asking for "the chunk" there returns the entire Card. Matching the text
 * that actually moved is the only thing that cannot take somebody else's
 * words with it. Returns null when those words are no longer there, which
 * means somebody has edited them and undo must not guess.
 */
export function removeExactText(content: string, text: string): string | null {
  const normalize = (v: string) => v.replace(/\r\n/g, "\n").trim();
  const haystack = normalize(content);
  const needle = normalize(text);
  if (!needle || !haystack.includes(needle)) return null;
  return haystack.replace(needle, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── The record ───────────────────────────────────────────────────────────────

async function selectMoves(where: string, params: Record<string, unknown>): Promise<GraphLogMove[]> {
  await ensureTable();
  const result = await query<[GraphLogMove[]]>(
    `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY decided_at ASC`,
    params,
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** Every move off or onto this project. Empty for every project nobody
 * has refiled anything on. */
export function listMovesForProject(projectFolderId: string): Promise<GraphLogMove[]> {
  return selectMoves(
    "source_project_folder_id = $projectFolderId OR dest_project_folder_id = $projectFolderId",
    { projectFolderId },
  );
}

export async function getMove(id: string): Promise<GraphLogMove | null> {
  await ensureTable();
  const result = await query<[GraphLogMove[]]>(`SELECT * FROM ${TABLE} WHERE id = $id`, {
    id: new RecordId(TABLE, id),
  });
  const row = result?.[0]?.[0];
  return row ? formatRecord(row) : null;
}

/** The names of the projects this project's material has been refiled to,
 * for a page run to refuse to write. A reader here may not be able to see
 * them, and may not be allowed to learn they exist. */
export async function listDestinationNames(sourceProjectFolderId: string): Promise<string[]> {
  const moves = await selectMoves("source_project_folder_id = $source AND status != 'undone'", {
    source: sourceProjectFolderId,
  });
  const names: string[] = [];
  for (const id of new Set(moves.map((m) => m.dest_project_folder_id).filter((d): d is string => !!d))) {
    const folder = await getFolderById(id);
    if (folder?.name) names.push(folder.name);
  }
  return names;
}

function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ── A mark asking for a move ─────────────────────────────────────────────────

export type MoveProposal = {
  markId: string;
  /** The synced day the chunk lives in: one of the mark's cited files. */
  entryFileId: string;
  /** A `##` heading in that Card, "" for its intro, or null for the whole
   * Card. */
  section: string | null;
  /** Which section of that heading, when a Card repeats one. */
  occurrence?: number;
  /** The project it belongs to, by name, as the mark says it. */
  destination: string;
};

/** A proposal that passed every guard, ready to carry out or to record as
 * a request. */
export type MovePlan = {
  markId: string | null;
  markerHumanId: string;
  authorHumanId: string;
  date: string;
  sourceCardFileId: string;
  sourceProjectFolderId: string;
  destProjectFolderId: string;
  /** The destination's name, so the page run can refuse to write it. It
   * never reaches the source project's page or graph. */
  destName: string;
  chunk: ChunkRef;
  chunkText: string;
  /** Carried out when the marker wrote the entry; a request for its
   * author otherwise. */
  status: "applied" | "requested";
};

export type MoveCheck = { ok: true; plan: MovePlan } | { ok: false; reason: string };

/** Finds the one project the marker can see whose name matches. Exact
 * (case-insensitive) first, then a unique partial match, because a mark
 * says "Coronado" and the project is "Coronado ADU". Anything ambiguous
 * is refused, never guessed. */
export function matchProject<T extends { _id: string; name: string }>(
  candidates: readonly T[],
  name: string,
  excludeId: string,
): T | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const pool = candidates.filter((c) => c._id !== excludeId);
  const exact = pool.filter((c) => c.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const partial = pool.filter((c) => {
    const n = c.name.trim().toLowerCase();
    return n.includes(wanted) || wanted.includes(n);
  });
  return partial.length === 1 ? partial[0] : null;
}

/**
 * Every guard a move has to pass, reading only. Two callers: a mark the
 * page run read and decided was structural, and a person choosing the
 * project themselves in the margin. The second names the destination by
 * id, so there is nothing to match and nothing for a model to get wrong;
 * the first names it in the mark's own words. Otherwise the rules are the
 * same, which is why they live in one function.
 *
 * Never throws; a refusal comes back as a reason.
 */
export async function checkMove(input: {
  markId: string | null;
  markerHumanId: string;
  sourceProject: VaultFolder;
  entryFileId: string;
  /** A `##` heading in that entry, "" for its intro, null for all of it. */
  section: string | null;
  /** Which section of that heading, when a Card repeats one. */
  occurrence?: number;
  /** The destination, by id (a person picked it) or by name (a mark said
   * it). Exactly one. */
  destFolderId?: string;
  destName?: string;
  /** The files the marked passage cites, when the request came from a
   * mark: an entry it does not cite is not one that passage can move. */
  citedFileIds?: readonly (string | null)[];
  parseSyncedName: (name: string) => { date: string; humanId: string } | null;
}): Promise<MoveCheck> {
  const { sourceProject } = input;
  try {
    if (input.citedFileIds && !input.citedFileIds.includes(input.entryFileId)) {
      return { ok: false, reason: "that entry is not one the marked passage cites" };
    }
    const synced = await getFileRefById(input.entryFileId);
    const parsed = synced ? input.parseSyncedName(synced.name) : null;
    if (!synced || !parsed) return { ok: false, reason: "that citation is not a synced daily-log entry" };
    const syncedFolder = synced.folder_id ? await getFolderById(synced.folder_id) : null;
    if (!syncedFolder || syncedFolder.human_id !== sourceProject.human_id) {
      return { ok: false, reason: "that entry does not belong to this project" };
    }
    // A marks file is named exactly like a synced Card and sits one folder
    // over (`MARKS_SYNC_FOLDER_NAME`), so without this a mark on a passage
    // citing another mark would resolve to that day's real Card and move a
    // chunk of it. Only a daily-log copy is an entry that can be refiled.
    if (syncedFolder.name !== DAILY_LOGS_SYNC_FOLDER_NAME) {
      return {
        ok: false,
        reason:
          syncedFolder.name === MARKS_SYNC_FOLDER_NAME
            ? "that citation is a mark, not a daily-log entry"
            : "that citation is not a synced daily-log entry",
      };
    }

    const card = (await getDailyLogCards(parsed.humanId, parsed.date)).find(
      (c) => c.projectFolderId === sourceProject._id,
    );
    if (!card) return { ok: false, reason: `no Card for ${parsed.date} on this project to move from` };
    const chunkRef: ChunkRef =
      input.section === null
        ? { kind: "whole", heading: "", occurrence: 0 }
        : { kind: "section", heading: input.section, occurrence: input.occurrence ?? 0 };
    const chunk = findChunk(card.content, chunkRef);
    if (!chunk || !chunk.text.trim()) {
      return { ok: false, reason: `the ${parsed.date} Card has no section "${input.section}"` };
    }

    const visible = await getAccessibleProjectFolders(input.markerHumanId);
    const dest = input.destFolderId
      ? visible.find((f) => f._id === input.destFolderId && f._id !== sourceProject._id) ?? null
      : matchProject(visible, input.destName ?? "", sourceProject._id);
    if (!dest) {
      return {
        ok: false,
        reason: input.destFolderId
          ? "that is not a project you can file this under"
          : `no single project the marker can see matches "${input.destName}"`,
      };
    }
    if (!canViewFolder(parsed.humanId, dest)) {
      return { ok: false, reason: "the entry's author cannot see the destination project" };
    }

    const existing = await selectMoves(
      "author_human_id = $author AND date = $date AND source_project_folder_id = $source AND status != 'undone'",
      { author: parsed.humanId, date: parsed.date, source: sourceProject._id },
    );
    const clash = existing.some(
      (m) =>
        m.chunk.kind === "whole" ||
        chunkRef.kind === "whole" ||
        m.chunk.heading.toLowerCase() === chunkRef.heading.toLowerCase(),
    );
    if (clash) return { ok: false, reason: "that chunk has already been moved" };

    return {
      ok: true,
      plan: {
        markId: input.markId,
        markerHumanId: input.markerHumanId,
        authorHumanId: parsed.humanId,
        date: parsed.date,
        sourceCardFileId: card.fileId,
        sourceProjectFolderId: sourceProject._id,
        destProjectFolderId: dest._id,
        destName: dest.name,
        chunk: chunkRef,
        chunkText: chunk.text,
        status: input.markerHumanId === parsed.humanId ? "applied" : "requested",
      },
    };
  } catch (err) {
    return { ok: false, reason: `checking it failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** What the page run's `propose_move` hands in: the destination in the
 * mark's own words, and the entry among the ones its passage cites. */
export async function checkMoveProposal(input: {
  proposal: MoveProposal;
  mark: GraphLogMark;
  sourceProject: VaultFolder;
  parseSyncedName: (name: string) => { date: string; humanId: string } | null;
}): Promise<MoveCheck> {
  return checkMove({
    markId: input.mark._id,
    markerHumanId: input.mark.author_human_id,
    sourceProject: input.sourceProject,
    entryFileId: input.proposal.entryFileId,
    section: input.proposal.section,
    occurrence: input.proposal.occurrence,
    destName: input.proposal.destination,
    citedFileIds: input.mark.unit.refs.map((r) => r.fileId),
    parseSyncedName: input.parseSyncedName,
  });
}

/** Records the move and, unless it is somebody else's entry to move,
 * carries it out. Reports whether the words actually moved, so a caller
 * never tells somebody an entry was refiled when the Card refused it. */
export async function recordMove(plan: MovePlan): Promise<{ id: string; status: MoveStatus; reason?: string }> {
  await ensureTable();
  const id = newId();
  await upsert(new RecordId(TABLE, id), {
    author_human_id: plan.authorHumanId,
    date: plan.date,
    source_project_folder_id: plan.sourceProjectFolderId,
    dest_project_folder_id: plan.destProjectFolderId,
    chunk: plan.chunk,
    chunk_text: plan.chunkText,
    chunk_hash: chunkHash(plan.chunkText),
    source_card_file_id: plan.sourceCardFileId,
    dest_card_file_id: null,
    mark_id: plan.markId,
    decided_by: plan.markerHumanId,
    decided_at: new Date().toISOString(),
    status: "requested",
    applied_at: null,
    undone_by: null,
    undone_at: null,
  });
  if (plan.markId) await setMarkMove(plan.markId, id);
  if (plan.status !== "applied") return { id, status: "requested" };
  const move = await getMove(id);
  const done = move ? await applyMove(move) : { ok: false as const, reason: "the record went missing" };
  // A move that could not be carried out stays a request rather than
  // silently reading as done: somebody still has to decide what happened.
  return done.ok ? { id, status: "applied" } : { id, status: "requested", reason: done.reason };
}

export type MoveResult = { ok: true } | { ok: false; reason: string };

/**
 * Carries out the correction: the chunk leaves the Card it was filed
 * under and joins a Card for the project it belongs to, on the same day,
 * created if that day has none. The destination's day page gets its
 * `::card{...}` mount point so the person sees the entry arrive, and any
 * photo that travelled with the words stops being synced into the old
 * project.
 *
 * Everything after this is ordinary: both projects' next runs re-read
 * their Cards and rebuild. Refuses rather than guesses if the words have
 * changed since the move was decided.
 */
export async function applyMove(move: GraphLogMove): Promise<MoveResult> {
  try {
    if (move.status === "applied") return { ok: true };
    if (!move.dest_project_folder_id) return { ok: false, reason: "this move has no destination" };
    const cards = await getDailyLogCards(move.author_human_id, move.date);
    const source = cards.find((c) => c.projectFolderId === move.source_project_folder_id);
    if (!source) return { ok: false, reason: `the ${move.date} Card it was filed under is gone` };
    const chunk = findChunk(source.content, move.chunk);
    if (!chunk || chunkHash(chunk.text) !== move.chunk_hash) {
      return { ok: false, reason: `the ${move.date} Card no longer holds those words as they were written` };
    }

    const dest = await createDailyLogCard(move.author_human_id, move.date, move.dest_project_folder_id);
    await saveDailyLogCard(dest.fileId, addChunk(dest.content, chunk.text));
    await saveDailyLogCard(source.fileId, removeChunk(source.content, move.chunk));
    await mountCardOnDay(move.author_human_id, move.date, move.dest_project_folder_id);
    await dropSyncedAttachments(move.source_project_folder_id, move.author_human_id, move.date, chunk.text);

    await merge(TABLE, move._id, {
      status: "applied",
      applied_at: new Date().toISOString(),
      dest_card_file_id: dest.fileId,
      undone_by: null,
      undone_at: null,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `moving it failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** Puts the words back where they were filed. They return at the end of
 * that Card rather than their old position, which is the one thing a move
 * cannot promise to reverse exactly. */
export async function undoMove(move: GraphLogMove, byHumanId: string): Promise<MoveResult> {
  try {
    if (move.status === "applied") {
      const cards = await getDailyLogCards(move.author_human_id, move.date);
      const source = cards.find((c) => c.projectFolderId === move.source_project_folder_id);
      const dest = cards.find((c) => c.projectFolderId === move.dest_project_folder_id);
      if (!source) return { ok: false, reason: "the Card it came from is gone" };
      // Take the words out of where they went before putting them back,
      // or the entry exists in both projects and both graphs.
      const without = dest ? removeExactText(dest.content, move.chunk_text) : null;
      if (dest && without === null) {
        return {
          ok: false,
          reason: "those words have been edited since they moved, so putting them back would duplicate or lose someone's writing",
        };
      }
      if (dest && without !== null) await saveDailyLogCard(dest.fileId, without);
      await saveDailyLogCard(source.fileId, addChunk(source.content, move.chunk_text));
    }
    await merge(TABLE, move._id, {
      status: "undone",
      undone_by: byHumanId,
      undone_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `putting it back failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** The day page shows the Cards its readme mounts, so a Card written by
 * code has to be mounted there or the person never sees the entry arrive. */
async function mountCardOnDay(humanId: string, date: string, projectFolderId: string): Promise<void> {
  const file = cardFileName(projectFolderId);
  const day = await getDailyLogByDate(humanId, date);
  const content = day?.content ?? "";
  if (content.includes(file)) return;
  await saveDailyLog(humanId, date, appendCardDirectiveMarkdown(content, { file, projectFolderId }));
}

/** A photo that travelled with the words is no longer this project's: its
 * synced copy goes, or sync-graph keeps making nodes of it here. The
 * original in the person's own day is untouched, and the destination
 * copies it in on its next sync. */
async function dropSyncedAttachments(
  sourceProjectFolderId: string,
  humanId: string,
  date: string,
  movedText: string,
): Promise<void> {
  const moved = extractFileAttachments(movedText);
  if (moved.length === 0) return;
  const project = await getFolderById(sourceProjectFolderId);
  if (!project) return;
  const { folders } = await listFolderChildren(project.human_id, project._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return;
  const dailyLogs = (await listFolderChildren(project.human_id, syncs._id)).folders.find(
    (f) => f.name === DAILY_LOGS_SYNC_FOLDER_NAME,
  );
  if (!dailyLogs) return;
  const { files } = await listFolderChildren(project.human_id, dailyLogs._id);
  const names = new Set(moved.map((a) => syncedAttachmentFileName(date, humanId, a.name)));
  for (const file of files) {
    if (names.has(file.name)) await deleteFileRef(file._id);
  }
}
