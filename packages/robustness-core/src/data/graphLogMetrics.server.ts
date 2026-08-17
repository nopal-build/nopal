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
 * Deliberately minimal for now: just `recordGraphLogUsage` (what
 * `syncKnowledge.server.ts` needs immediately). No `getGraphLogUsageSummary`/
 * dashboard/pruning-cron yet — those are worth building once a real Maker
 * page exists to review them from (mirroring PhyLog's own history: it
 * shipped usage tracking well before `/fruits/maker/phylog` existed too).
 */

import { RecordId } from "surrealdb";
import { query, upsert, formatRecord, defineTable, type Data } from "./generic.server";
import type { LlmUsage } from "./llmProvider";

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
