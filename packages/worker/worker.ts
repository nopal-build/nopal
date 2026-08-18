// worker.ts — PhyLog's queue worker. Its own standalone package (`packages/
// worker`, run via `pnpm --filter worker run start`, i.e. `vite-node
// worker.ts` — no build step or compiled output needed), deliberately NOT
// part of `webapp` at all — see `phylogQueue.server.ts`'s own module doc
// for why long-running PhyLog work is decoupled from request/response
// handling, and the `phylog` skill's "Scaling & Process Isolation"
// section for why this is a separate PACKAGE (not just a separate
// process sharing webapp's dependency graph): this worker's own
// `package.json` only declares what it actually needs, so its deploy
// doesn't drag along React/MDXEditor/PDFKit/etc.
//
// Imports the EXACT SAME pipeline functions the web app used to call
// inline, from the shared `robustness-core` workspace package — zero
// rewrite of PhyLog's own logic, only WHERE it runs (and which
// dependency graph it ships with) changed.
import { Worker, type Job } from "bullmq";
import {
  PHYLOG_QUEUE_NAME,
  acquireProjectPhylogLock,
  type PhylogJobData,
  type PhylogJobName,
} from "robustness-core/data/phylogQueue.server";
import { runPhylogPipeline, resetProject } from "robustness-core/data/phylogAgent.server";
import { runPreCapture } from "robustness-core/data/preCapture.server";
import { runCapture, runReorganize } from "robustness-core/data/capture.server";
import { runPostCapture } from "robustness-core/data/postCapture.server";
import { resolveProjectN01 } from "robustness-core/data/projectN01.server";
import {
  GRAPHLOG_QUEUE_NAME,
  acquireProjectGraphLogLock,
  type GraphLogJobData,
  type GraphLogJobName,
} from "robustness-core/data/graphLogQueue.server";
import { runSyncKnowledge } from "robustness-core/data/syncKnowledge.server";
import { runSyncGraph } from "robustness-core/data/syncGraph.server";
import { runGraphProjectView } from "robustness-core/data/graphProjectView.server";
import { runGraphLogPipeline } from "robustness-core/data/graphLogAgent.server";
import { migrateProjectToN02 } from "robustness-core/data/migrateToN02.server";
import { getFolderById, type VaultFolder } from "robustness-core/data/vault.server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Sequential per worker process on purpose — PhyLog's own concurrency
// safety (see the duplicate-summary-file bug fixed earlier) is about
// never running the SAME project's pipeline twice at once, not about
// general throughput; running multiple DIFFERENT projects' jobs
// concurrently in one process is fine and could be raised later once
// there's evidence it's worth it. Scale by running more worker
// PROCESSES/machines (`fly scale count worker=N`), not by raising this.
//
// This alone only guarantees "never twice at once WITHIN one process" —
// once there's more than one worker process, `acquireProjectPhylogLock`
// below (a Redis lock, held for the duration of a job's actual pipeline
// work) is what keeps two DIFFERENT processes from ever running the same
// project's pipeline concurrently.
const CONCURRENCY = 1;

async function runJob(
  job: Job<PhylogJobData, unknown, PhylogJobName>,
  projectFolder: VaultFolder,
  onProgress: (line: string) => void,
): Promise<unknown> {
  switch (job.name) {
    case "run": {
      const result = await runPhylogPipeline(
        job.data.actingHumanId,
        job.data.projectFolderId,
        { full: job.data.full, since: job.data.since, until: job.data.until },
        onProgress,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "pre-capture": {
      const result = await runPreCapture(
        job.data.actingHumanId,
        projectFolder,
        { date: job.data.date, fileId: job.data.fileId },
        onProgress,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "capture": {
      const result = await runCapture(
        job.data.actingHumanId,
        projectFolder,
        { full: job.data.full ?? false, since: job.data.since, until: job.data.until },
        onProgress,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "post-capture": {
      return await runPostCapture(job.data.actingHumanId, projectFolder, onProgress);
    }
    case "reset": {
      const result = await resetProject(job.data.projectFolderId, { wipeDailyLogs: false });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "reset-pre-capture": {
      const result = await resetProject(job.data.projectFolderId, { wipeDailyLogs: true });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "reorganize": {
      const result = await runReorganize(job.data.actingHumanId, projectFolder, {}, onProgress);
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    default:
      throw new Error(`Unknown PhyLog job name: ${job.name}`);
  }
}

async function processJob(job: Job<PhylogJobData, unknown, PhylogJobName>): Promise<unknown> {
  const onProgress = (line: string) => {
    job.log(line).catch((err) => console.error("Failed to write job log line:", err));
  };

  const resolved = await resolveProjectN01(job.data.projectFolderId);
  if (!resolved.ok) throw new Error(resolved.error);
  const projectFolder = resolved.folder;

  // Held for every job type that touches this project's PhyLog content —
  // pre-capture/capture/post-capture/reset/reset-pre-capture all mutate
  // the same project-n01 tree, so all of them serialize on it, not just
  // capture. See this file's own module doc above.
  const release = await acquireProjectPhylogLock(job.data.projectFolderId, onProgress);
  try {
    return await runJob(job, projectFolder, onProgress);
  } finally {
    await release();
  }
}

const worker = new Worker<PhylogJobData, unknown, PhylogJobName>(PHYLOG_QUEUE_NAME, processJob, {
  connection: { url: REDIS_URL, maxRetriesPerRequest: null },
  concurrency: CONCURRENCY,
});

worker.on("completed", (job) => {
  console.log(`[worker] ${job.name} ${job.id} completed (project ${job.data.projectFolderId}).`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] ${job?.name} ${job?.id} failed:`, err);
});

console.log(`[worker] PhyLog worker listening on queue "${PHYLOG_QUEUE_NAME}" (concurrency ${CONCURRENCY}).`);

// ─── GraphLog ───────────────────────────────────────────────────────────────────
// A SECOND, independent `Worker` in this SAME process, against GraphLog's
// OWN queue (see `graphLogQueue.server.ts`) — running two BullMQ workers
// in one Node process is cheap and keeps this package's whole "one worker
// process, no separate deploy target" story intact for GraphLog too (see
// the `graphlog` skill). Unlike PhyLog's own dispatch, this does NOT
// resolve through `resolveProjectN01`/`resolveProjectN02` — GraphLog's
// stages are deliberately container-type-agnostic (see
// `syncKnowledge.server.ts`'s own doc), so a plain `getFolderById` is all
// that's needed here, same as `dailyLogSync.server.ts`'s own resolution.

async function runGraphLogJob(
  job: Job<GraphLogJobData, unknown, GraphLogJobName>,
  projectFolder: VaultFolder,
  onProgress: (line: string) => void,
): Promise<unknown> {
  switch (job.name) {
    case "sync-knowledge": {
      const result = await runSyncKnowledge(projectFolder, job.data.actingHumanId, {
        log: onProgress,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "sync-graph": {
      const result = await runSyncGraph(projectFolder, job.data.actingHumanId, {
        log: onProgress,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "graph-project-view": {
      const result = await runGraphProjectView(projectFolder, job.data.actingHumanId, {
        log: onProgress,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "run": {
      const result = await runGraphLogPipeline(
        job.data.actingHumanId,
        job.data.projectFolderId,
        {},
        onProgress,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "migrate-to-n02": {
      const result = await migrateProjectToN02(job.data.projectFolderId);
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    default:
      throw new Error(`Unknown GraphLog job name: ${job.name}`);
  }
}

async function processGraphLogJob(job: Job<GraphLogJobData, unknown, GraphLogJobName>): Promise<unknown> {
  const onProgress = (line: string) => {
    job.log(line).catch((err) => console.error("Failed to write job log line:", err));
  };

  const projectFolder = await getFolderById(job.data.projectFolderId);
  if (!projectFolder) throw new Error("Project not found");

  const release = await acquireProjectGraphLogLock(job.data.projectFolderId, onProgress);
  try {
    return await runGraphLogJob(job, projectFolder, onProgress);
  } finally {
    await release();
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
// than abandon it mid-run, same rationale as this file's own module doc:
// PhyLog's own idempotency makes a clean re-run of an ABANDONED job safe,
// but an UNGRACEFULLY killed one can leave partial writes mid-flight. Same
// idempotency property holds for GraphLog's own stages, so both workers
// close together here.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, finishing in-flight jobs before exit…`);
  await Promise.all([worker.close(), graphLogWorker.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
