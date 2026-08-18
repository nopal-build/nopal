/**
 * GraphLog's job queue — mirrors `phylogQueue.server.ts`'s shape closely
 * (BullMQ over the same Redis, an enqueue-then-poll API route, a real
 * worker process consuming it), but on its OWN queue name (`"graphlog"`)
 * rather than sharing PhyLog's — kept fully independent so retiring
 * PhyLog later (see the `graphlog` skill) never touches this file, same
 * reasoning `graphLogMetrics.server.ts` already gives.
 *
 * See `phylogQueue.server.ts`'s own module doc for the full "why a queue
 * at all" reasoning (a GraphLog run can take minutes; running it inline
 * in an HTTP handler risks degrading the whole web server) — identical
 * here, not repeated.
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
  | "graph-project-view"
  | "migrate-to-n02";

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
// Same reasoning as `phylogQueue.server.ts`'s own `acquireProjectPhylogLock`
// — only matters once more than one worker process is deployed. A
// DIFFERENT key prefix (`graphlog:lock:...`) than PhyLog's own
// (`phylog:lock:...`) so the two pipelines' locks can never collide even
// though they may run against the very same project folder.

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
