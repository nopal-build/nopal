// =============================================================================
// Admin script: Backfill Guide Projects Board (guide-projects-phases).
//
// `createBoardCardForNewProject` only fires for a project started AFTER
// the "Ensure Org Kanban Board" script provisioned `org/kanban-projects/`
// — every project that already existed needs a card made for it here,
// once, by hand (well, by this script).
//
// Target phase, from each project's EXISTING `active`/`completed`/
// `trashed` status (`projectStatus.server.ts`):
//   - `completed` -> the board's End-type phase (it's already done).
//   - `active`    -> the board's Start-type phase (no way to know which
//                    of Seed/Discovery/Design it "should" be in — this
//                    is a deliberate, simple default, same spirit as
//                    "Backfill Organizations"'s own role defaults:
//                    cheap to hand-correct afterward via the board UI).
//   - `trashed`   -> skipped entirely, no card. A trashed project is
//                    already on its way to permanent deletion; it
//                    shouldn't clutter the board a Guide works from.
//
// Idempotent — a project already represented by SOME card anywhere on
// the board (scanned fresh every run, not a one-time marker) is skipped.
// =============================================================================

import { listEveryProject } from "../projectSharing.server";
import { getProjectStatus } from "../projectStatus.server";
import {
  getOrgBoardAnchor,
  listBoardPhases,
  listPhaseCards,
  createBoardCardForProject,
} from "../guideProjectsBoard.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const anchor = await getOrgBoardAnchor();
  if (!anchor) {
    return { summary: 'No Projects board yet — run "Ensure Org Kanban Board" first.' };
  }

  const phases = await listBoardPhases(anchor);
  const startPhase = phases.find((p) => p.type === "start");
  const endPhase = phases.find((p) => p.type === "end");
  if (!startPhase || !endPhase) {
    return { summary: "The board has no Start-type and/or End-type phase — can't backfill." };
  }

  log(`Scanning the board's ${phases.length} phase(s) for projects already carded…`);
  const alreadyCarded = new Set<string>();
  for (const phase of phases) {
    const cards = await listPhaseCards(phase);
    for (const card of cards) {
      if (card.projectFolderId) alreadyCarded.add(card.projectFolderId);
    }
  }
  log(`${alreadyCarded.size} project(s) already have a card.`);

  const everyProject = await listEveryProject();
  // `website` projects aren't "projects" in the Guide Projects sense —
  // they don't go through commissioning phases at all. `startProject`
  // (new-project auto-card hook) never creates one in the first place
  // (confirmed: `api.vault.folders.tsx` only calls `startProject` when
  // no explicit `folder_type` is given; a website always passes one) —
  // this filter is what keeps the BACKFILL from wrongly carding one.
  const candidateProjects = everyProject.filter(({ folder }) => folder.folder_type === "project-n02");
  log(`Found ${everyProject.length} project folder(s) org-wide, ${candidateProjects.length} of type project-n02.`);

  let created = 0;
  let skippedTrashed = 0;
  let skippedAlreadyCarded = 0;
  for (const { folder } of candidateProjects) {
    if (alreadyCarded.has(folder._id)) {
      skippedAlreadyCarded++;
      continue;
    }
    const status = getProjectStatus(folder);
    if (status === "trashed") {
      log(`  skipping "${folder.name}" (trashed)`);
      skippedTrashed++;
      continue;
    }
    const targetPhase = status === "completed" ? endPhase : startPhase;
    log(`  ${dryRun ? "would create" : "creating"} a card for "${folder.name}" (${status}) in ${targetPhase.name}`);
    if (!dryRun) {
      await createBoardCardForProject(folder, folder.human_id, targetPhase);
    }
    created++;
  }

  const summary = `${created} card(s) ${dryRun ? "would be " : ""}created, ${skippedAlreadyCarded} already carded, ${skippedTrashed} trashed (skipped).`;
  log(summary);
  return { summary };
}
