/**
 * Orchestrates GraphLog's full pipeline for one project, in order (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
 *     -> graph-project-view
 *
 * Mirrors `phylogAgent.server.ts`'s own `runPhylogPipeline` shape — one
 * job (`nopal graphlog run` / `POST /api/graphlog/run`) runs all five
 * stages sequentially, sharing one progress log. Each stage is ALSO
 * independently runnable (its own CLI subcommand/API route) for iterating
 * on one project's own skill files without paying for the others every
 * time — this is purely a convenience composition, no new logic of its
 * own beyond calling the five stage functions in order and stopping (with
 * a real error) if any of them fails.
 *
 * `daily-log-sync` runs first and unconditionally (deterministic, no
 * skill gate, no LLM cost) — same reason PhyLog's own pre-capture STAGING
 * is unconditional ahead of its skill-gated summarization: the later
 * agentic stages need `syncs/Daily Logs` to actually be populated to have
 * anything to work from.
 */

import { runDailyLogSync } from "./dailyLogSync.server";
import { runSyncKnowledge, type SyncKnowledgeResult } from "./syncKnowledge.server";
import { runSyncGraph, type SyncGraphResult } from "./syncGraph.server";
import { runGraphStructure, type GraphStructureResult } from "./graphStructure.server";
import { runGraphProjectView, type GraphProjectViewResult } from "./graphProjectView.server";
import { getFolderById, type VaultFolder } from "./vault.server";
import type { LlmProvider } from "./llmProvider";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";

export type GraphLogPipelineResult =
  | {
      ok: true;
      dailyLogSync: Awaited<ReturnType<typeof runDailyLogSync>>;
      syncKnowledge: SyncKnowledgeResult;
      syncGraph: SyncGraphResult;
      graphStructure: GraphStructureResult;
      graphProjectView: GraphProjectViewResult;
    }
  | { ok: false; error: string };

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

  log("run: starting daily-log-sync...");
  const dailyLogSync = await perf.time("daily-log-sync", "fn", "runDailyLogSync", null, () =>
    runDailyLogSync(projectFolderId, {}),
  );
  log(
    `run: daily-log-sync done (${dailyLogSync.synced.length} synced, ${dailyLogSync.attachmentsCopied.length} attachment(s) copied).`,
  );

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

  return { ok: true, dailyLogSync, syncKnowledge, syncGraph, graphStructure, graphProjectView };
}
