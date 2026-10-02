/**
 * Which daily logs a passage on the Efforts page came from, for the pen's
 * "Read the full log" (Austin, 2026-10-01).
 *
 * A citation names a file, not a statement (the 9/18 card), and that file
 * is one of five things: a Card's synced copy, a photo or PDF that came
 * with a Card, a margin note (`Syncs/Marks`, named exactly like a Card), a
 * seed day, or a seeded document. Only a Card, its attachment and a seed
 * day are a daily log. Which one a file is comes from the sync folder it
 * sits in, never from its name alone: a mark's file has a Card's name.
 *
 * What is shown is the Logbook's own list (`projectLogbook`): the project's
 * fed Cards and its seed days. A Card that waits for a Guide shows only
 * what a Guide took, there as here, so the reader never shows words the
 * Logbook would not.
 */

import { getFileRefListingsByIds, listFolderChildren } from "./vault.server";
import type { VaultFolder } from "./vault.types";
import { listCardsForProject } from "./dailyLog.server";
import { listSeedDays } from "./seed.server";
import { getHumansById } from "./humans.server";
import { firstName } from "./humanNames";
import { DAILY_LOGS_SYNC_FOLDER_NAME, parseSyncedAttachmentFileName, parseSyncedCardFileName } from "./dailyLogSync.server";

/** One entry on the Logbook: a person's Card for a day, or a seed day. */
export type LogbookEntry = {
  fileId: string;
  /** The writer's first name, or "Seed". */
  who: string;
  /** Null for a seed day, which is nobody's Card. */
  humanId: string | null;
  date: string;
  content: string;
  seeded: boolean;
};

/** Every Card written to the project, one per person per day, and the
 * seed days beside them, newest day first. A seed day is nobody's Card
 * (Austin, 2026-09-29: "never as someone's daily log"), so it is listed
 * as "Seed" with its own badge, where the groups that see logs see it. */
export async function projectLogbook(folder: VaultFolder): Promise<LogbookEntry[]> {
  const cards = (await listCardsForProject(folder._id)).filter((c) => c.content.trim());
  const names = new Map(
    (await getHumansById([...new Set(cards.map((c) => c.humanId))])).map((h) => [h._id, firstName(h)]),
  );
  const seed = (await listSeedDays(folder)).map((s) => ({ fileId: s.fileId, who: "Seed", humanId: null, date: s.date, content: s.content, seeded: true }));
  return [
    ...cards.map((c) => ({ fileId: c.fileId, who: names.get(c.humanId) ?? "Someone", humanId: c.humanId, date: c.date, content: c.content, seeded: false })),
    ...seed,
  ].sort(byNewestDay);
}

function byNewestDay(a: LogbookEntry, b: LogbookEntry): number {
  return b.date.localeCompare(a.date) || Number(a.seeded) - Number(b.seeded) || a.who.localeCompare(b.who);
}

/** What the resolver needs to know about a cited file. `syncFolder` is the
 * name of the project's own sync folder it sits in directly (`Daily
 * Logs`, `Marks`, `Seed`), or null when it sits anywhere else, another
 * project included. */
export type CitedFile = { name: string; syncFolder: string | null };

export type CitedLogs = {
  entries: LogbookEntry[];
  /** Something the passage cites is not a daily log: a note, a seeded
   * document, a file from somewhere else. */
  other: boolean;
};

/** The Logbook entries a passage's citations come from, newest first,
 * each once. Pure. A log that is not on the Logbook (a Card nobody has
 * fed the project yet, an empty one) is not shown, as the Logbook does
 * not show it. */
export function resolveCitedLogs(
  refs: readonly { fileId: string | null }[],
  files: ReadonlyMap<string, CitedFile>,
  logbook: readonly LogbookEntry[],
): CitedLogs {
  const found = new Map<string, LogbookEntry>();
  let other = false;
  for (const ref of refs) {
    const entry = ref.fileId ? citedEntry(ref.fileId, files.get(ref.fileId), logbook) : "other";
    if (entry === "other") other = true;
    else if (entry) found.set(entry.fileId, entry);
  }
  return { entries: [...found.values()].sort(byNewestDay), other };
}

function citedEntry(fileId: string, file: CitedFile | undefined, logbook: readonly LogbookEntry[]): LogbookEntry | null | "other" {
  // A seed day is cited by its own id, the one the Logbook lists.
  const seedDay = logbook.find((e) => e.seeded && e.fileId === fileId);
  if (seedDay) return seedDay;
  if (!file || file.syncFolder !== DAILY_LOGS_SYNC_FOLDER_NAME) return "other";
  const day = parseSyncedCardFileName(file.name) ?? parseSyncedAttachmentFileName(file.name);
  if (!day) return "other";
  return logbook.find((e) => !e.seeded && e.humanId === day.humanId && e.date === day.date) ?? null;
}

/** The project's own sync folders, by id: `Daily Logs`, `Marks`, `Seed`. */
export async function projectSyncFolderNames(project: VaultFolder): Promise<Map<string, string>> {
  const { folders } = await listFolderChildren(project.human_id, project._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return new Map();
  const { folders: syncFolders } = await listFolderChildren(project.human_id, syncs._id);
  return new Map(syncFolders.map((f) => [f._id, f.name]));
}

/** `resolveCitedLogs` against the project's files. */
export async function loadCitedLogs(project: VaultFolder, refs: readonly { fileId: string | null }[]): Promise<CitedLogs> {
  const [logbook, files] = await Promise.all([projectLogbook(project), loadCitedFiles(project, [refs])]);
  return resolveCitedLogs(refs, files, logbook);
}

type CitingUnit = { key: string; refs: readonly { fileId: string | null }[] };

/** Where the page offers "Read the full log": the passages (unit keys,
 * for the pen) and the cited files (for a citation's `*`) with a daily
 * log behind them. Only there, so the link never opens onto nothing
 * (Austin, 2026-10-02). The same answer the reader gives, worked out once
 * for the whole page: one Logbook, one lookup for every cited file. */
export type PageLogs = { unitKeys: string[]; fileIds: string[] };

export async function pageLogs(project: VaultFolder, units: readonly CitingUnit[]): Promise<PageLogs> {
  const citing = units.filter((u) => u.refs.length > 0);
  if (citing.length === 0) return { unitKeys: [], fileIds: [] };
  const [logbook, files] = await Promise.all([projectLogbook(project), loadCitedFiles(project, citing.map((u) => u.refs))]);
  return withLogs(citing, files, logbook);
}

/** The pure half of `pageLogs`: a passage, or one cited file, has a log
 * when the reader would show at least one entry for it. */
export function withLogs(
  units: readonly CitingUnit[],
  files: ReadonlyMap<string, CitedFile>,
  logbook: readonly LogbookEntry[],
): PageLogs {
  const fileIds = [...new Set(units.flatMap((u) => u.refs.map((r) => r.fileId)).filter((id): id is string => !!id))];
  return {
    unitKeys: units.filter((u) => resolveCitedLogs(u.refs, files, logbook).entries.length > 0).map((u) => u.key),
    fileIds: fileIds.filter((id) => resolveCitedLogs([{ fileId: id }], files, logbook).entries.length > 0),
  };
}

async function loadCitedFiles(
  project: VaultFolder,
  refLists: readonly (readonly { fileId: string | null }[])[],
): Promise<Map<string, CitedFile>> {
  const ids = [...new Set(refLists.flat().map((r) => r.fileId).filter((id): id is string => !!id))];
  const [syncFolders, listings] = await Promise.all([projectSyncFolderNames(project), getFileRefListingsByIds(ids)]);
  return new Map(
    listings.map((f) => [f._id, { name: f.name, syncFolder: (f.folder_id && syncFolders.get(f.folder_id)) || null }]),
  );
}
