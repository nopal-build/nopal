/**
 * PhyLog's orchestrator — ties the three pipeline stages together (see the
 * `phylog` skill for the full design):
 *
 *   pre-capture (`preCapture.server.ts`) -> capture (`capture.server.ts`)
 *     -> post-capture (`postCapture.server.ts`)
 *
 * `runPhylogPipeline` is what `nopal phylog run` (and its API route) call —
 * every project path first goes through `resolveProjectN01`
 * (`projectN01.server.ts`), which validates it's actually a project (or
 * `personal`) and lazily retrofits/seeds it if it predates the
 * `project-n01` type. The three stages are ALSO independently callable
 * (`nopal phylog pre-capture` / `capture` / `post-capture`) — see
 * `crates/cli/src/phylog.rs` and the `api.phylog.*` routes, which call
 * `runPreCapture`/`runCapture`/`runPostCapture` directly instead of going
 * through this file.
 *
 * ALWAYS APPLIES — there is no `--apply` flag or `dryRun` mode anywhere in
 * this pipeline anymore (a deliberate simplification once the `project-n01`
 * reset/rebuild story existed: `nopal phylog reset` plus `capture --full`
 * IS the "start over and inspect" workflow that used to be `--apply`'s
 * absence). `nopal release-log revert` remains the safety net for undoing
 * a specific capture's README edit.
 */

import { resolveProjectN01, resetProjectN01Content, type ResetSummary } from "./projectN01.server";
import { runPreCapture, type PreCaptureResult } from "./preCapture.server";
import { runCapture, type CaptureResult } from "./capture.server";
import { runPostCapture, type PostCaptureResult } from "./postCapture.server";
import type { LlmProvider, PhotoDescriber } from "./llmProvider";

export type PhylogRunOptions = {
  /** capture's full-rebuild mode — see `capture.server.ts`. */
  full?: boolean;
  since?: string;
  until?: string;
  provider?: LlmProvider;
  photoDescriber?: PhotoDescriber;
};

export type PhylogRunResult =
  | {
      ok: true;
      preCapture: PreCaptureResult;
      capture: CaptureResult;
      postCapture: PostCaptureResult;
    }
  | { ok: false; error: string };

/** Runs all three stages, in order, for one project. */
export async function runPhylogPipeline(
  actingHumanId: string,
  projectFolderId: string,
  opts: PhylogRunOptions = {},
  onProgress?: (line: string) => void,
): Promise<PhylogRunResult> {
  const log = onProgress ?? (() => {});
  const resolved = await resolveProjectN01(projectFolderId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const projectFolder = resolved.folder;

  log("=== Stage 1/3: pre-capture ===");
  const preCapture = await runPreCapture(
    actingHumanId,
    projectFolder,
    { provider: opts.provider, photoDescriber: opts.photoDescriber },
    log,
  );
  if (!preCapture.ok) return { ok: false, error: preCapture.error };

  log("=== Stage 2/3: capture ===");
  const capture = await runCapture(
    actingHumanId,
    projectFolder,
    { full: opts.full ?? false, since: opts.since, until: opts.until, provider: opts.provider },
    log,
  );
  if (!capture.ok) return { ok: false, error: capture.error };

  log("=== Stage 3/3: post-capture ===");
  const postCapture = await runPostCapture(actingHumanId, projectFolder, log);

  return { ok: true, preCapture, capture, postCapture };
}

export type ResetProjectResult =
  | { ok: true; summary: ResetSummary }
  | { ok: false; error: string };

/**
 * Deletes every direct child of a `project-n01` folder except its
 * `skills`/`syncs`/`newspapers` anchors and, unless `wipeDailyLogs` is
 * passed, `daily-logs` too — see `resetProjectN01Content`'s own doc for
 * the two distinct reset depths (`nopal phylog reset` vs
 * `reset-pre-capture`). A standalone, explicit operation, never run
 * implicitly — a human can inspect the emptied-out state before running
 * `capture --full` (or `phylog run --full`) to rebuild.
 */
export async function resetProject(
  projectFolderId: string,
  opts: { wipeDailyLogs?: boolean } = {},
): Promise<ResetProjectResult> {
  const resolved = await resolveProjectN01(projectFolderId);
  if (!resolved.ok) return resolved;
  const summary = await resetProjectN01Content(resolved.folder, opts);
  return { ok: true, summary };
}

export { resolveProjectN01 };
export type { PreCaptureResult, CaptureResult, PostCaptureResult };
