/**
 * PhyLog usage tracking — tokens and timing ONLY, deliberately built for
 * "understand aggregate usage over time," not a forensic log of what any
 * one run did. Two tables, same "cheap durable rollup vs. short-lived raw
 * detail" split `vault_folders.project_status`/etc. use elsewhere in this
 * app, just inverted here (the ROLLUP is the thing kept forever; the raw
 * rows are the disposable ones):
 *
 *   - `phylog_usage_events` — one row per LLM call PhyLog makes (or would
 *     have made, for a "skipped" outcome). Deliberately narrow: no file
 *     names, no prompt/response content, no raw error text — just enough
 *     to know WHERE the tokens/time went (`stage`/`kind`/`model`) and
 *     whether it worked. Short-lived on purpose (`pruneOldPhylogUsageEvents`)
 *     — kept only long enough to debug something recent, never meant to
 *     be the long-term source of truth.
 *   - `phylog_usage_daily` — one row per (date, human, project, stage,
 *     model), incremented at the SAME time every raw event is written.
 *     This is the durable table: tiny (bounded by active humans/projects/
 *     days/models, not by files processed), kept indefinitely, and what
 *     the `/fruits/maker`/`/fruits/maker/phylog` dashboards actually
 *     read — so pruning the raw table never loses the ability to answer
 *     "how much are we spending, and how long is this taking, over time."
 *     `model` is part of the bucket key (not just a stored field) so a
 *     future model change is reflected as a NEW bucket rather than
 *     silently blending two different price points into one row — see
 *     `llmPricing.ts`'s `estimateCostUsd`, applied per-row at aggregation
 *     time in `getPhylogUsageSummary`.
 *
 * KNOWN LIMITATION: the daily rollup stores SUMS (tokens, duration) and a
 * `maxDurationMs` per bucket, not a real distribution — a true p95/p99
 * needs the raw events, which are pruned after `DEFAULT_RETENTION_DAYS`.
 * `maxDurationMs` is a cheap "worst case that day" signal in place of a
 * real percentile; revisit if tail latency ever needs closer tracking
 * than that.
 */

import { RecordId } from "surrealdb";
import { query, upsert, remove, formatRecord, defineTable, type Data } from "./generic.server";
import type { LlmUsage } from "./llmProvider";
import { estimateCostUsd, isPricingStale, pricingAgeDays } from "./llmPricing";

export type PhylogStage = "pre-capture" | "capture" | "post-capture";
export type PhylogEventKind = "photo-summary" | "text-summary" | "organize" | "pipeline";
export type PhylogOutcome = "success" | "skipped" | "error";
/** Short, closed categories — never the raw error message (see this
 * file's own module doc on why). */
export type PhylogErrorKind = "rate_limited" | "oversized_image" | "other";

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await defineTable("phylog_usage_events");
  await defineTable("phylog_usage_daily");
  tablesEnsured = true;
}

export type PhylogUsageEvent = Data & {
  date: string; // YYYY-MM-DD
  human_id: string;
  project_folder_id: string;
  stage: PhylogStage;
  kind: PhylogEventKind;
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  outcome: PhylogOutcome;
  error_kind?: PhylogErrorKind | null;
  created_at: string;
};

export type PhylogUsageDaily = Data & {
  date: string;
  human_id: string;
  project_folder_id: string;
  stage: PhylogStage;
  model: string;
  call_count: number;
  success_count: number;
  skipped_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  max_duration_ms: number;
  updated_at: string;
};

const UNKNOWN_MODEL = "unknown";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Best-effort classification of a thrown LLM-call error into one of a
 * small, closed set of categories — deliberately never the raw message
 * (see this file's own module doc on why). Anthropic's SDK throws
 * `APIError` subclasses carrying a `status`; anything else (a plain
 * download/network error, etc.) falls into `"other"`. */
export function classifyLlmError(err: unknown): PhylogErrorKind {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429) return "rate_limited";
  const message = err instanceof Error ? err.message : String(err);
  if (/exceeds .* maximum/i.test(message) || /too large/i.test(message)) return "oversized_image";
  return "other";
}

/** Deterministic so concurrent writes for the same (date, human, project,
 * stage, model) bucket always target the same row — same "stable id, no
 * duplicate buckets" trick `systemVaultFolderKey` uses elsewhere. A
 * concurrent increment can still under/over-count by a call or two under
 * real concurrency (read-then-write, not atomic) — an accepted,
 * deliberately-not-solved tradeoff for aggregate usage stats, same spirit
 * as the check-then-create races already documented on `vault.server.ts`'s
 * `getOrCreateVaultFolder`. */
function dailyBucketId(
  date: string,
  humanId: string,
  projectFolderId: string,
  stage: PhylogStage,
  model: string,
): string {
  return `${date}_${humanId}_${projectFolderId}_${stage}_${model}`;
}

export type RecordPhylogUsageInput = {
  humanId: string;
  projectFolderId: string;
  stage: PhylogStage;
  kind: PhylogEventKind;
  model?: string | null;
  usage?: LlmUsage;
  durationMs: number;
  outcome: PhylogOutcome;
  errorKind?: PhylogErrorKind | null;
};

/**
 * Records one PhyLog LLM call (or no-op) — writes the raw event AND
 * increments the durable daily rollup in the same call, so the rollup is
 * always current with no separate batch step. Never throws — a metrics
 * write failing must never break the actual PhyLog run it's describing.
 */
export async function recordPhylogUsage(input: RecordPhylogUsageInput): Promise<void> {
  try {
    await ensureTables();
    const date = todayUtc();
    const now = new Date().toISOString();
    const inputTokens = input.usage?.inputTokens ?? 0;
    const outputTokens = input.usage?.outputTokens ?? 0;
    const model = input.model ?? UNKNOWN_MODEL;

    await upsert("phylog_usage_events", {
      date,
      human_id: input.humanId,
      project_folder_id: input.projectFolderId,
      stage: input.stage,
      kind: input.kind,
      model: input.model ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      duration_ms: input.durationMs,
      outcome: input.outcome,
      error_kind: input.outcome === "error" ? input.errorKind ?? "other" : null,
      created_at: now,
    });

    const bucketId = dailyBucketId(date, input.humanId, input.projectFolderId, input.stage, model);
    const existingResult = await query<[PhylogUsageDaily[]]>(
      `SELECT * FROM phylog_usage_daily WHERE id = $rid`,
      { rid: new RecordId("phylog_usage_daily", bucketId) },
    );
    const existing = existingResult?.[0]?.[0] ? formatRecord(existingResult[0][0]) : null;

    await upsert(new RecordId("phylog_usage_daily", bucketId), {
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
      duration_ms: (existing?.duration_ms ?? 0) + input.durationMs,
      max_duration_ms: Math.max(existing?.max_duration_ms ?? 0, input.durationMs),
      updated_at: now,
    });
  } catch (err) {
    console.error("PhyLog usage tracking failed (non-fatal):", err);
  }
}

const DEFAULT_RETENTION_DAYS = 30;

/** Deletes raw `phylog_usage_events` rows older than `retentionDays` —
 * safe to run anytime, since the durable daily rollup those events already
 * incremented is entirely independent of their continued existence. Wired
 * into `POST /api/phylog/usage-cleanup` (same `CRON_SECRET` cron pattern
 * as `archive-cleanup`/`trash-cleanup`). */
export async function pruneOldPhylogUsageEvents(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<{ deleted: number }> {
  await ensureTables();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const result = await query<[PhylogUsageEvent[]]>(
    `SELECT id FROM phylog_usage_events WHERE date < $cutoff`,
    { cutoff },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);
  for (const row of rows) {
    await remove("phylog_usage_events", row._id);
  }
  return { deleted: rows.length };
}

// ─── Aggregation for the /fruits/maker dashboards ──────────────────────

type UsageTotals = { callCount: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };

export type PhylogUsageSummary = {
  callCount: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number;
  maxDurationMs: number;
  /** Sum of `estimateCostUsd` (`llmPricing.ts`) applied per bucket's own
   * model — a rough gauge, not reconciled against real Anthropic billing.
   * See `pricingStale`/`pricingAgeDays` before trusting it blindly. */
  estimatedCostUsd: number;
  pricingStale: boolean;
  pricingAgeDays: number;
  byStage: Record<PhylogStage, { callCount: number; inputTokens: number; outputTokens: number; durationMs: number; estimatedCostUsd: number }>;
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
 * pruned. */
export async function getPhylogUsageSummary(days: number): Promise<PhylogUsageSummary> {
  await ensureTables();
  const since = startOfRange(days);
  const result = await query<[PhylogUsageDaily[]]>(
    `SELECT * FROM phylog_usage_daily WHERE date >= $since ORDER BY date ASC`,
    { since },
  );
  const rows = (result?.[0] ?? []).map(formatRecord);

  const summary: PhylogUsageSummary = {
    callCount: 0,
    successCount: 0,
    skippedCount: 0,
    errorCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    avgDurationMs: 0,
    maxDurationMs: 0,
    estimatedCostUsd: 0,
    pricingStale: isPricingStale(),
    pricingAgeDays: pricingAgeDays(),
    byStage: {
      "pre-capture": { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
      capture: { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
      "post-capture": { callCount: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
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
    const rowCost = estimateCostUsd(row.model, row.input_tokens, row.output_tokens) ?? 0;

    summary.callCount += row.call_count;
    summary.successCount += row.success_count;
    summary.skippedCount += row.skipped_count;
    summary.errorCount += row.error_count;
    summary.inputTokens += row.input_tokens;
    summary.outputTokens += row.output_tokens;
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
