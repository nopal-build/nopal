/**
 * PhyLog's job queue — BullMQ over Redis, deliberately a SEPARATE piece of
 * infrastructure from the app's own SurrealDB (see the "Scaling & Process
 * Isolation" section of the `phylog` skill for the full reasoning): a
 * PhyLog run can legitimately take minutes, and running it inline inside
 * an HTTP request handler means a slow/hung/crashed run can degrade the
 * ENTIRE web server for every human, not just the one who triggered it.
 *
 * The `api.phylog.*` routes now only ENQUEUE a job and return its id
 * immediately (`202 Accepted`) — the actual pipeline work happens in a
 * separate process (`worker.ts`, a plain Node/vite-node entrypoint, NOT
 * part of the web server) that imports the exact SAME pipeline functions
 * (`phylogAgent.server.ts`/`preCapture.server.ts`/`capture.server.ts`/
 * `postCapture.server.ts`) with zero rewrite. The CLI (`crates/cli/src/
 * phylog.rs`) polls `GET /api/phylog/jobs/:jobId` for progress/results
 * instead of blocking on one long request.
 *
 * DELIBERATELY POLYGLOT-READY: nothing about the job SCHEMA below assumes
 * a Node worker consumes it — `PhylogJobName`/`PhylogJobData` are plain
 * JSON. If a future job type ever earns a Rust worker (a genuine CPU-bound
 * case, or real evidence Node concurrency is the limiter), that worker
 * would poll this SAME Redis queue for its own job name, running alongside
 * the Node worker with zero disruption to everything else — see the
 * `phylog` skill.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: IORedis | undefined;

/** Lazily created — a route/script that never touches the queue should
 * never pay for a Redis connection it doesn't use. `maxRetriesPerRequest:
 * null` is REQUIRED by BullMQ (it manages its own retry/backoff for
 * blocking commands); omitting it makes `Worker` throw on startup. */
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export const PHYLOG_QUEUE_NAME = "phylog";

let queue: Queue<PhylogJobData, unknown, PhylogJobName> | undefined;

/** Shared by both the web process (enqueuing) and the worker process
 * (consuming) — each imports this same module, but only ever needs
 * ONE of `phylogQueue`/`Worker` (`worker.ts` constructs its own `Worker`
 * directly against `PHYLOG_QUEUE_NAME`, not through this getter). */
export function getPhylogQueue(): Queue<PhylogJobData, unknown, PhylogJobName> {
  if (!queue) {
    queue = new Queue(PHYLOG_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export type PhylogJobName = "run" | "pre-capture" | "capture" | "post-capture" | "reset";

export type PhylogJobData = {
  actingHumanId: string;
  projectFolderId: string;
  /** `run` / `capture` only. */
  full?: boolean;
  since?: string;
  until?: string;
  /** `pre-capture` only. */
  date?: string;
  fileId?: string;
};

/** Kept short — a stuck/duplicate job clutters the queue far more than a
 * failed one; retries are meaningless here (each pipeline call is already
 * internally idempotent, see the `phylog` skill, so a human re-running the
 * CLI command is the right way to retry, not an automatic BullMQ retry
 * racing a still-running attempt — exactly the duplicate-write bug fixed
 * last time this pipeline had a retry-while-still-running problem). */
const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60 }, // 1 day — long enough to poll/debug, never a permanent log
  removeOnFail: { age: 7 * 24 * 60 * 60 }, // 1 week — failures are worth a longer look
};

export async function enqueuePhylogJob(name: PhylogJobName, data: PhylogJobData): Promise<string> {
  const job = await getPhylogQueue().add(name, data, JOB_OPTIONS);
  if (!job.id) throw new Error("Failed to enqueue PhyLog job");
  return job.id;
}

export type PhylogJobStatus =
  | {
      ok: true;
      state: "waiting" | "active" | "delayed" | "completed" | "failed" | "unknown";
      log: string[];
      result?: unknown;
      error?: string;
    }
  | { ok: false; error: string };

/** Polled by the CLI (and, later, any UI) — deliberately returns the FULL
 * log every time rather than an offset-based delta; these logs are tiny
 * (a line per file/day processed, see the pipeline stages' own
 * `onProgress` calls), so the caller just tracks how many lines it's
 * already printed and slices client-side. */
export async function getPhylogJobStatus(jobId: string): Promise<PhylogJobStatus> {
  const q = getPhylogQueue();
  const job = await q.getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  const state = await job.getState();
  const { logs } = await q.getJobLogs(job.id!);

  if (state === "completed") {
    return { ok: true, state, log: logs, result: job.returnvalue };
  }
  if (state === "failed") {
    return { ok: true, state, log: logs, error: job.failedReason };
  }
  if (state === "waiting" || state === "active" || state === "delayed") {
    return { ok: true, state, log: logs };
  }
  return { ok: true, state: "unknown", log: logs };
}

/** Only the job's OWN `actingHumanId` (or a project's owner-tier
 * collaborator, checked by the caller) may poll it — a job id alone
 * shouldn't leak another human's PhyLog activity. */
export async function getPhylogJobOwner(jobId: string): Promise<PhylogJobData | null> {
  const job = await getPhylogQueue().getJob(jobId);
  return job?.data ?? null;
}
