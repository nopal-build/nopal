/**
 * The Budget (2026-09-29): low and high are the estimate with the
 * uncertainty applied either way, totals sum the columns, the first
 * values come from the 4/22 table copied once, and a line's current
 * value is its latest change with the history kept. See
 * `budgetLines.ts` and `budget.server.ts`.
 */

import { describe, expect, it } from "vitest";
import { BUDGET_LINES, budgetLineKey, budgetTotals, lowHigh, parseBudgetTable, parseDollars } from "robustness-core/data/budgetLines";
import { budgetFromChanges, type BudgetChange } from "robustness-core/data/budget.server";

// The table in `seed/documents/2026-04-22 Expedition planning and first build estimate.md`.
const TABLE = `
| line item | cost estimate | confidence |
|---|---|---|
| design + engineering + planning | $46,000 | 0.9 |
| permitting + procurement | $12,000 | 0.8 |
| remediation and demo | $60,000 | 0.7 |
| foundation and crawl space | $90,000 | 0.7 |
| structure + performance layers | $15,000 | 0.7 |
| HVAC | $75,000 | 0.8 |
| electrical | $40,000 | 0.6 |
| plumbing | $35,000 | 0.6 |
| finishes + millwork | $50,000 | 0.5 |
| appliances | $4,000 | 0.5 |
| windows and doors | $30,000 | 0.5 |
| cladding and roofing | $30,000 | 0.6 |
| increase family room | $50,000 | 0.6 |
| contingency | $120,000 | 0.3 |
| gates + landscaping | $30,000 | 0.5 |
| general conditions and management | $108,000 | 0.8 |
| taxes | $30,000 | 0.8 |
`;

describe("low and high are the estimate with the uncertainty applied either way", () => {
  it("HVAC at $75,000 and 0.8 runs $60,000 to $90,000", () => {
    expect(lowHigh({ estimate: 75000, confidence: 0.8 })).toEqual({ low: 60000, high: 90000 });
  });

  it("contingency at $120,000 and 0.3 runs $36,000 to $204,000; a sure line does not move", () => {
    expect(lowHigh({ estimate: 120000, confidence: 0.3 })).toEqual({ low: 36000, high: 204000 });
    expect(lowHigh({ estimate: 1000, confidence: 1 })).toEqual({ low: 1000, high: 1000 });
  });

  it("totals sum each column", () => {
    const { lines } = parseBudgetTable(TABLE);
    const totals = budgetTotals(lines);
    expect(totals.estimate).toBe(825000);
    expect(totals.low).toBe(lines.reduce((s, l) => s + lowHigh(l).low, 0));
    expect(totals.high).toBe(lines.reduce((s, l) => s + lowHigh(l).high, 0));
    expect(totals.low).toBeLessThan(totals.estimate);
    expect(totals.high).toBeGreaterThan(totals.estimate);
  });
});

describe("the 4/22 table is copied once, by name, onto the shared list", () => {
  it("reads all 17 lines in the list's order with their numbers", () => {
    const parsed = parseBudgetTable(TABLE);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.lines).toHaveLength(17);
    expect(parsed.lines.map((l) => l.key)).toEqual(BUDGET_LINES.map((l) => l.key));
    expect(parsed.lines.find((l) => l.key === budgetLineKey("HVAC"))).toMatchObject({ estimate: 75000, confidence: 0.8 });
  });

  it("a dollar figure reads with or without its dressing; a name not on the list is reported, not invented", () => {
    expect(parseDollars("$46,000")).toBe(46000);
    expect(parseDollars("46000")).toBe(46000);
    expect(parseDollars("1,866.83")).toBe(1866.83);
    expect(parseDollars("about 46k")).toBeNull();
    const parsed = parseBudgetTable("| line item | cost estimate | confidence |\n|---|---|---|\n| solar | $20,000 | 0.5 |\n| HVAC | lots | 0.8 |\n| taxes | $30,000 | 1.4 |\n");
    expect(parsed.lines).toEqual([]);
    expect(parsed.unknown).toEqual(["solar"]);
    expect(parsed.unreadable).toEqual(["HVAC", "taxes"]);
  });

  it("keys are stable slugs of the names", () => {
    expect(budgetLineKey("design + engineering + planning")).toBe("design-and-engineering-and-planning");
    expect(budgetLineKey("HVAC")).toBe("hvac");
    expect(new Set(BUDGET_LINES.map((l) => l.key)).size).toBe(17);
  });
});

describe("a line's value is its latest change, and the history is kept", () => {
  const row = (over: Partial<BudgetChange>): BudgetChange => ({
    _id: "x",
    project_folder_id: "p",
    line_key: "hvac",
    estimate: 75000,
    confidence: 0.8,
    author_human_id: "h_austin",
    date: "2026-04-22",
    created_at: "2026-09-29T10:00:00.000Z",
    kind: "start",
    ...over,
  });

  it("no rows, no budget; the start rows give the as-of date", () => {
    expect(budgetFromChanges([])).toBeNull();
    const view = budgetFromChanges([row({}), row({ line_key: "taxes", estimate: 30000 })]);
    expect(view?.asOf).toBe("2026-04-22");
    expect(view?.lines.map((l) => l.key)).toEqual(["hvac", "taxes"]);
    expect(view?.totals).toEqual({ estimate: 105000, low: 84000, high: 126000 });
  });

  it("a change moves the line, low, high and totals, and the start stays in its history", () => {
    const view = budgetFromChanges([
      row({}),
      row({ _id: "y", kind: "change", estimate: 70000, confidence: 0.9, date: "2026-09-29", created_at: "2026-09-29T11:00:00.000Z", author_human_id: "h_lucas" }),
    ]);
    const hvac = view!.lines[0];
    expect(hvac).toMatchObject({ estimate: 70000, confidence: 0.9, low: 63000, high: 77000 });
    expect(hvac.history.map((h) => [h.kind, h.author_human_id, h.date])).toEqual([
      ["start", "h_austin", "2026-04-22"],
      ["change", "h_lucas", "2026-09-29"],
    ]);
    expect(view!.totals).toEqual({ estimate: 70000, low: 63000, high: 77000 });
  });
});
