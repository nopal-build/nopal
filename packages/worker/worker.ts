// worker.ts — GraphLog's queue worker. Its own standalone package
// (`packages/worker`, run via `pnpm --filter worker run start`, i.e.
// `vite-node worker.ts` — no build step or compiled output needed),
// deliberately NOT part of `webapp` at all — a GraphLog run can take
// minutes, and running it inline in an HTTP handler risks degrading the
// whole web server. This worker's own `package.json` only declares what
// it actually needs, so its deploy doesn't drag along React/etc.
//
// Imports the EXACT SAME pipeline functions the web app used to call
// inline, from the shared `robustness-core` workspace package — zero
// rewrite of GraphLog's own logic, only WHERE it runs (and which
// dependency graph it ships with) changed.
import { Worker, type Job } from "bullmq";
import {
  GRAPHLOG_QUEUE_NAME,
  acquireProjectGraphLogLock,
  type GraphLogJobData,
  type GraphLogJobName,
} from "robustness-core/data/graphLogQueue.server";
import { runSyncKnowledge } from "robustness-core/data/syncKnowledge.server";
import { runSyncGraph } from "robustness-core/data/syncGraph.server";
import { runGraphStructure } from "robustness-core/data/graphStructure.server";
import { runGraphProjectView } from "robustness-core/data/graphProjectView.server";
import { runGraphLogPipeline } from "robustness-core/data/graphLogAgent.server";
import {
  resetProjectView,
  resetGraph,
  resetKnowledge,
  resetProjectAll,
} from "robustness-core/data/graphLogReset.server";
import { getFolderById, type VaultFolder } from "robustness-core/data/vault.server";
import {
  startGraphLogRun,
  finishGraphLogRun,
  type GraphLogPerfRecorder,
} from "robustness-core/data/graphLogPerf.server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Sequential per worker process on purpose — this worker's own
// concurrency safety is about never running the SAME project's pipeline
// twice at once, not about general throughput; running multiple
// DIFFERENT projects' jobs concurrently in one process is fine and could
// be raised later once there's evidence it's worth it. Scale by running
// more worker PROCESSES/machines (`fly scale count worker=N`), not by
// raising this.
//
// This alone only guarantees "never twice at once WITHIN one process" —
// once there's more than one worker process, `acquireProjectGraphLogLock`
// below (a Redis lock, held for the duration of a job's actual pipeline
// work) is what keeps two DIFFERENT processes from ever running the same
// project's pipeline concurrently.
const CONCURRENCY = 1;

// ─── GraphLog ───────────────────────────────────────────────────────────────────
// GraphLog's stages are deliberately container-type-agnostic (see
// `syncKnowledge.server.ts`'s own doc), so a plain `getFolderById` is all
// that's needed here, same as `dailyLogSync.server.ts`'s own resolution.

async function runGraphLogJob(
  job: Job<GraphLogJobData, unknown, GraphLogJobName>,
  projectFolder: VaultFolder,
  onProgress: (line: string) => void,
  perf: GraphLogPerfRecorder,
): Promise<unknown> {
  switch (job.name) {
    case "sync-knowledge": {
      const result = await runSyncKnowledge(projectFolder, job.data.actingHumanId, {
        log: onProgress,
        perf,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "sync-graph": {
      const result = await runSyncGraph(projectFolder, job.data.actingHumanId, {
        log: onProgress,
        perf,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "graph-structure": {
      const result = await runGraphStructure(projectFolder, job.data.actingHumanId, {
        log: onProgress,
        perf,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "graph-project-view": {
      const result = await runGraphProjectView(projectFolder, job.data.actingHumanId, {
        log: onProgress,
        perf,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "run": {
      const result = await runGraphLogPipeline(
        job.data.actingHumanId,
        job.data.projectFolderId,
        { perf },
        onProgress,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "reset-project-view": {
      return await perf.time("reset-project-view", "fn", "resetProjectView", null, () =>
        resetProjectView(projectFolder),
      );
    }
    case "reset-graph": {
      return await perf.time("reset-graph", "fn", "resetGraph", null, () => resetGraph(projectFolder));
    }
    case "reset-knowledge": {
      return await perf.time("reset-knowledge", "fn", "resetKnowledge", null, () =>
        resetKnowledge(projectFolder),
      );
    }
    case "reset": {
      return await perf.time("reset", "fn", "resetProjectAll", null, () => resetProjectAll(projectFolder));
    }
    default:
      throw new Error(`Unknown GraphLog job name: ${job.name}`);
  }
}

async function processGraphLogJob(job: Job<GraphLogJobData, unknown, GraphLogJobName>): Promise<unknown> {
  const onProgress = (line: string) => {
    job.log(line).catch((err) => console.error("Failed to write job log line:", err));
  };

  // The job's own BullMQ id doubles as this run's id (see
  // `graphLogPerf.server.ts`'s own module doc) -- one real job always
  // means exactly one timeline, never a separately-generated id to keep
  // in sync with it.
  const perf = await startGraphLogRun({
    runId: job.id!,
    humanId: job.data.actingHumanId,
    projectFolderId: job.data.projectFolderId,
    jobName: job.name,
  });

  try {
    const projectFolder = await getFolderById(job.data.projectFolderId);
    if (!projectFolder) throw new Error("Project not found");

    const release = await acquireProjectGraphLogLock(job.data.projectFolderId, onProgress);
    try {
      const result = await runGraphLogJob(job, projectFolder, onProgress, perf);
      await finishGraphLogRun(job.id!, { ok: true });
      return result;
    } finally {
      await release();
    }
  } catch (err) {
    await finishGraphLogRun(job.id!, {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }
}

const graphLogWorker = new Worker<GraphLogJobData, unknown, GraphLogJobName>(
  GRAPHLOG_QUEUE_NAME,
  processGraphLogJob,
  {
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    concurrency: CONCURRENCY,
  },
);

graphLogWorker.on("completed", (job) => {
  console.log(`[worker] ${job.name} ${job.id} completed (project ${job.data.projectFolderId}).`);
});
graphLogWorker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name} ${job?.id} failed:`, err);
});

console.log(`[worker] GraphLog worker listening on queue "${GRAPHLOG_QUEUE_NAME}" (concurrency ${CONCURRENCY}).`);

// Graceful shutdown — let an in-flight job finish (or fail cleanly) rather
// than abandon it mid-run: GraphLog's own idempotency makes a clean
// re-run of an ABANDONED job safe, but an UNGRACEFULLY killed one can
// leave partial writes mid-flight.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, finishing in-flight jobs before exit…`);
  await graphLogWorker.close();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
