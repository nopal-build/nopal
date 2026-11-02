/**
 * The daily log stamp (`source: "daily_log"`, `date`) locks a file once its
 * day is over (`isFileRefLocked`). #130 let the browser send both for any
 * folder; `dailyLogStamp` keeps them only on the person's own Daily Logs
 * folder for that date, the one `api.daily-log.upload-target` returns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const folders = vi.hoisted(() => new Map<string, { _id: string; name: string; human_id: string; parent_folder_id: string | null }>());
vi.mock("robustness-core/data/vault.server", () => ({
  getFolderById: vi.fn(async (id: string) => folders.get(id) ?? null),
  resolveDailyLogsFolder: vi.fn(async (humanId: string) => ({ _id: `${humanId}-daily-logs` })),
}));

import { dailyLogStamp } from "../modules/dailyLogStamp.server";

beforeEach(() => {
  folders.clear();
  folders.set("day1", { _id: "day1", name: "2026-11-01", human_id: "h1", parent_folder_id: "h1-daily-logs" });
  folders.set("project1", { _id: "project1", name: "2026-10-01", human_id: "h1", parent_folder_id: "projects" });
  folders.set("theirs", { _id: "theirs", name: "2026-11-01", human_id: "h2", parent_folder_id: "h2-daily-logs" });
});

describe("dailyLogStamp", () => {
  it("keeps the stamp on the person's own day folder for that date", async () => {
    expect(await dailyLogStamp("h1", "day1", "daily_log", "2026-11-01")).toEqual({ source: "daily_log", date: "2026-11-01" });
  });

  it("drops a stamp that would lock a file it doesn't describe", async () => {
    // A past date on today's folder: the lock would fire at once.
    expect(await dailyLogStamp("h1", "day1", "daily_log", "2026-10-01")).toBeNull();
    // A folder named like a date that isn't under Daily Logs.
    expect(await dailyLogStamp("h1", "project1", "daily_log", "2026-10-01")).toBeNull();
    // Someone else's day folder.
    expect(await dailyLogStamp("h1", "theirs", "daily_log", "2026-11-01")).toBeNull();
  });

  it("ignores any other source, a bad date, or no folder", async () => {
    expect(await dailyLogStamp("h1", "day1", "daily_log_card", "2026-11-01")).toBeNull();
    expect(await dailyLogStamp("h1", "day1", "daily_log", "Nov 1")).toBeNull();
    expect(await dailyLogStamp("h1", null, "daily_log", "2026-11-01")).toBeNull();
    expect(await dailyLogStamp("h1", "day1", null, null)).toBeNull();
  });
});
