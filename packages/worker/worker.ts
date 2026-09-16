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
  clearGraphLogCancellation,
  type GraphLogJobData,
  type GraphLogJobName,
} from "robustness-core/data/graphLogQueue.server";
import { runSyncKnowledge } from "robustness-core/data/syncKnowledge.server";
import { runSyncGraph } from "robustness-core/data/syncGraph.server";
import { runGraphStructure } from "robustness-core/data/graphStructure.server";
import { coverageFromJobResult, readmeChangedFromJobResult, runGraphProjectView, syncReadmeIncompleteBanner } from "robustness-core/data/graphProjectView.server";
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
import {
  ADMIN_SCRIPTS_QUEUE_NAME,
  type AdminScriptJobData,
} from "robustness-core/data/adminScriptsQueue.server";
import { getAdminScript } from "robustness-core/data/adminScriptsRegistry.server";
import {
  startAdminScriptRun,
  finishAdminScriptRun,
} from "robustness-core/data/adminScriptRuns.server";
import {
  PUBLIC_ZIP_QUEUE_NAME,
  runPublicFolderZip,
  type PublicZipJobData,
  type PublicZipJobResult,
  type PublicZipProgress,
} from "robustness-core/data/publicZip.server";

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
      // The stage strips the README's incomplete banner before the model
      // sees it (so the model cannot helpfully delete it) and relies on
      // the PIPELINE to put it back from the whole run's outcome. Run as
      // its own job there was no pipeline, so the banner came off and
      // nothing restored it -- a silently CLEARED warning, the opposite
      // of the "stale banner is the safe direction" its doc assumed. A
      // lone stage can only vouch for itself, so this raises or clears
      // from its own reasons, prefixed the way the pipeline prefixes
      // them; the next nightly run re-judges the whole. ADR-016.
      const changed = await syncReadmeIncompleteBanner(
        projectFolder,
        result.incomplete.map((r) => `graph-project-view: ${r}`),
      );
      if (changed) onProgress(result.incomplete.length > 0 ? "graph-project-view: marked README.md as incomplete on its own first line." : "graph-project-view: cleared the incomplete notice from README.md.");
      return result;
    }
    case "rerun-outputs": {
      // The two view stages only, with `rebuildStale`. Neither extraction
      // stage runs: the graph is never rebuilt here (that is reset-graph,
      // and it is expensive on purpose). Each stage decides for itself
      // whether its stamp is stale; when neither is, this costs no model
      // call and says so.
      const structure = await perf.time("graph-structure", "fn", "runGraphStructure", null, () =>
        runGraphStructure(projectFolder, job.data.actingHumanId, { log: onProgress, perf, rebuildStale: true }),
      );
      if (!structure.ok) throw new Error(structure.error);
      const view = await perf.time("graph-project-view", "fn", "runGraphProjectView", null, () =>
        runGraphProjectView(projectFolder, job.data.actingHumanId, { log: onProgress, perf, rebuildStale: true }),
      );
      if (!view.ok) throw new Error(view.error);
      // Same banner handling as the lone graph-project-view job above.
      const bannerChanged = await syncReadmeIncompleteBanner(
        projectFolder,
        [...structure.incomplete.map((r) => `graph-structure: ${r}`), ...view.incomplete.map((r) => `graph-project-view: ${r}`)],
      );
      if (bannerChanged) onProgress(structure.incomplete.length + view.incomplete.length > 0 ? "rerun-outputs: marked README.md as incomplete on its own first line." : "rerun-outputs: cleared the incomplete notice from README.md.");
      const structureWas = structure.staleSkill ?? false;
      const readmeWas = view.staleSkill ?? false;
      onProgress(
        !structureWas && !readmeWas
          ? "rerun-outputs: nothing stale; structure and README were already written under the current skills."
          : `rerun-outputs: finished (${[structureWas ? "structure re-threaded" : "structure current", readmeWas ? "README rewritten" : "README current"].join(", ")}).`,
      );
      // `coverage` / `readmeChanged` at the top level, same as the pipeline
      // result, so the run row reads them (`coverageFromJobResult`,
      // `readmeChangedFromJobResult`).
      return {
        structure,
        projectView: view,
        structureWasStale: structureWas,
        readmeWasStale: readmeWas,
        coverage: view.coverage,
        readmeChanged: view.changed,
      };
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
    // Each reset's own summary (what it deleted, what it cleared) used to
    // be a return value read only by the CLI; the Vault UI read the job
    // id and nothing else. Recorded onto the run's timeline so the run
    // page says what a reset did (ADR-016).
    case "reset-project-view": {
      const result = await perf.time("reset-project-view", "fn", "resetProjectView", null, () =>
        resetProjectView(projectFolder),
      );
      await perf.event({ process: "reset-project-view", type: "fn", name: "summary", params: { ...result }, durationMs: 0 });
      return result;
    }
    case "reset-graph": {
      const result = await perf.time("reset-graph", "fn", "resetGraph", null, () => resetGraph(projectFolder));
      await perf.event({ process: "reset-graph", type: "fn", name: "summary", params: { ...result }, durationMs: 0 });
      return result;
    }
    case "reset-knowledge": {
      const result = await perf.time("reset-knowledge", "fn", "resetKnowledge", null, () =>
        resetKnowledge(projectFolder),
      );
      await perf.event({ process: "reset-knowledge", type: "fn", name: "summary", params: { ...result }, durationMs: 0 });
      return result;
    }
    case "reset": {
      const result = await perf.time("reset", "fn", "resetProjectAll", null, () => resetProjectAll(projectFolder));
      await perf.event({ process: "reset", type: "fn", name: "summary", params: { ...result }, durationMs: 0 });
      return result;
    }
    default:
      throw new Error(`Unknown GraphLog job name: ${job.name}`);
  }
}

/** Pulls the pipeline's own `incomplete` lines off whatever a job
 * returned. Every agentic stage result and the full-pipeline result carry
 * the same field, and the deterministic reset jobs carry none, so one
 * shape-check covers all of them without the switch above having to
 * report its own outcome a second time. */
/** Pulls the full-pipeline run's own 1.7 denominators off whatever a job
 * returned. Only a `"run"` job carries these (a single-stage or reset job
 * has no whole-run picture to report), so the shape check doubles as the
 * "does this job have stats" test. */
function collectRunStats(result: unknown): {
  nodesWritten: number;
  daysWritten: number;
  graphNodeCount: number | null;
  threadCount: number | null;
} | null {
  if (!result || typeof result !== "object") return null;
  const stats = (result as { stats?: unknown }).stats;
  if (!stats || typeof stats !== "object") return null;
  const s = stats as Record<string, unknown>;
  if (typeof s.nodesWritten !== "number" || typeof s.daysWritten !== "number") return null;
  return {
    nodesWritten: s.nodesWritten,
    daysWritten: s.daysWritten,
    graphNodeCount: typeof s.graphNodeCount === "number" ? s.graphNodeCount : null,
    threadCount: typeof s.threadCount === "number" ? s.threadCount : null,
  };
}

function collectIncomplete(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const value = (result as { incomplete?: unknown }).incomplete;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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
      // A job that didn't throw is not automatically a run that did its
      // job: an agentic stage that hit an output or turn limit commits
      // what it captured and returns successfully so the next run can
      // resume. Correct behaviour, but it used to display as a plain OK.
      // Carried through to the run row so the report can say otherwise.
      await finishGraphLogRun(job.id!, {
        ok: true,
        incomplete: collectIncomplete(result),
        stats: collectRunStats(result),
        coverage: coverageFromJobResult(result),
        readmeChanged: readmeChangedFromJobResult(job.name, result),
      });
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
  } finally {
    // Unconditional — success, failure, or a Stop-triggered
    // `GraphLogCancelledError` all end up here, and a stale cancellation
    // flag left behind by ANY of those paths would silently cancel this
    // project's very next run too (see `graphLogQueue.server.ts`'s own
    // "Cooperative cancellation" section).
    await clearGraphLogCancellation(job.data.projectFolderId);
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

// ─── Admin Scripts ─────────────────────────────────────────────────────────────
// One-off/repair scripts registered in `adminScriptsRegistry.server.ts`,
// triggered from /maker/scripts -- see that registry's own module
// doc for why this exists instead of running scripts locally against a
// `fly proxy` tunnel.

// Serialized (queue concurrency 1, see `adminScriptsQueue.server.ts`), so
// unlike GraphLog's per-project lock, no lock is needed here -- the queue
// itself is the only thing that can ever be running at once.
const ADMIN_SCRIPTS_CONCURRENCY = 1;

async function processAdminScriptJob(job: Job<AdminScriptJobData, unknown, string>): Promise<unknown> {
  const logLines: string[] = [];
  const onProgress = (line: string) => {
    logLines.push(line);
    job.log(line).catch((err) => console.error("Failed to write job log line:", err));
  };

  // Same "job id doubles as the run's own id" convention GraphLog's run
  // tracking uses (see `graphLogPerf.server.ts`'s module doc).
  await startAdminScriptRun({
    runId: job.id!,
    humanId: job.data.actingHumanId,
    scriptName: job.data.scriptName,
    dryRun: job.data.dryRun,
    args: job.data.args,
  });

  try {
    const script = getAdminScript(job.data.scriptName);
    if (!script) throw new Error(`Unknown admin script: "${job.data.scriptName}"`);
    const result = await script.run({ dryRun: job.data.dryRun, args: job.data.args, log: onProgress });
    await finishAdminScriptRun(job.id!, { ok: true, summary: result.summary, log: logLines });
    return result;
  } catch (err) {
    await finishAdminScriptRun(job.id!, {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      log: logLines,
    });
    throw err;
  }
}

const adminScriptsWorker = new Worker<AdminScriptJobData, unknown, string>(
  ADMIN_SCRIPTS_QUEUE_NAME,
  processAdminScriptJob,
  {
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    concurrency: ADMIN_SCRIPTS_CONCURRENCY,
  },
);

adminScriptsWorker.on("completed", (job) => {
  console.log(`[worker] admin-script "${job.data.scriptName}" (${job.id}) completed.`);
});
adminScriptsWorker.on("failed", (job, err) => {
  console.error(`[worker] admin-script "${job?.data.scriptName}" (${job?.id}) failed:`, err);
});

console.log(
  `[worker] Admin scripts worker listening on queue "${ADMIN_SCRIPTS_QUEUE_NAME}" (concurrency ${ADMIN_SCRIPTS_CONCURRENCY}).`,
);

// ─── Public folder zip ("Download all" on /public/folder/:folderId) ──────────────────
// See `publicZip.server.ts`'s own module doc for the caching/dedup shape.
// No per-folder lock needed like GraphLog's -- two concurrent jobs for the
// SAME (folder, fingerprint) can't happen at all (`ensurePublicZipJob`
// only ever enqueues one), and two DIFFERENT folders zipping at once is
// perfectly fine to run in parallel.
const PUBLIC_ZIP_CONCURRENCY = 2;

async function processPublicZipJob(
  job: Job<PublicZipJobData, PublicZipJobResult, string>,
): Promise<PublicZipJobResult> {
  return runPublicFolderZip(job.data.folderId, (progress: PublicZipProgress) => {
    job.updateProgress(progress).catch((err) => console.error("Failed to update zip job progress:", err));
  });
}

const publicZipWorker = new Worker<PublicZipJobData, PublicZipJobResult, string>(
  PUBLIC_ZIP_QUEUE_NAME,
  processPublicZipJob,
  {
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    concurrency: PUBLIC_ZIP_CONCURRENCY,
    // BullMQ's default lock (30s, auto-renewed every ~15s) is tuned for
    // fast jobs -- a real production incident showed a big-photo folder's
    // zip job missing its renewal window ("could not renew lock for job
    // ...") under memory pressure from the OLD buffer-everything
    // implementation (see `publicZip.server.ts`'s own doc for the fix).
    // Streaming now keeps memory far more bounded, but this is kept as a
    // deliberate safety margin: a real GC pause or a slow file (large
    // upload over a slow connection) has much more room before the lock
    // renewal timer could ever miss its window again.
    lockDuration: 10 * 60 * 1000,
  },
);

publicZipWorker.on("completed", (job) => {
  console.log(
    `[worker] public zip ${job.id} completed (${job.returnvalue.fileCount} files, ${job.returnvalue.size} bytes).`,
  );
});
publicZipWorker.on("failed", (job, err) => {
  console.error(`[worker] public zip ${job?.id} failed:`, err);
});

console.log(
  `[worker] Public folder zip worker listening on queue "${PUBLIC_ZIP_QUEUE_NAME}" (concurrency ${PUBLIC_ZIP_CONCURRENCY}).`,
);

// Graceful shutdown — let an in-flight job finish (or fail cleanly) rather
// than abandon it mid-run: GraphLog's own idempotency makes a clean
// re-run of an ABANDONED job safe, but an UNGRACEFULLY killed one can
// leave partial writes mid-flight.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, finishing in-flight jobs before exit…`);
  await Promise.all([graphLogWorker.close(), adminScriptsWorker.close(), publicZipWorker.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
