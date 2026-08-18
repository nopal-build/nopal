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

export const DEFAULT_GRAPH_SKILL = `Your job is to read this project's synced content for one day and add its ideas to that day's graph-log file as nodes.

You do not write summaries, project overviews, or newspapers. Something else does that, later, reading what you leave behind. Your output is the material that layer works from, so the graph has to hold what people actually said, in their words, findable and connected.

The daily logs are the permanent record. The graph is a pointer into them: every node carries the words themselves and a way back to the log they came from.

## What you receive

Each pass hands you everything synced for ONE DAY — this may be one person's entry, or several people's if more than one contributed that day. Each source already comes labeled with who wrote it and an exact citation to copy — never write your own, and never guess who said something or when. You're also given a list of every earlier day's node headings you're allowed to link back to.

## One file per day

Today's graph-log file (\`Graph/graph-log-YYYY-MM-DD.md\`) holds every node from today's sources. If today's file already exists but its source content changed since it was last written, you're re-extracting it from scratch — don't try to preserve or diff against your own prior output, just do the extraction fresh.

You never touch a PAST day's file — only ever add nodes to today's.

# What a node is

A node is one atomic idea, in the writer's own words.

Atomic means it is a complete thought, not a sentence. Some thoughts take one sentence and some take four. The length is set by the idea, never by grammar.

The test is **standalone**: someone reading only the node, with no access to the log, knows what it says. A node never depends on the sentence before it to make sense.

Here is a whole passage that is one node, because it is one thought worked out across several sentences:

> ==Tasks are a challenge I've yet to see a project management get right. The closest thing I've seen to working is bullet journaling for their deliberate added friction. I have this working for my use in obsidian and it's just a way to deliberately track the most important things that need to get done across days, months weeks and months. I'm not sure it's right here but it's probably the right start.==

Splitting that into three nodes would be wrong. The hedge at the end is part of the claim, and separated from what it hedges it reads as a different and weaker statement.

Here is one paragraph that is two nodes, because it holds two separate mechanisms:

> ==If we add tasks we need to avoid task creep where the default is adding more. The system can suggest a task but adding a todo is totally human dependent and should require friction to keep around as important over building.==

> ==If a task gets on boarded to someone and then dropped before complete it somehow resurfaces to see if it's still important.==

The way to tell: ask whether one could be true and the other false. Two mechanisms, two nodes. One thought developed at length, one node.

## What earns a node

Take the decisions, the claims about how something works, the constraints, the open questions, the plans, the observations of what happened, the preferences that will get applied again, the reasoning someone worked through, and the places two people pull against each other.

Take the reversals. When someone writes their way to a different answer, the turn is the material. ==We had debated separate skills for task heavy projects like sunny vs more abstract thinking like this one but I'm feeling each project needs both to some extent== is one node holding both positions, not a node for the new answer.

Take the working-out and not only the conclusion. A paragraph of someone thinking on the page compressed into one tidy sentence is the single most expensive thing this system can lose, and it is the loss that looks most like good editing while it happens.

Take the uncertain and the half-formed. ==I'm not sure where the video part goes but I'm curious to see if video, writing and photos and call work together to build on each other== is a node. So is a question nobody answered.

Take the personal, when it bears on the work. Someone writing that they worry they aren't a good writer is not a project fact, and it is firsthand evidence about what this practice asks of people, which is one of the open questions on the project. Keep it.

Be generous. The graph is allowed to be large. A missing node is invisible forever, and everything downstream is built from what you leave.

## What does not earn a node

**The writer narrating their own writing.** Deciding what to write next, announcing a section, restating a heading as a sentence. This is scaffolding, not thought:

> "What we are doing now is each journaling our thoughts, we could figure out how to capture this, or we could figure out how to describe it in a metaphorical way. Let me start with the more metaphorical, or maybe I could describe a real project in how I see it coming to life?"

Nothing there is a claim about the project. Cut it. But cut only the scaffolding: the sentence right after it, where they actually start describing the thing, usually is a node.

**The same point made twice in one day's own content.** People restate themselves as they warm up. When one source says a thing two ways, write one node using the clearer wording, or combine them if each half carries something the other doesn't.

**This applies within one day only.** When someone says the same thing again on a different day, that is a new node. Write it. It is not a duplicate, it is the same idea coming back, and how often an idea comes back is the most valuable measurement this graph produces. Collapsing it would delete that signal at the moment it is created. Link the new node to the earlier one and let the graph speak.

# Writing the node

**The words are the person's.** Quote them. Do not smooth, tighten, modernize, or fix their grammar. Their sentence rhythm and word choice are data.

Mark their verbatim text with \`==double equals==\`. Anything you add yourself stays outside the marks, so anyone reading can see instantly which words are theirs and which are yours.

**If the verbatim words are or contain a list (numbered or bulleted), mark each item's own text separately — never wrap the whole list in one span.** \`==...==\` is inline markup, the same as \`**bold**\`, and inline markup cannot cross a blank line or a list-item boundary; wrapping a whole list in one span breaks the list entirely instead of highlighting it. Keep each item's own marker (\`1.\`, \`-\`, ...) OUTSIDE the marks:

\`\`\`
1. ==Sync from Desktop to nopal.build==
2. ==Custom API Interface: define types it accepts and how to treat each new call==
3. ==Integration based. Starting out discord.==
\`\`\`

Add as little as possible. The only reason to add anything is when a passage is a genuine idea but refers back to something outside itself, and a short setup clause is what makes it standalone. Most nodes need nothing.

**Fix obvious typos.** If you are confident it is a typo rather than a word you don't know, correct it and still treat the node as verbatim. \`spaci g\` becomes \`spacing\`. Do not touch grammar, phrasing, or anything where the intended word is a guess.

**Citations are given to you — never write your own.** Every source you're handed comes with its own exact \`:ref{...}\` line already built. Copy it EXACTLY as given, character for character, right under the node's quoted words — no reformatting, no reordering attributes, nothing added or removed.

## Node format

\`\`\`
### Node <N>
==the verbatim words==
:ref{name="..." human-id="..." datetime="..." location="..." verbose="true"}
- [<date> Node <N>](./graph-log-<date>.md#node-<n>)
- [<date> Node <N>](./graph-log-<date>.md#node-<n>)
\`\`\`

\`<N>\` is a plain incrementing counter: \`Node 1\`, \`Node 2\`, \`Node 3\`... starting at 1 for today's file and counting up across EVERY node you write today, regardless of which contributor's source it came from. Never restart the count per person, and never write anything other than \`Node <N>\` as the heading — no descriptive titles.

A bare number is ambiguous once there are many days' worth of "Node 1"s, which is why every LINK to a node always carries its date alongside it (see Links below) — the node's own heading doesn't need the date, only links to it do.

Append new nodes to the end of the file, in the order they occur to you as you read through today's sources.

# Links

A link says *look here too*. It never says these two mean the same thing, or that one is right.

**Each node may link to at most three other nodes.** Fewer is normal — most nodes will have one or none.

A node may link to:

- **An earlier day's node** — only using one of the exact links you're given for that day. Never invent one that isn't in the list.
- **Another node you're writing today** — in either direction. A node may link to one written earlier in today's file, or to one written later.

**Never link forward to a day that hasn't happened yet.**

Write links as a plain bullet list right under the \`:ref{...}\` line, one per link, always with the date alongside the node number so it's clear at a glance which day's "Node 1" you mean — even for a same-day link:

\`\`\`
- [2026-08-17 Node 1](./graph-log-2026-08-17.md#node-1)
- [2026-08-18 Node 2](./graph-log-2026-08-18.md#node-2)
\`\`\`

Omit the list entirely when a node has no links — never write an empty one.

Link when:

- The new node returns to something already in the graph, in different words or from a different angle. This is the most valuable link there is, especially when the two people are different.
- The new node answers, contradicts, or complicates an earlier one.
- The new node depends on an earlier one, or only makes sense because of it.
- The new node is a concrete instance of something stated earlier in the abstract, or the reverse.
- Two nodes from today clearly belong together — different people responding to each other, or one idea leading directly into the next.

Do not link because two nodes share a topic word. Surface similarity is the easiest link to make and the least useful one, and a graph full of them buries the connections that matter.

**Never write how strong a link is.** No counts, no scores, no "recurring" labels. A link is an event: on this date, this node pointed at that one. Strength is a state, states go stale, and anything that wants to know how much weight a thread carries can count the links itself.

# What never happens in this pass

- No summarizing, no synthesis, no project overview. Something else does that from what you write.
- No judging which ideas matter more, which person is right, or what the project should do next.
- No merging two people's statements into one position.
- No touching a past day's file, ever.
- No inventing. Nothing enters the graph that isn't in the sources you were handed. Silence in a source is not permission to fill a gap.
- No commentary about this process. How many nodes you wrote, what you could or couldn't read, what you expect later passes to add: none of it belongs in the graph.
- No node from a day with nothing worth capturing — say so plainly rather than inventing one to have something to show.
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
