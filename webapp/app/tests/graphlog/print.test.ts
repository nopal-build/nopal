/**
 * The graph is nightly, the page is printed (ADR-030). Three rules, each
 * a pure function: who may print and when (`printAllowance`), which
 * projects the nightly runs for (`isNightly`), and when a night may touch
 * the Efforts page at all (`decideEffortsRebuild`).
 */
import { describe, expect, it } from "vitest";
import { PRINT_INTERVAL_DAYS, isNightly, printAllowance } from "robustness-core/data/effortsPrint.server";
import { GROUPS, featuresOf } from "robustness-core/data/features";
import { decideEffortsRebuild } from "robustness-core/data/graphProjectView.server";

const DAY = 24 * 60 * 60 * 1000;
const printedAt = "2026-10-01T17:00:00.000Z";
const after = (ms: number) => new Date(new Date(printedAt).getTime() + ms);

describe("who may print, and when", () => {
  it("every group on a project holds print", () => {
    expect(GROUPS.filter((g) => featuresOf(g).includes("print"))).toEqual([...GROUPS]);
  });

  it("a non-guide waits a full week from the last print", () => {
    const crafter = featuresOf("Crafter");
    const early = printAllowance({ features: crafter, isStaff: false, printedAt, now: after(PRINT_INTERVAL_DAYS * DAY - 60_000) });
    expect(early).toEqual({ may: false, anytime: false, nextAt: after(PRINT_INTERVAL_DAYS * DAY).toISOString() });
    expect(printAllowance({ features: crafter, isStaff: false, printedAt, now: after(PRINT_INTERVAL_DAYS * DAY) }).may).toBe(true);
  });

  it("a page never printed can be printed by anyone on it", () => {
    expect(printAllowance({ features: featuresOf("Client"), isStaff: false, printedAt: null, now: new Date() }).may).toBe(true);
  });

  it("a guide and staff print any time", () => {
    const now = after(60_000);
    expect(printAllowance({ features: featuresOf("Guide"), isStaff: false, printedAt, now })).toEqual({ may: true, anytime: true, nextAt: null });
    expect(printAllowance({ features: [], isStaff: true, printedAt, now })).toEqual({ may: true, anytime: true, nextAt: null });
  });

  it("a reader with no role on the list never prints", () => {
    expect(printAllowance({ features: [], isStaff: false, printedAt: null, now: new Date() })).toEqual({ may: false, anytime: false, nextAt: null });
  });
});

describe("which projects the nightly runs for", () => {
  it("on unless turned off, once the project has a graph", () => {
    expect(isNightly({ graphlog_scheduled: undefined }, true)).toBe(true);
    expect(isNightly({ graphlog_scheduled: null }, true)).toBe(true);
    expect(isNightly({ graphlog_scheduled: true }, true)).toBe(true);
    expect(isNightly({ graphlog_scheduled: false }, true)).toBe(false);
    expect(isNightly({ graphlog_scheduled: true }, false)).toBe(false);
  });
});

describe("when a night may touch the Efforts page", () => {
  const base = { applied: true, rewrite: false, namesAnotherProject: false, unreadNotes: 0, unreadMarks: 0 };

  it("holds a changed graph, notes and marks for a print", () => {
    const held = decideEffortsRebuild({ ...base, applied: false, unreadNotes: 1, unreadMarks: 2, hold: true });
    expect(held).toEqual({ reason: "graph-changed", rebuild: false, waiting: ["graph changed", "1 note(s)", "2 mark(s)"] });
    expect(decideEffortsRebuild({ ...base, unreadMarks: 1, hold: true }).rebuild).toBe(false);
  });

  it("still takes another project's name off the page overnight", () => {
    expect(decideEffortsRebuild({ ...base, namesAnotherProject: true, hold: true })).toMatchObject({ reason: "names-another-project", rebuild: true });
  });

  it("a print rebuilds for any of them", () => {
    expect(decideEffortsRebuild({ ...base, applied: false, hold: false })).toMatchObject({ reason: "graph-changed", rebuild: true });
    expect(decideEffortsRebuild({ ...base, unreadNotes: 1, hold: false })).toMatchObject({ reason: "unread-notes", rebuild: true });
  });

  it("nothing new is nothing to do, held or not", () => {
    expect(decideEffortsRebuild({ ...base, hold: true })).toEqual({ reason: "up-to-date", rebuild: false, waiting: [] });
    expect(decideEffortsRebuild({ ...base, hold: false })).toEqual({ reason: "up-to-date", rebuild: false, waiting: [] });
  });
});
