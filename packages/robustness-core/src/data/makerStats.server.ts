// app/data/makerStats.server.ts
// Stats backing the internal "/fruits/maker" dashboard (Super/Admin only).
import { getHumans, isHumanActive, isHumanInvited, type Human } from "./humans.server";
import { getDailyLogsSince } from "./dailyLog.server";

export type MakerRangeDays = 7 | 30;

export type HumanActivity = {
  human: Human;
  logCount: number;
  lastLogDate: string;
};

export type MakerStats = {
  /** All-time, ignores the selected range. */
  totalActiveHumans: number;
  /** All-time, ignores the selected range. */
  totalInvitedHumans: number;
  /** Count of daily logs written within the selected range. */
  dailyLogCountInRange: number;
  /** Humans who wrote at least one daily log within the selected range,
   * sorted by log count (most active first). */
  humansInRange: HumanActivity[];
};

function startOfRange(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function getMakerStats(days: MakerRangeDays): Promise<MakerStats> {
  const [humansCollection, logsInRange] = await Promise.all([
    getHumans(),
    getDailyLogsSince(startOfRange(days)),
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

  const humansInRange: HumanActivity[] = Array.from(byHuman.entries())
    .map(([humanId, { count, lastDate }]) => {
      const human = humanById.get(humanId);
      return human ? { human, logCount: count, lastLogDate: lastDate } : null;
    })
    .filter((entry): entry is HumanActivity => entry !== null)
    .sort((a, b) => b.logCount - a.logCount);

  return {
    totalActiveHumans,
    totalInvitedHumans,
    dailyLogCountInRange: logsInRange.length,
    humansInRange,
  };
}
