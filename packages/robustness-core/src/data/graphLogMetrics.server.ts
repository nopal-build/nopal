/**
 * GraphLog usage tracking — a two-table split (a short-lived raw event
 * log, a durable daily rollup) on GraphLog's own tables
 * (`graphlog_usage_events`/`graphlog_usage_daily`). `classifyLlmError`/
 * its error-kind union, and `graphLogDefaults.server.ts`'s own
 * `SKIP_MARKER`, are small, self-contained, deliberate duplications
 * rather than shared cross-file dependencies.
 *
 * `getGraphLogUsageSummary` (read by `/fruits/maker`'s "GraphLog Usage"
 * section and `/fruits/maker/graphlog`) and `pruneOldGraphLogUsageEvents`
 * (a `CRON_SECRET`-gated cleanup route) were added once the Maker
 * GraphLog page this file's own header used to say was a precondition
 * actually existed.
 */

import { RecordId } from "surrealdb";
import { query, upsert, remove, formatRecord, defineTable, type Data } from "./generic.server";
import type { LlmUsage } from "./llmProvider";
import { estimateCostUsd, isPricingStale, pricingAgeDays } from "./llmPricing";

export type GraphLogStage = "sync-knowledge" | "sync-graph" | "graph-structure" | "graph-project-view";
export type GraphLogEventKind =
  | "photo-knowledge"
  | "text-knowledge"
  | "graph-extract"
  | "graph-structure"
  | "project-view";
export type GraphLogOutcome = "success" | "skipped" | "error";
export type GraphLogErrorKind = "rate_limited" | "oversized_image" | "incomplete" | "other";

/** Best-effort classification of a thrown LLM-call error — never store
 * the raw message (could contain sensitive prompt/response content). */
export function classifyGraphLogError(err: unknown): GraphLogErrorKind {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429) return "rate_limited";
  const message = err instanceof Error ? err.message : String(err);
  if (/exceeds .* maximum/i.test(message) || /too large/i.test(message)) return "oversized_image";
  return "other";
}

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await defineTable("graphlog_usage_events");
  await defineTable("graphlog_usage_daily");
  tablesEnsured = true;
}

export type GraphLogUsageEvent = Data & {
  date: string; // YYYY-MM-DD
  human_id: string;
  project_folder_id: string;
  stage: GraphLogStage;
  kind: GraphLogEventKind;
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  duration_ms: number;
  outcome: GraphLogOutcome;
  error_kind?: GraphLogErrorKind | null;
  created_at: string;
};

export type GraphLogUsageDaily = Data & {
  date: string;
  human_id: string;
  project_folder_id: string;
  stage: GraphLogStage;
  model: string;
  call_count: number;
  success_count: number;
  skipped_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  duration_ms: number;
  max_duration_ms: number;
  updated_at: string;
};

const UNKNOWN_MODEL = "unknown";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyBucketId(
  date: string,
  humanId: string,
  projectFolderId: string,
  stage: GraphLogStage,
  model: string,
): string {
  return `${date}_${humanId}_${projectFolderId}_${stage}_${model}`;
}

export type RecordGraphLogUsageInput = {
  humanId: string;
  projectFolderId: string;
  stage: GraphLogStage;
  kind: GraphLogEventKind;
  model?: string | null;
  usage?: LlmUsage;
  durationMs: number;
  outcome: GraphLogOutcome;
  errorKind?: GraphLogErrorKind | null;
};

/**
 * Records one GraphLog LLM call (or no-op) — writes the raw event AND
 * increments the durable daily rollup in the same call. Never throws — a
 * metrics write failing must never break the actual GraphLog run it's
 * describing.
 */
export async function recordGraphLogUsage(input: RecordGraphLogUsageInput): Promise<void> {
  try {
    await ensureTables();
    const date = todayUtc();
    const now = new Date().toISOString();
    const inputTokens = input.usage?.inputTokens ?? 0;
    const outputTokens = input.usage?.outputTokens ?? 0;
    const cacheReadTokens = input.usage?.cacheReadTokens ?? 0;
    const cacheWriteTokens = input.usage?.cacheWriteTokens ?? 0;
    const model = input.model ?? UNKNOWN_MODEL;

    await upsert("graphlog_usage_events", {
      date,
      human_id: input.humanId,
      project_folder_id: input.projectFolderId,
      stage: input.stage,
      kind: input.kind,
      model: input.model ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      duration_ms: input.durationMs,
      outcome: input.outcome,
      error_kind: input.outcome === "error" ? (input.errorKind ?? "other") : null,
      created_at: now,
    });

    const bucketId = dailyBucketId(date, input.humanId, input.projectFolderId, input.stage, model);
    const existingResult = await query<[GraphLogUsageDaily[]]>(
      `SELECT * FROM graphlog_usage_daily WHERE id = $rid`,
      { rid: new RecordId("graphlog_usage_daily", bucketId) },
    );
    const existing = existingResult?.[0]?.[0] ? formatRecord(existingResult[0][0]) : null;

    await upsert(new RecordId("graphlog_usage_daily", bucketId), {
      date,
      human_id: input.humanId,
      project_folder_id: input.projectFolderId,
      stage: input.stage,
      model,
      call_count: (existing?.call_count ?? 0) + 1,
      success_count: (existing?.success_count ?? 0) + (input.outcome === "success" ? 1 : 0),
      skipped_count: (existing?.skipped_count ?? 0) + (input.outcome === "skipped" ? 1 : 0),
      error_count: (existing?.error_count ?? 0) + (input.outcome === "error" ? 1 : 0),
      input_tokens: (existing?.input_tokens ?? 0) + inputTokens,
      output_tokens: (existing?.output_tokens ?? 0) + outputTokens,
      cache_read_tokens: (existing?.cache_read_tokens ?? 0) + cacheReadTokens,
      cache_write_tokens: (existing?.cache_write_tokens ?? 0) + cacheWriteTokens,
      duration_ms: (existing?.duration_ms ?? 0) + input.durationMs,
      max_duration_ms: Math.max(existing?.max_duration_ms ?? 0, input.durationMs),
      updated_at: now,
    });
  } catch (err) {
    console.error("GraphLog usage tracking failed (non-fatal):", err);
  }
}

const DEFAULT_RETENTION_DAYS = 30;

/** Deletes raw `graphlog_usage_events` rows older than `retentionDays` —
 * safe to run anytime, since the durable daily rollup those events already
 * incremented is entirely independent of their continued existence. */
export async function pruneOldGraphLogUsageEvents(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<{ deleted: number }> {
  await ensureTables();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const result = await query<[GraphLogUsageEvent[]]>(
    `SELECT id FROM graphlog_usage_events WHERE date < $cutoff`,
    { cutoff },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);
  for (const row of rows) {
    await remove("graphlog_usage_events", row._id);
  }
  return { deleted: rows.length };
}

// ─── Aggregation for the /fruits/maker dashboards ──────────────────

type UsageTotals = { callCount: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };

export type GraphLogUsageSummary = {
  callCount: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  avgDurationMs: number;
  maxDurationMs: number;
  /** Sum of `estimateCostUsd` (`llmPricing.ts`) applied per bucket's own
   * model — a rough gauge, not reconciled against real Anthropic billing.
   * See `pricingStale`/`pricingAgeDays` before trusting it blindly. */
  estimatedCostUsd: number;
  pricingStale: boolean;
  pricingAgeDays: number;
  /** Per-stage totals, INCLUDING cache tokens — 1.1 made those real (they
   * were accumulated nowhere and stored as zero, which is why the
   * dashboard read a 0% cache hit rate across every call), and 1.7 wants
   * them broken out per stage because the three stages have different
   * cache profiles: `sync-graph` and `graph-structure` both carry a large
   * stable system prompt worth caching hard, while `graph-project-view`
   * doesn't pass `cacheSystemPrompt` at all and relies on the provider's
   * own multi-turn heuristic. That difference is invisible in a single
   * total. */
  byStage: Record<
    GraphLogStage,
    {
      callCount: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      durationMs: number;
      estimatedCostUsd: number;
    }
  >;
  /** 1.7's two derived rates, and the run facts they come from.
   *
   * Cost was always a TOTAL, which says nothing on its own: a bigger total
   * could mean a busier week or a more expensive pipeline and there was no
   * way to tell. These make it a rate.
   *
   * `costPerNodeByStage` divides each stage's cost in the range by the
   * nodes WRITTEN in the range. Note what that means per stage, because
   * the three are deliberately different shapes and the number is only
   * interpretable if you know which: `sync-graph` should track nodes
   * fairly directly but climb as the graph grows (all of
   * `graph-structure.md` rides in its system prompt and is resent every
   * turn, so its cost is roughly nodes-that-day times graph-size);
   * `graph-structure` is the same shape but gentler; `graph-project-view`
   * is bounded by design (`NODE_PREFETCH_BUDGET`) and should stay roughly
   * FLAT as the graph grows, which means its cost-per-node should FALL on
   * a busy day rather than hold steady. A view stage whose cost per node
   * is constant is a sign its budget stopped bounding it.
   *
   * Null when nothing was written in the range — a rate with a zero
   * denominator is not zero, it is unknown, and showing 0 would read as
   * "free". */
  nodesWrittenInRange: number;
  runCount: number;
  costPerNodeByStage: Record<GraphLogStage, number | null> | null;
  costPerRunByProject: ({ projectFolderId: string; runCount: number; costPerRunUsd: number })[];
  byProject: ({ projectFolderId: string } & UsageTotals)[];
  byHuman: ({ humanId: string } & UsageTotals)[];
  byDate: ({ date: string } & UsageTotals)[];
};

function startOfRange(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

/** Just the two run columns this rollup needs — deliberately not the whole
 * `GraphLogRun`, so a change to that row's shape can't quietly widen what
 * this query pulls back on every dashboard load. */
type GraphLogRunCounts = { project_folder_id: string; nodes_written: number | null };

function emptyStageTotals(): GraphLogUsageSummary["byStage"][GraphLogStage] {
  return {
    callCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 0,
    estimatedCostUsd: 0,
  };
}

function emptyTotals(): UsageTotals {
  return { callCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

/** Reads entirely from the durable daily rollup — works the same whether
 * the underlying raw events for that range still exist or were already
 * pruned. */
export async function getGraphLogUsageSummary(days: number): Promise<GraphLogUsageSummary> {
  await ensureTables();
  const since = startOfRange(days);
  const result = await query<[GraphLogUsageDaily[]]>(
    `SELECT * FROM graphlog_usage_daily WHERE date >= $since ORDER BY date ASC`,
    { since },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);

  const summary: GraphLogUsageSummary = {
    callCount: 0,
    successCount: 0,
    skippedCount: 0,
    errorCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    avgDurationMs: 0,
    maxDurationMs: 0,
    estimatedCostUsd: 0,
    pricingStale: isPricingStale(),
    pricingAgeDays: pricingAgeDays(),
    byStage: {
      "sync-knowledge": emptyStageTotals(),
      "sync-graph": emptyStageTotals(),
      "graph-structure": emptyStageTotals(),
      "graph-project-view": emptyStageTotals(),
    },
    nodesWrittenInRange: 0,
    runCount: 0,
    costPerNodeByStage: null,
    costPerRunByProject: [],
    byProject: [],
    byHuman: [],
    byDate: [],
  };

  const byProject = new Map<string, UsageTotals>();
  const byHuman = new Map<string, UsageTotals>();
  const byDate = new Map<string, UsageTotals>();
  let totalDurationMs = 0;

  for (const row of rows) {
    const rowCacheRead = row.cache_read_tokens ?? 0;
    const rowCacheWrite = row.cache_write_tokens ?? 0;
    const rowCost = estimateCostUsd(row.model, row.input_tokens, row.output_tokens, rowCacheRead, rowCacheWrite) ?? 0;

    summary.callCount += row.call_count;
    summary.successCount += row.success_count;
    summary.skippedCount += row.skipped_count;
    summary.errorCount += row.error_count;
    summary.inputTokens += row.input_tokens;
    summary.outputTokens += row.output_tokens;
    summary.cacheReadTokens += rowCacheRead;
    summary.cacheWriteTokens += rowCacheWrite;
    summary.estimatedCostUsd += rowCost;
    totalDurationMs += row.duration_ms;
    summary.maxDurationMs = Math.max(summary.maxDurationMs, row.max_duration_ms);

    const stageBucket = summary.byStage[row.stage];
    stageBucket.callCount += row.call_count;
    stageBucket.inputTokens += row.input_tokens;
    stageBucket.outputTokens += row.output_tokens;
    stageBucket.cacheReadTokens += rowCacheRead;
    stageBucket.cacheWriteTokens += rowCacheWrite;
    stageBucket.durationMs += row.duration_ms;
    stageBucket.estimatedCostUsd += rowCost;

    for (const [map, key] of [
      [byProject, row.project_folder_id],
      [byHuman, row.human_id],
      [byDate, row.date],
    ] as const) {
      const existing = map.get(key) ?? emptyTotals();
      existing.callCount += row.call_count;
      existing.inputTokens += row.input_tokens;
      existing.outputTokens += row.output_tokens;
      existing.estimatedCostUsd += rowCost;
      map.set(key, existing);
    }
  }

  // The denominators live on the RUN rows (see `GraphLogRun`'s own
  // `nodes_written` note for why they're run-scoped rather than bucketed
  // into the usage rollup), so they're read separately and joined here
  // rather than being available on a usage row.
  const runRows = await query<[GraphLogRunCounts[]]>(
    `SELECT project_folder_id, nodes_written FROM graphlog_runs
     WHERE started_at >= $since AND ok = true`,
    { since },
  );
  // No `formatRecord` here: this SELECT names two columns, so the rows
  // carry no `id` for it to rewrite, and running it would only widen the
  // type back to `Data`.
  const runs: GraphLogRunCounts[] = runRows?.[0] ?? [];
  const runsByProject = new Map<string, number>();
  for (const r of runs) {
    summary.runCount += 1;
    summary.nodesWrittenInRange += r.nodes_written ?? 0;
    runsByProject.set(r.project_folder_id, (runsByProject.get(r.project_folder_id) ?? 0) + 1);
  }

  if (summary.nodesWrittenInRange > 0) {
    summary.costPerNodeByStage = {
      "sync-knowledge": summary.byStage["sync-knowledge"].estimatedCostUsd / summary.nodesWrittenInRange,
      "sync-graph": summary.byStage["sync-graph"].estimatedCostUsd / summary.nodesWrittenInRange,
      "graph-structure": summary.byStage["graph-structure"].estimatedCostUsd / summary.nodesWrittenInRange,
      "graph-project-view":
        summary.byStage["graph-project-view"].estimatedCostUsd / summary.nodesWrittenInRange,
    };
  }

  summary.avgDurationMs = summary.callCount > 0 ? Math.round(totalDurationMs / summary.callCount) : 0;
  summary.byProject = [...byProject.entries()]
    .map(([projectFolderId, v]) => ({ projectFolderId, ...v }))
    .sort((a, b) => b.callCount - a.callCount);
  summary.costPerRunByProject = [...byProject.entries()]
    .map(([projectFolderId, v]) => {
      const runCount = runsByProject.get(projectFolderId) ?? 0;
      return {
        projectFolderId,
        runCount,
        costPerRunUsd: runCount > 0 ? v.estimatedCostUsd / runCount : 0,
      };
    })
    .filter((p) => p.runCount > 0)
    .sort((a, b) => b.costPerRunUsd - a.costPerRunUsd);
  summary.byHuman = [...byHuman.entries()]
    .map(([humanId, v]) => ({ humanId, ...v }))
    .sort((a, b) => b.callCount - a.callCount);
  summary.byDate = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return summary;
}
