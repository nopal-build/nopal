/**
 * The Budget's arithmetic and its shared line list (2026-09-29), a plain
 * module: the screen and the server read the same numbers.
 *
 * A budget line is an estimate with a confidence, 0 to 1. Low and high
 * are the estimate with the uncertainty applied either way (Austin:
 * "the estimate number with the confidence percentage applied in both
 * directions"): HVAC at $75,000 and 0.8 runs $60,000 to $90,000. Totals
 * are the sums of each column.
 *
 * The line names are the start of a list every project shares, so the
 * next project's lines can be fitted to it. The first budget copies the
 * 4/22 Campbell estimate once; nothing here reads Notion.
 */

export type BudgetLineDef = { key: string; name: string };

/** The shared lines, in the order the sheet had them. The key is the
 * name's slug and never changes once written to a row. */
export const BUDGET_LINES: readonly BudgetLineDef[] = [
  "design + engineering + planning",
  "permitting + procurement",
  "remediation and demo",
  "foundation and crawl space",
  "structure + performance layers",
  "HVAC",
  "electrical",
  "plumbing",
  "finishes + millwork",
  "appliances",
  "windows and doors",
  "cladding and roofing",
  "increase family room",
  "contingency",
  "gates + landscaping",
  "general conditions and management",
  "taxes",
].map((name) => ({ key: budgetLineKey(name), name }));

export function budgetLineKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function budgetLineName(key: string): string | null {
  return BUDGET_LINES.find((l) => l.key === key)?.name ?? null;
}

export type BudgetValues = { estimate: number; confidence: number };

/** Low and high, in whole dollars. */
export function lowHigh(v: BudgetValues): { low: number; high: number } {
  return {
    low: Math.round(v.estimate * v.confidence),
    high: Math.round(v.estimate * (2 - v.confidence)),
  };
}

export function budgetTotals(lines: readonly BudgetValues[]): { estimate: number; low: number; high: number } {
  return lines.reduce(
    (t, l) => {
      const { low, high } = lowHigh(l);
      return { estimate: t.estimate + l.estimate, low: t.low + low, high: t.high + high };
    },
    { estimate: 0, low: 0, high: 0 },
  );
}

export function isValidEstimate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function isValidConfidence(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** `$46,000`, `46000`, `46,000.50`: a number of dollars, or null. */
export function parseDollars(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export type ParsedBudgetTable = {
  lines: { key: string; name: string; estimate: number; confidence: number }[];
  /** Rows whose name is not on the shared list, as written. */
  unknown: string[];
  /** Rows on the list whose numbers could not be read. */
  unreadable: string[];
};

/** The markdown table the estimate holds: `| line item | cost estimate |
 * confidence |`, one row per line. Names match the shared list, case
 * and spacing aside. Pure. */
export function parseBudgetTable(markdown: string): ParsedBudgetTable {
  const out: ParsedBudgetTable = { lines: [], unknown: [], unreadable: [] };
  const seen = new Set<string>();
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^-+$/.test(cells[0].replace(/:/g, "")) || cells[0].toLowerCase() === "line item") continue;
    const key = budgetLineKey(cells[0]);
    const def = BUDGET_LINES.find((l) => l.key === key);
    if (!def) {
      out.unknown.push(cells[0]);
      continue;
    }
    const estimate = parseDollars(cells[1]);
    const confidence = Number(cells[2]);
    if (estimate === null || !isValidConfidence(confidence) || seen.has(key)) {
      out.unreadable.push(cells[0]);
      continue;
    }
    seen.add(key);
    out.lines.push({ key, name: def.name, estimate, confidence });
  }
  return out;
}
