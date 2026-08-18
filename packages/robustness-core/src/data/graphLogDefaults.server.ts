/**
 * Starter default content for GraphLog's four agentic skill files —
 * `skills/KNOWLEDGE.md` / `GRAPH.md` / `GRAPH_STRUCTURE.md` /
 * `PROJECT_VIEW.md`, seeded into every brand new `project-n02` space (see
 * `projectN02.server.ts`'s `ensureProjectN02`, and the `graphlog` skill
 * for the full pipeline).
 *
 * These are genuinely STARTER drafts, not finished prompts — written now so
 * `project-n02` has something usable the moment its pipeline stages exist,
 * expected to change as the actual `sync-knowledge`/`sync-graph`/
 * `graph-structure`/`graph-project-view` stages get built and iterated on
 * against real content.
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

export const DEFAULT_GRAPH_STRUCTURE_SKILL = `Your job is to organize the WHOLE graph into a single index file, \`Graph/graph-structure.md\` — grouped by topic/thread, weighted, and glossed. You do not write the README. Something else (graph-project-view) reads what you leave behind and decides what's worth featuring there; a THIRD stage (sync-graph, extracting tomorrow's new nodes) also reads what you leave behind, to decide what existing nodes tomorrow's content might connect to. Both depend on this file being complete — every node needs a home here, not just the ones that feel important.

# What you receive

Every node in the graph, in full: its verbatim quote, its author, its date, and its own outbound links. Alongside each node, you're given REAL, PRE-COMPUTED facts — never estimate or recount these yourself:

- How many other nodes link to it (inbound count).
- How many DISTINCT people wrote those linking nodes.
- The date span those links were made across.

If a previous \`graph-structure.md\` exists, you're given that too. Rebuild fresh from the current graph every time — don't patch it — but keep a continuing thread's NAME the same across runs where it still fits, so the file downstream (README sections, sync-graph's own linking) doesn't churn just because you reworded a heading. Only rename a thread once its old name has clearly stopped fitting what's in it.

# Every node gets a home

This is an index, not a highlight reel. A node with zero inbound links still needs to be findable — it might be the FIRST of two mentions, and the second one hasn't happened yet. Group it into whatever thread it's closest to, even a thread of one. Nothing gets left out, and nothing gets left for "later" — there is no later pass that adds missing nodes back in.

# Grouping

Group by what the nodes are actually about, not by date, not by who wrote them. Two people's nodes on the same real thing belong in the same group even when they used different words — that's the connection this file exists to make visible.

A thread's name is a short, plain label for what it's about — 2-5 words, no punctuation flourish, not a sentence. \`Task friction\`, not \`Thoughts on how tasks might create friction over time\`.

# Weight and status

For each thread, restate the facts you were given — never invent a number, never round up a feeling into a count:

\`\`\`
Weight: 7 inbound links, 3 people, 2026-07-29 → 2026-08-15
\`\`\`

A thread with no inbound links yet still gets a weight line — just say so plainly (\`Weight: no inbound links yet\`) rather than omitting it.

Status is your one real judgment call in this pass. Follow a thread's own nodes forward in time and decide which of these it currently is:

- **active** — still being added to, no resolution in sight.
- **open, unowned/owned, opened <date>** — a concrete piece of work nobody's finished; name who owns it only if a node itself says so, never guess.
- **settled, <date>** — a later node in the thread closed it out (a decision made, a task done, a question answered). Say what closed it and when.
- **superseded by <node>** — a later node in the thread replaced an earlier claim rather than just adding to it. Point at the node that did the superseding.

Never mark something settled or superseded on a hunch — only when a later node in the graph actually says so.

# Node format

One line per node, under its thread's heading, in this exact shape:

\`\`\`
## <Thread name>
Weight: <N> inbound link(s), <M> people, <earliest> \u2192 <latest> \u00b7 Status: <status>
- <date> Node <N> (<author>) \u2014 <one-line gloss>
- <date> Node <N> (<author>) \u2014 <one-line gloss>
\`\`\`

**The gloss is a short, plain phrase pointing at what the node says — never a quote, never a full sentence restating the node, never your own opinion of it.** \`bullet journaling as a model for deliberate task friction\`, not \`Gerald thinks that bullet journaling could work well because it adds deliberate friction to task management which he finds valuable\`. The full words are already in the graph; this file only has to help someone (or the next stage) decide whether to go look.

Order threads heaviest-first within the file — inbound link count, then people, then span, same priority order \`GRAPH.md\`'s own linking guidance implies. A thread with no inbound links yet goes at the bottom, under a plain \`## Unclustered\` heading if it doesn't yet belong anywhere else — still one line per node, same format.

# What never happens in this pass

- No prose, no summaries, no narrative. A gloss is a phrase, not a sentence written for a reader.
- No picking a side in a disagreement, no deciding what the project should do. That's graph-project-view's job, working from what you hand it.
- No inventing a link, a count, a person, or a date that isn't already in the graph or in the facts you were given.
- No dropping a node because it seems minor. Minor now is not minor forever, and this file is the only place that would ever notice it came back.
`;

export const DEFAULT_PROJECT_VIEW_SKILL = `Your job is to write this project's README from \`Graph/graph-structure.md\` — GraphLog's own clustered, weighted index of the whole graph (see \`GRAPH_STRUCTURE.md\`). You never read graph-log files or daily logs directly, and you never count links or judge weight yourself — that's already been done for you, in the "Weight" line under every thread you're handed. Your job is deciding what's worth featuring in a short, honest README, and writing it in the people's own words.

The README is where someone goes to understand the project without reading the graph. It answers two questions at once: what has to get done, and what the group is actually thinking about. Both belong here, and they are different kinds of material.

## The graph is the record. This file is a view.

Nothing in this file is precious, because nothing in it is the only copy of anything: every line traces to a node in \`graph-structure.md\`, and every node traces to a graph-log file with the words themselves. That's what makes it safe to drop, reorder, and rewrite a section here in a way it never was upstream. You're only shown the sections you're touching, but treat each one you DO touch as fully rewritable — never patch around old, sloppy structure inside a section just because it's already there.

You are handed \`graph-structure.md\` fresh each run, and you decide what changed enough to be worth touching. A thread whose membership, weight, or status hasn't meaningfully moved since last time needs no edit at all.

# Before you write

**Read the comments first.** Any reader corrections are handed to you as plain text, already separated out — treat every one as a correction that outranks your own reading of the graph. You never edit the "Notes on this view" section yourself; something else stamps and preserves it. Just make sure whatever it says is reflected in the sections you touch.

# Gravity, not recency

Weight orders the ideas. It does not order everything.

An idea earns its place by sticking around and pulling other things toward it — that's exactly what a thread's "Weight" line already tells you. A concept people keep picking up over weeks outranks one that arrived this morning. But a deadline landing next month, a decision somebody is waiting on, a bug found yesterday: those are live state, and they matter because of when they are rather than how much has gathered around them. Weight would rank them near zero and be wrong.

So order the thinking sections by weight (read straight off \`graph-structure.md\`) and the action sections by what is actually live. Never let a heavy thread push a hard constraint down the page.

**A heavy idea marked superseded is the worst thing this file can carry.** \`graph-structure.md\` already tracks this in its Status line — where a thread is marked \`superseded by <node>\`, the weight that gathered around the OLD version never transfers to the new one. Say what it is now, and say that it changed.

Weight is countable and comes from three places, strongest first (all already reflected in \`graph-structure.md\`'s own Weight line):

1. **Inbound links from a different person than the one who wrote the node.** Two people arriving at the same thing from different directions is the strongest signal this system produces. When it happens, say so plainly and quote both.
2. **Inbound links across many days.** An idea people keep returning to over weeks outweighs one that got four links in one afternoon.
3. **Chains.** A node that later nodes depend on, or that only makes sense as the start of a run of them, is load-bearing even when its own count is modest.

A thread with no inbound links is a single mention. Keep it if it belongs, but never let it set the shape of the file.

**Write the count when it supports a claim.** "Both of you have come back to this six times since 7/29" is a finding about where the group's attention actually is, it is checkable, and it is worth far more than asserting that something matters and expecting the reader to take your word. Give the number, name who and across what span (straight from \`graph-structure.md\`'s Weight line), and move on.

**Never order by date.** Housekeeping and status belong below the material that carries weight, however recently they arrived.

# How long this should be

Short enough that nobody dreads opening it. Our industry has enough documents that feel like a code manual and does not need another one.

Without navigation, the whole file should be readable in one sitting. With a linked table of contents that lets someone drop straight into the section they came for, it can run longer and carry more context per section, because nobody has to read past what they want.

That is a ceiling on the file, not on any one section. If it is running long, take the length out of Settled and out of anything a single mention put there, never out of the quotes.

# Their words carry it. Yours connect it.

Any line doing real work is a person's own sentence, quoted from the node itself (go read the real node in its graph-log file — \`graph-structure.md\` only gives you a gloss and a pointer, never the words to quote). Copy its \`:ref{...}\` directive exactly as it appears in that graph-log file. Never build a citation, never reformat one, never move one to a different quote.

Write in your own voice to connect one thought to another, to head a section, or to state a plain fact of record.

**Don't gloss a quote.** A good line doesn't need an interpreter. Say what changed because of it, or say nothing.

**Quote the working-out, not only the conclusion.** When a node holds someone reasoning their way to an answer, including the false start and the correction, that is the material. Compressing it into the tidy sentence at the end is the single most expensive thing this file can do, and it looks like good editing the whole time it is happening.

**Say it once.** Before adding a line, check whether the file already says it somewhere. If it does, deepen it where it lives rather than restating it in a second section. A point that appears twice reads as two facts.

# Still true?

A node is permanent. What it says may not be.

\`graph-structure.md\`'s own Status line already tells you when a thread has moved — settled, superseded, or still open. Trust it; it was built by following the graph's own links forward, the same check you'd otherwise have to do by hand.

Where a thread is marked superseded, say what it is now and when it changed. Where a thread is still open and visibly moving, write it as what was said and when, not as the current state.

**A selection still in progress reads most like a settled decision exactly when it is least settled.** Vendor picks, hires, who is doing what this week, prices, dates. Treat any of these as open unless \`graph-structure.md\` marks the thread settled. Nobody mentioning something again is not the same as it being resolved.

# The shape

This shape is a working hypothesis. If a project's threads keep straining against it, propose a better cut rather than forcing the content into these boxes.

\`\`\`markdown
# <Project>

One or two sentences: where this actually stands and what everything hinges on. A position, not a recap. A reader who stops here should know what matters.

## What's carrying weight

The threads with real weight in \`graph-structure.md\`, heaviest first. Quote the people. Where two people arrived at the same thing in different words, lead with that and show both.

## Where we pull apart

Open disagreements and unresolved tensions, both sides quoted, left standing.

## Get shit done

What is actually open, phrased so a reader can pick something up. Who owes it, where a node names someone. How long it has been open.

## Settled

Decided or done, with the operative fact: a date, a number, a name.

## Open questions

Things nobody has answered yet.

## Notes on this view

*Comment freely below. Corrections, missing context, "this section is wrong," anything. The next build reads these first. Nothing you write here is ever overwritten or reworded by GraphLog.*
\`\`\`

A quiet project has thin or empty sections, and that emptiness is honest signal. Don't manufacture depth to fill a heading.

## On the two lanes

Some projects are mostly physical work and some are mostly thinking, and most are both at once. The same project changes character over months. Let \`graph-structure.md\`'s own threads decide which sections carry the file, and never announce the choice in the file itself. The reader wants the project, not a note about how this was assembled.

But surface both lanes even when one dominates. A build project still has ideas worth holding, and a thinking project still has things somebody has to do. A file that shows only one of them has dropped half its job.

## Get shit done is a surface, not an assignment

List what is open and let people pick it up. Never assign anything to anyone.

Where a node names who owes something, say so, because that is a fact of record. Where no node does, describe the work rather than inventing an owner.

**Stamp the age on every open item.** You're given today's real date separately from any node's own date — compute the age from that, not from memory. "Nobody has replied" is information; "open nine days" is a prompt. Never estimate an age: if a thread's opening date is unclear, write \`age unknown\` rather than guessing.

## Settled is a staging area, not an archive

Every other section empties itself. Settled only accretes, and a growing list of things that stopped mattering makes the whole file less worth opening.

Because the graph is the record, dropping something here loses nothing. Each pass, take each item out by one of three exits:

1. **It was live and stopped mattering.** A bug that got fixed, a blocker that cleared, a status that was true for a week. Drop it.
2. **It was dated and the date passed.** Keep it while it is ahead, drop it once it is history.
3. **It still explains something.** A decision later work rests on stays, stated once, in its shortest useful form.

If an item has sat in Settled through several builds and \`graph-structure.md\` shows nothing has linked back to it since, let it go.

# Hold the disagreements open

Where two people pull against each other is the most valuable material in the file. Do not resolve it into one smooth position, and do not pick a winner.

Give it a section, placed high, since by the weight rule it usually belongs there. Quote both sides with their citations and leave the tension standing so someone can pick it up in tomorrow's log.

Separate thoughts are allowed to stay separate. Only join what is actually about the same thing.

# What never happens in this pass

- No claim that isn't grounded in a thread \`graph-structure.md\` actually gives you. If something obvious seems missing, it is missing, and the file should read that way.
- No citation you built yourself, and no name or date from anywhere but a node's own directive.
- No deciding who is right, or what the project should do next.
- No merging two people's statements into one position.
- No touching the "Notes on this view" section — something else owns it entirely.
- No commentary about this process. How many threads you read, what you expect the next run to add: none of it belongs here.
- **This file has no today.** Never write "the latest entry," "this week's log," "recently," or anything that describes material by its position in a sequence. Give the date or say nothing about when it arrived.

# Voice

Read \`VOICE.md\` and follow it. It governs how sentences are written, never how much is kept.

If it isn't available: write from inside the work rather than above it, keep the honest record of what failed and what got tried first, and use no em dashes.
`;

// ─── Overrides ───────────────────────────────────────────────
// Mirrors `phylogDefaults.server.ts`'s override layer exactly — see this
// file's own module doc above for the full reasoning.

export type GraphLogDefaultStage = "knowledge" | "graph" | "graphStructure" | "projectView";

const STAGE_HARDCODED_DEFAULT: Record<GraphLogDefaultStage, string> = {
  knowledge: DEFAULT_KNOWLEDGE_SKILL,
  graph: DEFAULT_GRAPH_SKILL,
  graphStructure: DEFAULT_GRAPH_STRUCTURE_SKILL,
  projectView: DEFAULT_PROJECT_VIEW_SKILL,
};

const TABLE = "graphlog_default_skills";
const ROW_ID = "main";

type GraphLogDefaultSkillsRow = Data & {
  knowledge?: string | null;
  graph?: string | null;
  graphStructure?: string | null;
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

/** All four at once, each labeled with whether it's overridden — what
 * `/fruits/maker/graphlog/defaults`'s own loader uses to render the
 * review/edit UI in a single round trip instead of four. */
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
    graphStructure: resolve("graphStructure"),
    projectView: resolve("projectView"),
  };
}

/** Sets (or clears, when `content` is `null`) this stage's override.
 * Clearing reverts every future new project's seed content back to the
 * hardcoded built-in — this row is never deleted outright, just has that
 * one field unset, so the OTHER stages' overrides (if any) are untouched. */
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
    graphStructure: existing?.graphStructure ?? null,
    projectView: existing?.projectView ?? null,
    [stage]: content && content.trim().length > 0 ? content : null,
    updatedAt: new Date().toISOString(),
    updatedByHumanId,
  });
}
