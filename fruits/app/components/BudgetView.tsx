/**
 * The Budget under Costs (2026-09-29): the estimate by line, how sure we
 * were, the range, the totals, in one view for guides. Behaves like the
 * sheet it was copied from (change a line, watch low, high and the
 * totals move) and looks like the rest of the project page: rows, not a
 * spreadsheet. Every saved change is kept with its date and author
 * (`budget.server.ts`); each line twirls down to its history.
 *
 * Who decides what. Code: low, high, totals, what a valid number is. A
 * person: the start (the table pasted once), every change. The model:
 * nothing.
 */
import { useMemo, useState } from "react";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Input } from "stamps/Input";
import { Disclosure } from "stamps/Disclosure";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { budgetTotals, lowHigh } from "robustness-core/data/budgetLines";
import type { BudgetView as Budget } from "robustness-core/data/budget.server";
import "./budgetView.css";

export type BudgetNames = Record<string, string>;

/** Today where the person is, `YYYY-MM-DD`. */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

async function post(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/budget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "That didn't save.";
}

export function BudgetView({
  projectFolderId,
  budget,
  names,
  onChanged,
}: {
  projectFolderId: string;
  /** Null until someone starts one. */
  budget: Budget | null;
  /** First names by human id, for the history rows. */
  names: BudgetNames;
  onChanged: () => void;
}) {
  if (!budget) return <StartBudget projectFolderId={projectFolderId} onChanged={onChanged} />;
  return <BudgetLines projectFolderId={projectFolderId} budget={budget} names={names} onChanged={onChanged} />;
}

function StartBudget({ projectFolderId, onChanged }: { projectFolderId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const err = await post({ act: "start", projectFolderId, asOf: String(form.get("asOf") ?? ""), table: String(form.get("table") ?? "") });
        setBusy(false);
        if (err) setError(err);
        else onChanged();
      }}
    >
      <Stack gap={3}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Paste the estimate's table once: a line, its estimate, its confidence. Its date is where the history starts.
        </p>
        <Input type="date" name="asOf" label="Dated" required />
        <Input type="textarea" name="table" label="The table" placeholder="| line item | cost estimate | confidence |" required />
        {error && (
          <p className={textSize.sm} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
        <div>
          <button type="submit" className={button({ variant: "primary" })} disabled={busy}>
            Start the budget
          </button>
        </div>
      </Stack>
    </form>
  );
}

type Draft = { estimate: string; confidence: string };

function BudgetLines({ projectFolderId, budget, names, onChanged }: { projectFolderId: string; budget: Budget; names: BudgetNames; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(budget.lines.map((l) => [l.key, { estimate: String(l.estimate), confidence: String(l.confidence) }])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Low, high and the totals follow what is typed, before anything is
  // saved: the sheet's behaviour. A number that doesn't read stays at the
  // line's current value until it does.
  const live = useMemo(
    () =>
      budget.lines.map((l) => {
        const d = drafts[l.key] ?? { estimate: String(l.estimate), confidence: String(l.confidence) };
        const estimate = Number(d.estimate.replace(/[$,\s]/g, ""));
        const confidence = Number(d.confidence);
        const values = {
          estimate: Number.isFinite(estimate) && estimate >= 0 ? estimate : l.estimate,
          confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : l.confidence,
        };
        return { ...l, draft: values, ...lowHigh(values), dirty: values.estimate !== l.estimate || values.confidence !== l.confidence };
      }),
    [budget, drafts],
  );
  const totals = budgetTotals(live.map((l) => l.draft));

  const save = async (key: string) => {
    const line = live.find((l) => l.key === key);
    if (!line) return;
    setBusy(key);
    setError(null);
    // The change is dated the writer's own day, as a mark is, not the
    // server's clock.
    const err = await post({ act: "change", projectFolderId, key, estimate: line.draft.estimate, confidence: line.draft.confidence, date: localDay() });
    setBusy(null);
    if (err) setError(err);
    else onChanged();
  };

  const cell = sprinkles({ fontFamily: "mono" });
  return (
    <Stack gap={4}>
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        The estimate as of {budget.asOf}, by line: what each bucket is, how sure we were, the range. Change a number and the range moves; save it and the change is kept with today's date.
      </p>
      <div role="table" aria-label="Budget lines" className={sprinkles({ display: "flex", flexDirection: "column", gap: 2 })}>
        <div role="row" className={`${textSize.xs} budget-row`} style={{ color: semanticColors.textSubtle }}>
          <span>Line</span>
          <span>Estimate</span>
          <span>Confidence</span>
          <span>Low</span>
          <span>High</span>
          <span />
        </div>
        {live.map((l) => (
          <Disclosure
            key={l.key}
            summary={
              <div role="row" className="budget-row" onClick={(e) => e.stopPropagation()}>
                <span role="cell">{l.name}</span>
                <span role="cell">
                  <Input
                    type="number"
                    name={`estimate-${l.key}`}
                    label={`${l.name}, estimate`}
                    hideLabel
                    min={0}
                    step={1000}
                    value={drafts[l.key]?.estimate ?? String(l.estimate)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: { ...(d[l.key] ?? { estimate: String(l.estimate), confidence: String(l.confidence) }), estimate: e.target.value } }))}
                  />
                </span>
                <span role="cell">
                  <Input
                    type="number"
                    name={`confidence-${l.key}`}
                    label={`${l.name}, confidence`}
                    hideLabel
                    min={0}
                    max={1}
                    step={0.05}
                    value={drafts[l.key]?.confidence ?? String(l.confidence)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: { ...(d[l.key] ?? { estimate: String(l.estimate), confidence: String(l.confidence) }), confidence: e.target.value } }))}
                  />
                </span>
                <span role="cell" className={cell}>{dollars(l.low)}</span>
                <span role="cell" className={cell}>{dollars(l.high)}</span>
                <span role="cell">
                  {l.dirty && (
                    <button type="button" className={button({ variant: "primary" })} disabled={busy === l.key} onClick={() => save(l.key)}>
                      Save
                    </button>
                  )}
                </span>
              </div>
            }
          >
            <ul className={textSize.xs} style={{ listStyle: "none", padding: 0, margin: 0, color: semanticColors.textSubtle }}>
              {[...l.history].reverse().map((h) => (
                <li key={h._id}>
                  {h.date} · {names[h.author_human_id] ?? "someone"} · {dollars(h.estimate)} at {percent(h.confidence)}
                  {h.kind === "start" ? " · the estimate as first written" : ""}
                </li>
              ))}
            </ul>
          </Disclosure>
        ))}
        <div role="row" className={`budget-row ${sprinkles({ fontWeight: "semibold" })}`}>
          <span role="cell">Total</span>
          <span role="cell" className={cell}>{dollars(totals.estimate)}</span>
          <span role="cell" />
          <span role="cell" className={cell}>{dollars(totals.low)}</span>
          <span role="cell" className={cell}>{dollars(totals.high)}</span>
          <span role="cell" />
        </div>
      </div>
      {error && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }}>
          {error}
        </p>
      )}
      <Cluster gap={2} className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
        <span>Low and high are the estimate with the uncertainty applied either way: $75,000 at 80% runs $60,000 to $90,000.</span>
      </Cluster>
    </Stack>
  );
}
