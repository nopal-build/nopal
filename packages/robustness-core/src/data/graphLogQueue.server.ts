/**
 * GraphLog's job queue — BullMQ over Redis, an enqueue-then-poll API
 * route, a real worker process consuming it, on its own queue name
 * (`"graphlog"`). A GraphLog run can take minutes; running it inline in
 * an HTTP handler risks degrading the whole web server, hence a real
 * queue rather than an in-request call.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  getLatestUnfinishedGraphLogRun,
  getLatestCompletedGraphLogRun,
  finishGraphLogRun,
} from "./graphLogPerf.server";

let connection: IORedis | undefined;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export const GRAPHLOG_QUEUE_NAME = "graphlog";

let queue: Queue<GraphLogJobData, unknown, GraphLogJobName> | undefined;

export function getGraphLogQueue(): Queue<GraphLogJobData, unknown, GraphLogJobName> {
  if (!queue) {
    queue = new Queue(GRAPHLOG_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export type GraphLogJobName =
  | "run"
  | "sync-knowledge"
  | "sync-graph"
  | "graph-structure"
  | "graph-project-view"
  | "reset"
  | "reset-project-view"
  | "reset-graph"
  | "reset-knowledge";

export type GraphLogJobData = {
  actingHumanId: string;
  projectFolderId: string;
};

const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export async function enqueueGraphLogJob(name: GraphLogJobName, data: GraphLogJobData): Promise<string> {
  const job = await getGraphLogQueue().add(name, data, JOB_OPTIONS);
  if (!job.id) throw new Error("Failed to enqueue GraphLog job");
  return job.id;
}

export type GraphLogJobStatus =
  | {
      ok: true;
      state: "waiting" | "active" | "delayed" | "completed" | "failed" | "unknown";
      log: string[];
      result?: unknown;
      error?: string;
    }
  | { ok: false; error: string };

export async function getGraphLogJobStatus(jobId: string): Promise<GraphLogJobStatus> {
  const q = getGraphLogQueue();
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

export async function getGraphLogJobOwner(jobId: string): Promise<GraphLogJobData | null> {
  const job = await getGraphLogQueue().getJob(jobId);
  return job?.data ?? null;
}

// --- Per-project run lock -------------------------------------------------
// A Redis lock, held for the duration of a job's actual pipeline work —
// only matters once more than one worker process is deployed, to keep two
// DIFFERENT processes from ever running the same project's pipeline
// concurrently. Key prefix: `graphlog:lock:...`.

const PROJECT_LOCK_TTL_MS = 10 * 60 * 1000;
const PROJECT_LOCK_POLL_MS = 3000;
const PROJECT_LOCK_MAX_WAIT_MS = 30 * 60 * 1000;

function projectLockKey(projectFolderId: string): string {
  return `graphlog:lock:${projectFolderId}`;
}

export async function acquireProjectGraphLogLock(
  projectFolderId: string,
  onWaiting?: (line: string) => void,
): Promise<() => Promise<void>> {
  const redis = getConnection();
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const key = projectLockKey(projectFolderId);
  const deadline = Date.now() + PROJECT_LOCK_MAX_WAIT_MS;
  let announced = false;

  for (;;) {
    const acquired = await redis.set(key, token, "PX", PROJECT_LOCK_TTL_MS, "NX");
    if (acquired) break;
    if (!announced) {
      onWaiting?.("waiting for another GraphLog run already in progress for this project to finish...");
      announced = true;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for this project's GraphLog lock (another run has held it for over ${Math.round(PROJECT_LOCK_MAX_WAIT_MS / 60000)} minutes).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECT_LOCK_POLL_MS));
  }

  return async () => {
    const releaseScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    await redis.eval(releaseScript, 1, key, token);
  };
}

// --- Cooperative cancellation ("Stop") ------------------------------------
// There's no way to preemptively kill a job mid-`await` in BullMQ/Node, so
// "Stop" is cooperative: a plain Redis flag a running pipeline checks at
// its own safe checkpoints (between pipeline stages, once per turn of an
// agentic loop, once per file/day of a batch loop) and throws
// `GraphLogCancelledError` on -- same "finish cleanly, don't kill
// mid-write" philosophy `worker.ts`'s own graceful SIGTERM shutdown
// already uses. This means Stop can take as long as the current single
// LLM call/file/day takes to finish, never instantly -- see the
// `graphlog` skill for exactly where each stage checks this.

const CANCEL_FLAG_TTL_MS = 60 * 60 * 1000; // safety net so a stale flag can never wedge a LATER run

function cancelFlagKey(projectFolderId: string): string {
  return `graphlog:cancel:${projectFolderId}`;
}

/** Thrown by a running pipeline's own cancellation checkpoints once it
 * observes the Redis flag set below -- the worker's normal catch block
 * (`processGraphLogJob`) handles it exactly like any other thrown error
 * (`finishGraphLogRun({ ok: false, error: ... })`, job marked "failed"),
 * just with a message that reads as an intentional stop rather than a
 * crash. */
export class GraphLogCancelledError extends Error {
  constructor() {
    super("Cancelled by an admin.");
    this.name = "GraphLogCancelledError";
  }
}

/** Sets the flag a running pipeline's own checkpoints (see module doc)
 * poll for. Called by `cancelGraphLogJob` below when the target job is
 * already active; a no-op otherwise. */
export async function requestGraphLogCancellation(projectFolderId: string): Promise<void> {
  await getConnection().set(cancelFlagKey(projectFolderId), "1", "PX", CANCEL_FLAG_TTL_MS);
}

/** Checked at every pipeline checkpoint (see module doc) -- throws
 * `GraphLogCancelledError` if a Stop was requested for this project,
 * otherwise a no-op. Import this, not the raw flag, from every checkpoint
 * so "what counts as cancelled" stays defined in exactly one place. */
export async function throwIfGraphLogCancelled(projectFolderId: string): Promise<void> {
  const flagged = await getConnection().get(cancelFlagKey(projectFolderId));
  if (flagged !== null) throw new GraphLogCancelledError();
}

/** Clears the flag -- called unconditionally by `processGraphLogJob`'s own
 * `finally` once a project's job finishes (success, failure, OR
 * cancellation), so a stale flag can never block that project's NEXT
 * run. */
export async function clearGraphLogCancellation(projectFolderId: string): Promise<void> {
  await getConnection().del(cancelFlagKey(projectFolderId));
}

// --- Live project status ---------------------------------------------------
// What `api.graphlog.status.tsx` (polled by the Vault UI's permanent
// status line) and `cancelGraphLogJob` below both read.

export type GraphLogProjectStatus = {
  running: boolean;
  currentJobId: string | null;
  currentJobName: string | null;
  currentStartedAt: string | null;
  lastCompletedJobName: string | null;
  lastCompletedAt: string | null;
  lastCompletedOk: boolean | null;
  lastCompletedError: string | null;
};

/**
 * Cross-checks `graphlog_runs`' own idea of "is there an unfinished run
 * for this project" (`getLatestUnfinishedGraphLogRun`) against that run's
 * REAL BullMQ job state, since a `graphlog_runs` row can only be stuck
 * showing `ok: null` forever if the worker process itself died mid-run
 * (crash, `kill -9`, a bad deploy) without ever reaching its own
 * `finally`. When that mismatch is caught, this self-heals: it records
 * the run as failed right here (`finishGraphLogRun`) instead of leaving a
 * project stuck reporting "running" forever with no way to Stop a job
 * that no longer exists.
 */
export async function getGraphLogProjectStatus(projectFolderId: string): Promise<GraphLogProjectStatus> {
  let running = false;
  let currentJobId: string | null = null;
  let currentJobName: string | null = null;
  let currentStartedAt: string | null = null;

  const unfinished = await getLatestUnfinishedGraphLogRun(projectFolderId);
  if (unfinished) {
    const job = await getGraphLogQueue().getJob(unfinished._id);
    const state = job ? await job.getState() : null;
    if (job && (state === "active" || state === "waiting" || state === "delayed")) {
      running = true;
      currentJobId = unfinished._id;
      currentJobName = unfinished.job_name;
      currentStartedAt = unfinished.started_at;
    } else {
      // The DB row says "still running" but the job itself is gone or
      // already settled -- the worker process died before it could
      // record its own outcome. Self-heal rather than reporting a
      // phantom "running" forever.
      await finishGraphLogRun(unfinished._id, {
        ok: false,
        error: "Worker exited unexpectedly before this run finished.",
      });
    }
  }

  const lastCompleted = await getLatestCompletedGraphLogRun(projectFolderId);

  return {
    running,
    currentJobId,
    currentJobName,
    currentStartedAt,
    lastCompletedJobName: lastCompleted?.job_name ?? null,
    lastCompletedAt: lastCompleted?.finished_at ?? null,
    lastCompletedOk: lastCompleted?.ok ?? null,
    lastCompletedError: lastCompleted?.error ?? null,
  };
}

export type CancelGraphLogJobResult =
  | { ok: true; wasActive: boolean }
  | { ok: false; error: string };

/**
 * Stops whatever GraphLog job is currently running (or queued) for a
 * project. A job that hasn't started processing yet (`"waiting"`/
 * `"delayed"`) is removed from the queue outright -- no cooperation
 * needed. An already-`"active"` job instead gets the cooperative
 * cancellation flag (see module doc above) -- it stops at its own next
 * safe checkpoint, not instantly.
 */
export async function cancelGraphLogJob(projectFolderId: string): Promise<CancelGraphLogJobResult> {
  const unfinished = await getLatestUnfinishedGraphLogRun(projectFolderId);
  if (!unfinished) return { ok: false, error: "No running GraphLog job found for this project." };

  const job = await getGraphLogQueue().getJob(unfinished._id);
  if (!job) {
    await finishGraphLogRun(unfinished._id, {
      ok: false,
      error: "Cancelled by an admin (job was already gone from the queue).",
    });
    return { ok: true, wasActive: false };
  }

  const state = await job.getState();
  if (state === "waiting" || state === "delayed") {
    await job.remove();
    await finishGraphLogRun(unfinished._id, { ok: false, error: "Cancelled by an admin before it started." });
    return { ok: true, wasActive: false };
  }

  if (state === "active") {
    await requestGraphLogCancellation(projectFolderId);
    return { ok: true, wasActive: true };
  }

  // Already completed/failed by the time we got here (a race with the
  // worker's own finish) -- nothing left to cancel.
  return { ok: false, error: "This job has already finished." };
}
