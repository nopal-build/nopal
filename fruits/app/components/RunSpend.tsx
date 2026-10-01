// What one GraphLog run spent, by stage, and what it decided about the
// Efforts page. Rendered on the run page; `RunCost` is the one-figure
// version for the Recent Runs list. Data comes from
// `getGraphLogRunSpend` (graphLogMetrics.server.ts) and
// `effortsDecisionFromEvents` (graphLogPerf.server.ts), both computed in
// the loader.
import type { GraphLogRunSpend } from "robustness-core/data/graphLogMetrics.server";
import type { EffortsDecision } from "robustness-core/data/graphLogPerf.server";
import { PRICING_AS_OF } from "robustness-core/data/llmPricing";

const STAGE_LABEL: Record<string, string> = {
  sow: "sow (seed packets)",
  "sync-knowledge": "sync-knowledge (reading files)",
  "sync-graph": "sync-graph (extraction)",
  "graph-structure": "graph-structure (threads)",
  "graph-project-view": "graph-project-view (Efforts)",
};

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function decisionSentence(d: EffortsDecision): string {
  switch (d.reason) {
    case "up-to-date":
      return "Efforts was not rebuilt. Nothing changed since the last run.";
    case "graph-changed":
      return "Efforts was rebuilt because the graph changed.";
    case "skill-rewrite":
      return "Efforts was rebuilt under a changed EFFORTS.md.";
    case "names-another-project":
      return "Efforts was rebuilt to take another project's name off the page. The graph had not changed.";
    case "unread-notes":
      return `Efforts was rebuilt for ${d.unreadNotes} unread note(s) on the page. The graph had not changed.`;
    case "unread-marks":
      return `Efforts was rebuilt for ${d.unreadMarks} unread mark(s). The graph had not changed.`;
  }
}

/** The run's total for a list row. Says "no model calls" rather than $0
 * so a quiet night reads as quiet, not as free-by-accident. */
export function RunCost({ spend }: { spend: GraphLogRunSpend | undefined }) {
  if (!spend) return null;
  const text =
    spend.attribution === "none"
      ? "no model calls"
      : `${formatUsd(spend.estimatedCostUsd)}${spend.unpricedCallCount > 0 ? "+" : ""}`;
  return <span className="text-xs font-mono subtle-text">{text}</span>;
}

export function RunSpendSection({
  spend,
  decision,
}: {
  spend: GraphLogRunSpend;
  decision: EffortsDecision | null;
}) {
  return (
    <div className="text-sm" style={{ marginTop: "12px" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="font-bold" style={{ margin: 0 }}>
          Spend {spend.attribution === "none" ? "" : formatUsd(spend.estimatedCostUsd)}
          {spend.unpricedCallCount > 0 ? "+" : ""}
        </p>
        <span className="text-xs font-mono subtle-text">
          estimate, prices as of {PRICING_AS_OF}
          {spend.pricingStale ? ` (${spend.pricingAgeDays} days old, re-check them)` : ""}
        </span>
      </div>
      {decision && (
        <p style={{ margin: 0, marginTop: "4px" }}>{decisionSentence(decision)}</p>
      )}
      {spend.attribution === "none" ? (
        <p className="subtle-text" style={{ margin: 0, marginTop: "4px" }}>
          No model calls recorded for this run.
        </p>
      ) : (
        <div style={{ marginTop: "6px" }}>
          {spend.byStage.map((s) => (
            <div
              key={s.stage}
              className="flex items-center justify-between flex-wrap gap-2 py-1"
              style={{ borderBottom: "1px solid var(--midground)" }}
            >
              <span className="text-xs font-mono">
                {STAGE_LABEL[s.stage] ?? s.stage}
                <span className="subtle-text"> · {s.models.join(", ") || "no model"}</span>
              </span>
              <span className="text-xs font-mono subtle-text">
                {s.callCount} call(s)
                {s.errorCount > 0 ? `, ${s.errorCount} failed` : ""} · in {formatTokens(s.inputTokens)} · out{" "}
                {formatTokens(s.outputTokens)} · cache read {formatTokens(s.cacheReadTokens)} · cache write{" "}
                {formatTokens(s.cacheWriteTokens)} · <strong>{formatUsd(s.estimatedCostUsd)}</strong>
              </span>
            </div>
          ))}
          {spend.unpricedCallCount > 0 && (
            <p className="text-xs subtle-text" style={{ margin: 0, marginTop: "4px" }}>
              {spend.unpricedCallCount} call(s) used a model with no price in the table, so the total is a floor.
            </p>
          )}
          {spend.attribution === "time-window" && (
            <p className="text-xs subtle-text" style={{ margin: 0, marginTop: "4px" }}>
              Matched by time: this run predates usage rows that carry their run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
