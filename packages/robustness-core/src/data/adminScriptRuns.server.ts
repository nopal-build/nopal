/**
 * Admin Scripts' audit trail — one row per run of a registered script
 * (`adminScriptsRegistry.server.ts`), recorded by the worker
 * (`packages/worker/worker.ts`). Mirrors `graphLogPerf.server.ts`'s own
 * run-tracking half (`graphlog_runs`), minus the per-event timeline —
 * these scripts are occasional maintenance/repair jobs, not agentic
 * pipelines with sub-events worth timing individually.
 *
 * The run's id is the BullMQ job id (`adminScriptsQueue.server.ts`), same
 * "one real job always means exactly one row" convention GraphLog's own
 * run tracking uses — no separate id scheme to keep in sync.
 *
 * `log` is stored here (not just left in BullMQ's own `job.log()`)
 * because BullMQ jobs are pruned (`removeOnComplete`/`removeOnFail` ages,
 * `adminScriptsQueue.server.ts`) — this table is the PERMANENT record of
 * what a script did in production, which matters for anything that
 * mutates real data.
 */

import { RecordId } from "surrealdb";
import { query, upsert, formatRecord, defineTable, type Data } from "./generic.server";

export type AdminScriptRun = Data & {
  script_name: string;
  human_id: string;
  dry_run: boolean;
  args: string[];
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  /** `null` while still running. Reflects only whether the job THREW. */
  ok: boolean | null;
  error: string | null;
  /** The script's own one-line result (`AdminScriptResult.summary`) —
   * `null` until finished, or on failure. */
  summary: string | null;
  /** Every progress line the script logged, in order. */
  log: string[];
};

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await defineTable("admin_script_runs");
  tablesEnsured = true;
}

export async function startAdminScriptRun(input: {
  runId: string;
  humanId: string;
  scriptName: string;
  dryRun: boolean;
  args: string[];
}): Promise<void> {
  try {
    await ensureTables();
    await upsert(new RecordId("admin_script_runs", input.runId), {
      script_name: input.scriptName,
      human_id: input.humanId,
      dry_run: input.dryRun,
      args: input.args,
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: null,
      ok: null,
      error: null,
      summary: null,
      log: [],
    });
  } catch (err) {
    // Same "tracking must never break the real work it's describing"
    // convention `graphLogPerf.server.ts` follows — a failure to record
    // is logged, never thrown, so it can't take down the script itself.
    console.error("Admin script run tracking failed to start (non-fatal):", err);
  }
}

export async function finishAdminScriptRun(
  runId: string,
  outcome: { ok: boolean; error?: string | null; summary?: string | null; log: string[] },
): Promise<void> {
  try {
    await ensureTables();
    const result = await query<[AdminScriptRun[]]>(`SELECT * FROM admin_script_runs WHERE id = $rid`, {
      rid: new RecordId("admin_script_runs", runId),
    });
    const row = result?.[0]?.[0] ? formatRecord(result[0][0]) : null;
    if (!row) return;
    const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : Date.now();
    await upsert(new RecordId("admin_script_runs", runId), {
      script_name: row.script_name,
      human_id: row.human_id,
      dry_run: row.dry_run,
      args: row.args,
      started_at: row.started_at,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtMs,
      ok: outcome.ok,
      error: outcome.ok ? null : (outcome.error ?? "Unknown error"),
      summary: outcome.summary ?? null,
      log: outcome.log,
    });
  } catch (err) {
    console.error("Admin script run tracking failed to finish (non-fatal):", err);
  }
}

export async function getAdminScriptRun(runId: string): Promise<AdminScriptRun | null> {
  await ensureTables();
  const result = await query<[AdminScriptRun[]]>(`SELECT * FROM admin_script_runs WHERE id = $rid`, {
    rid: new RecordId("admin_script_runs", runId),
  });
  return result?.[0]?.[0] ? formatRecord(result[0][0]) : null;
}

const RECENT_RUNS_LIMIT = 20;

export async function listRecentAdminScriptRuns(limit: number = RECENT_RUNS_LIMIT): Promise<AdminScriptRun[]> {
  await ensureTables();
  const result = await query<[AdminScriptRun[]]>(
    `SELECT * FROM admin_script_runs ORDER BY started_at DESC LIMIT $limit`,
    { limit },
  );
  return (result?.[0] ?? []).map(formatRecord);
}
