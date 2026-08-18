/**
 * Starter default content for GraphLog's three agentic skill files —
 * `skills/KNOWLEDGE.md` / `GRAPH.md` / `PROJECT_VIEW.md`, seeded into every
 * brand new `project-n02` space (see `projectN02.server.ts`'s
 * `ensureProjectN02`, and the `graphlog` skill for the full pipeline).
 *
 * These are genuinely STARTER drafts, not finished prompts — written now so
 * `project-n02` has something usable the moment its pipeline stages exist,
 * expected to change as the actual `sync-knowledge`/`sync-graph`/
 * `graph-project-view` stages get built and iterated on against real
 * content.
 *
 * Also mirrors `phylogDefaults.server.ts`'s admin-editable-override layer
 * (a single DB row, `graphlog_default_skills`, one OPTIONAL field per
 * stage) — added once `/fruits/maker/graphlog/defaults` existed to review
 * these from, same as PhyLog's own defaults got theirs after, not before,
 * a real Maker page existed. See that module's own doc for the full
 * reasoning (deliberately NOT retroactive — only affects a brand new
 * project's seed content going forward, never an existing project's own
 * already-seeded `skills/*.md` file).
 */

import { RecordId } from "surrealdb";
import { defineTable, formatRecord, query, upsert, type Data } from "./generic.server";

/** Same marker `projectN01.server.ts`'s `isSkipInstruction` checks for.
 * Not imported from there — see that module's own doc for why duplicating
 * this one small literal avoids a cross-pipeline import that has no other
 * reason to exist. GraphLog's own stages should define their own
 * `isSkipInstruction`-equivalent when they're built, reading this same
 * marker convention. */
const SKIP_MARKER = "skip";

export const DEFAULT_KNOWLEDGE_SKILL = `${SKIP_MARKER}

GraphLog's sync-knowledge stage does nothing until you replace this with
real instructions. When it runs, it looks at every file inside this
project's \`syncs/\` tree that doesn't already have a sibling
\`<name>.knowledge.md\` in that folder's own \`_knowledge/\` subfolder, and
asks an AI to decide (per the instructions you write here) whether to
write one, and what it should focus on pulling out.

A knowledge file is metadata ABOUT a synced file, not a summary of it —
sync-graph reads these to decide what's worth turning into a graph node,
so favor concrete, extractable facts over prose. For example, you might
replace this with something like:

- For a photo: who/what/where is visible, and any dates/timestamps
  legible in the image itself.
- For a PDF or text file: names, dates, decisions, and dollar amounts
  mentioned, as a short bullet list — not a narrative summary.
- Skip anything that's just a screenshot of a chat with no new
  information beyond what the chat text itself already says.

Leaving this file as "skip" means sync-knowledge is a complete no-op —
sync-graph will still run, it just won't have any knowledge files to draw
on beyond the raw synced content itself.
`;

export const DEFAULT_GRAPH_SKILL = `Read everything new under this project's \`syncs/\` tree (including any
\`_knowledge/*.knowledge.md\` files sync-knowledge has already written) and
pull out the statements worth remembering as their own, independently
citable nodes — not a summary of the day, a small set of verbatim or
near-verbatim quotes that matter on their own.

For each node:

- Quote the source material directly wherever possible. Don't paraphrase
  something that was said plainly just to make it sound more polished.
- Give it a short, stable heading so later days can link back to it, e.g.
  \`### Decided to use cedar for the fence\`.
- Cite where it came from with a verbose ref directive right after the
  quote, e.g.:
  \`:ref{name="Jane Doe" human-id="h_abc123" datetime="2026-08-17T14:30:00Z" location="/h_abc123:personal/syncs/Daily Logs/2026-08-17.md" verbose="true"}\`
- If this node clearly follows up on, contradicts, or resolves an earlier
  node from a PREVIOUS day's graph log, link to it by heading, e.g.
  \`See [Decided to use cedar for the fence](./graph-log-2026-08-10.md#decided-to-use-cedar-for-the-fence)\`.
  Only link BACKWARD to earlier days — never forward to a day that hasn't
  happened yet.
- Leave out anything that's small talk, purely logistical with no lasting
  relevance, or already fully captured by an existing node with nothing
  new added.

If a day has genuinely nothing worth turning into a node, don't force
one — it's fine for sync-graph to produce no file for that day at all.

Replace this file with your own instructions to change what counts as
worth capturing, or how nodes should be written/linked.
`;

export const DEFAULT_PROJECT_VIEW_SKILL = `Read this project's \`Graph/graph-log-*.md\` files, oldest-not-yet-applied
first, and use each one to keep \`README.md\` an accurate, organized index
of what this project actually is and where it stands — never inventing
progress, dates, or facts that aren't grounded in a graph-log node's own
content.

Default structure for a new project's README:

- A short intro paragraph: what this project is, in plain language.
- A "Latest" section summarizing the most recent graph-log entries you've
  processed so far.
- One section per recurring topic/theme that emerges across multiple
  days' nodes (e.g. "Budget," "Timeline," "People Involved") — only
  create a section once there's enough real content to justify it, not
  preemptively.

Update incrementally: a single new day's graph-log file should only ever
touch the sections it actually has something new to say about, not
trigger a full README rewrite. Reorganize sections only when the
existing structure has clearly stopped making sense, not on every run.

Replace this file with your own instructions to change what sections a
README should have, or how much a single day's update should touch.
`;

// ─── Overrides ───────────────────────────────────────────────
// Mirrors `phylogDefaults.server.ts`'s override layer exactly — see this
// file's own module doc above for the full reasoning.

export type GraphLogDefaultStage = "knowledge" | "graph" | "projectView";

const STAGE_HARDCODED_DEFAULT: Record<GraphLogDefaultStage, string> = {
  knowledge: DEFAULT_KNOWLEDGE_SKILL,
  graph: DEFAULT_GRAPH_SKILL,
  projectView: DEFAULT_PROJECT_VIEW_SKILL,
};

const TABLE = "graphlog_default_skills";
const ROW_ID = "main";

type GraphLogDefaultSkillsRow = Data & {
  knowledge?: string | null;
  graph?: string | null;
  projectView?: string | null;
  updatedAt?: string;
  updatedByHumanId?: string;
};

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

async function getOverrideRow(): Promise<GraphLogDefaultSkillsRow | null> {
  await ensureTable();
  const result = await query<[GraphLogDefaultSkillsRow[]]>(`SELECT * FROM ${TABLE} LIMIT 1`);
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : null;
}

export type EffectiveGraphLogDefaultSkill = {
  content: string;
  /** True when this is an admin-set override, not the hardcoded built-in
   * — drives the "Reset to built-in default" affordance on
   * `/fruits/maker/graphlog/defaults`. */
  overridden: boolean;
};

/** The single value `ensureProjectN02`/`applyProjectN02Shape` actually
 * need: what should a new `project-n02`'s `skills/<STAGE>.md` be seeded
 * with right now. Falls back to the hardcoded constant whenever no
 * override row exists, or this specific stage's field on it is
 * unset/blank. */
export async function getEffectiveGraphLogDefaultSkill(stage: GraphLogDefaultStage): Promise<string> {
  const row = await getOverrideRow();
  const override = row?.[stage];
  return override && override.trim().length > 0 ? override : STAGE_HARDCODED_DEFAULT[stage];
}

/** All three at once, each labeled with whether it's overridden — what
 * `/fruits/maker/graphlog/defaults`'s own loader uses to render the
 * review/edit UI in a single round trip instead of three. */
export async function getAllEffectiveGraphLogDefaultSkills(): Promise<
  Record<GraphLogDefaultStage, EffectiveGraphLogDefaultSkill>
> {
  const row = await getOverrideRow();
  const resolve = (stage: GraphLogDefaultStage): EffectiveGraphLogDefaultSkill => {
    const override = row?.[stage];
    if (override && override.trim().length > 0) {
      return { content: override, overridden: true };
    }
    return { content: STAGE_HARDCODED_DEFAULT[stage], overridden: false };
  };
  return {
    knowledge: resolve("knowledge"),
    graph: resolve("graph"),
    projectView: resolve("projectView"),
  };
}

/** Sets (or clears, when `content` is `null`) this stage's override.
 * Clearing reverts every future new project's seed content back to the
 * hardcoded built-in — this row is never deleted outright, just has that
 * one field unset, so the OTHER two stages' overrides (if any) are
 * untouched. */
export async function setGraphLogDefaultSkillOverride(
  stage: GraphLogDefaultStage,
  content: string | null,
  updatedByHumanId: string,
): Promise<void> {
  await ensureTable();
  const existing = await getOverrideRow();
  await upsert(new RecordId(TABLE, ROW_ID), {
    knowledge: existing?.knowledge ?? null,
    graph: existing?.graph ?? null,
    projectView: existing?.projectView ?? null,
    [stage]: content && content.trim().length > 0 ? content : null,
    updatedAt: new Date().toISOString(),
    updatedByHumanId,
  });
}
