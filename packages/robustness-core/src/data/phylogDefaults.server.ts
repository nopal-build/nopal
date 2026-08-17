/**
 * Admin-editable overrides for PhyLog's default skill content -- the
 * three strings a brand new `project-n01` folder gets seeded with
 * (`skills/PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md`, see
 * `projectN01.server.ts`'s `ensureProjectN01`), and the one
 * (`DEFAULT_CAPTURE_SKILL`) `capture.server.ts` also falls back to at
 * RUN TIME if a project's own `CAPTURE.md` is somehow missing.
 *
 * Previously these were plain hardcoded constants, invisible and
 * unreachable from anywhere in the product -- reviewing or tuning them
 * meant reading/editing this file's own source and redeploying. This
 * module makes them reviewable and editable from `/fruits/maker/phylog`
 * (Admin/Super only, see the `phylog` skill), backed by a single
 * database row (`phylog_default_skills`, one row, fixed id `main`) with
 * one OPTIONAL field per stage -- unset/null means "use the hardcoded
 * constant below," so a fresh deploy with no overrides yet behaves
 * identically to before this existed.
 *
 * DELIBERATELY NOT RETROACTIVE: editing a default here only ever
 * affects (a) a brand new project's seed content going forward, and (b)
 * the rare runtime fallback when a project's own file is missing. It
 * never reaches into an EXISTING project's own already-seeded
 * `skills/*.md` file -- that file is that project's own copy from the
 * moment it's created, and PhyLog already treats a project's `skills/`
 * folder as the ONE place a human is meant to edit directly (see the
 * `vault` skill's Vault Folder Types section). Silently rewriting a
 * project's own customized skill file out from under it because an
 * admin tuned the org-wide default would be a real, surprising data-loss
 * bug, not a feature.
 */

import { RecordId } from "surrealdb";
import { defineTable, formatRecord, query, upsert, type Data } from "./generic.server";

// ─── Hardcoded factory defaults ────────────────────────────────────────
// Moved here (from `projectN01.server.ts`) so this file can be the
// single source of truth for "what does a brand new project's skill
// file say" -- both the hardcoded fallback AND the override/resolution
// logic live in one place, and `projectN01.server.ts` depends on THIS
// file rather than the other way around (avoids an import cycle, since
// this file has no reason to depend on anything in `projectN01.server.ts`).

/** Same marker `projectN01.server.ts`'s `isSkipInstruction` checks for --
 * duplicated here as a tiny, private literal rather than imported, since
 * importing it from `projectN01.server.ts` would create exactly the
 * import cycle this module's own doc above is designed to avoid. */
const SKIP_MARKER = "skip";

export const DEFAULT_PRE_CAPTURE_SKILL = `${SKIP_MARKER}

PhyLog's pre-capture stage does nothing until you replace this with real
instructions. When it runs, it looks at every file attached to this
project's daily-log Cards, and every file inside this project's own
\`syncs/\` folder, that doesn't already have a sibling \`*-summary.md\` next
to it — and asks an AI to decide (per the instructions you write here)
whether to write one, and what it should focus on.

For example, you might replace this with something like:

- Describe every photo attachment factually — what it shows, not what it
  means.
- Summarize any PDF or text file dropped into syncs/ in 2-3 sentences.
- Skip anything that's just a screenshot of a chat.

Leaving this file as "skip" means pre-capture is a complete no-op — capture
will still run, it just won't have any pre-written summaries to draw on.
`;

export const DEFAULT_CAPTURE_SKILL = `File every new attachment from this project's daily-log Cards into this
project, and keep README.md as a clear, organized index linking to
everything that's been filed. Reorganize into subfolders only when it
clearly helps keep things navigable — don't create structure for its own
sake. Never invent progress, dates, or facts that aren't grounded in the
Card content, any pre-capture summaries, or README.md's own existing
content.

When presenting a GROUP of related photos, use the ::gallery{folder="..."}
directive (group them into a single subfolder, then reference it by name)
so they display as a photo grid instead of a bulleted list of links.

Replace this file with your own instructions to change how this project
gets organized — e.g. "group photos by month" or "keep a running task
list at the top of the README."
`;

export const DEFAULT_POST_CAPTURE_SKILL = `${SKIP_MARKER}

Post-capture is reserved for processing that happens after this project's
structure and README have already been captured — for example, the
planned "newspapers" space (a generated daily/individual digest). Nothing
runs here yet; replace this file once there's something you want done
after every capture.
`;

// ─── Overrides ──────────────────────────────────────────────────────────

export type PhylogDefaultStage = "preCapture" | "capture" | "postCapture";

const STAGE_HARDCODED_DEFAULT: Record<PhylogDefaultStage, string> = {
  preCapture: DEFAULT_PRE_CAPTURE_SKILL,
  capture: DEFAULT_CAPTURE_SKILL,
  postCapture: DEFAULT_POST_CAPTURE_SKILL,
};

const TABLE = "phylog_default_skills";
const ROW_ID = "main";

type PhylogDefaultSkillsRow = Data & {
  preCapture?: string | null;
  capture?: string | null;
  postCapture?: string | null;
  updatedAt?: string;
  updatedByHumanId?: string;
};

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

async function getOverrideRow(): Promise<PhylogDefaultSkillsRow | null> {
  await ensureTable();
  const result = await query<[PhylogDefaultSkillsRow[]]>(`SELECT * FROM ${TABLE} LIMIT 1`);
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : null;
}

export type EffectiveDefaultSkill = {
  content: string;
  /** True when this is an admin-set override, not the hardcoded
   * built-in -- drives the "Reset to built-in default" affordance on
   * `/fruits/maker/phylog`. */
  overridden: boolean;
};

/** The single value every real call site actually needs: what should a
 * new project's `skills/<STAGE>.md` be seeded with right now, and (for
 * `capture`) what should `capture.server.ts` fall back to if a
 * project's own file is missing. Falls back to the hardcoded constant
 * whenever no override row exists, or this specific stage's field on it
 * is unset/blank. */
export async function getEffectiveDefaultSkill(stage: PhylogDefaultStage): Promise<string> {
  const row = await getOverrideRow();
  const override = row?.[stage];
  return override && override.trim().length > 0 ? override : STAGE_HARDCODED_DEFAULT[stage];
}

/** All three at once, each labeled with whether it's overridden -- what
 * `/fruits/maker/phylog`'s own loader uses to render the review/edit UI
 * in a single round trip instead of three. */
export async function getAllEffectiveDefaultSkills(): Promise<Record<PhylogDefaultStage, EffectiveDefaultSkill>> {
  const row = await getOverrideRow();
  const resolve = (stage: PhylogDefaultStage): EffectiveDefaultSkill => {
    const override = row?.[stage];
    if (override && override.trim().length > 0) {
      return { content: override, overridden: true };
    }
    return { content: STAGE_HARDCODED_DEFAULT[stage], overridden: false };
  };
  return {
    preCapture: resolve("preCapture"),
    capture: resolve("capture"),
    postCapture: resolve("postCapture"),
  };
}

/** Sets (or clears, when `content` is `null`) this stage's override.
 * Clearing reverts every future new project's seed content (and, for
 * `capture`, the runtime fallback) back to the hardcoded built-in --
 * this row is never deleted outright, just has that one field unset, so
 * the OTHER two stages' overrides (if any) are untouched. */
export async function setDefaultSkillOverride(
  stage: PhylogDefaultStage,
  content: string | null,
  updatedByHumanId: string,
): Promise<void> {
  await ensureTable();
  // `upsert` here is a full replace (`UPDATE ... CONTENT`, not a partial
  // merge -- same convention `phylogMetrics.server.ts`'s own bucket
  // upsert already established), so the OTHER two stages' existing
  // overrides have to be fetched and re-specified explicitly, or this
  // call would silently wipe them out.
  const existing = await getOverrideRow();
  await upsert(new RecordId(TABLE, ROW_ID), {
    preCapture: existing?.preCapture ?? null,
    capture: existing?.capture ?? null,
    postCapture: existing?.postCapture ?? null,
    [stage]: content && content.trim().length > 0 ? content : null,
    updatedAt: new Date().toISOString(),
    updatedByHumanId,
  });
}
