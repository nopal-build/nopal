/**
 * GraphLog performance tracing — a per-run TIMELINE of real, wall-clock-
 * measured events (LLM calls, external API/storage calls, plain function
 * calls), completely separate from `graphLogMetrics.server.ts`'s own
 * token/cost usage tracking. That file answers "how much did this cost
 * and how many tokens did it use, aggregated per day"; this file answers
 * "what actually happened, in what order, and how long did each individual
 * thing take, for ONE specific run" — the two are complementary, not
 * overlapping (a run's LLM-call events here duplicate none of that file's
 * own token/cost bookkeeping).
 *
 * Every duration recorded here is measured by CODE wrapping a real call
 * (`Date.now()` before/after) — never a number the model itself reports.
 * There is no mechanism here for an LLM to self-time; that's a deliberate
 * choice, not an oversight (see the `graphlog` skill's own perf section).
 *
 * A "run" is one GraphLog job execution (`packages/worker/worker.ts`'s
 * `processGraphLogJob`) — the SAME id BullMQ already assigned that job
 * (`job.id`) is reused directly as this run's own record id, so a run here
 * always corresponds 1:1 with a real queued job, no separate id scheme to
 * keep in sync. A `run --project <path>` job's own five-stage pipeline
 * (`graphLogAgent.server.ts`) shares ONE run/timeline across all five
 * stages, tagging each event with which stage (`process`) it came from;
 * an independently-run single stage's own job just produces a shorter
 * timeline with one process tag throughout.
 *
 * Two tables, mirroring `graphLogMetrics.server.ts`'s own two-table shape
 * (a durable summary row, a detail log) but for a different axis (time
 * sequence, not daily rollup): `graphlog_runs` (one row per run, started/
 * finished/ok/error) and `graphlog_run_events` (one row per timed event
 * within a run, ordered by `seq`). Never throws on a recording failure —
 * same "metrics must never break the real work they're describing"
 * convention `recordGraphLogUsage` already established; a perf-tracking
 * bug should degrade to "this run's timeline is incomplete," never to
 * "this run failed."
 */

import { RecordId } from "surrealdb";
import { query, remove, upsert, formatRecord, defineTable, type Data } from "./generic.server";

export type GraphLogPerfEventType = "api" | "llm" | "fn" | "other";

export type GraphLogRun = Data & {
  human_id: string;
  project_folder_id: string;
  /** The GraphLog job name that produced this run — see `GraphLogJobName`
   * (`graphLogQueue.server.ts`): "run", "sync-graph", "graph-structure",
   * etc. For a "run" job this is the umbrella label; individual events
   * within it are tagged with their OWN stage via `process`. */
  job_name: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  /** `null` while still in progress. */
  ok: boolean | null;
  error: string | null;
};

export type GraphLogRunEvent = Data & {
  run_id: string;
  /** Monotonic within one run — the authoritative ordering (timestamps
   * alone can collide for two very fast, back-to-back events). */
  seq: number;
  /** Which pipeline stage this event happened during — e.g.
   * "daily-log-sync", "sync-knowledge", "sync-graph", "graph-structure",
   * "graph-project-view", or a deterministic job's own name
   * ("migrate-to-n02", "reset", ...). */
  process: string;
  type: GraphLogPerfEventType;
  /** A simple identifier for the specific thing that ran — e.g.
   * "complete", "describePhoto", "downloadFileBytes", "runSyncGraph". */
  name: string;
  /** Whatever concrete parameters that call actually took — e.g.
   * `{ date: "2026-08-13" }`, `{ fileId: "..." }`, `{ batchIndex: 0 }`.
   * Deliberately freeform (never schema'd further than "an object") since
   * every event kind's own useful params differ. */
  params: Record<string, unknown> | null;
  duration_ms: number;
  outcome: "ok" | "error";
  /** When the event actually STARTED (not when it was recorded) — this,
   * not `duration_ms` alone, is what lets the UI lay events out in a real
   * timeline rather than just a flat list. */
  started_at: string;
};

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await defineTable("graphlog_runs");
  await defineTable("graphlog_run_events");
  tablesEnsured = true;
}

/** The recorder interface every GraphLog stage function is handed
 * (`opts.perf`) — a real `GraphLogRunRecorder` when invoked from the
 * worker (see `worker.ts`), or `noopGraphLogRunRecorder` when a stage is
 * exercised directly (a script, a test, `api.graphlog.daily-log-sync`'s
 * own synchronous route) with no run/job context to attach a timeline to.
 * Keeping this as an interface (not requiring the concrete class) is what
 * makes the no-op substitution possible without every call site needing
 * its own `if (perf) ...` branch. */
export interface GraphLogPerfRecorder {
  event(input: {
    process: string;
    type: GraphLogPerfEventType;
    name: string;
    params?: Record<string, unknown> | null;
    durationMs: number;
    startedAt?: string;
    outcome?: "ok" | "error";
  }): Promise<void>;

  /** Wraps an async call, timing it wall-clock and recording the event
   * automatically — records (with `outcome: "error"`) even if `fn`
   * throws, then rethrows so the caller's own error handling is
   * unaffected. */
  time<T>(
    process: string,
    type: GraphLogPerfEventType,
    name: string,
    params: Record<string, unknown> | null,
    fn: () => Promise<T>,
  ): Promise<T>;
}

class GraphLogRunRecorder implements GraphLogPerfRecorder {
  private seq = 0;

  constructor(private readonly runId: string) {}

  async event(input: {
    process: string;
    type: GraphLogPerfEventType;
    name: string;
    params?: Record<string, unknown> | null;
    durationMs: number;
    startedAt?: string;
    outcome?: "ok" | "error";
  }): Promise<void> {
    try {
      await ensureTables();
      const seq = this.seq++;
      const durationMs = Math.max(0, Math.round(input.durationMs));
      await upsert("graphlog_run_events", {
        run_id: this.runId,
        seq,
        process: input.process,
        type: input.type,
        name: input.name,
        params: input.params ?? null,
        duration_ms: durationMs,
        outcome: input.outcome ?? "ok",
        started_at: input.startedAt ?? new Date(Date.now() - durationMs).toISOString(),
      });
    } catch (err) {
      console.error("GraphLog perf event recording failed (non-fatal):", err);
    }
  }

  async time<T>(
    process: string,
    type: GraphLogPerfEventType,
    name: string,
    params: Record<string, unknown> | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    try {
      const result = await fn();
      await this.event({ process, type, name, params, durationMs: Date.now() - start, startedAt, outcome: "ok" });
      return result;
    } catch (err) {
      await this.event({ process, type, name, params, durationMs: Date.now() - start, startedAt, outcome: "error" });
      throw err;
    }
  }
}

/** A real recorder that never persists anything — for call sites with no
 * run/job to attach a timeline to. `time()` still just runs `fn` and
 * returns its result unchanged. */
export const noopGraphLogRunRecorder: GraphLogPerfRecorder = {
  async event() {},
  async time(_process, _type, _name, _params, fn) {
    return fn();
  },
};

/**
 * Starts (creates) a new run row and returns a recorder bound to it.
 * `runId` should be the owning BullMQ job's own id (see this file's own
 * module doc) — reused directly, not regenerated. Never throws: falls
 * back to `noopGraphLogRunRecorder` if the run row itself can't be
 * created, so a perf-tracking outage never blocks a real GraphLog job
 * from running.
 */
export async function startGraphLogRun(input: {
  runId: string;
  humanId: string;
  projectFolderId: string;
  jobName: string;
}): Promise<GraphLogPerfRecorder> {
  try {
    await ensureTables();
    await upsert(new RecordId("graphlog_runs", input.runId), {
      human_id: input.humanId,
      project_folder_id: input.projectFolderId,
      job_name: input.jobName,
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: null,
      ok: null,
      error: null,
    });
    return new GraphLogRunRecorder(input.runId);
  } catch (err) {
    console.error("GraphLog run tracking failed to start (non-fatal):", err);
    return noopGraphLogRunRecorder;
  }
}

/** Marks a run row finished — `ok`/`error` reflect the OUTER job's own
 * outcome (thrown vs. not), same as BullMQ's own completed/failed split.
 * Never throws. A no-op if the run row doesn't exist (e.g. `startGraphLogRun`
 * itself failed earlier for the same run). */
export async function finishGraphLogRun(
  runId: string,
  outcome: { ok: boolean; error?: string | null },
): Promise<void> {
  try {
    await ensureTables();
    const result = await query<[GraphLogRun[]]>(`SELECT * FROM graphlog_runs WHERE id = $rid`, {
      rid: new RecordId("graphlog_runs", runId),
    });
    const row = result?.[0]?.[0] ? formatRecord(result[0][0]) : null;
    if (!row) return;
    const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : Date.now();
    const now = new Date().toISOString();
    await upsert(new RecordId("graphlog_runs", runId), {
      human_id: row.human_id,
      project_folder_id: row.project_folder_id,
      job_name: row.job_name,
      started_at: row.started_at,
      finished_at: now,
      duration_ms: Date.now() - startedAtMs,
      ok: outcome.ok,
      error: outcome.ok ? null : (outcome.error ?? "Unknown error"),
    });
  } catch (err) {
    console.error("GraphLog run tracking failed to finish (non-fatal):", err);
  }
}

/** Most recent runs, newest first — powers the "Recent Runs" list on
 * `/fruits/maker/graphlog/defaults`. */
export async function listRecentGraphLogRuns(limit = 20): Promise<GraphLogRun[]> {
  await ensureTables();
  const result = await query<[GraphLogRun[]]>(
    `SELECT * FROM graphlog_runs ORDER BY started_at DESC LIMIT $limit`,
    { limit },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

/** One run plus its full event timeline, in order — powers the individual
 * run page. Returns `null` if the run itself doesn't exist. */
export async function getGraphLogRun(
  runId: string,
): Promise<{ run: GraphLogRun; events: GraphLogRunEvent[] } | null> {
  await ensureTables();
  const runResult = await query<[GraphLogRun[]]>(`SELECT * FROM graphlog_runs WHERE id = $rid`, {
    rid: new RecordId("graphlog_runs", runId),
  });
  const run = runResult?.[0]?.[0] ? formatRecord(runResult[0][0]) : null;
  if (!run) return null;

  // Ordered by ACTUAL start time, not insertion order — a wrapper span
  // (e.g. "runSyncGraph") is only written to the DB once it finishes,
  // which is AFTER every event nested inside it, so `seq` alone would put
  // it last even though it genuinely started first. `seq` only breaks
  // ties between two events that started at the exact same millisecond.
  const eventsResult = await query<[GraphLogRunEvent[]]>(
    `SELECT * FROM graphlog_run_events WHERE run_id = $runId ORDER BY started_at ASC, seq ASC`,
    { runId },
  );
  const events = (eventsResult?.[0] ?? []).map(formatRecord);
  return { run, events };
}

const DEFAULT_RUN_RETENTION_DAYS = 30;

/** Deletes runs (and their events) older than `retentionDays` — same
 * retention-window shape as `pruneOldGraphLogUsageEvents`, kept as its
 * own separate function since these two tables track different things
 * and may want different retention windows later. Not yet wired to a
 * cron route (same "not yet done" state `pruneOldGraphLogUsageEvents`
 * itself was in before its own cron route existed) — safe to call
 * on-demand in the meantime. */
export async function pruneOldGraphLogRuns(
  retentionDays: number = DEFAULT_RUN_RETENTION_DAYS,
): Promise<{ deletedRuns: number; deletedEvents: number }> {
  await ensureTables();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const runsResult = await query<[GraphLogRun[]]>(`SELECT id FROM graphlog_runs WHERE started_at < $cutoff`, {
    cutoff,
  });
  const runs = (runsResult?.[0] ?? []).map(formatRecord);

  let deletedEvents = 0;
  for (const run of runs) {
    const eventsResult = await query<[GraphLogRunEvent[]]>(
      `SELECT id FROM graphlog_run_events WHERE run_id = $runId`,
      { runId: run._id },
    );
    const events = (eventsResult?.[0] ?? []).map(formatRecord);
    for (const ev of events) {
      await remove("graphlog_run_events", ev._id);
      deletedEvents++;
    }
    await remove("graphlog_runs", run._id);
  }
  return { deletedRuns: runs.length, deletedEvents };
}
