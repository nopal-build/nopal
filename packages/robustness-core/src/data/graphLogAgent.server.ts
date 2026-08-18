/**
 * Orchestrates GraphLog's full pipeline for one project, in order (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view
 *
 * Mirrors `phylogAgent.server.ts`'s own `runPhylogPipeline` shape — one
 * job (`nopal graphlog run` / `POST /api/graphlog/run`) runs all four
 * stages sequentially, sharing one progress log. Each stage is ALSO
 * independently runnable (its own CLI subcommand/API route) for iterating
 * on one project's own skill files without paying for the others every
 * time — this is purely a convenience composition, no new logic of its
 * own beyond calling the four stage functions in order and stopping (with
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
import { runGraphProjectView, type GraphProjectViewResult } from "./graphProjectView.server";
import { getFolderById, type VaultFolder } from "./vault.server";
import type { LlmProvider } from "./llmProvider";

export type GraphLogPipelineResult =
  | {
      ok: true;
      dailyLogSync: Awaited<ReturnType<typeof runDailyLogSync>>;
      syncKnowledge: SyncKnowledgeResult;
      syncGraph: SyncGraphResult;
      graphProjectView: GraphProjectViewResult;
    }
  | { ok: false; error: string };

export interface RunGraphLogPipelineOptions {
  provider?: LlmProvider;
}

export async function runGraphLogPipeline(
  actingHumanId: string,
  projectFolderId: string,
  opts: RunGraphLogPipelineOptions = {},
  onProgress?: (line: string) => void,
): Promise<GraphLogPipelineResult> {
  const log = onProgress ?? (() => {});

  const projectFolder: VaultFolder | undefined = await getFolderById(projectFolderId);
  if (!projectFolder) return { ok: false, error: "Project not found" };

  log("run: starting daily-log-sync...");
  const dailyLogSync = await runDailyLogSync(projectFolderId, {});
  log(
    `run: daily-log-sync done (${dailyLogSync.synced.length} synced, ${dailyLogSync.attachmentsCopied.length} attachment(s) copied).`,
  );

  log("run: starting sync-knowledge...");
  const syncKnowledge = await runSyncKnowledge(projectFolder, actingHumanId, {
    provider: opts.provider,
    log,
  });
  if (!syncKnowledge.ok) return { ok: false, error: syncKnowledge.error };
  log(syncKnowledge.skipped ? "run: sync-knowledge skipped." : "run: sync-knowledge done.");

  log("run: starting sync-graph...");
  const syncGraph = await runSyncGraph(projectFolder, actingHumanId, {
    provider: opts.provider,
    log,
  });
  if (!syncGraph.ok) return { ok: false, error: syncGraph.error };
  log(syncGraph.skipped ? "run: sync-graph skipped." : "run: sync-graph done.");

  log("run: starting graph-project-view...");
  const graphProjectView = await runGraphProjectView(projectFolder, actingHumanId, {
    provider: opts.provider,
    log,
  });
  if (!graphProjectView.ok) return { ok: false, error: graphProjectView.error };
  log(graphProjectView.skipped ? "run: graph-project-view skipped." : "run: graph-project-view done.");

  return { ok: true, dailyLogSync, syncKnowledge, syncGraph, graphProjectView };
}
