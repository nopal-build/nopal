/**
 * Orchestrates GraphLog's full pipeline for one project, in order (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
 *     -> graph-project-view
 *
 * One job (`nopal graphlog run` / `POST /api/graphlog/run`) runs all five
 * stages sequentially, sharing one progress log. Each stage is ALSO
 * independently runnable (its own CLI subcommand/API route) for iterating
 * on one project's own skill files without paying for the others every
 * time — this is purely a convenience composition, no new logic of its
 * own beyond calling the five stage functions in order and stopping (with
 * a real error) if any of them fails.
 *
 * THREE OUTCOMES, NOT TWO. `ok: false` is a hard stop: a stage threw or
 * couldn't run, and nothing after it ran either. `ok: true` with an empty
 * `incomplete` is a clean run. `ok: true` with a NON-EMPTY `incomplete` is
 * the state that used to be indistinguishable from clean, and it is the
 * common one when something goes wrong: a stage that hits an output limit
 * or a turn limit commits what it captured, returns `ok: true`, and is
 * retried next run. That recovery behaviour is right and should stay.
 * What it must not do is let the run call itself OK. See
 * `GraphLogPipelineResult`'s own `incomplete` doc for the real run that
 * made this necessary.
 *
 * `daily-log-sync` runs first and unconditionally (deterministic, no
 * skill gate, no LLM cost) — the later agentic stages need
 * `syncs/Daily Logs` to actually be populated to have anything to work
 * from.
 */

import { runDailyLogSync } from "./dailyLogSync.server";
import { runSyncKnowledge, type SyncKnowledgeResult } from "./syncKnowledge.server";
import { runSyncGraph, type SyncGraphResult } from "./syncGraph.server";
import { runGraphStructure, type GraphStructureResult } from "./graphStructure.server";
import { runGraphProjectView, type GraphProjectViewResult } from "./graphProjectView.server";
import { getFolderById, type VaultFolder } from "./vault.server";
import type { LlmProvider } from "./llmProvider";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";

export type GraphLogPipelineResult =
  | {
      ok: true;
      dailyLogSync: Awaited<ReturnType<typeof runDailyLogSync>>;
      syncKnowledge: SyncKnowledgeResult;
      syncGraph: SyncGraphResult;
      graphStructure: GraphStructureResult;
      graphProjectView: GraphProjectViewResult;
      /** Every reason a stage finished without doing its whole job,
       * prefixed with the stage it came from. Empty on a fully clean run.
       *
       * `ok: true` with a non-empty `incomplete` is the honest middle
       * state this pipeline was missing. A real run reported OK at the top
       * while holding a truncated `graph-structure` batch and, directly
       * downstream of it, a `graph-project-view` that produced nothing:
       * the truncation left `asOfGraphHash` unstamped, so the view's own
       * up-to-date check skipped it. Neither stage threw, so neither was
       * `ok: false`, so the run called itself fine. A run is not fine when
       * a stage errored and the stage after it produced nothing.
       *
       * Not modelled as failure on purpose -- ADR-011
       * (docs/adr/0011-budget-bounds-lateness-never-what-is-kept.md, kept out of the public repo):
       * every case is resumable and already committed real progress. What
       * was wrong was the reporting, not the recovery. */
      incomplete: string[];
      /** 1.7's denominators, so cost becomes a RATE rather than a total.
       *
       * The per-run and per-stage cost was already recorded; what was
       * missing was anything to divide it by. Without these, one run at one
       * graph size looks the same as another and no curve is visible. The
       * three stages have genuinely different curves: extraction's output
       * scales with the day but its INPUT scales with the whole graph
       * (`graph-structure.md` rides in its system prompt as the
       * link-candidate list and is resent every turn), `graph-structure` is
       * the same shape but gentler, and the view stage is bounded by design
       * via `NODE_PREFETCH_BUDGET` so it should stay flat as the graph
       * grows.
       *
       * That split is the commercial question too: per-project cost is a
       * flat part (the views) plus a growing part (extraction against graph
       * size), and neither can be priced until the curve is visible. */
      stats: GraphLogRunStats;
    }
  | { ok: false; error: string };

export type GraphLogRunStats = {
  /** Nodes written across every day this run. */
  nodesWritten: number;
  /** Days that produced a file this run. */
  daysWritten: number;
  /** Total nodes in the whole graph after this run, and threads in
   * `graph-structure.md` after it. Null when `graph-structure` didn't get
   * far enough to know. */
  graphNodeCount: number | null;
  threadCount: number | null;
};

export interface RunGraphLogPipelineOptions {
  provider?: LlmProvider;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. Each
   * stage below is wrapped in its own `perf.time(...)` span (tagged with
   * that stage's own name as `process`) so a full `nopal graphlog run`
   * shows up as one run whose timeline spans all five stages, not five
   * separate untagged runs. Omit to run with no timeline recorded (e.g. a
   * script/test with no job/run context). */
  perf?: GraphLogPerfRecorder;
}

export async function runGraphLogPipeline(
  actingHumanId: string,
  projectFolderId: string,
  opts: RunGraphLogPipelineOptions = {},
  onProgress?: (line: string) => void,
): Promise<GraphLogPipelineResult> {
  const log = onProgress ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const projectFolder: VaultFolder | undefined = await getFolderById(projectFolderId);
  if (!projectFolder) return { ok: false, error: "Project not found" };

  // A Stop request (see `graphLogQueue.server.ts`'s own "Cooperative
  // cancellation" section) is checked between each of the five stages
  // below, plus once more per turn/file/day INSIDE the three agentic
  // stages themselves -- this top-level check alone would otherwise leave
  // Stop unable to interrupt anything until a whole stage finishes.
  await throwIfGraphLogCancelled(projectFolderId);

  log("run: starting daily-log-sync...");
  const dailyLogSync = await perf.time("daily-log-sync", "fn", "runDailyLogSync", null, () =>
    runDailyLogSync(projectFolderId, {}),
  );
  log(
    `run: daily-log-sync done (${dailyLogSync.synced.length} synced, ${dailyLogSync.attachmentsCopied.length} attachment(s) copied).`,
  );

  await throwIfGraphLogCancelled(projectFolderId);
  log("run: starting sync-knowledge...");
  const syncKnowledge = await perf.time("sync-knowledge", "fn", "runSyncKnowledge", null, () =>
    runSyncKnowledge(projectFolder, actingHumanId, {
      provider: opts.provider,
      log,
      perf,
    }),
  );
  if (!syncKnowledge.ok) return { ok: false, error: syncKnowledge.error };
  log(syncKnowledge.skipped ? "run: sync-knowledge skipped." : "run: sync-knowledge done.");

  await throwIfGraphLogCancelled(projectFolderId);
  log("run: starting sync-graph...");
  const syncGraph = await perf.time("sync-graph", "fn", "runSyncGraph", null, () =>
    runSyncGraph(projectFolder, actingHumanId, {
      provider: opts.provider,
      log,
      perf,
    }),
  );
  if (!syncGraph.ok) return { ok: false, error: syncGraph.error };
  log(syncGraph.skipped ? "run: sync-graph skipped." : "run: sync-graph done.");

  await throwIfGraphLogCancelled(projectFolderId);
  log("run: starting graph-structure...");
  const graphStructure = await perf.time("graph-structure", "fn", "runGraphStructure", null, () =>
    runGraphStructure(projectFolder, actingHumanId, {
      provider: opts.provider,
      log,
      perf,
    }),
  );
  if (!graphStructure.ok) return { ok: false, error: graphStructure.error };
  log(graphStructure.skipped ? "run: graph-structure skipped." : "run: graph-structure done.");

  await throwIfGraphLogCancelled(projectFolderId);
  log("run: starting graph-project-view...");
  const graphProjectView = await perf.time("graph-project-view", "fn", "runGraphProjectView", null, () =>
    runGraphProjectView(projectFolder, actingHumanId, {
      provider: opts.provider,
      log,
      perf,
    }),
  );
  if (!graphProjectView.ok) return { ok: false, error: graphProjectView.error };
  log(graphProjectView.skipped ? "run: graph-project-view skipped." : "run: graph-project-view done.");

  const incomplete = [
    ...syncGraph.incomplete.map((r) => `sync-graph: ${r}`),
    ...graphStructure.incomplete.map((r) => `graph-structure: ${r}`),
    ...graphProjectView.incomplete.map((r) => `graph-project-view: ${r}`),
  ];
  if (incomplete.length > 0) {
    log(`run: finished INCOMPLETE — ${incomplete.length} stage issue(s), each retried next run:`);
    for (const line of incomplete) log(`run:   - ${line}`);
  } else {
    log("run: finished clean.");
  }

  const stats: GraphLogRunStats = {
    nodesWritten: syncGraph.nodesWritten,
    daysWritten: syncGraph.days.filter((d) => d.changed && !d.empty).length,
    graphNodeCount: graphStructure.graphNodeCount,
    threadCount: graphStructure.threadCount,
  };
  log(
    `run: ${stats.nodesWritten} node(s) written across ${stats.daysWritten} day(s); graph now holds ${stats.graphNodeCount ?? "?"} node(s) in ${stats.threadCount ?? "?"} thread(s).`,
  );

  return {
    ok: true,
    dailyLogSync,
    syncKnowledge,
    syncGraph,
    graphStructure,
    graphProjectView,
    incomplete,
    stats,
  };
}
