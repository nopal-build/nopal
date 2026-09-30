/**
 * The Budget (2026-09-29): a project's estimate by line, each line an
 * estimate and a confidence, and every change kept with its date and who
 * made it, so a later round can slide back through time and see whether
 * a number moved because we were wrong or because the scope changed.
 *
 * One table, `budget_changes`, append-only: a row per line per change,
 * `kind: "start"` for the first values (dated the day the estimate was
 * made, 2026-04-22 for Campbell) and `kind: "change"` after. The current
 * value of a line is its latest row; the history is all of them. Nothing
 * is ever rewritten.
 *
 * Kept apart from everything that travels: not a file, not a mark, not a
 * node, never on the Efforts page. Who reads it is the features list's
 * `budget` (Guides), checked by the page and the API; nothing here checks
 * a role. A seed wipe (`seed.server.ts`) touches vault files and graph
 * days and never this table. Estimates are not costs: `confirmedCosts`
 * (ADR-020) is untouched and unread here.
 */

import { RecordId } from "surrealdb";
import { defineTable, query, upsert } from "./generic.server";
import { BUDGET_LINES, budgetLineName, budgetTotals, isValidConfidence, isValidEstimate, lowHigh } from "./budgetLines";

const TABLE = "budget_changes";

export type BudgetChange = {
  _id: string;
  project_folder_id: string;
  line_key: string;
  estimate: number;
  confidence: number;
  author_human_id: string;
  /** The day the values stand for: the estimate's own date on a start,
   * the day of the change after. */
  date: string;
  created_at: string;
  kind: "start" | "change";
};

/** Random id in the shape SurrealDB generates (20 lowercase alnum),
 * the same helper `graphLogMarks.server.ts` keeps for its rows. */
function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  // Selecting from a table SurrealDB has never seen is an error, and the
  // Costs tab reads this table before anyone has started a budget.
  await defineTable(TABLE);
  tableEnsured = true;
}

function formatChange(raw: Record<string, unknown>): BudgetChange {
  const id = raw.id as { id?: string } | string | undefined;
  return {
    _id: typeof id === "string" ? id : String(id?.id ?? raw._id ?? ""),
    project_folder_id: String(raw.project_folder_id),
    line_key: String(raw.line_key),
    estimate: Number(raw.estimate),
    confidence: Number(raw.confidence),
    author_human_id: String(raw.author_human_id),
    date: String(raw.date),
    created_at: String(raw.created_at),
    kind: raw.kind === "start" ? "start" : "change",
  };
}

/** Every change on a project, oldest first. */
export async function listBudgetChanges(projectFolderId: string): Promise<BudgetChange[]> {
  await ensureTable();
  const result = await query<[Record<string, unknown>[]]>(
    `SELECT * FROM ${TABLE} WHERE project_folder_id = $projectFolderId ORDER BY created_at ASC`,
    { projectFolderId },
  );
  return (result?.[0] ?? []).map(formatChange);
}

async function appendChange(input: Omit<BudgetChange, "_id" | "created_at">): Promise<BudgetChange | null> {
  await ensureTable();
  const row = { ...input, created_at: new Date().toISOString() };
  const result = await upsert(new RecordId(TABLE, newId()), row);
  const record = Array.isArray(result) ? result[0] : result;
  return record ? formatChange(record as Record<string, unknown>) : null;
}

export type BudgetLineView = {
  key: string;
  name: string;
  estimate: number;
  confidence: number;
  low: number;
  high: number;
  /** Oldest first: the start, then each change. */
  history: BudgetChange[];
};

export type BudgetView = {
  /** The estimate's own date, from the start rows. */
  asOf: string;
  lines: BudgetLineView[];
  totals: { estimate: number; low: number; high: number };
};

/** The current budget from its rows: latest row per line, in the shared
 * list's order, with each line's history. Pure. */
export function budgetFromChanges(changes: readonly BudgetChange[]): BudgetView | null {
  if (changes.length === 0) return null;
  const byKey = new Map<string, BudgetChange[]>();
  for (const c of changes) byKey.set(c.line_key, [...(byKey.get(c.line_key) ?? []), c]);
  const lines: BudgetLineView[] = [];
  for (const def of BUDGET_LINES) {
    const history = byKey.get(def.key);
    if (!history) continue;
    const latest = history[history.length - 1];
    lines.push({ key: def.key, name: def.name, estimate: latest.estimate, confidence: latest.confidence, ...lowHigh(latest), history });
  }
  const starts = changes.filter((c) => c.kind === "start").map((c) => c.date).sort();
  return { asOf: starts[0] ?? changes[0].date, lines, totals: budgetTotals(lines) };
}

export async function loadBudget(projectFolderId: string): Promise<BudgetView | null> {
  return budgetFromChanges(await listBudgetChanges(projectFolderId));
}

export type StartBudgetResult = { ok: true; budget: BudgetView } | { ok: false; error: string; status: 400 | 409 };

/** The first values, dated the estimate's own day. Refused when the
 * project already has a budget: lines are changed one at a time after. */
export async function startBudget(input: {
  projectFolderId: string;
  authorHumanId: string;
  asOf: string;
  lines: { key: string; estimate: number; confidence: number }[];
}): Promise<StartBudgetResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) return { ok: false, error: "The as-of date must be YYYY-MM-DD.", status: 400 };
  if (input.lines.length === 0) return { ok: false, error: "No lines to start from.", status: 400 };
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!budgetLineName(l.key) || seen.has(l.key)) return { ok: false, error: `"${l.key}" is not a line on the list.`, status: 400 };
    if (!isValidEstimate(l.estimate) || !isValidConfidence(l.confidence)) return { ok: false, error: `"${l.key}" needs an estimate in dollars and a confidence from 0 to 1.`, status: 400 };
    seen.add(l.key);
  }
  if ((await listBudgetChanges(input.projectFolderId)).length > 0) {
    return { ok: false, error: "This project already has a budget.", status: 409 };
  }
  for (const l of input.lines) {
    await appendChange({
      project_folder_id: input.projectFolderId,
      line_key: l.key,
      estimate: l.estimate,
      confidence: l.confidence,
      author_human_id: input.authorHumanId,
      date: input.asOf,
      kind: "start",
    });
  }
  const budget = await loadBudget(input.projectFolderId);
  return budget ? { ok: true, budget } : { ok: false, error: "Couldn't start the budget.", status: 400 };
}

export type ChangeBudgetLineResult = { ok: true; budget: BudgetView } | { ok: false; error: string; status: 400 | 404 };

/** One line's new estimate and/or confidence, kept as a row dated today
 * with its author. A value left out keeps its current one. */
export async function changeBudgetLine(input: {
  projectFolderId: string;
  authorHumanId: string;
  key: string;
  estimate?: number;
  confidence?: number;
  date: string;
}): Promise<ChangeBudgetLineResult> {
  const current = await loadBudget(input.projectFolderId);
  const line = current?.lines.find((l) => l.key === input.key);
  if (!current || !line) return { ok: false, error: "No such line on this budget.", status: 404 };
  const estimate = input.estimate ?? line.estimate;
  const confidence = input.confidence ?? line.confidence;
  if (!isValidEstimate(estimate)) return { ok: false, error: "The estimate is a number of dollars, zero or more.", status: 400 };
  if (!isValidConfidence(confidence)) return { ok: false, error: "Confidence runs from 0 to 1.", status: 400 };
  if (estimate === line.estimate && confidence === line.confidence) return { ok: true, budget: current };
  await appendChange({
    project_folder_id: input.projectFolderId,
    line_key: input.key,
    estimate,
    confidence,
    author_human_id: input.authorHumanId,
    date: input.date,
    kind: "change",
  });
  const budget = await loadBudget(input.projectFolderId);
  return budget ? { ok: true, budget } : { ok: false, error: "Couldn't save that.", status: 400 };
}
