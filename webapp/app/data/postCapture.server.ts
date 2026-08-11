/**
 * PhyLog's post-capture stage — the THIRD, currently mostly-reserved stage
 * of the pipeline (see the `phylog` skill):
 *
 *   pre-capture (`preCapture.server.ts`) -> capture (`capture.server.ts`)
 *     -> post-capture (this file)
 *
 * A deliberate placeholder: `skills/POST_CAPTURE.md` is seeded "skip" by
 * default (`projectN01.server.ts`), and there are no tools wired up yet —
 * this stage exists so the pipeline's SHAPE (pre-capture -> capture ->
 * post-capture) is already real and callable, ahead of actually defining
 * what runs here. The first planned use is generating the `newspapers`
 * space type (see `vaultFolderTypes.ts`) — an individual/daily digest
 * built from what capture just produced.
 *
 * When the skill file is anything other than "skip", this currently only
 * REPORTS that instructions exist and does nothing else — no model call is
 * made (there's genuinely nothing for it to do yet).
 */

import { getProjectStageSkill, isSkipInstruction } from "./projectN01.server";
import type { VaultFolder } from "./vault.server";

export type PostCaptureResult = { ok: true; skipped: boolean; note?: string };

export async function runPostCapture(
  _actingHumanId: string,
  projectFolder: VaultFolder,
  onProgress?: (line: string) => void,
): Promise<PostCaptureResult> {
  const log = onProgress ?? (() => {});
  const skill = await getProjectStageSkill(projectFolder, "POST_CAPTURE.md");
  if (isSkipInstruction(skill)) {
    log("post-capture: skills/POST_CAPTURE.md says skip — nothing to do.");
    return { ok: true, skipped: true };
  }
  log("post-capture: instructions found in skills/POST_CAPTURE.md, but no post-capture tools are implemented yet.");
  return {
    ok: true,
    skipped: false,
    note: "Post-capture instructions are present but not yet actionable — no tools implemented.",
  };
}
