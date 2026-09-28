/**
 * Taking someone off a project scraps what they wrote on it in the last
 * day (Austin, 2026-09-27: someone gets inappropriate and has to come off
 * right away). "The last day" is the last 24 hours by the clock, not a
 * calendar date: a Card's date is the writer's own day, which the server
 * can't know.
 *
 * Their Cards on the project touched in that window are emptied, the
 * attachments those Cards copied into the project's syncs are removed,
 * their notes on the project from that window are deleted, and each day
 * is re-synced. That is the same way a move takes words out of a project:
 * the empty copy is what takes the day out of the graph. Older days stay.
 *
 * Not reached: an Efforts page a GraphLog run already wrote from those
 * words keeps them until the next run. Taking them off the page sooner is
 * redaction, which is its own piece of work.
 */

import { query, formatRecord, merge } from "./generic.server";
import type { FileRef } from "./vault.types";
import { saveDailyLogCard } from "./dailyLog.server";
import { runDailyLogSync, syncMarksProjection } from "./dailyLogSync.server";
import { getFolderById } from "./vault.server";
import { dropSyncedAttachments } from "./graphLogMoves.server";
import { scrapMarksSince } from "./graphLogMarks.server";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScrapResult = { cards: number; marks: number };

export async function scrapRecentWriting(projectFolderId: string, humanId: string): Promise<ScrapResult> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE source = 'daily_log_card' AND project_folder_id = $projectFolderId
       AND human_id = $humanId AND updated_at >= $since`,
    { projectFolderId, humanId, since },
  );
  // A suggestion Card feeds what a Guide took (`taken_content`), so that
  // goes too, or the sync would keep feeding it.
  const cards = (result?.[0] ?? [])
    .map((r) => formatRecord(r as unknown as FileRef))
    .filter((c) => !!c.date && !!`${c.content ?? ""}${c.taken_content ?? ""}`.trim());
  for (const card of cards) {
    await saveDailyLogCard(card._id, "");
    if (card.suggestion) await merge("file_refs", card._id, { taken_content: null, passed_content: null });
    await dropSyncedAttachments(projectFolderId, humanId, card.date!, `${card.content ?? ""}\n${card.taken_content ?? ""}`);
  }
  const marks = await scrapMarksSince(projectFolderId, humanId, since);
  // The empty copies and the marks' copy reach the project's syncs now,
  // not at the next run. A day's sync writes the marks' copy too.
  const dates = new Set(cards.map((c) => c.date!));
  for (const date of dates) await runDailyLogSync(projectFolderId, { date });
  if (dates.size === 0 && marks > 0) {
    const project = await getFolderById(projectFolderId);
    if (project) await syncMarksProjection(project);
  }
  return { cards: cards.length, marks };
}
