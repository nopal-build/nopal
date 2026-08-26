---
name: graphlog
description: GraphLog, Nopal's AI pipeline for `project-n02` spaces — turns synced content into a `Graph/` of cited, linkable nodes, organizes the whole graph into a weighted `graph-structure.md` index, then into an up-to-date `README.md` Project View. Use when working on `project-n02`, `projectN02.server.ts`, `graphLogDefaults.server.ts`, the `Graph`/`project-n02` Vault Folder Types, the `:ref{...}` directive (`oxmarkdown-core/src/refDirective.ts`), or when asked about "GraphLog", daily-log-sync, sync-knowledge, sync-graph, graph-structure, or graph-project-view.
---

# GraphLog

GraphLog is `project-n02`'s AI pipeline. It replaced PhyLog (formerly
`project-n01`) as this app's only content pipeline — **PhyLog has been
fully retired: every project and `personal` space has been migrated to
`project-n02`, and all of PhyLog's own code, routes, CLI commands, Maker
pages, and the one-time migration tooling that bridged the two have been
deleted.** `project-n01` no longer exists as a valid folder type at all.
Nothing in this skill describes coexistence with PhyLog anymore — if you
see a stale reference to it elsewhere in the codebase, it's a leftover
comment, not a real code path.

GraphLog's own shape: a deterministic pre-step, then agentic stages driven
by per-project skill files, extracting CITABLE, LINKABLE nodes from synced
content into a daily `Graph/` log, then synthesizing those into a README.
Read the `vault` skill first for the Vault Folder Type system this assumes.

**Status: all five pipeline stages and a Maker usage/defaults page are
built and verified; PhyLog's retirement (see above) is also complete.**
Written as a living design doc, same convention as `oxmarkdown`'s skill —
update it as GraphLog gets built, don't let it drift into describing a
design that was later changed without a matching code change.

**A real architecture change, not in the original design**: a fifth
stage, `graph-structure`, was added between `sync-graph` and
`graph-project-view` after the ORIGINAL `graph-project-view` design (read
one graph-log day at a time, patch README sections incrementally) turned
out to have real, unfixable-in-place problems — no way to see real
cross-graph link weight, no way to reorder sections, no protection for
the reader-comment section. `graph-structure` does the expensive
whole-graph read ONCE per run and produces a compact, weighted,
clustered index (`Graph/graph-structure.md`) that BOTH `graph-project-view`
AND `sync-graph` now read, instead of each stage trying to re-derive its
own partial view of the whole graph. See "The pipeline" and "Build
status" item 7 below for the full design and what changed in the other
two stages as a result.

## Why a new name instead of extending PhyLog

`project-n01`/PhyLog's whole shape (stage skill files, filing attachments,
one evolving README) was designed around "organize scattered content into
a tidy project." `project-n02`/GraphLog's shape is designed around a
different goal: build a durable, linkable GRAPH of specific statements
("who said/decided what, when, sourced from where") that a README is later
synthesized FROM, rather than directly written to. Different enough in
both data model (a new `Graph/` space, cross-day node links, the `:ref{...}`
citation directive) and pipeline shape (five stages, not three, with the
first one deliberately NOT agentic) to warrant a new name rather than a
fourth PhyLog stage.

## The pipeline

`nopal graphlog run --project <path>` runs all five stages in order, in
one job (`graphLogAgent.server.ts`'s `runGraphLogPipeline`, mirroring
`phylogAgent.server.ts`'s own `runPhylogPipeline`); each stage below is
ALSO independently runnable via its own CLI subcommand/API route.

```
personal/syncs/Daily Logs (real Cards, one per project per day)
  -> STAGE 1: daily-log-sync    (deterministic copy, NOT agentic)
  -> STAGE 2: sync-knowledge     (agentic, skills/KNOWLEDGE.md)
  -> STAGE 3: sync-graph         (agentic, skills/GRAPH.md)
  -> STAGE 4: graph-structure    (agentic, skills/GRAPH_STRUCTURE.md)
  -> STAGE 5: graph-project-view (agentic, skills/PROJECT_VIEW.md)
```

- **daily-log-sync** — the Sorter's counterpart for GraphLog: zero-inference,
  Card-driven. A daily-log Card is already explicitly scoped to one project
  (same mechanism the `vault` skill's Cards section describes), so copying
  its content into that project's own `syncs/Daily Logs/` folder needs no
  AI judgment at all. `skills/DAILY_LOG.md` was considered and dropped —
  there's no per-project behavior left to configure once routing is fully
  Card-driven.
- **sync-knowledge** — the first AGENTIC stage. Walks every file under a
  project's `syncs/` tree (not just Daily Logs — any connector folder) and
  asks an AI, per `skills/KNOWLEDGE.md`'s instructions, to pull out
  METADATA about that file (concrete extractable facts — names, dates,
  decisions — not a narrative summary) into a sidecar file. Reserved
  subfolder name: `_knowledge/`, holding one `<name>.knowledge.md` per
  covered source file, directly inside the SAME sync folder the source
  file lives in (e.g. `syncs/Daily Logs/_knowledge/2026-08-17.knowledge.md`).
  Idempotent via a content hash deciding what still needs (re)covering,
  same convention every other GraphLog stage's own idempotency uses (see
  "IDEMPOTENT via..." notes throughout this skill).
- **sync-graph** — reads a project's `syncs/` tree (including
  `_knowledge/*.knowledge.md`) and, per `skills/GRAPH.md`, extracts
  citable nodes — verbatim or near-verbatim statements worth remembering
  on their own — into `Graph/graph-log-YYYY-MM-DD.md`, one file per day
  with new content (no file at all for a day with nothing worth
  capturing). Each node gets a plain, predictable `### Node <N>` heading
  (an incrementing counter per day's file, never an LLM-generated title)
  and a `:ref{...verbose="true"}` citation. Runs once a day IN INTENT
  (matches the day a new Daily Log/sync content landed) but is **never
  wired to run automatically yet** — every stage is CLI-only for now (see
  "CLI surface" below), "always on-demand, never a cron," for the same
  cost/non-determinism reasons real-money LLM calls always warrant.
  - **A THIRD real architecture change, not in the original design**:
    one day's extraction used to be ONE non-tool completion producing
    the WHOLE day's file body in one shot — confirmed to genuinely
    truncate on a busy day (a real project's `2026-08-13` cut off at the
    shared 8192-token default), the exact same class of problem
    `graph-structure` already hit and fixed at the whole-graph level.
    Now a bounded tool loop (`add_node`, one call per node) builds a
    day's nodes up incrementally, accumulated in memory and written ONCE
    the day finishes cleanly — a day is still all-or-nothing (an
    interrupted/truncated day still writes nothing and is retried whole
    next run), but any single completion's output is now just one
    node's worth of text, so the original truncation mode is no longer
    reachable in ordinary use. The model never writes a citation OR a
    `### Node <N>` heading itself anymore — `add_node`'s own
    `sourceIndex` parameter identifies which numbered source a quote
    came from, and CODE attaches that source's exact `:ref{...}` and
    assigns the next number, a step further than the original "hand it
    verbatim text to copy" design (which still left room for a long
    citation string to get mangled in transcription).
  - **Regeneration, not append**: if a day's underlying source content
    changed after its `graph-log-*.md` was already written, DELETE that
    file and fully regenerate it — no partial-append logic.
  - **Links, now VALIDATED by code, not just instructed**: a node may
    link to an EARLIER day's node by id (`add_node`'s `backwardLinks`,
    e.g. `"2026-07-29#3"`), or to ANOTHER node from the SAME day via
    `sameDayLinks` (plain numbers already added earlier that turn) — an
    id/number not actually in the candidate set offered is silently
    dropped and reported back to the model, rather than a hallucinated
    link quietly ending up in the file the way free-form markdown could
    before. Max 3 links per node is now an enforced CAP (extras dropped),
    not just a skill instruction; forward-to-an-unprocessed-day links are
    now structurally impossible (a future day's ids are never in the
    candidate set to begin with) rather than merely told not to happen.
  - **Candidate list for backward links is `Graph/graph-structure.md`**,
    not a bare list of past headings — see the `graph-structure` bullet
    below for why a heading of just "Node 3" gave the model nothing to
    judge relevance against. One cycle stale by construction (reflects
    the graph as of `graph-structure`'s last run, not this exact moment)
    — fine in practice since `nopal graphlog run` always runs
    `graph-structure` immediately after `sync-graph`. Falls back to the
    OLD flat heading-scan for a project that's never had `graph-structure`
    run yet. Nodes written EARLIER IN THE SAME `sync-graph` run (which
    `graph-structure.md` can never reflect yet) are still tracked live,
    exactly as before. Now folded into the CACHED system prompt (see the
    next bullet) rather than resent raw per day.
  - **Prompt caching**: `graph-structure.md`'s content (plus the shared
    skill instructions) now live in the SYSTEM prompt, byte-identical
    across every day AND every turn a run touches — a multi-day catch-up
    run used to resend this (often large) block at full price on EVERY
    day; now it's paid for once, then cheaply cache-read for the rest of
    the run, via the SAME `cacheSystemPrompt` mechanism already used
    elsewhere in GraphLog/PhyLog for exactly this reason.
  - **A real rendering bug, found in real production output, fixed at
    the tool-schema level rather than by re-explaining the rule in
    prose**: a verbatim quote that was a multi-paragraph, indented
    outline (not a classic numbered/bulleted list) got wrapped in ONE
    `==...==` span across several blank lines, which OxMarkdown's real
    `mark` mdast node (an inline construct, same rule as `**bold**`) can
    never close correctly across — confirmed rendering broke exactly the
    way the ALREADY-DOCUMENTED list version of this bug did (see Build
    status item 5's own earlier bug writeup), just for a source shape
    that instruction never covered. Fixed by taking `==...==` OUT OF the
    model's hands entirely: `add_node`'s `quote` string parameter was
    replaced with a structured `blocks` array (`{type: "paragraph",
    text}` / `{type: "list", items, ordered}`) plus an optional `setup`
    clause — `renderQuoteBlocks` (`syncGraph.server.ts`) applies
    `==...==` itself, per paragraph and per list item, with a list
    item's own `-`/`N.` marker always kept outside the highlight by
    construction. The model now only describes STRUCTURE (is this a
    paragraph or a list, how many items), never highlight syntax — the
    same "never trust the model with formatting a citation/weight-line/
    link can already just compute" reasoning applied one layer further
    down, to markup itself. `GRAPH.md` was updated to describe the new
    parameters (including "never reproduce a person's own indentation as
    literal leading spaces — that's its own markdown syntax, a code
    block, and it's exactly what triggered this").
- **graph-structure** — reads EVERY `Graph/graph-log-*.md` file (the
  whole graph, not incrementally) and keeps ONE file,
  `Graph/graph-structure.md`, an organized, weighted, status-annotated
  index of every node (clustered by topic/thread; active / open /
  settled / superseded), per `skills/GRAPH_STRUCTURE.md`. Sits between
  `sync-graph` and `graph-project-view` specifically to solve a problem
  neither neighbor can solve alone without reading the whole graph every
  time it does anything — see the header's "real architecture change"
  note and Build status item 7.
  - **A SECOND real architecture change, not in the original design**:
    this stage used to REBUILD `graph-structure.md` from scratch, in one
    non-tool, non-streaming completion, every run — a genuine scaling
    problem, confirmed against a real project's real history (88 nodes
    truncated the shared 8192-token output default; even a generous
    stage-specific override, 20000, was already brushing against the
    Anthropic SDK's own hard non-streaming ceiling, ~21333 tokens, a WALL
    that any further graph growth would eventually hit again — not a
    dial that can just be turned up further). Now a bounded tool-calling
    loop (`update_cluster`/`remove_cluster`/`get_node`, mirroring
    `graph-project-view`'s own `update_section`/`remove_section` shape
    closely) edits `graph-structure.md` ONE CLUSTER AT A TIME, and the
    model is handed only the node(s) genuinely NEW since the last run —
    not the whole graph's full text — plus the CURRENT
    `graph-structure.md` itself (already compact by design) for context.
    `get_node` lets it pull an older node's full original text on demand
    if it's weighing a merge/split/rename, rather than that text being
    resent eagerly every run. A first-ever build (or a fallback full
    rebuild against an unparseable previous file) still happens, but
    spread across many small, bounded tool calls instead of one
    unbounded completion, so the old hard ceiling is no longer reachable
    in ordinary operation. Full design/rationale in `graphStructure.server.ts`'s
    own module doc.
  - **A real finding from the FIRST live run of this redesign, fixed
    directly**: a real 61-node bootstrap (a freshly-reset project)
    truncated anyway — on the very FIRST turn, before any tool call ever
    completed, meaning the model spent its whole per-turn output budget
    on plain narration/planning text rather than calling a tool at all.
    Fixed two ways: (1) the system prompt now explicitly forbids any
    text outside a tool call ("go straight to calling
    update_cluster/remove_cluster/get_node with no preamble"); (2) a
    large new-node delta is now split into separate, smaller batched
    conversations (`NEW_NODE_BATCH_SIZE = 15`) rather than one
    conversation holding all 61 nodes at once — each batch still sees
    whatever the PREVIOUS batch already committed (via the same
    executors' own persisted state), so the end result is unchanged,
    only how much the model has to hold in mind in any one conversation.
    The system prompt's own skill-instruction portion is now ALSO cached
    (`cacheSystemPrompt`, via a run-wide call counter) across every
    turn/batch — a real gap in the original redesign (never enabled at
    all), same convention `sync-graph`'s own larger cached block uses.
    Same open item as before: this fix itself hasn't yet been re-run for
    real (see Build status item 7's own note).
  - **Inbound link counts, AND NOW every cluster's "Weight: ..." line,
    are fully code-computed, never left to the model**
    (`graphNodeIndex.server.ts`'s `computeBacklinkIndex`, plus
    `graphStructure.server.ts`'s own `refreshClusterWeight`) — same
    "citations are pre-computed" reasoning `sync-graph` already applies
    to a node's own `:ref{...}`, just applied to arithmetic instead of a
    citation. Every cluster's Weight line is recomputed from live
    backlink data as a deterministic pass after the tool loop finishes —
    whether the model touched that cluster this run or not — and
    clusters are then re-sorted heaviest-first the same way, so a node
    gaining an inbound link elsewhere in the graph never requires the
    model to revisit its own cluster just to keep its Weight line
    honest. `GRAPH_STRUCTURE.md`'s own instructions tell the model it
    doesn't need to get these numbers right at all.
  - **A safety net, never trusting the model's own sense that it's
    done**: before stamping a run's `asOfGraphHash` applied, code
    confirms every node in the graph actually has a home in some
    cluster; if any are still unplaced (a turn limit hit, an interrupted
    run, or the model simply stopping early), the hash is left
    unstamped so the NEXT run picks up exactly the still-missing nodes
    (already-committed placements are reflected in the file it re-reads,
    so this is naturally idempotent, not a full retry).
  - **Known, accepted gap**: a node whose own TEXT changes without its
    id changing (a past day's graph-log file regenerated with the same
    date/number but different wording) won't be detected as "new" by the
    placement-delta logic, since only node IDS are diffed, not content —
    not fixed, no evidence yet that this has happened in practice.
  - **Thread naming continuity**: still handed its own previous version
    every run and told to keep a continuing thread's name where it
    still fits, so downstream churn (README sections, `sync-graph`'s own
    candidate list) doesn't reset just because a heading got reworded.
- **graph-project-view** — reads `Graph/graph-structure.md` (not
  graph-log files directly), per `skills/PROJECT_VIEW.md`, and keeps
  `README.md` an accurate, organized synthesis. **NOT per-day anymore** —
  a real architecture change from this stage's original shape: since
  `graph-structure` already did the expensive whole-graph read, this
  stage runs ONCE per invocation, gated on `graph-structure.md`'s own
  `asOfGraphHash` versus the `appliedByProjectView` marker this stage
  stamps onto that SAME file once an update completes cleanly.
  - **"Notes on this view" is never touched by the model** — the
    reader-comment section at the bottom of the README. `update_section`/
    `remove_section` both hard-refuse any attempt to target it. Reading
    unstamped comments and stamping them ` → read <date>` is
    deterministic, code-owned pre/post-processing, never a tool call the
    model could skip, mangle, or reorder — same "never trust the model
    with exact/sacred text" reasoning a node's own citation already gets.
  - **Section order is enforced by code, not the model** — `update_section`
    appends a brand-new heading to the end of the README's own section
    list, which would otherwise leave order however sections happened to
    get created over a project's life. A deterministic reorder pass runs
    after every clean finish (whether or not the model made any edits
    this run), re-sorting the six canonical headings
    (`PROJECT_VIEW.md`'s own prescribed shape: What's carrying weight →
    Where we pull apart → Get shit done → Settled → Open questions →
    Notes on this view) into place.
  - **A full project reset** now means: reset `graph-structure.md` (its
    `asOfGraphHash` disappears with the file), which naturally makes
    `graph-project-view`'s own `appliedByProjectView` marker meaningless
    the next time either stage runs — no separate "full" mode needed,
    same idempotent-by-construction property the old per-day design had.
  - **Hardened ahead of `graph-structure`'s own real bootstrap failure**
    (before this stage had run for real against a substantial
    `graph-structure.md` itself): shares the exact same tool-calling-loop
    shape that proved vulnerable to a real bootstrap truncating on its
    first turn's own narration text. Applied the same two defensive fixes
    ahead of time rather than waiting to hit the identical failure for
    real: the system prompt explicitly forbids text outside a tool call,
    and `MAX_TURNS` is raised from 8 to 20 (a first bootstrap needs a
    minimum of ~5-6 `update_section` calls, one per canonical heading,
    leaving little margin at the old ceiling). No batching equivalent to
    `graph-structure`'s own `NEW_NODE_BATCH_SIZE` was added here since
    there's no analogous "list of many things" to chunk — this stage
    always writes to the same fixed six sections, not a growing
    per-cluster set.
  - **A REAL, CONFIRMED FAILURE from the first production run against a
    substantial graph, fixed directly (not theoretical)**: this stage DID
    run end-to-end for real (Nopal O., 88+ nodes) and produced a
    README — but a 4,473-character one with ZERO `:ref{...}` citations,
    zero `==` highlight marks, and four quotation marks total. Not a
    prompt-quality problem: `buildUserPrompt` only ever handed the model
    four things — today's date, `graph-structure.md`'s body, the README's
    current body, and unstamped comments — and `graph-structure.md` holds
    only twelve-word glosses (`2026-08-14 Node 1 (Austin T) — journaling
    as superpower for organizing thoughts`), never the words themselves.
    There was structurally NO path from this stage to a single word
    anyone actually wrote, so "write from the nodes, quote their own
    words" was a request `PROJECT_VIEW.md` made of a stage that had no
    way to comply — paraphrase of paraphrase was the only possible
    output. Fixed with BOTH a floor and a ceiling, deliberately, not just
    one (a tool alone is one skill edit away from silently reverting to
    paraphrase with nothing erroring, which is exactly how this failed
    the first time — see ADR-006, `docs/adr/` kept out of the public
    repo):
    - **Pre-fetch (the floor)** — `buildNodePrefetchBlock` walks
      `graph-structure.md`'s own top threads (already importance-sorted,
      see the next bullet) top-down and hands the model every member
      node's full verbatim text plus its exact `:ref{...}` citation
      (`graphNodeIndex.server.ts`'s new `formatNodeVerbatim`/`refLine` —
      a node's citation is now kept verbatim on the parsed record, not
      just re-derived into a name/humanId pair, so nothing downstream
      ever has to re-serialize one from parts). Bounded by a NODE budget
      (`NODE_PREFETCH_BUDGET = 60`), not a thread count, filled top-down
      and stopping MID-THREAD if needed (with an explicit "truncated"
      note so the model knows it saw only part of one) — flat cost as the
      graph grows, rather than scaling with however large one thread
      happens to get.
    - **`get_node` (the ceiling)** — a new tool, same shape
      `graph-structure`'s own `get_node` already has: takes a node id,
      returns its verbatim text and citation, validated against
      `graph-structure.md`'s own node list (`buildMembershipIndex`,
      exported from `graphStructure.server.ts` for this) exactly like
      `add_node` already validates its own link candidates — an id not
      actually in the graph is rejected, not silently accepted.
  - **The thread sort was ALSO wrong, found on the same first production
    run, fixed as its own change (ADR-008)**: `graph-structure.md`'s
    clusters used to sort by raw inbound link COUNT only — never reading
    `BacklinkInfo.fromAuthors` (see ADR-003), a thread's `Status`, or
    anything resembling urgency — which let a single person's own notes
    outrank the one thread holding a real deadline and a shipping list.
    `GRAPH_STRUCTURE.md` now gives a thread two new optional fields,
    `Due: <date>` and `Blocking: <what it holds up>` (the latter must
    NAME the thing held up, never a rating — see ADR-007, guarding
    against the same drift-to-a-cheap-default that made `Status` collapse
    to `active` on 9 of 10 real threads), and `graphStructure.server.ts`'s
    `sortClustersByWeight`/`rankCluster` now sort down an
    importance-and-urgency grid: `Blocking`+`Due` first, `Blocking` alone,
    `Due` alone, then everything else by distinct authors then raw count
    then latest date, with `settled`/`superseded`/`dormant` threads
    carrying neither field sinking to the very bottom rather than
    competing on accumulated weight at all. A thread that's `dormant` with
    no `Due` and no `Blocking` has "fallen away" (`hasFallenAway`, ADR-009)
    — still fully present in `graph-structure.md` and still a valid
    `sync-graph` backward-link candidate (ADR-004), just no longer
    surfaced to the README. Two new MECHANICAL facts (never the model's
    job to compute) are now handed to `graph-structure` per existing
    thread — the date of its most recent node, and any dates found in its
    nodes' own text (`graphNodeIndex.server.ts`'s new
    `extractDatesFromText`) — so the model's only real judgment is
    deciding what those dates MEAN (a commitment vs. a passing mention),
    never finding them. **Known, deliberately unresolved risk (ADR-008's
    own "known consequence")**: `sync-graph` receives this SAME ordering
    as its backward-link candidate list, so the sort now also shapes what
    tomorrow's nodes link to, which shapes weight, which shapes the sort —
    a real feedback loop, accepted for now (Austin's call: the sort serves
    the downstream stages, not human readability); the fix if it proves
    real is a separately-ordered candidate list for `sync-graph`, not a
    compromise to this ordering.
  - **A companion coverage/"fell away" report, deliberately NOT a
    coverage rule** — after every clean finish, `computeCoverageReport`
    diffs graph-structure.md's own thread list against the README's final
    body (an approximate heading-substring check, not exact per-node
    citation tracking — a measurement, not a gate) and reports which
    threads have zero representation, alongside which threads fell away
    this run per `hasFallenAway`. Surfaced on `GraphProjectViewResult`'s
    own new `coverage` field (`{ missingThreads, fellAway, missingFiles }`,
    `null` whenever a run didn't reach a clean finish) and logged as job
    lines — `missingThreads`/`fellAway` are never a rule forcing coverage,
    since on the first real run four of ten threads (including all
    fourteen nodes covering shipped work) produced no README
    representation with no pattern predictable by rank, and the right next
    step is reading this data across a few real runs before anyone writes
    a rule from a guess.
  - **`missingFiles` is checked more strictly than the other two, ON
    PURPOSE** — unlike thread coverage, `PROJECT_VIEW.md`'s own "A file is
    never optional" is a hard rule, not a judgment call: for every node in
    a NON-fallen-away thread, `extractGalleryImageLines` (`graphNodeIndex.server.ts`)
    pulls any real attached-image markdown line (an ordinary
    `![alt](/api/vault/view/<fileId>)`, never a custom directive) off that
    node's own text (see `sync-graph`'s own "Files" note — the image line
    is code-attached, so this is checking for something that's ALWAYS
    really there when a node cites a file source) and confirms that exact
    same image line survived into the finished README, however it got
    wrapped along the way (a `:::gallery{}...:::` grouping several images
    together is fine — only the individual line itself has to survive
    unchanged). Still report-only, not a forced retry: unlike a
    truncated/refused turn (a mechanical failure), a dropped file is the
    model making a legitimate-looking editorial choice that happens to
    violate an instruction — forcing an automatic retry risks looping
    forever if it keeps making the same choice, so this is visibility, not
    enforcement, same as the other two fields.
  - **A REAL, CONFIRMED GAP, FOUND AND FIXED: files had NO path into the
    graph at all before this**, regardless of what either skill said —
    see "Done — `daily-log-sync`" and "Done — `sync-graph`" above (Build
    status items 3 and 5) for the full fix (a missing `date` stamp on a
    copied attachment, closed at the source). GraphLog's own OUTPUT
    deliberately does NOT use the `::file{...}` directive at all — an
    attached image is appended to its node's text as an ORDINARY
    `![alt](/api/vault/view/<fileId>)` markdown image instead (a real,
    considered choice, not an oversight: it degrades gracefully anywhere,
    and several images can be grouped under one shared
    `:::gallery{}...:::` wrapper without ever having to rebuild the image
    line itself — something a one-file-per-mount `::file{...}` directive
    can't do). `::file{...}` remains exactly what it always was: the
    HUMAN-facing upload directive a person writes when attaching a photo
    to a Card in the first place; GraphLog only ever READS that one (for
    its `caption`), never writes one of its own.

## Reset

GraphLog has THREE independent, narrower resets — `graphLogReset.server.ts`
— since it has three separate kinds of generated content worth being able
to wipe on their own, plus one combined command that runs all three in
order:

- **`nopal graphlog reset-project-view`** (`resetProjectView`) — deletes
  every direct child of the project folder EXCEPT `skills`/`syncs`/
  `graph`, and clears `README.md`'s BODY (front matter preserved
  byte-for-byte, since Sharing Roles/`status` live ONLY in that front
  matter and deleting the whole file would silently revoke every
  collaborator's role). In practice there's rarely anything else at the
  project root to delete here — this exists mainly to clear a stale
  README body and catch anything unexpected left there.
- **`nopal graphlog reset-graph`** (`resetGraph`) — deletes the `Graph`
  space folder outright: every `graph-log-*.md` file AND
  `graph-structure.md`, so both `graph-structure`'s own `asOfGraphHash`
  and `graph-project-view`'s `appliedByProjectView` marker (co-located on
  that same file — see `graphStructure.server.ts`) go with it. A no-op if
  the project has no `Graph` folder yet. A fresh `sync-graph` run
  afterward regenerates every day from scratch.
- **`nopal graphlog reset-knowledge`** (`resetKnowledge`) — recursively
  deletes every `_knowledge/` sidecar folder nested anywhere under
  `syncs/`. A fresh `sync-knowledge` run afterward regenerates every
  sidecar from scratch.
- **`nopal graphlog reset`** (`resetProjectAll`) — runs all three above,
  in order (project-view first, so `graph`/`syncs` are still there to
  reset next; then `graph`; then `knowledge`, nested inside whatever's
  left of `syncs`) — the single deepest "start completely over" reset.

All four are destructive, require `--yes` at the CLI layer, and are
deliberately NOT run automatically by anything else — always an explicit, separate call,
so a human can inspect the emptied-out state before re-running `nopal
graphlog run`. Deterministic and free (no LLM calls, no `{ ok, error }`
wrapper) — same `runDailyLogSync`-style "a missing project folder just
throws" convention, since these don't need `resolveProjectN02`'s
container-type validation either (container-type-agnostic, like every
other GraphLog stage). Each has its own job name on the `graphlog` queue
(`reset`/`reset-project-view`/`reset-graph`/`reset-knowledge`) and its own
`POST /api/graphlog/reset*` route, all following the same
enqueue-then-poll shape (`GET /api/graphlog/jobs/:jobId`) every other
agentic-shaped stage uses, even though these three are actually
deterministic — kept consistent with the rest of the CLI/API surface
rather than special-cased as synchronous like `daily-log-sync`.

The combined `reset` and the full `run` are both also reachable from
`/fruits/vault`'s "More Actions" dropdown (Admin/Super only) — see item 11
under "Build status" below. The same dropdown also has an Admin/Super-only
"Enable/Disable GraphLog Schedule" toggle that enrolls a project in an
automatic nightly `run` — no scheduled equivalent for `reset`, since that's
destructive and deliberately stays an explicit, one-off action. See item 12
under "Build status".

## `project-n02` spaces

The ONLY `ContainerFolderTypeKey` in `vaultFolderTypes.ts` (PhyLog's
`project-n01` has been fully retired and removed from the type entirely).
`README.md` is the index, `skills`/`syncs` are the only human-writable
children, everything else (including the `Graph` space) is
`writable: "system"`.

- **`graph`** — a `SpaceFolderTypeKey`, singleton per `project-n02`
  container, holding `graph-log-*.md` files plus `graph-structure.md`.
  "Lazily created the first time there's actually something to write" —
  NOT seeded at project-creation time, unlike `skills`.
- `projectN02.server.ts`:
  - `ensureProjectN02(folder)` — tags `folder` `project-n02` and seeds
    `skills/KNOWLEDGE.md`/`GRAPH.md`/`GRAPH_STRUCTURE.md`/`PROJECT_VIEW.md`
    from `graphLogDefaults.server.ts`. `vault.server.ts`'s
    `createVaultFolder` calls this for every brand new project (and
    `personal`) directly — there's no other container type left to
    default to.
  - `resolveProjectN02(folderId)` — the "resolve + validate + retrofit"
    chokepoint every GraphLog CLI/API entry point runs a `--project` path
    through.
  - `ensureProjectGraphFolder(projectFolder)` — lazy `Graph` folder
    creation, called by `sync-graph` the first time it has something to
    write.
- `graphLogDefaults.server.ts` holds the four starter
  `DEFAULT_KNOWLEDGE_SKILL`/`DEFAULT_GRAPH_SKILL`/`DEFAULT_GRAPH_STRUCTURE_SKILL`/
  `DEFAULT_PROJECT_VIEW_SKILL` constants, plus an admin-editable-override
  layer reviewable at `/fruits/maker/graphlog/defaults` (see "Maker
  pages" below).

## The "Daily Logs" symlink

**Decision: Option A (the low-cost path), not a new Vault symlink
primitive.** The vault-wide `daily-logs` ROOT (see the `vault` skill's
"Vault Root Folders") is retired as its own container; a human's daily
log content instead resolves to their `personal` space's own
`syncs/Daily Logs` folder. A real symlink primitive (`target_folder_id`,
proxying reads/writes) was considered and explicitly deferred — revisit
only if a second real symlink need shows up; this one didn't justify the
added complexity (listing/breadcrumb/move/share code all having to know
how to see through an alias).

**Done — the data-layer resolution + migration.**
`vault.server.ts`'s `resolveDailyLogsFolder(humanId)` is the single
chokepoint every daily-log read/write path now goes through (replacing
every direct `getOrCreateVaultFolder(humanId, "daily-logs", null)` call):

- Canonically resolves to `personal/syncs/Daily Logs` (lazily created).
- **A legacy vault-wide `daily-logs` ROOT (anyone who used Nopal before
  this shipped) is MOVED there in place** via the existing
  `moveVaultFolder` primitive — re-parented, never recreated, so every
  file's own id (a day's `readme.md`, a Card, an attachment) and every
  date subfolder's own id survives completely unchanged. This is what
  makes the migration safe: `::card{file="..."}` references, the
  `daily_logs` cache table (keyed by humanId+date, never by folder path),
  and anything else addressed by fileId keep working with no separate
  content migration step.
- `ensureVaultRootFolders` (`vault.server.ts`) no longer auto-creates a
  `daily-logs` root if one doesn't already exist — the one behavior
  change needed to stop a migrated human's old root from being silently
  RESURRECTED (empty) on their very next page load, since by then no
  root-level folder named `daily-logs` exists for that function's own
  check to find. A human who still has one gets it left alone there
  (`ensureVaultRootFolders` only backfills its `vault_root_key` tag if
  missing) until `resolveDailyLogsFolder` migrates it away.
- `VAULT_ROOTS`/`VaultRootKey` (`vaultRoots.ts`) were deliberately left
  UNTOUCHED (still include `"daily-logs"`) — only `ensureVaultRootFolders`'s
  runtime behavior changed, not the type system, so every place that
  reads a not-yet-migrated folder's `vault_root_key` (`canWriteToRoot`,
  `isRootShareable`, the Vault sidebar's `folderLabel`, ...) keeps working
  unchanged for the transitional period.
- **Verified directly against the local dev SurrealDB** (not just
  typechecked): a synthetic human's simulated legacy root+history was
  migrated, confirmed same folder id / same date-folder id / same
  readme fileId / unchanged content, confirmed idempotent on a second
  call, and confirmed `ensureVaultRootFolders` no longer resurrects the
  old root afterward.
- **A REAL, CONFIRMED bug found via actual local-dev usage (not caught by
  the synthetic-human test above), since fixed**: the original code
  checked "does a `Daily Logs` destination already exist under `syncs`"
  BEFORE ever looking for the legacy root. The doc here originally called
  the underlying race "theoretical, accepted" (same class as
  `getOrCreateVaultFolder`'s own documented one) — that assessment was
  WRONG: once any folder happened to be created at that destination (a
  real account hit this from ordinary concurrent usage — the Daily Log
  page plus a GraphLog CLI command both touching the same human around
  the same time), the real legacy root became PERMANENTLY invisible to
  every later call, silently orphaning that human's entire daily-log
  history (confirmed directly: real `readme.md`/Card/attachment files
  sitting untouched under the old root while new saves kept landing in a
  freshly-created, mostly-empty folder next to it — a materially worse
  outcome than a cosmetic duplicate folder). Fixed by always resolving
  the legacy root FIRST, and self-healing an already-bad state via a new
  `mergeFolderContentsInto` helper: a same-named child folder (a date
  that got touched under BOTH locations during the bad window) merges
  recursively; a same-named child file keeps both copies via the same
  auto-dedupe suffix `copyFileIntoFolder` already uses
  (`image.jpg`/`image (2).jpg`) rather than silently dropping either one.
  **Confirmed fixed against the real broken account**: re-running
  resolution merged 20+ real date folders (some moved wholesale, some
  merged with a genuine filename collision preserved via the dedupe
  suffix) with zero data loss, and `daily-log-sync` immediately found and
  synced every real historical Card afterward.
- **Known, accepted follow-up, not yet done**: the Vault sidebar
  (`fruits_.vault.tsx`) doesn't yet turn the root-level "Daily Logs" entry
  into an explicit shortcut/redirect into `personal/syncs/Daily Logs` —
  today it simply stops appearing in the sidebar once a human is
  migrated (an already-migrated human has no `daily-logs`-keyed root
  folder left at all), rather than redirecting there. Purely a navigation/
  discoverability polish item, not a data-integrity concern — the actual
  Daily Log editing page (`fruits_.daily-log.tsx`) doesn't go through the
  Vault sidebar at all, so this doesn't affect daily-log editing itself.
- **Known, accepted perf tradeoff, not yet optimized**:
  `resolveDailyLogsFolder` does several sequential lookups (root
  provisioning, personal lookup, syncs lookup/create, legacy-root check)
  versus the old resolution's single query — and every daily-log read/
  write path calls it independently, with no per-request caching/
  memoization yet. Not addressed in this pass; revisit if it shows up as
  a real bottleneck, same "don't optimize until it's proven to matter"
  approach the rest of this codebase already takes.

## The `:ref{...}` directive

A read-only attribution mark — who said/wrote something, when, and where
it came from. Lives in `oxmarkdown-core/src/refDirective.ts`
(`RefAttrs`/`buildRefDirectiveMarkdown`/`parseRefAttrs`), rendered by
`components/OxRenderer.tsx`'s `RefDirectiveStatic`/`RefDirectiveMarker`.
Demoed in `routes/fruits_.styles_.oxmarkdown.tsx`'s "Try it" playground.

- **A TEXT directive** (`:ref{...}`, inline, no children) — same built-in
  tier as `::file{...}`/`::card{...}` (never a caller-registered
  `DirectiveRegistry` entry), but never editable — GraphLog is the only
  writer, so it does NOT get the generic directive-attrs-editing popover
  every OTHER directive gets.
- **Attributes** (`REF_ATTR_KEYS`): `name`, `human-id` (optional — this
  app's Human id, when known), `datetime` (ISO 8601), `location` (a path
  back to the source), `verbose` (`"true"` or omitted — omitted means
  `false`).
- **`verbose` is a STATIC attribute, decided by the WRITER, never by
  rendering context.** GraphLog passes `verbose="true"` only when writing
  into a `Graph/graph-log-*.md` file; every other usage should omit it.
- **Two renderings**:
  - `verbose="true"` — fully spelled-out plain inline text (name · date ·
    a "source" link), no popover — there's nothing hidden to reveal.
  - omitted/`false` — a single `*` glyph; click/tap opens a small
    read-only `OxPopover` with Name/When/Source. Name links to
    `human-id`'s vault root if present.
- **A real, confirmed parser limitation to know about**:
  `micromark-extension-directive`'s attribute-value parser has **no
  escape mechanism for a literal `"` inside a value at all** — a
  backslash-escaped quote doesn't get unescaped on read, it breaks
  attribute parsing outright (the whole `attributes` object comes back
  `null`, silently dropping every attribute, not just the one with the
  quote in it — confirmed directly with a round-trip test). Every
  directive attribute value in this codebase shares this limitation, not
  just `ref`'s — `buildRefDirectiveMarkdown`'s `escapeDirectiveAttrValue`
  substitutes a right double quotation mark (`"` → `”`) rather than
  attempting to escape, since there's no real escape syntax to lean on.
- **`formatRefDatetime` must pin an explicit locale AND `timeZone: "UTC"`**
  — `toLocaleString(undefined, ...)` resolves to whatever locale/timezone
  the RUNTIME is in, which is the server's during SSR and the browser's
  during hydration; those two disagreeing is a real, confirmed bug that
  shipped once (a hydration error on `/fruits/styles/oxmarkdown`, the
  rendered date/time text differing between server and client). Same
  fix `fruits_.profile.tsx`'s `formatSignedAt` already uses, for the same
  reason.
- **Human profile links are a known, accepted gap** — `humanProfileHref`
  builds an `/{humanId}:root` href (same `/humanId:path` SHAPE the
  `oxmarkdown` skill documents for `@`-mentions), but there's no real
  human-profile PAGE to resolve it to yet, and no real in-app navigation
  wired up for it — same already-accepted gap `@`-mentions have today
  ("resolving a mention's `/humanId:path` href into real in-app
  navigation" is still a TODO there too). Whoever finishes that for
  mentions should cover this the same way, rather than solving it twice.

## Migration from `project-n01` (historical — completed and removed)

GraphLog originally coexisted with PhyLog while projects were migrated one
at a time (`nopal graphlog migrate-to-n02`, plus a `--full` sweep to
discover and convert everything a human owned in one command). That
migration has been run for real across every project and `personal`
space, and the migration tooling itself — `migrateToN02.server.ts`,
the `nopal graphlog migrate-to-n02` CLI command, and the
`/api/graphlog/migrate-to-n02`/`/api/graphlog/n01-projects` routes — has
since been deleted entirely, alongside the rest of PhyLog (see the header
above). `project-n01` no longer exists as a valid folder type.

Two real data-integrity bugs were found and fixed while building that
migration's `--full` sweep, before it was removed — kept here as a
historical record since the SHAPE of both bugs (a check-then-create race
producing duplicate system-managed folders; a retrofit function silently
re-tagging an already-migrated folder back to its old type) is a real,
generalizable lesson, not just a fact about PhyLog specifically:

1. **A retrofit function (`ensureProjectN01`, since deleted) silently
   retagged an already-migrated `project-n02` folder back to
   `project-n01`** whenever a call site meant only "backfill an UNTYPED
   legacy folder" but couldn't tell "untyped" apart from "validly typed as
   something else." Found because it had already corrupted a real
   project's data (re-adding PhyLog's own skill files alongside GraphLog's,
   while the real `Graph/` content sat there orphaned) — repaired directly
   against the DB, not via re-migration (which would have deleted that
   real `Graph/` content). Fixed at the time by adding an early-return
   guard for an already-`project-n02` folder; moot now that the function
   generating the bug no longer exists.
2. **A check-then-create race in "does a Skills folder already exist?"
   checks produced duplicate "Skills" folders** on several real projects
   — fixed at the root with a deterministic folder id
   (`systemVaultFolderKey`) so creating "the same" folder twice is a
   no-op instead of a duplicate row, the same pattern
   `getOrCreateVaultFolder` already used elsewhere in `vault.server.ts`.
   This fix is NOT specific to migration and remains in `projectN02.server.ts`'s
   `applyProjectN02Shape` today.

## Maker pages

Same gate (Admin/Super only), same layout, same range-toggle convention
as the rest of `/fruits/maker`.

- **`graphLogMetrics.server.ts`'s `getGraphLogUsageSummary(days)`/
  `pruneOldGraphLogUsageEvents`**, alongside `recordGraphLogUsage` — an
  aggregation layer (byStage/byProject/byHuman/byDate, cost estimation via
  `llmPricing.ts`) added once a real Maker page existed to review it from.
- **`graphLogDefaults.server.ts`'s admin-editable-override layer**
  (`getEffectiveGraphLogDefaultSkill`/`getAllEffectiveGraphLogDefaultSkills`/
  `setGraphLogDefaultSkillOverride`, table `graphlog_default_skills`) —
  one DB row, one OPTIONAL field per stage, unset means "use the hardcoded
  constant"; NEVER retroactive — only changes a brand new project's seed
  content going forward. `projectN02.server.ts`'s `applyProjectN02Shape`
  seeds from these effective values instead of the raw `DEFAULT_*_SKILL`
  constants directly.
- **`/fruits/maker`'s "GraphLog Usage" summary section**.
- **`/fruits/maker/graphlog`** — the full usage breakdown page (Overview/
  By Stage/Calls Per Day/By Project/By Human).
- **`/fruits/maker/graphlog/defaults`** — the default-skill-text review/
  edit UI (Knowledge/Graph/Structure/Project View).
- **Verified directly** against the real local dev SurrealDB: `projects/Nopal
  O.`'s real earlier `nopal graphlog run` already left real
  `graphlog_usage_daily` rows (16 calls, sync-graph + graph-project-view,
  ~$0.33 estimated) — `getGraphLogUsageSummary(30)` correctly aggregated
  them end to end (byStage/byProject/byHuman/byDate all populated
  correctly) on the first real call, not just against synthetic data.

## Performance tracing (per-run timelines)

Separate from `graphLogMetrics.server.ts`'s own token/cost usage
tracking: `graphLogPerf.server.ts` records a per-run TIMELINE of real,
code-measured event durations — API calls, LLM calls, plain function
calls — never a number the model itself reports (deliberately: this
exists to see how long CODE takes, not to have the AI estimate its own
timing). Two tables, `graphlog_runs` (one row per run: started/finished/
ok/error) and `graphlog_run_events` (one row per timed event within a
run: `process`/`type`/`name`/`params`/`duration_ms`/`started_at`/
`outcome`, ordered by actual start time). A "run" reuses the owning
BullMQ job's own id directly as its record id (`worker.ts`'s
`processGraphLogJob` calls `startGraphLogRun`/`finishGraphLogRun` around
every GraphLog job, of every job name) — one real queued job always means
exactly one timeline, no separate id scheme to keep in sync.

- **`GraphLogPerfRecorder`** (`event`/`time`) is the interface every
  stage function's own `opts.perf` is typed as — a real recorder when
  invoked from the worker, or `noopGraphLogRunRecorder` when a stage is
  exercised directly with no run/job context (a script, a test). `time()`
  wraps an async call, measuring it wall-clock and recording the event
  automatically (including on a thrown error, before rethrowing).
- **`process` values today**: `"daily-log-sync"`, `"sync-knowledge"`,
  `"sync-graph"`, `"graph-structure"`, `"graph-project-view"`, plus the
  deterministic jobs' own names (`"migrate-to-n02"`, `"reset"`,
  `"reset-project-view"`, `"reset-graph"`, `"reset-knowledge"`).
  `runGraphLogPipeline` (the `"run"` job) shares ONE recorder across all
  five stages, tagging each stage's own events correctly — a full `nopal
  graphlog run` produces one run whose timeline spans all five stages,
  not five separate untagged runs.
- **`type` values**: `"llm"` (a real Anthropic call — `sync-knowledge`'s
  `describePhoto`/`complete`, `sync-graph`'s per-day tool loop,
  `graph-structure`'s per-batch tool loop, `graph-project-view`'s readme
  tool loop), `"api"` (an external call that isn't an LLM — today just
  `sync-knowledge`'s `downloadFileBytes` S3 read), `"fn"` (a plain
  function call — today each stage's own top-level wrapper, recorded by
  `runGraphLogPipeline`/`worker.ts` around the whole stage call so a
  skipped/fast stage still shows up as one bar), `"other"` (reserved,
  unused today).
- **Two levels of granularity, nested by actual start time**: each of
  `sync-graph`'s per-day loop, `graph-structure`'s per-batch loop, and
  `graph-project-view`'s single loop records BOTH an aggregate event
  (`day`/`batch`/`readme`, piggybacking on the exact spot each stage
  already computes a `durationMs` for `recordGraphLogUsage`) AND one
  `turn` event PER TURN inside that loop — a real, individually-timed
  `provider.complete()` call, not a share of the aggregate. A turn event's
  `params` carries `stopReason`, the names of any `toolCalls` made that
  turn, and (see next bullet) the model's own plain text for that turn.
  `sync-knowledge` has no multi-turn loop to begin with (one completion
  per file), so its own `describePhoto`/`complete` events are already
  turn-granular by construction.
- **The model's own plain text, captured per turn** — `LlmResponse.text`
  (whatever narration a turn produced alongside/instead of a tool call)
  used to be thrown away the instant it was folded back into the
  conversation history; every `turn` event's `params.text` now carries it
  (trimmed, capped at 8000 characters), specifically because it's
  otherwise-invisible for the ONE case it matters most: a turn that hit
  `max_tokens` never got to finish that text, so it's the only record of
  what the model was in the middle of writing when it got cut off. This is
  NOT Anthropic's separate, opt-in "extended thinking" feature (no stage
  requests that) — just the model's ordinary response text, previously
  discarded. `sync-knowledge`'s own text-extraction call gets the same
  `text` field for consistency, even though on success it's redundant
  with the knowledge file itself (the file is the real record there).
- **`/fruits/maker/graphlog`'s "Recent Runs" section** (moved here from
  the defaults page, which is now editors-only) lists the most recent
  runs (`listRecentGraphLogRuns`); each links to
  **`/fruits/maker/graphlog/runs/$runId`** (`getGraphLogRun`), a full
  timeline view — one row per event, ordered by actual start time (NOT
  insertion order — a wrapper `fn`/aggregate span is only written once it
  finishes, which is AFTER everything nested inside it), with a
  right-aligned duration bar (max 33% of the row's own width; the single
  longest event in the run is the only one that ever fills that full
  33%). A row with `params.text` renders it in a collapsed
  `<details>`/`<summary>` (character count in the summary, full text in a
  scrollable `<pre>` once expanded) rather than squeezed into the compact
  inline params string every other param renders as.
- **Not yet wired to a cron route** — `pruneOldGraphLogRuns` (30-day
  default retention) exists but has no `POST /api/graphlog/*-cleanup`
  route calling it yet, same gap `pruneOldGraphLogUsageEvents` itself had
  before its own Maker page existed. Worth revisiting sooner than that
  gap otherwise would have needed — per-turn events (plus each one's own
  up-to-8000-character text) accumulate meaningfully faster than the old
  per-day/per-batch/per-loop events did.
- **Verified directly**: a synthetic run (mixed `llm`/`api`/`fn` events,
  one deliberately marked `outcome: "error"`) was seeded against the real
  local dev SurrealDB and screenshotted on both new pages in light AND
  dark mode — badges/bars reuse the SAME already-vetted hues `Badge`'s
  own `accent`/`success`/`warning`/`neutral` variants use as backgrounds
  (no bespoke contrast check needed), confirmed legible in both schemes.
  Re-verified after adding per-turn `text` capture: a synthetic
  `graph-project-view` run (one clean `tool_use` turn, one `max_tokens`
  turn carrying a long in-progress `text`) was screenshotted collapsed
  AND expanded (via a real Playwright click on the `<summary>`, not just
  page load) in both color schemes — the expanded `<pre>` block's text
  stayed legible in dark mode without needing its own dark-mode override
  (confirmed directly, not assumed, since a bare `color: inherit` on this
  kind of element is exactly what already broke `DefaultSkillEditor`'s
  own textarea in dark mode — a known, pre-existing, NOT-yet-fixed gap
  noted when this skill's own "Recent Runs" section was first built,
  unrelated to this addition).

## Local dev gotcha: the worker not hot-reloading (FIXED)

`packages/worker`'s `vite-node worker.ts` is a plain, long-running
process, its own standalone package (not part of `webapp`) so its deploy
doesn't drag along dependencies it doesn't need. This used to mean it did
NOT watch for file changes at all, unlike the webapp's own Vite dev
server — editing `worker.ts` OR ANY `robustness-core`/`oxmarkdown-core`
file a GraphLog job transitively imports left the running
`nopal-worker-1` container silently serving the OLD code until someone
remembered to `docker restart nopal-worker-1` by hand (confirmed directly
multiple times over the course of this skill's own build — a job enqueued
right after a code change either ran the stale logic or failed outright
with `Unknown GraphLog job name: ...`).

**Fixed**: `docker-compose.yml`'s `worker` service now runs
`pnpm --filter worker run dev` (`vite-node --watch worker.ts`) instead of
`run start` (a plain, one-shot `vite-node` — unchanged, still what
production's own Dockerfile CMD uses; watch mode is dev-only, on purpose,
since there's no live-editing to react to in an immutable deployed
container). `--watch` is `vite-node`'s own built-in flag, and it follows
pnpm's real workspace symlinks back to each package's actual source —
the SAME reason the webapp's own dev server already hot-reloads changes
to `robustness-core`/`oxmarkdown-core` — so editing any file the worker's
module graph touches now respawns the whole process automatically, no
manual restart needed.

**Applying this to an already-running local stack requires recreating the
container**, not just editing the compose file — `docker compose up -d
worker` (or a full `docker compose up -d`) picks up the new `command:`.
A plain `docker restart nopal-worker-1` reuses whatever command the
container was already created with, so it does NOT pick this up on its
own. Recreating the container interrupts any GraphLog job currently
running, same as any other worker restart already could — do it between
runs, not mid-run. `make reset` (a full `docker compose down -v` + fresh
`up`) also picks it up, but wipes every named volume — including local
SurrealDB/MinIO data — so it's a much bigger hammer than needed just for
this.

## Build status

Sequenced as testable, independent units — mirrors the phased plan this
skill was born from:

1. **Done — the `:ref{...}` directive.** See its own section above.
   Files: `oxmarkdown-core/src/refDirective.ts`, `OxRenderer.tsx`'s
   `RefDirectiveStatic`/`RefDirectiveMarker`, `styles/oxmarkdown.css`'s
   `.ox-ref*` rules, demoed in `fruits_.styles_.oxmarkdown.tsx`.
2. **Done — `project-n02` container + `Graph` space type skeleton.**
   `vaultFolderTypes.ts` (`project-n02`, `graph`), `vault.server.ts`'s
   `validateFolderTypeForParent` widened to accept either container type,
   `projectN02.server.ts` (`ensureProjectN02`/`resolveProjectN02`/
   `ensureProjectGraphFolder`), `graphLogDefaults.server.ts` (starter skill
   content). **Not yet wired to anything real** — nothing calls
   `resolveProjectN02` yet (no CLI/API surface), and `createVaultFolder`
   still tags every brand new project `project-n01` by default (that
   cutover is a deliberate later step, not a side effect of this type
   existing).
3. **Done — `daily-log-sync`, including the Option-A root retirement.**
   `dailyLogSync.server.ts` (`ensureDailyLogsSyncFolder`, `runDailyLogSync`)
   mirrors `fileCardAttachments`'s zero-inference shape: for every (day,
   contributor) with a Card for a project, mirrors that Card's content
   into `syncs/Daily Logs/<date>-<humanId>.md` and copies every
   `::file{...}` attachment alongside it (`<date>-<humanId>-<name>`),
   idempotent via a stored `content_hash` for the Card text and a
   deterministic destination name for attachments.
   `POST /api/graphlog/daily-log-sync` (synchronous, no job queue —
   deterministic and free, so there's no reason to make a caller wait on
   a queued job for it), `nopal graphlog daily-log-sync --project <path>
   [--date]`.
   The Option-A root retirement (`vault.server.ts`'s `resolveDailyLogsFolder`
   + `ensureVaultRootFolders`'s "daily-logs" special case) shipped as its
   own carefully-scoped, separately-tested follow-up — see "The 'Daily
   Logs' symlink" above for the full design and what's still open
   (sidebar navigation polish, per-request caching).
   - **A REAL, CONFIRMED GAP, FOUND AND FIXED: a copied attachment never
     carried a `date`.** Only the Card's own text file got `date:
     entryDate` stamped at creation; a copied `::file{...}` attachment
     was left with none. Since `sync-graph`'s `collectDatedCandidates`
     only ever collects files with a real `date` (`!!f.date`), every
     attachment — a photo, a PDF, anything — was SILENTLY EXCLUDED from
     ever becoming a graph candidate, no matter what either skill said.
     `sync-knowledge` still described it into a `_knowledge/*.knowledge.md`
     sidecar (it walks every real file, not just dated ones), but nothing
     downstream ever read that description back in — the description
     dead-ended, and the file had NO path into the graph, and therefore
     none into the README, structurally, regardless of prompt wording.
     Fixed by stamping `date` on a copied attachment too
     (`updateFileRef`'s own allowed-fields list widened to include `date`
     for exactly this), so it flows through the SAME per-day pipeline a
     Card's text already does. See `sync-graph`'s own "Files" note below
     for the rest of the fix (a file-backed source, a node's own attached
     image, and `graph-project-view`'s "files are never optional"
     coverage check).
4. **Done — `sync-knowledge`.** `syncKnowledge.server.ts`
   (`runSyncKnowledge`) walks a project's `syncs/` tree recursively
   (skipping `_knowledge/` folders themselves), and for every file without
   an up-to-date sidecar, asks an LLM (per `skills/KNOWLEDGE.md`'s own
   instructions — default "skip", a total no-op) to extract concrete
   metadata into `_knowledge/<name>.knowledge.md`, right inside the SAME
   folder the source lives in. Idempotent via a stored `content_hash` in
   the sidecar's own front matter, same convention pre-capture uses.
   Reuses `LlmProvider`/`PhotoDescriber`/`AnthropicProvider`
   (`anthropicProvider.server.ts`) unchanged — no new LLM infra needed.
   - **Own usage-tracking + queue infra** — `graphLogMetrics.server.ts`
     (`graphlog_usage_events`/`graphlog_usage_daily` tables,
     `recordGraphLogUsage`) and `graphLogQueue.server.ts` (its own BullMQ
     queue `"graphlog"`, own per-project Redis lock keyed
     `graphlog:lock:...`). `classifyLlmError`/`SKIP_MARKER`/
     `getProjectStageSkill`/`listExtraSkillFiles`/`isSkipInstruction` live
     directly in `graphLogMetrics.server.ts`/`projectN02.server.ts`,
     self-contained rather than imported from elsewhere.
   - **Runs in `packages/worker/worker.ts`**, a BullMQ `Worker` against
     the `"graphlog"` queue — GraphLog's stages are deliberately
     container-type-agnostic by design (a plain `getFolderById` is
     enough, same as `dailyLogSync.server.ts`'s own resolution) rather
     than resolving through `resolveProjectN02` on every dispatch.
   - `POST /api/graphlog/sync-knowledge` (enqueue) + `GET
     /api/graphlog/jobs/:jobId` (poll) — agentic, so this follows an
     enqueue-then-poll shape, unlike `daily-log-sync`'s synchronous one.
     `nopal graphlog sync-knowledge --project <path>`
     (`crates/cli/src/graphlog.rs`'s own enqueue/poll helpers).
   - **Verified directly** (not just typechecked): a throwaway script
     exercised `runSyncKnowledge` against the real local dev SurrealDB
     with a FAKE `LlmProvider`/`PhotoDescriber` (no real Anthropic calls,
     no cost) via its own `opts.provider`/`opts.photoDescriber` override
     seam (the same one PhyLog's `runPreCapture` already supports for
     testability) — confirmed the skip-gate (no `KNOWLEDGE.md` -> zero
     calls), correct `_knowledge/<name>.knowledge.md` naming, idempotency
     on an unchanged file, and correct regeneration once a source file's
     `content_hash` changes.
5. **Done — `sync-graph`, since REDESIGNED a second time from a
   whole-day, single-completion shape** (see "The pipeline"'s own
   sync-graph bullet's "A THIRD real architecture change" note above).
   `syncGraph.server.ts` (`runSyncGraph`) still walks every file under
   `syncs/` that carries a `date` (today, only `daily-log-sync`'s own
   output does), groups by date, and for each day whose aggregate hash
   (every candidate's `content_hash` PLUS its `_knowledge/` sidecar's
   own hash, if any) has changed, extracts citable nodes into
   `Graph/graph-log-YYYY-MM-DD.md` per `skills/GRAPH.md`'s own real
   starter instructions (NOT "skip").
   - **What changed**: this used to ask an LLM, in ONE non-tool
     completion, to produce a whole day's file body at once. Confirmed
     against `nopal o.`'s real history that this genuinely truncates on
     a busy day (`2026-08-13`'s output cut off at the shared 8192-token
     default) — the same class of problem `graph-structure` already hit
     and fixed at the whole-graph level (see item 7 below). Now a
     bounded tool loop (`add_node`, `TOOLS`/`createSyncGraphExecutors`/
     `runSyncGraphDayLoop`) calls one tool per node, accumulated in
     memory and written ONCE the day finishes cleanly — still
     all-or-nothing per day (an interrupted/truncated day still writes
     nothing, retried whole next run — no partial-file complexity added,
     unlike `graph-structure`'s own per-cluster durability, since a raw
     day's source content has no stable per-node identity to resume
     against the way an already-existing graph node or README section
     does), but any single completion's own output is now just one
     node's worth of text, so the original truncation mode is no longer
     reachable in ordinary use. `MAX_TURNS = 30` per day (generous for a
     realistic day's node count).
   - **A REAL, CONFIRMED FOLLOW-ON BUG, found against a real production
     run of this exact redesign (`nopal o.`, a busy day, not
     theoretical)**: "one tool call per node" was only ever a PROMPT-level
     assumption, never an enforced one -- Anthropic is free to return
     several `tool_use` blocks in a single response, and on a busy day
     the model batched multiple `add_node` calls into one turn, growing
     that turn's own output past the shared 8192-token ceiling anyway --
     the exact truncation class the redesign above was meant to
     eliminate, just recreated one level up (per-turn instead of
     per-day; confirmed live: "2026-08-14's output was cut off by the
     model's own output limit" on an otherwise-healthy multi-day catch-up
     run). Fixed the same way every other "never trust the model with
     something code can just enforce" bug in this file already was:
     `runSyncGraphDayLoop` now only EXECUTES the first `add_node` call in
     a given turn; any extra call in that same turn is rejected (told to
     retry on a later turn) rather than applied, so a turn's own
     necessary output is now actually BOUNDED to one node, not just asked
     to be. The system prompt and the tool's own description were also
     reworded to ask for this directly -- belt and suspenders, since a
     clearer prompt still reduces how often the reject-and-retry path
     even needs to fire. Code-fixed, ready for the next deploy; not yet
     re-run against the specific day that triggered this.
   - **Citations are now ATTACHED BY CODE, not copied by the model at
     all** — a step further than the original "pre-computed, hand it
     verbatim text to copy" design (which still left room for a long
     `:ref{...}` attribute string to get mangled in transcription).
     `add_node`'s own `sourceIndex` parameter identifies which of the
     day's numbered sources ( "Source 0", "Source 1", ...) a quote came
     from; the executor attaches that source's exact citation and the
     next `### Node <N>` number itself — the model never sees or writes
     a citation's markdown, or a node heading/number, at all anymore.
     `location` is still a real, working `/fruits/vault?file=<fileId>`
     link into the SYNCED COPY inside this project's own vault; `datetime`
     is still `<date>T12:00:00Z` (noon UTC) — a deliberate simplification
     since a Card carries a calendar date, never a sub-day timestamp.
   - **Contributor attribution** is recovered from the synced copy's own
     FILENAME (`dailyLogSync.server.ts`'s `parseSyncedCardFileName`, the
     reverse of `syncedCardFileName`) — the file's own `human_id` is
     always the PROJECT's owner, never the actual contributor, since the
     copy lives in the project's own tree. Falls back to "Unknown"/no
     `human-id` for any future non-daily-log sync source's file that
     doesn't match this naming shape — `:ref{...}`'s `human-id` is
     optional for exactly this reason.
   - **Links are now VALIDATED, not just instructed** — `backwardLinks`
     (ids like `"2026-07-29#3"`, from `Graph/graph-structure.md`'s own
     clustered, glossed, weighted content, one cycle stale by
     construction, falling back to a flat heading scan for a project
     that's never had `graph-structure` run at all) and `sameDayLinks`
     (plain numbers already added earlier the same turn, tracked live via
     `headingsByDate` since `graph-structure.md` can never reflect a node
     written earlier in the SAME run) are both checked against the real
     candidate set before being accepted — an invented id/number is
     silently dropped and reported back to the model, rather than a
     hallucinated link quietly ending up in the file. The max-3-links
     rule (`GRAPH.md`'s own instruction) is now an enforced CAP, not just
     a request; a forward link to an unprocessed day is now structurally
     impossible (its id is never in the candidate set) rather than merely
     told not to happen.
   - **Prompt caching**: `graph-structure.md`'s content (plus the shared
     skill instructions) now live in the SYSTEM prompt instead of being
     resent raw in every day's own user message — byte-identical across
     every day/turn a run touches, so a multi-day catch-up run pays full
     price for that block once, then a cheap cache-read for the rest,
     via the same `cacheSystemPrompt` mechanism already used elsewhere.
   - **Delete-and-regenerate, never partial-patch** — a day whose
     aggregate hash changed has its existing `graph-log-*.md` deleted
     BEFORE the model is asked to redo it from scratch; a day where the
     model makes NO `add_node` calls at all (replacing the original
     design's literal `NOTHING_TO_CAPTURE` sentinel string, which needed
     its own parsing/matching logic) ends up with NO file at all, even if
     an earlier run had written one for that same day.
   - `POST /api/graphlog/sync-graph` (enqueue) + the SAME
     `GET /api/graphlog/jobs/:jobId` sync-knowledge already uses (one
     polling route for every GraphLog job name). `nopal graphlog
     sync-graph --project <path>` — unchanged by the redesign.
   - **Verified directly, but NOT YET RE-VERIFIED after this redesign**
     — the ORIGINAL (pre-redesign) whole-day shape WAS verified directly
     against the real local dev SurrealDB with a FAKE `LlmProvider`: two
     days processed with correct cross-day linking; a second run made
     zero new LLM calls; changing one day's `content_hash` regenerated
     ONLY that day; a day with nothing worth capturing correctly produced
     no file. The new `add_node`/validation/caching logic has been
     self-reviewed carefully but not yet re-run against a scripted fake
     `LlmProvider` the way every other redesign in this list was before
     being marked verified — same open item `graph-structure`'s own
     redesign already has (see item 7's own note).
   - **A real bug in production output, found and fixed (predates this
     redesign, still true of the current code)**: a verbatim quote that
     was itself a numbered list got wrapped in ONE `==...==` span around
     the whole list, which silently broke instead of highlighting --
     confirmed the root cause is structural, not a rendering bug:
     `==...==` is inline markup exactly like `**bold**`, and inline
     markup can never cross a blank line or list-item boundary in any
     CommonMark-based parser (reproduced the identical failure with plain
     `**bold**` around the same list, in `oxmarkdown-core`). Fixed at the
     source, not the renderer: `DEFAULT_GRAPH_SKILL`
     (`graphLogDefaults.server.ts`) instructs marking each list item's
     own text separately when the verbatim words are/contain a list,
     keeping each item's own `1.`/`-` marker outside the highlight.
   - **Files.** An attached photo/PDF now becomes a real, numbered source
     alongside a day's Card text — see "Done — `daily-log-sync`" above for
     the `date`-stamping half of this fix. A file-backed source is offered
     once it has EITHER a real knowledge-derived DESCRIPTION or a real
     human-written CAPTION to ground a node in (never fabricated from an
     unseen photo) — a caption is deliberately just as sufficient on its
     own, since it's the uploader's own words, zero AI involved, and
     shouldn't need `sync-knowledge` switched on (a real cost, off by
     default) just to be reachable. The caption lives on the Card's own
     `::file{...}` attributes (the HUMAN-facing upload directive, never
     touched otherwise) and is recovered per day by re-scanning that day's
     Cards and matching by the attachment's own synced name. Its
     `sourceIndex` behaves exactly like a text source's.
     - **Deliberately NOT rendered as `::file{...}`.** When `add_node`
       cites a file-backed source, ORDINARY markdown (never a custom
       directive) is appended to the node's own text BY CODE
       (`buildAttachedMediaMarkdown`, `syncGraph.server.ts`), never typed
       out by the model — same reasoning `:ref{...}` already follows.
       Shape depends on the file's REAL content type, decided by code,
       never guessed by the model:
       - **Image** — `![alt](/api/vault/view/<fileId>)` (the caption, if
         any, becomes the alt text).
       - **Video** — `[alt](/api/vault/view/<fileId>?type=video)`, an
         ORDINARY LINK carrying a `?type=video` marker — a real, working,
         clickable link even somewhere that's never heard of this
         convention (unlike an `<img>` pointed at a video file, which
         would just be broken). `OxRenderer.tsx`'s own gallery collector
         (`collectGalleryMedia`, the `oxmarkdown` skill's own domain) looks
         for that SAME marker to upgrade the link into a real
         `<video controls>` player wherever it ends up inside a
         `:::gallery{}...:::` block — a real, new capability added
         alongside this (the gallery, and `project.server.ts`'s own LEAF
         `::gallery{folder="..."}` folder resolution, both used to only
         ever recognize images; video is now equally first-class in both).
       - **Anything else** (a PDF, a doc, ...) — a plain
         `[name](/api/vault/view/<fileId>)` link, no marker — never
         gallery-eligible, a reader just clicks through.

       A bare image/link degrades gracefully anywhere (no directive
       support needed at all), and — the real reason for this choice over
       a one-file-per-mount `::file{...}` directive — several photos/videos
       can be freely grouped under one shared `:::gallery{}...:::`
       container by a later stage without ever having to rebuild the
       image/link line itself. From there the file needs no separate field
       or plumbing at all: it's just part of `GraphLogNode.quote`, so
       `graph-structure`'s pre-fetch and `graph-project-view`'s own node
       text see it automatically. `DEFAULT_GRAPH_SKILL`'s own "Files"
       section covers the model-facing side (read a caption and/or a
       description, apply the same standalone test, never write any
       markup yourself — the model never needs to know or care which of
       the three shapes above its own citation becomes). `PROJECT_VIEW.md`'s
       own "Files travel with their nodes" section tells graph-project-view
       the gallery is for photos/videos ONLY (grouping several from the
       same thread/moment into ONE gallery rather than scattering
       single-item ones), and everything else stays a plain link, never
       wrapped in a gallery — the grouping is the writer's choice, the
       image/link line inside it is not.
6. **Done — `graph-project-view`, REDESIGNED from its original per-day
   shape** (see the header's "real architecture change" note).
   `graphProjectView.server.ts` (`runGraphProjectView`) now reads
   `Graph/graph-structure.md` (not graph-log files directly) and runs
   ONCE per invocation — not once per graph-log day — gated on
   `graph-structure.md`'s own `asOfGraphHash` versus the
   `appliedByProjectView` marker this stage stamps onto that SAME file
   once an update completes cleanly. A single bounded tool-calling loop
   (`update_section`/`remove_section`, same "Deliberately deferred" note
   on `write_file`/`update_readme`/truncation-retry as before) reconciles
   the whole README against the current graph-structure.md, grounded in
   `skills/PROJECT_VIEW.md`.
   - **Reuses `project.types.ts`'s `splitFrontmatter`/`splitReadmeSections`/
     `joinReadmeSections`/`withReadmeBody` directly** (the same primitives
     `capture.server.ts` uses) — these are neutral README-SHAPE utilities,
     not PhyLog pipeline code, so sharing them doesn't compromise
     GraphLog's independence the way importing `capture.server.ts` itself
     would have.
   - **"Notes on this view" is protected, code-owned, never a tool
     target.** `update_section`/`remove_section` both hard-refuse (a
     `hadRefusal` state, same signal a bad edit anywhere already uses to
     block marking the run applied) any attempt to target that heading.
     The section is guaranteed to exist — created with the standard
     placeholder text the FIRST time this stage ever runs for a project,
     since the model can never create it itself. Reading unstamped
     comment LINES (anything not already ending ` → read <date>`) and
     stamping them after a clean run is deterministic pre/post-processing
     code (`extractReaderComments`/`stampAppliedDate`), never delegated to
     the model — the unstamped text is handed to the model as read-only
     context ("treat this as ground truth"), not something it edits.
   - **Section order is enforced by a deterministic `reorderSections`
     pass**, run unconditionally on a clean finish (not just when a
     section was actually edited) — re-sorts the six canonical headings
     from `PROJECT_VIEW.md`'s prescribed shape into place; anything else
     (a heading the model invented despite the fixed shape) lands just
     before "Notes on this view" rather than being silently dropped.
   - **A real bug found and fixed by direct testing**: the executors were
     originally constructed with the OLD (pre-run) file id before the
     "ensure Notes on this view exists" step had a chance to create the
     README for a brand new project — the model's first `update_section`
     call then created a SECOND, duplicate README instead of editing the
     one just created. Fixed by creating/updating the real file FIRST,
     then constructing the executors with that real id.
   - `POST /api/graphlog/graph-project-view` (enqueue) + the shared
     `GET /api/graphlog/jobs/:jobId`. `nopal graphlog graph-project-view
     --project <path>`.
   - **Verified directly** (not just typechecked) against the real local
     dev SurrealDB with a scripted fake `LlmProvider`: a first run adds a
     section and auto-creates "Notes on this view"; a no-op re-run against
     an unchanged `graph-structure.md` makes zero new LLM calls; an
     attempt to edit "Notes on this view" alongside a legitimate edit in
     the SAME turn commits the legitimate one and rejects the other
     (confirmed by inspecting the saved file, not just the return value),
     leaving the run unmarked-applied so it retries; a later clean retry
     succeeds; and an unstamped reader comment is both included in the
     next prompt verbatim AND stamped ` → read <date>` in place afterward.
   - **A SECOND real bug, found against real production data** (`nopal
     o.`, 88 nodes, a real Anthropic call — not the fake-provider tests
     above): `update_section`'s own tool description told the model to
     pass `heading: ""` for the intro, and the model sometimes read that
     as "pass the literal two-character string of two quote marks"
     rather than "pass an actually-empty string" — the real README came
     back with a literal `## ""` heading holding the intro, sorted next
     to "Open questions" instead of leading the file. Fixed two ways:
     the tool description was reworded to remove the ambiguous quote
     marks entirely, AND `normalizeIntroHeading` now treats both
     spellings (`""` the value, `'""'` the two-character string) as the
     same intro regardless of prompt wording, since a clearer prompt
     reduces the odds without ever guaranteeing them. The already-broken
     README on `nopal o.` was repaired directly (a pure section-reorder,
     no new LLM call needed) rather than via re-migration.
7. **Done — `graph-structure`, since REDESIGNED a second time from its
   original whole-graph-rebuild shape** (see the header's "real
   architecture change" note for why this stage exists at all, and "The
   pipeline"'s own graph-structure bullet above for the SECOND
   architecture change described here). `graphStructure.server.ts`
   (`runGraphStructure`) still reads EVERY `Graph/graph-log-*.md` file
   every run (not incrementally) and parses each into structured node
   records (`graphNodeIndex.server.ts`'s `parseGraphLogNodes` —
   deliberately simple line/regex parsing over the generated node
   format, same tradeoff `extractHeadings` already made) — that part is
   unchanged and still cheap (parsing, not an LLM call).
   - **What changed**: this used to hand EVERY node's full text to the
     model and ask for the ENTIRE `graph-structure.md` rebuilt in one
     non-tool, non-streaming completion. Confirmed against a real
     project's real history (88 nodes, a real Anthropic call) that this
     doesn't scale — the shared provider default output budget (8192
     tokens) truncated outright (`output_tokens: 8192` in the failed
     call's own recorded usage), and even a generous stage-specific
     override (20000) was already brushing against the Anthropic SDK's
     own HARD non-streaming ceiling (`expectedTime = 60min * maxTokens /
     128000`, throwing outright above ~21333 tokens, confirmed hit
     directly at 32000) — a wall that any further graph growth would
     eventually hit again, not a dial that could keep being turned up.
     Now: `graphStructure.server.ts` diffs the CURRENT graph's node ids
     against whichever ones `graph-structure.md` already has homes for
     (`buildMembershipIndex`, scanning the file's own `- <date> Node <N>`
     lines — deterministic, same simple-regex tradeoff as the parsing
     above), and only the DIFFERENCE is handed to the model, one cluster
     at a time, via a bounded tool-calling loop (`update_cluster`/
     `remove_cluster`/`get_node` — `TOOLS`/`createStructureExecutors`/
     `runStructureAgentLoop`, mirroring `graph-project-view`'s own
     `update_section`/`remove_section` shape closely, including
     persisting each tool call's edit immediately rather than only at
     the end, so a crash mid-run keeps whatever was already placed and
     the next run's diff naturally picks up only what's still missing).
     A first-ever build (or a fallback full rebuild against an
     unparseable previous file) still needs to place every node, but
     now spread across many small, bounded tool calls (`MAX_TURNS = 40`,
     generous versus `graph-project-view`'s own 8, since a real project
     can have dozens of threads) instead of one unbounded completion —
     the old hard ceiling is no longer reachable in ordinary operation.
     `GRAPH_STRUCTURE_MAX_TOKENS` and its whole override mechanism were
     REMOVED — no longer needed once no single completion's output
     scales with the whole graph anymore.
   - **Inbound link counts, AND NOW every cluster's "Weight: ..." line,
     are fully code-computed, never left to the model**
     (`graphNodeIndex.server.ts`'s `computeBacklinkIndex`, plus this
     file's own new `refreshClusterWeight`) — same "never trust the
     model with arithmetic it's shown" reasoning `sync-graph`'s own
     pre-built citations already follow, now extended from "facts handed
     to the model" to "the model's own output gets overwritten
     regardless of what it writes there." Every cluster's Weight line is
     recomputed from live backlink data as a deterministic pass
     (`refreshClusterWeight`) after the tool loop finishes — whether the
     model touched that cluster this run or not — and clusters are then
     re-sorted heaviest-first the same way (`sortClustersByWeight`), so a
     node gaining an inbound link elsewhere in the graph never requires
     the model to revisit its own cluster just to keep its Weight line
     honest. `GRAPH_STRUCTURE.md`'s own instructions were updated to
     tell the model it doesn't need to get these numbers right at all.
   - **A safety net, never trusting the model's own sense that it's
     done**: before stamping a run's `asOfGraphHash` applied, code
     confirms every node in the graph actually has a home in some
     cluster (re-parsing the just-committed file, same
     `buildMembershipIndex` used for the initial diff); if any are still
     unplaced, the hash is left unstamped so the run is retried, and the
     next attempt's diff naturally finds only the still-missing ones.
   - **Idempotent via an aggregate hash of every graph-log file's OWN
     `sourceHash`**, stored as `asOfGraphHash` on `graph-structure.md`'s
     own front matter — UNCHANGED from before this redesign. What
     changed is WHEN it's written: interim tool-call commits during a
     run persist the file's BODY immediately, but `asOfGraphHash` itself
     is only stamped once the whole run finishes cleanly AND the safety
     net above confirms every node placed. `graph-project-view` stamps
     its OWN `appliedByProjectView` marker onto that SAME file
     (`markGraphStructureApplied`, exported from this file for that
     stage to call directly) — co-located, same convention
     `sourceHash`/`appliedSourceHash` used on graph-log files before this
     stage existed.
   - **Thread-naming continuity**: still handed the CURRENT
     `graph-structure.md` every run and told to keep a continuing
     thread's name where it still fits — unchanged in spirit, though the
     mechanism is now "edit the existing file's cluster" rather than
     "rebuild fresh and try to match old names."
   - **Known, accepted gap, not yet fixed**: a node whose own TEXT
     changes without its id changing (a past day's graph-log file
     regenerated with the same date/number but different wording —
     possible, if rare, since `sync-graph` deletes and fully regenerates
     a changed day) won't be detected as "new" by the id-based diff, so
     its stale gloss in `graph-structure.md` could go unnoticed until
     something else touches that cluster. No evidence yet this has
     happened in practice; worth an audit if a gloss is ever found
     describing the wrong words for a node.
   - `POST /api/graphlog/graph-structure` (enqueue) + the shared
     `GET /api/graphlog/jobs/:jobId`. `nopal graphlog graph-structure
     --project <path>` — unchanged by the redesign.
   - **NOT yet re-verified against a real DB after this redesign** —
     the ORIGINAL (pre-redesign) whole-graph-rebuild shape WAS verified
     directly (see the now-superseded bullet this replaced, still true
     of the code as it stood then): a two-node, two-day graph produced a
     prompt with the correct precomputed inbound-link count/author, and
     a no-op re-run made zero new LLM calls. The new tool-driven
     diff/placement/weight-refresh/safety-net logic described above has
     been carefully self-reviewed against the exact shape
     `graph-project-view`'s own already-proven tool loop uses, but has
     NOT yet been exercised against the real local dev SurrealDB with a
     scripted fake `LlmProvider` the way every other stage's own
     redesign was before being marked verified here — that's the
     concrete next step before trusting this over the old, already-proven
     shape in production.
   - **`nopal graphlog run`** (`graphLogAgent.server.ts`'s
     `runGraphLogPipeline`, mirroring `phylogAgent.server.ts`'s
     `runPhylogPipeline`) ties all FIVE stages together in one job —
     `POST /api/graphlog/run`, job name `"run"` on the same `graphlog`
     queue.
8. **Done — the migration tool itself** (`nopal graphlog migrate-to-n02`,
   plus `--full` to discover and convert every space a human owns in one
   command). See "Migration from `project-n01`" above for exactly what it
   does, how it was verified, AND two real data-integrity bugs this work
   uncovered and fixed: (1) `ensureProjectN01` silently retagging an
   already-migrated `project-n02` folder back to `project-n01`
   (`projects/Nopal O.` was found corrupted this way, then repaired
   directly — NOT via re-migration, which would have deleted its real
   `Graph/` content); (2) a check-then-create race producing duplicate
   "Skills" folders, found on three real projects and fixed at the root
   with a deterministic folder id, same pattern `getOrCreateVaultFolder`
   already established elsewhere in `vault.server.ts`.
9. **Done — the Maker usage/defaults pages** (`/fruits/maker/graphlog`,
   `/fruits/maker/graphlog/defaults`, plus a summary section on
   `/fruits/maker` itself). See "Maker pages" above. The defaults page now
   has a fourth editor (`graphStructure`) alongside `knowledge`/`graph`/
   `projectView`.
10. **Done — the four reset commands** (`nopal graphlog reset`/
    `reset-project-view`/`reset-graph`/`reset-knowledge`,
    `graphLogReset.server.ts`). Not part of the original phased plan above
    — added afterward once the lack of any reset became a real gap. See
    "Reset" above for exactly what each depth deletes. `reset-graph` now
    also clears `graph-structure.md` (it lives in the same `Graph`
    folder), taking both its own `asOfGraphHash` and `graph-project-view`'s
    `appliedByProjectView` marker with it.
11. **Done — Run/Reset GraphLog from the Vault UI itself**, not just the
    CLI. `/fruits/vault`'s "More Actions" dropdown, on any `project-n02`
    folder (project OR `personal`), gains "Run GraphLog"/"Reset GraphLog"
    entries — but ONLY for `permissions.isAdmin(user)` (Admin or Super),
    and deliberately independent of that folder's own ownership/Sharing
    Role gate, since a staff member using this may not own or be shared on
    the project at all. To make that work, the three routes it calls
    (`api.graphlog.run.tsx`, `api.graphlog.reset.tsx`,
    `api.graphlog.jobs.$jobId.tsx`) were widened from owner-only to
    `role?.isOwner || isStaff`, matching the existing staff-override
    pattern in `api.legal-documents.view.$docId.tsx`. The UI enqueues,
    then polls `GET /api/graphlog/jobs/:jobId` every 3s (same
    enqueue-then-poll shape the CLI uses), and reports success/failure via
    a plain `window.alert` — intentionally minimal, no progress detail
    beyond that. "Reset" additionally requires a confirm dialog, since it's
    destructive.
12. **Done — a nightly automatic run, opt-in per project**
    (`graphLogSchedule.server.ts`). The same Vault "More Actions" dropdown
    (Admin/Super only, same `permissions.isAdmin` gate as item 11) gains an
    "Enable GraphLog Schedule"/"Disable GraphLog Schedule" toggle on any
    `project-n02` folder. Architecture mirrors `projectStatus.server.ts`
    exactly: a denormalized `graphlog_scheduled`/`graphlog_scheduled_at`
    pair on `vault_folders` (`vault.types.ts`), written only by
    `setGraphLogScheduled`, read back by `getGraphLogScheduledFolders`
    (`SELECT * FROM vault_folders WHERE folder_type = 'project-n02' AND
    is_folder_type_root = true AND graphlog_scheduled = true`).
    - **Unlike Run/Reset, this toggle is Admin/Super ONLY — no owner
      fallback**, in both the UI gate and its API route
      (`api.graphlog.schedule.tsx`). Enrolling something in an unattended
      nightly run is a different, more consequential call than triggering
      one run by hand, so it doesn't get the same "or you own it"
      carve-out Run/Reset have.
    - **The actual midnight trigger lives in `server.js`**, alongside the
      existing archive-cleanup/trash-cleanup/daily-log-sort crons but
      anchored differently: those three just repeat every 24h from server
      start (staggered by a fixed offset), which is "once a day" but NOT
      necessarily midnight. GraphLog's is deliberately anchored to actual
      local midnight (`msUntilNextMidnight()`), since "run overnight" was
      the whole point. Same `CRON_SECRET` bearer-token protection as the
      other three, hitting a new `POST /api/graphlog/scheduled-run`
      (`api.graphlog.scheduled-run.tsx`), which fans out one normal `"run"`
      job (`enqueueGraphLogJob`, same queue Run/Reset use) per scheduled
      project, `actingHumanId` set to the project's own `human_id` since
      no human is actually present to attribute the run to.
    - **No separate "fresh vs incremental" mode was needed.**
      `runGraphLogPipeline` already ties `daily-log-sync` →
      `sync-knowledge` → `sync-graph` → `graph-structure` →
      `graph-project-view` together, and every one of those five stages
      already decides for itself whether it has new work from what's
      already on disk (each logs `"...skipped"` when it finds nothing new
      — see `runGraphLogPipeline`'s own log lines). A brand new project, or
      one that was just reset, simply has nothing on disk yet, so the
      exact same `"run"` job does a full first pass; an existing project's
      same job only picks up what changed since the last one. Scheduling
      required zero changes to the pipeline itself.

**All done against the original phased plan** — the migration ran for
real across every existing project/`personal` space, and PhyLog/
`project-n01`'s code has since been fully retired (deleted, not just
unused) — see the header above and "Migration from `project-n01`" for
what that involved.

## Load-bearing decisions (ADRs)

A handful of GraphLog's behaviors look like tuning parameters or
inefficiencies to a future rewrite, but are actually brakes on real
feedback loops (e.g. the three-link cap, ranking by distinct authors
before raw count, quiet threads staying in `sync-graph`'s candidate list).
Removing any of them is silent — nothing errors, the system just slowly
stops doing the thing it was built to do. The reasoning for each is kept
in `docs/adr/000N-slug.md`, numbered so code can point at one directly
(`// brake, not a default — see ADR-002`) without spelling out the
reasoning inline. **That directory is deliberately git-ignored and kept
OUT of the public repo** (see `.gitignore`) — the one-line code comment is
enough to stop a careless change without publishing the reasoning itself;
ask whoever holds the ADR file directly if you need to read one and don't
have the directory locally.

## Related skills

- `vault` — Vault Folder Types, Daily Logs/Cards, Sharing Roles, and (in
  its own "GraphLog" section) the lineage from PhyLog, which this skill's
  system replaced and which has since been fully retired.
- `oxmarkdown` — the directive/interactable model `:ref{...}` follows;
  keep both skills in sync as `:ref{...}` evolves.
