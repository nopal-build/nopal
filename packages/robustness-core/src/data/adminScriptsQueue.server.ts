/**
 * Admin Scripts' job queue — BullMQ over Redis, its own queue name
 * ("admin-scripts") separate from GraphLog's, consumed by a second
 * `Worker` in the same worker process (`packages/worker/worker.ts`). See
 * `adminScriptsRegistry.server.ts` for what a job actually runs, and
 * `adminScriptRuns.server.ts` for the permanent audit row a job's outcome
 * ends up in.
 *
 * Concurrency 1 in the worker on purpose (unlike GraphLog, which is 1 per
 * PROJECT) — these mutate shared data with no natural partition to run
 * concurrently against, so the queue itself is the serialization point:
 * a second script always waits for the first to finish rather than
 * racing it.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: IORedis | undefined;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export const ADMIN_SCRIPTS_QUEUE_NAME = "admin-scripts";

export type AdminScriptJobData = {
  actingHumanId: string;
  scriptName: string;
  dryRun: boolean;
};

let queue: Queue<AdminScriptJobData, unknown, string> | undefined;

export function getAdminScriptsQueue(): Queue<AdminScriptJobData, unknown, string> {
  if (!queue) {
    queue = new Queue(ADMIN_SCRIPTS_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

const JOB_OPTIONS = {
  attempts: 1,
  // Shorter than GraphLog's own (graphLogQueue.server.ts) since a
  // finished run's real, permanent record lives in `admin_script_runs`
  // (adminScriptRuns.server.ts) -- these BullMQ entries only need to
  // outlive "is anything currently running" checks and live log tailing.
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 24 * 60 * 60 },
};

export async function enqueueAdminScriptJob(data: AdminScriptJobData): Promise<string> {
  const job = await getAdminScriptsQueue().add(data.scriptName, data, JOB_OPTIONS);
  if (!job.id) throw new Error("Failed to enqueue admin script job");
  return job.id;
}

/** Whether ANY admin script is currently waiting/active — since the
 * queue is globally serialized (see module doc), this is enough to decide
 * whether to let the UI enqueue another one right now. */
export async function isAnyAdminScriptRunning(): Promise<boolean> {
  const q = getAdminScriptsQueue();
  const counts = await q.getJobCounts("waiting", "active", "delayed");
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) > 0;
}

export type AdminScriptJobLog = {
  state: "waiting" | "active" | "delayed" | "completed" | "failed" | "unknown";
  log: string[];
};

/** Live log tailing for a run that hasn't finished yet — once
 * `admin_script_runs` has `ok !== null` the permanent row's own `log` is
 * the thing to read instead (this job may have already been pruned by
 * then). */
export async function getAdminScriptJobLog(jobId: string): Promise<AdminScriptJobLog | null> {
  const q = getAdminScriptsQueue();
  const job = await q.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  const { logs } = await q.getJobLogs(job.id!);
  return { state: state as AdminScriptJobLog["state"], log: logs };
}
