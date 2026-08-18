/**
 * GraphLog usage tracking — mirrors `phylogMetrics.server.ts`'s shape
 * closely (same two-table split: a short-lived raw event log, a durable
 * daily rollup), but on GraphLog's own tables (`graphlog_usage_events`/
 * `graphlog_usage_daily`) — kept fully independent of PhyLog's own tables
 * so retiring PhyLog later (see the `graphlog` skill) never touches this
 * file. `classifyLlmError`/its error-kind union are duplicated here rather
 * than imported from `phylogMetrics.server.ts` for the same reason
 * `graphLogDefaults.server.ts` duplicates PhyLog's `SKIP_MARKER` — small,
 * self-contained, not worth a cross-pipeline dependency.
 *
 * Also mirrors PhyLog's aggregation layer: `getGraphLogUsageSummary`
 * (read by `/fruits/maker`'s "GraphLog Usage" section and
 * `/fruits/maker/graphlog`) and `pruneOldGraphLogUsageEvents` (same
 * `CRON_SECRET` cleanup pattern PhyLog's own events table uses) — added
 * once the Maker GraphLog page this file's own header used to say was a
 * precondition actually existed.
 */

import { RecordId } from "surrealdb";
import { query, upsert, remove, formatRecord, defineTable, type Data } from "./generic.server";
import type { LlmUsage } from "./llmProvider";
import { estimateCostUsd, isPricingStale, pricingAgeDays } from "./llmPricing";

export type GraphLogStage = "sync-knowledge" | "sync-graph" | "graph-project-view";
export type GraphLogEventKind =
  | "photo-knowledge"
  | "text-knowledge"
  | "graph-extract"
  | "project-view";
export type GraphLogOutcome = "success" | "skipped" | "error";
export type GraphLogErrorKind = "rate_limited" | "oversized_image" | "incomplete" | "other";

/** Best-effort classification of a thrown LLM-call error — see
 * `phylogMetrics.server.ts`'s identical `classifyLlmError` for the full
 * rationale (never store the raw message). */
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
  byStage: Record<GraphLogStage, { callCount: number; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number }>;
  byProject: ({ projectFolderId: string } & UsageTotals)[];
  byHuman: ({ humanId: string } & UsageTotals)[];
  byDate: ({ date: string } & UsageTotals)[];
};

function startOfRange(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

function emptyTotals(): UsageTotals {
  return { callCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

/** Reads entirely from the durable daily rollup — works the same whether
 * the underlying raw events for that range still exist or were already
 * pruned. Mirrors `phylogMetrics.server.ts`'s `getPhylogUsageSummary`
 * exactly, just against GraphLog's own tables/stage set. */
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
      "sync-knowledge": { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
      "sync-graph": { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
      "graph-project-view": { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
    },
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

  summary.avgDurationMs = summary.callCount > 0 ? Math.round(totalDurationMs / summary.callCount) : 0;
  summary.byProject = [...byProject.entries()]
    .map(([projectFolderId, v]) => ({ projectFolderId, ...v }))
    .sort((a, b) => b.callCount - a.callCount);
  summary.byHuman = [...byHuman.entries()]
    .map(([humanId, v]) => ({ humanId, ...v }))
    .sort((a, b) => b.callCount - a.callCount);
  summary.byDate = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return summary;
}
