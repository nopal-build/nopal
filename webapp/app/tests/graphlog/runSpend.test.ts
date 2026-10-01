/**
 * What one run spent (`graphLogMetrics.server.ts`, "Spend per run") and
 * what it decided about the Efforts page (`effortsDecisionFromEvents`).
 * The attribution rule is the part that can quietly lie: a usage row
 * tagged with its run is exact; an untagged row is matched by project and
 * time only for runs that have no tagged rows at all.
 */
import { describe, expect, it } from "vitest";
import {
  summarizeRunSpend,
  usageRowsForRun,
  type GraphLogUsageEvent,
  type RunWindow,
} from "robustness-core/data/graphLogMetrics.server";
import { effortsDecisionFromEvents, type GraphLogRunEvent } from "robustness-core/data/graphLogPerf.server";
import { estimateCostUsd } from "robustness-core/data/llmPricing";

const PROJECT = "proj1";

function row(over: Partial<GraphLogUsageEvent>): GraphLogUsageEvent {
  return {
    _id: Math.random().toString(36).slice(2),
    date: "2026-10-01",
    run_id: null,
    human_id: "h1",
    project_folder_id: PROJECT,
    stage: "sync-graph",
    kind: "graph-extract",
    model: "claude-sonnet-5",
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    duration_ms: 10,
    outcome: "success",
    created_at: "2026-10-01T03:00:30.000Z",
    ...over,
  } as GraphLogUsageEvent;
}

const run: RunWindow = {
  _id: "run-a",
  project_folder_id: PROJECT,
  started_at: "2026-10-01T03:00:00.000Z",
  finished_at: "2026-10-01T03:05:00.000Z",
};

describe("which usage rows belong to a run", () => {
  it("takes rows tagged with the run, and only those, once any exist", () => {
    const tagged = row({ run_id: "run-a" });
    const untaggedInWindow = row({});
    const otherRun = row({ run_id: "run-b" });
    const picked = usageRowsForRun(run, [tagged, untaggedInWindow, otherRun]);
    expect(picked.attribution).toBe("run");
    expect(picked.rows).toEqual([tagged]);
  });

  it("falls back to the project's untagged rows inside the run's window", () => {
    const inside = row({});
    const before = row({ created_at: "2026-10-01T02:59:59.000Z" });
    const after = row({ created_at: "2026-10-01T03:05:01.000Z" });
    const otherProject = row({ project_folder_id: "proj2" });
    const taggedElsewhere = row({ run_id: "run-b" });
    const picked = usageRowsForRun(run, [inside, before, after, otherProject, taggedElsewhere]);
    expect(picked.attribution).toBe("time-window");
    expect(picked.rows).toEqual([inside]);
  });

  it("says none when the run made no model call", () => {
    expect(usageRowsForRun(run, [row({ project_folder_id: "proj2" })])).toEqual({ attribution: "none", rows: [] });
  });
});

describe("a run's spend", () => {
  it("totals by stage in pipeline order, pricing each row by its own model", () => {
    const rows = [
      row({ stage: "graph-project-view", kind: "project-view", model: "claude-fable-5-1", input_tokens: 20_000, output_tokens: 3_000, cache_read_tokens: 50_000 }),
      row({ stage: "sync-graph", input_tokens: 5_000, output_tokens: 500, cache_write_tokens: 8_000 }),
      row({ stage: "sync-graph", input_tokens: 4_000, output_tokens: 400, cache_read_tokens: 8_000 }),
    ];
    const spend = summarizeRunSpend("run-a", "run", rows);
    expect(spend.byStage.map((s) => s.stage)).toEqual(["sync-graph", "graph-project-view"]);
    expect(spend.byStage[0].callCount).toBe(2);
    expect(spend.byStage[0].inputTokens).toBe(9_000);
    const expected = rows.reduce(
      (sum, r) => sum + (estimateCostUsd(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens) ?? 0),
      0,
    );
    expect(spend.estimatedCostUsd).toBeCloseTo(expected, 10);
    expect(spend.unpricedCallCount).toBe(0);
  });

  it("counts a call at an unknown price as unpriced, but not a failed call that spent nothing", () => {
    const spend = summarizeRunSpend("run-a", "run", [
      row({ model: "claude-unlisted" }),
      row({ model: null, input_tokens: 0, output_tokens: 0, outcome: "error" }),
    ]);
    expect(spend.unpricedCallCount).toBe(1);
    expect(spend.byStage[0].errorCount).toBe(1);
  });
});

describe("what the run decided about Efforts", () => {
  const ev = (over: Partial<GraphLogRunEvent>): GraphLogRunEvent =>
    ({
      _id: "e",
      run_id: "run-a",
      seq: 0,
      process: "graph-project-view",
      type: "fn",
      name: "rebuildDecision",
      params: null,
      duration_ms: 0,
      outcome: "ok",
      started_at: "2026-10-01T03:04:00.000Z",
      ...over,
    }) as GraphLogRunEvent;

  it("reads the decision event", () => {
    expect(
      effortsDecisionFromEvents([
        ev({ process: "sync-graph", name: "complete" }),
        ev({ params: { reason: "unread-marks", rebuilt: true, unreadNotes: 0, unreadMarks: 2 } }),
      ]),
    ).toEqual({ rebuilt: true, reason: "unread-marks", unreadNotes: 0, unreadMarks: 2 });
  });

  it("is null when the stage never reached the decision", () => {
    expect(effortsDecisionFromEvents([ev({ process: "sync-graph", name: "complete" })])).toBeNull();
  });
});
