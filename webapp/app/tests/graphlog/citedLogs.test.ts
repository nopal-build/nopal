/**
 * "Read the full log" (2026-10-01): which daily logs a passage on the
 * Efforts page came from (`citedLogs.server.ts`). A citation names a file,
 * and which kind of file it is comes from the sync folder it sits in,
 * never from its name alone.
 */
import { describe, expect, it } from "vitest";
import { resolveCitedLogs, type CitedFile, type LogbookEntry } from "robustness-core/data/citedLogs.server";

const card = (fileId: string, who: string, humanId: string, date: string): LogbookEntry => ({
  fileId,
  who,
  humanId,
  date,
  content: `${who}'s day`,
  seeded: false,
});
const seedDay = (fileId: string, date: string): LogbookEntry => ({ fileId, who: "Seed", humanId: null, date, content: "seeded", seeded: true });

// The Logbook: Cards by their own ids (the writer's), seed days by theirs.
const LOGBOOK = [
  card("orig-gerald-0909", "Gerald", "gerald", "2026-09-09"),
  card("orig-lucas-0909", "Lucas", "lucas", "2026-09-09"),
  card("orig-gerald-0912", "Gerald", "gerald", "2026-09-12"),
  seedDay("seed-0401", "2026-04-01"),
];

// What the page cites: the project's synced copies, by their own ids.
const FILES = new Map<string, CitedFile>([
  ["copy-gerald-0909", { name: "2026-09-09-gerald.md", syncFolder: "Daily Logs" }],
  ["copy-lucas-0909", { name: "2026-09-09-lucas.md", syncFolder: "Daily Logs" }],
  ["copy-gerald-0912", { name: "2026-09-12-gerald.md", syncFolder: "Daily Logs" }],
  ["photo-gerald-0912", { name: "2026-09-12-gerald-IMG_7834.jpeg", syncFolder: "Daily Logs" }],
  ["mark-lucas-0909", { name: "2026-09-09-lucas.md", syncFolder: "Marks" }],
  ["copy-austin-0910", { name: "2026-09-10-austin.md", syncFolder: "Daily Logs" }],
  ["elsewhere-gerald-0909", { name: "2026-09-09-gerald.md", syncFolder: null }],
  ["seed-doc", { name: "permit-notes.md", syncFolder: null }],
]);

const cites = (...ids: (string | null)[]) => ids.map((fileId) => ({ fileId }));
const shown = (ids: (string | null)[]) => resolveCitedLogs(cites(...ids), FILES, LOGBOOK);

describe("which log a citation means", () => {
  it("a Card's synced copy is that person's Card that day", () => {
    expect(shown(["copy-gerald-0909"])).toEqual({ entries: [LOGBOOK[0]], other: false });
  });

  it("a photo that came with a Card is the Card it came with", () => {
    expect(shown(["photo-gerald-0912"]).entries.map((e) => e.fileId)).toEqual(["orig-gerald-0912"]);
  });

  it("a margin note has a Card's name and is never that day's Card", () => {
    expect(shown(["mark-lucas-0909"])).toEqual({ entries: [], other: true });
  });

  it("a seed day is itself, by its own id", () => {
    expect(shown(["seed-0401"])).toEqual({ entries: [LOGBOOK[3]], other: false });
  });

  it("a seeded document, or a citation with no file, is not a log", () => {
    expect(shown(["seed-doc"])).toEqual({ entries: [], other: true });
    expect(shown([null])).toEqual({ entries: [], other: true });
  });

  it("a Card's name outside this project's Daily Logs resolves to nothing", () => {
    expect(shown(["elsewhere-gerald-0909"])).toEqual({ entries: [], other: true });
  });

  it("a Card the Logbook doesn't show (waiting for a Guide, nothing taken) isn't shown here either", () => {
    expect(shown(["copy-austin-0910"])).toEqual({ entries: [], other: false });
  });

  it("a heading citing many days gets each once, newest first", () => {
    const { entries, other } = shown(["copy-gerald-0909", "seed-0401", "copy-gerald-0912", "photo-gerald-0912", "copy-lucas-0909", "mark-lucas-0909"]);
    expect(entries.map((e) => `${e.who} ${e.date}`)).toEqual([
      "Gerald 2026-09-12",
      "Gerald 2026-09-09",
      "Lucas 2026-09-09",
      "Seed 2026-04-01",
    ]);
    expect(other).toBe(true);
  });
});
