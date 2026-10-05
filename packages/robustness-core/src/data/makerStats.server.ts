// app/data/makerStats.server.ts
// Stats backing the internal "/maker" dashboard (Super/Admin only).
import { getHumans, isHumanActive, isHumanInvited, type Human } from "./humans.server";
import { getDailyLogsSince, listCardsSince } from "./dailyLog.server";
import { getFoldersByIds } from "./vault.server";

export type MakerRangeDays = 7 | 30;

/** One person's Cards on one project within the range. `empty` counts the
 * Cards that give the project nothing: a Card with no words, or a
 * suggestion no Guide has taken. Those sync as empty files. */
export type ProjectCards = {
  projectFolderId: string;
  projectName: string;
  count: number;
  empty: number;
};

export type HumanActivity = {
  human: Human;
  /** Personal Daily Log entries (`daily_logs`), the welcome sample
   * included. A project only ever gets `cards`. */
  logCount: number;
  lastLogDate: string;
  /** Cards written to projects, per project. The project sync folders copy
   * these and nothing else (`runDailyLogSync`). */
  cards: ProjectCards[];
};

export type MakerStats = {
  /** All-time, ignores the selected range. */
  totalActiveHumans: number;
  /** All-time, ignores the selected range. */
  totalInvitedHumans: number;
  /** Count of daily logs written within the selected range. */
  dailyLogCountInRange: number;
  /** Humans who wrote at least one daily log or Card within the selected
   * range, sorted by log count (most active first). */
  humansInRange: HumanActivity[];
  /** Daily logs in the range whose `humanId` has no `humans` row. They
   * count in `dailyLogCountInRange` and used to be silently dropped from
   * `humansInRange`, so the table quietly failed to sum to the headline
   * (ADR-016). The same class of gap sync-graph hard-fails on (ADR-015);
   * here it is reported, keyed by the unresolved id. */
  unattributedInRange: { humanId: string; logCount: number; lastLogDate: string }[];
};

function startOfRange(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Cards per person per project. Pure. A Card whose `fed` is only
 * whitespace counts as empty, as the Logbook hides it. */
export function tallyCards(
  cards: readonly { humanId: string; date: string; projectFolderId: string; fed: string }[],
  projectNames: ReadonlyMap<string, string>,
): Map<string, { cards: ProjectCards[]; lastDate: string }> {
  const byHuman = new Map<string, { byProject: Map<string, ProjectCards>; lastDate: string }>();
  for (const card of cards) {
    let entry = byHuman.get(card.humanId);
    if (!entry) {
      entry = { byProject: new Map(), lastDate: card.date };
      byHuman.set(card.humanId, entry);
    }
    if (card.date > entry.lastDate) entry.lastDate = card.date;
    let project = entry.byProject.get(card.projectFolderId);
    if (!project) {
      project = {
        projectFolderId: card.projectFolderId,
        projectName: projectNames.get(card.projectFolderId) ?? "A removed project",
        count: 0,
        empty: 0,
      };
      entry.byProject.set(card.projectFolderId, project);
    }
    project.count += 1;
    if (!card.fed.trim()) project.empty += 1;
  }
  return new Map(
    [...byHuman].map(([humanId, { byProject, lastDate }]) => [
      humanId,
      { cards: [...byProject.values()].sort((a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName)), lastDate },
    ]),
  );
}

export async function getMakerStats(days: MakerRangeDays): Promise<MakerStats> {
  const start = startOfRange(days);
  const [humansCollection, logsInRange, cardsInRange] = await Promise.all([
    getHumans(),
    getDailyLogsSince(start),
    listCardsSince(start),
  ]);

  const humans = humansCollection?.data ?? [];
  const totalActiveHumans = humans.filter(isHumanActive).length;
  const totalInvitedHumans = humans.filter(isHumanInvited).length;

  const humanById = new Map(humans.map((h) => [h._id, h]));
  const byHuman = new Map<string, { count: number; lastDate: string }>();
  for (const log of logsInRange) {
    const existing = byHuman.get(log.humanId);
    if (existing) {
      existing.count += 1;
      if (log.date > existing.lastDate) existing.lastDate = log.date;
    } else {
      byHuman.set(log.humanId, { count: 1, lastDate: log.date });
    }
  }

  const projectIds = [...new Set(cardsInRange.map((c) => c.projectFolderId))];
  const projectNames = new Map((await getFoldersByIds(projectIds)).map((f) => [f._id, f.name]));
  const cardsByHuman = tallyCards(cardsInRange, projectNames);

  const humansInRange: HumanActivity[] = [];
  const unattributedInRange: MakerStats["unattributedInRange"] = [];
  for (const [humanId, { count, lastDate }] of byHuman.entries()) {
    const human = humanById.get(humanId);
    const cards = cardsByHuman.get(humanId);
    if (human) {
      humansInRange.push({
        human,
        logCount: count,
        lastLogDate: cards && cards.lastDate > lastDate ? cards.lastDate : lastDate,
        cards: cards?.cards ?? [],
      });
    } else unattributedInRange.push({ humanId, logCount: count, lastLogDate: lastDate });
  }
  // Someone with Cards in the range but no personal entry in it.
  for (const [humanId, { cards, lastDate }] of cardsByHuman) {
    if (byHuman.has(humanId)) continue;
    const human = humanById.get(humanId);
    if (human) humansInRange.push({ human, logCount: 0, lastLogDate: lastDate, cards });
  }
  humansInRange.sort((a, b) => b.logCount - a.logCount);
  unattributedInRange.sort((a, b) => b.logCount - a.logCount);

  return {
    totalActiveHumans,
    totalInvitedHumans,
    dailyLogCountInRange: logsInRange.length,
    humansInRange,
    unattributedInRange,
  };
}
