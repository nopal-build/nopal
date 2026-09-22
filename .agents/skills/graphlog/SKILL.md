---
name: graphlog
description: GraphLog, Nopal's AI pipeline for `project-n02` spaces — turns synced content into a `Graph/` of cited, linkable nodes, organizes the whole graph into a weighted `graph-structure.md` index, then into an up-to-date `README.md` Project View. Use when working on `project-n02`, `projectN02.server.ts`, `graphLogDefaults.server.ts`, the `Graph`/`project-n02` Vault Folder Types, the `:ref{...}` directive (`oxmarkdown-core/src/refDirective.ts`), or when asked about "GraphLog", daily-log-sync, sync-knowledge, sync-graph, graph-structure, or graph-project-view.
---

# GraphLog

GraphLog is `project-n02`'s AI pipeline, and the only content pipeline this
app has. It replaced PhyLog (formerly `project-n01`), which has been fully
retired: every project and `personal` space has been migrated, and all of
PhyLog's own code, routes, CLI commands, Maker pages, and migration
tooling have been deleted. `project-n01` no longer exists as a valid
folder type — a stale reference to PhyLog elsewhere in the codebase is a
leftover comment, not a real code path.

GraphLog's shape: a deterministic pre-step, then four agentic stages
driven by per-project skill files, extracting CITABLE, LINKABLE nodes from
synced content into a daily `Graph/` log, then organizing those into a
weighted index and synthesizing that into a README. Read the `vault`
skill first for the Vault Folder Type system this assumes.

**Status: all five pipeline stages, Reset, the Maker usage/defaults
pages, Vault UI Run/Reset/Schedule/Stop, and live run status are built
and shipped.** Written as a living design doc — update it as GraphLog
changes, don't let it drift into describing a design the code no longer
matches. It describes the present. How GraphLog got here lives in git
history and `docs/adr/`; when something changes, rewrite the passage that
described it rather than appending a dated note.

The pipeline was originally four stages (sync straight to a README). A
fifth stage, `graph-structure`, sits between `sync-graph` and
`graph-project-view`: reading the whole graph on every run is too
expensive to repeat in both neighbors, so `graph-structure` does that
read ONCE per run and produces a compact, weighted, clustered index
(`Graph/graph-structure.md`) that both `graph-project-view` and
`sync-graph` read instead of each re-deriving their own partial view of
the graph. See "The pipeline" below.

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
one job (`graphLogAgent.server.ts`'s `runGraphLogPipeline`); each stage
below is also independently runnable via its own CLI subcommand/API route.

```
personal/syncs/Daily Logs (real Cards, one per project per day)
  -> STAGE 1: daily-log-sync    (deterministic copy, NOT agentic)
  -> STAGE 2: sync-knowledge     (agentic, skills/KNOWLEDGE.md)
  -> STAGE 3: sync-graph         (agentic, skills/GRAPH.md)
  -> STAGE 4: graph-structure    (agentic, skills/GRAPH_STRUCTURE.md)
  -> STAGE 5: graph-project-view (agentic, skills/EFFORTS.md + skills/VOICE.md)
```

- **daily-log-sync** (`dailyLogSync.server.ts`: `ensureDailyLogsSyncFolder`,
  `runDailyLogSync`) — zero-inference, Card-driven. A daily-log Card is
  already explicitly scoped to one project, so copying its content into
  that project's own `syncs/Daily Logs/` folder needs no AI judgment.
  Mirrors `fileCardAttachments`'s shape: for every (day, contributor) with
  a Card for a project, mirrors that Card's content into `syncs/Daily
  Logs/<date>-<humanId>.md` and copies every `::file{...}` attachment
  alongside it, idempotent via a stored `content_hash`. A copied
  attachment is stamped with `date` too (not just the Card's own text
  file) — without it, `sync-graph`'s `collectDatedCandidates` (which only
  ever collects files with a real `date`) silently excludes every
  attachment from ever becoming a graph candidate. Synchronous, no job
  queue: `POST /api/graphlog/daily-log-sync`, `nopal graphlog
  daily-log-sync --project <path> [--date]`.
- **Every stage stamps the skill it ran under, and never re-runs on that
  basis by itself** (`composeStageSkill`/`readSkillFingerprint` in
  `projectN02.server.ts`: a 16-hex fingerprint of the stage skill +
  `SKILL.md` + every extra skill file — exactly the text the model reads).
  A rewritten skill produces nothing for existing output: the past keeps
  the old skill's output, only new content meets the new rules. This is
  deliberate — a skill under revision gets run on one or two projects over
  and over, and rebuilding every project on each upload would be waste.
  Sidecars, day files, and `graph-structure.md` carry `skillFingerprint`;
  `graph-structure.md` also carries `appliedSkillFingerprint` beside
  `appliedByProjectView` for the README. Every run reports drift per
  stage with zero model calls; acting on it is a per-project choice:
  **`rerun-outputs`** (`nopal graphlog rerun-outputs`,
  `api.graphlog.rerun-outputs.tsx`) re-runs `graph-structure` then
  `graph-project-view` with `rebuildStale` wherever their stamp is stale,
  without touching the graph itself. The structure is re-threaded from
  scratch there, not incrementally: the incremental path only places
  unplaced nodes and would leave the old threads standing. A file written
  before stamping existed has no fingerprint and reads as stale until it
  is rebuilt once. Re-extracting days under a new
  `GRAPH.md` is only ever `reset-graph` (destructive) — the expensive
  path. The model/effort a stage runs on (`STAGE_DEFAULTS`) is not part of
  the fingerprint.
- **A stage whose skill is missing, empty, or opens with `skip` does not
  run** (`isSkipInstruction`/`classifyStageSkill` in
  `projectN02.server.ts`). A missing skill is reported through
  `incomplete`; `skip` is a person's choice and is not. Every other file
  in `skills/` is folded into every stage's prompt
  (`listExtraSkillFiles`), except the reserved names.
- **sync-knowledge** — the first agentic stage. Walks every ATTACHMENT
  under a project's `syncs/` tree (any connector folder, never the synced
  Cards themselves — see `collectSyncCandidates`) and asks an AI, per
  `skills/KNOWLEDGE.md`, to pull concrete extractable metadata (names,
  dates, decisions — not a narrative summary) into a
  `_knowledge/<name>.knowledge.md` sidecar next to the source file. A
  photo is one vision call; a HEIC/HEIF is converted to JPEG first; a
  video is a few evenly spaced still frames described as a sequence
  (`attachmentFrames.server.ts`, ffmpeg via `ffmpeg-static`, frames only,
  no audio). Idempotent via a content hash, same convention every other
  stage uses. Reuses `LlmProvider`/`PhotoDescriber`/`AnthropicProvider`
  unchanged. Runs in `packages/worker/worker.ts` (a BullMQ `Worker`
  against the `"graphlog"` queue); `POST /api/graphlog/sync-knowledge`
  (enqueue) + `GET /api/graphlog/jobs/:jobId` (poll), `nopal graphlog
  sync-knowledge --project <path>`.
- **sync-graph** (`syncGraph.server.ts`: `runSyncGraph`) — reads a
  project's `syncs/` tree (including `_knowledge/*.knowledge.md`) and,
  per `skills/GRAPH.md`, extracts citable nodes — verbatim or
  near-verbatim statements worth remembering on their own — into
  `Graph/graph-log-YYYY-MM-DD.md`, one file per day with new content (no
  file for a day with nothing worth capturing). Groups files by date, and
  regenerates any day whose aggregate hash (every candidate's
  `content_hash` plus its `_knowledge/` sidecar's hash, if any) changed.
  Runs a bounded tool loop per day (`add_node`, `MAX_TURNS = 30`,
  `runSyncGraphDayLoop`) rather than one non-tool completion — the
  earlier whole-day-in-one-completion design truncated on busy days once
  a day's node count grew large.
  - A day runs in passes (`classifyPassEnding`): a pass that adds nothing
    and ends cleanly is the real terminator, `MAX_TURNS` bounds one pass,
    and `MAX_PASSES_PER_DAY = 8` is a runaway guard, never the content
    limit (ADR-013). A day that ends short is still written with
    everything captured and the shortfall reported through `incomplete`;
    it is not a discard path (ADR-011).
  - The first `add_node` carrying a list of three or more items is
    answered with `GRAPH.md`'s unit question instead of being added, and
    the same blocks resent are accepted (`listSplitBounce`,
    `LIST_BOUNCE_MIN_ITEMS`). `GRAPH.md` shows a four-bullet section as
    four nodes, and in the 2026-09-11 model grid Sonnet still wrote it as
    one node on every run: the tool result is the channel a literal
    reader answers to. This is a rule with code behind it, not a quirk
    (ADR-017).
  - One `add_node` call is executed per turn even if the model batches
    several `tool_use` blocks into a single response — any extra call in
    that turn is rejected and the model is told to retry on a later turn,
    so a turn's own necessary output stays bounded to one node.
  - The model never writes a citation, a `### Node <N>` heading, or
    highlight markup. `add_node`'s `sourceIndex` tells code which of the
    day's numbered sources a quote came from; code attaches that source's
    exact `:ref{...verbose="true"}` citation and assigns the next node
    number. A quote is described as structured `blocks`
    (`{type: "paragraph", text}` / `{type: "list", items, ordered}`) plus
    an optional `setup` clause; `renderQuoteBlocks` applies `==...==`
    itself, per paragraph and per list item (keeping a list item's own
    `-`/`N.` marker outside the highlight) — inline highlight markup can
    never legally cross a blank line or list-item boundary, so the model
    only describes structure, never the markup.
  - `location` links to the synced copy in this project's own vault;
    `datetime` is `<date>T12:00:00Z` (a Card only carries a calendar
    date, never a sub-day timestamp). Contributor attribution comes from
    the synced file's own name (`parseSyncedCardFileName`) since the
    file's `human_id` is always the project owner, not the actual
    contributor — falls back to "Unknown"/no `human-id` for anything that
    doesn't match this naming shape.
  - Links (`backwardLinks` to an earlier day's node id, e.g.
    `"2026-07-29#3"`; `sameDayLinks` to a node added earlier the same
    turn) are validated against the real candidate set — an invented
    id/number is dropped and reported back, never silently written. Max 3
    links/node is an enforced cap, and a forward link to an unprocessed
    day is structurally impossible (its id is never in the candidate set).
    Backward-link candidates come from `Graph/graph-structure.md` (one
    cycle stale by construction — fine since `nopal graphlog run` always
    runs `graph-structure` immediately after; falls back to a flat
    heading scan for a project with no `graph-structure` run yet).
  - A changed day is deleted and fully regenerated, never patched. A day
    where the model makes zero `add_node` calls ends up with no file at
    all, even if an earlier run had written one.
  - `graph-structure.md`'s content plus the shared skill instructions
    live in the cached system prompt (`cacheSystemPrompt`), so a
    multi-day catch-up run pays full price for that block once, then
    cache-reads it for the rest.
  - **Files**: an attachment becomes a numbered source once it has either
    a real `sync-knowledge` description or a human-written caption (never
    fabricated from an unseen file) — a caption alone is sufficient since
    it's the uploader's own words, no `sync-knowledge` needed. GraphLog's
    own output deliberately never uses `::file{...}`; code appends the
    citation as ordinary markdown by `buildAttachedMediaMarkdown`, shaped
    by the file's real content type: an image
    (`![alt](/api/vault/view/<fileId>)`), a video (an ordinary link with
    a `?type=video` marker, upgraded to a real `<video controls>` player
    by `OxRenderer.tsx`'s gallery collector inside a
    `:::gallery{}...:::` block), or anything else (a plain link, never
    gallery-eligible). This keeps the file just part of
    `GraphLogNode.quote` with no extra plumbing, and lets several
    photos/videos be grouped into one gallery later without ever
    rebuilding the image/link line itself.
  - `POST /api/graphlog/sync-graph` (enqueue) + `GET
    /api/graphlog/jobs/:jobId`. `nopal graphlog sync-graph --project
    <path>`.
- **graph-structure** (`graphStructure.server.ts`: `runGraphStructure`) —
  reads every `Graph/graph-log-*.md` file each run (parsed by
  `graphNodeIndex.server.ts`'s `parseGraphLogNodes`, deliberately simple
  line/regex parsing) and keeps one file, `Graph/graph-structure.md`, an
  organized, weighted, status-annotated index of every node — clustered
  by topic/thread, active/open/settled/superseded — per
  `skills/GRAPH_STRUCTURE.md`. Sits between `sync-graph` and
  `graph-project-view` so the expensive whole-graph read happens once per
  run instead of in both neighbors.
  - A bounded tool loop (`update_cluster`/`remove_cluster`/`get_node`,
    `runStructureAgentLoop`) edits `graph-structure.md` one cluster at a
    time. `buildMembershipIndex` diffs the graph's current node ids
    against whichever ones already have a home in the file (scanning its
    own `- <date> Node <N>` lines), and only the difference is handed to
    the model — not the whole graph re-sent every run. `get_node` lets
    the model pull an older node's full text on demand when weighing a
    merge/split/rename. Each tool call's edit persists immediately, so a
    crash mid-run keeps whatever was already placed and the next run's
    diff naturally picks up only what's still missing.
  - A first-ever build (or a fallback full rebuild against an
    unparseable previous file) still places every node, spread across
    many bounded tool calls (`MAX_TURNS = 60`) rather than one unbounded
    completion — the old shared-provider output ceiling (8192 tokens,
    with even a generous 20000-token override still brushing the
    Anthropic SDK's own hard non-streaming ceiling around ~21333 tokens)
    is no longer reachable in ordinary operation. A large new-node delta
    is split into batches of `NEW_NODE_BATCH_SIZE = 15`, each batch
    seeing what the previous one already committed. The system prompt
    forbids any text outside a tool call (a bootstrap run once spent its
    whole turn budget on narration before ever calling a tool). The
    skill-instruction portion of the system prompt is cached across
    turns/batches.
  - The model is handed the current `graph-structure.md` every run and
    told to keep a continuing thread's name where it still fits, so README
    sections and `sync-graph`'s candidate list don't churn on a reword.
  - Inbound link counts and every cluster's `Weight:` line are always
    code-computed (`graphNodeIndex.server.ts`'s `computeBacklinkIndex`,
    plus `refreshClusterWeight`) after the tool loop finishes, whether
    the model touched that cluster this run or not — never trusted from
    the model. Clusters are then re-sorted heaviest-first
    (`sortClustersByWeight`/`rankCluster`) down an importance-and-urgency
    grid: `Blocking`+`Due` first, `Blocking` alone, `Due` alone, then
    distinct authors, then raw count, then latest date —
    `settled`/`superseded`/`dormant` threads with neither field sink to
    the very bottom ("fallen away," `hasFallenAway`; still a valid
    `sync-graph` backward-link candidate, just not surfaced to the
    README). `Due`/`Blocking` are optional per-thread fields; `Blocking`
    must NAME the thing held up, never a rating (ADR-007).
    `reviewClusterWrite` runs on every `update_cluster` before commit: a
    `Due` matching no date actually found in the cluster's own nodes is
    stripped and reported back, and a cluster past
    `MAX_NODES_PER_THREAD = 15` is committed but told to split. Both
    rules were prose-only until the 2026-09-11 model grid: five runs on
    one 69-node graph built 3 to 15 threads with the ceiling stated only
    in the skill, and a README once carried a due date the model had
    computed from "in the next 2 months".
  - Before stamping a run's `asOfGraphHash` applied, code confirms every
    node in the graph actually has a home in some cluster; if any are
    still unplaced, the hash stays unstamped so the next run's diff picks
    up exactly the still-missing ones.
  - Idempotent via `asOfGraphHash` (an aggregate hash of every graph-log
    file's own `sourceHash`), stored on `graph-structure.md`'s front
    matter alongside `skillFingerprint`. `graph-project-view` stamps its
    own `appliedByProjectView`/`appliedSkillFingerprint`
    (`markGraphStructureApplied`) onto that same file.
  - **Known, accepted gap**: a node whose own text changes without its
    id changing (a regenerated day reusing the same date/number) won't be
    detected as "new" by the id-based diff — no evidence yet this has
    happened in practice.
  - **Known, deliberate risk (ADR-008)**: `sync-graph` uses this same
    cluster ordering as its backward-link candidate list, so the sort
    shapes what tomorrow's nodes link to, which shapes weight, which
    shapes the sort — a real feedback loop, accepted for now. The fix if
    it proves real is a separately-ordered candidate list for
    `sync-graph`, not a change to this ordering.
  - `POST /api/graphlog/graph-structure` (enqueue) + `GET
    /api/graphlog/jobs/:jobId`. `nopal graphlog graph-structure --project
    <path>`.
- **graph-project-view** (`graphProjectView.server.ts`:
  `runGraphProjectView`) — reads `Graph/graph-structure.md` (not
  graph-log files directly), per `skills/EFFORTS.md`, and keeps
  `README.md` an accurate, organized synthesis. Runs once per invocation
  (not once per day), gated on `graph-structure.md`'s own `asOfGraphHash`
  versus the `appliedByProjectView` marker this stage stamps onto that
  same file once an update completes cleanly.
  - A run is a loop of passes (ADR-013, `MAX_PASSES = 3`): pass 1 is one
    bounded tool-calling conversation (`update_section`/`remove_section`,
    `MAX_TURNS` bounds a pass, never the whole README) that reconciles
    the README against the current `graph-structure.md`, grounded in
    `skills/EFFORTS.md`. Between passes, code runs
    `computeCoverageReport` on the committed README, and every later pass
    is TARGETED — handed exactly the threads still cited nowhere plus the
    name of any section the previous pass was cut off writing. Remaining
    work is derived from the README, never stored (a stored marker would
    survive `resetProjectView` and point at an empty README).
    `classifyViewPassEnding` holds the stopping rules. Applied iff the
    final pass ends clean. The whole graph (structure body + node
    pre-fetch) lives in the cached system prompt.
  - **Pre-fetch + `get_node`**: handing the model only
    `graph-structure.md`'s twelve-word glosses produced a README with no
    real citations at all — paraphrase of a paraphrase, since there was
    no path from this stage to a single word anyone actually wrote.
    `buildNodePrefetchBlock` now walks `graph-structure.md`'s own
    importance-sorted threads top-down and hands the model every member
    node's full verbatim text plus its exact `:ref{...}` citation,
    bounded by `NODE_PREFETCH_BUDGET = 60` nodes (not a thread count),
    truncating mid-thread if needed. A `get_node` tool (same shape as
    `graph-structure`'s own) lets the model pull any other node's
    verbatim text/citation on demand, validated against
    `graph-structure.md`'s own node list. Both exist on purpose (ADR-006):
    the pre-fetch is the floor, and a tool alone is one skill edit away
    from sliding back to paraphrase with nothing erroring.
  - **"Notes on this view"** (the reader-comment section) is protected
    and code-owned: `update_section`/`remove_section` both hard-refuse
    any attempt to target it, and it's no longer auto-created for a
    project that doesn't already have one. Reading unstamped comment
    lines and stamping them ` → read <date>` after a clean run
    (`extractReaderComments`/`stampAppliedDate`) is deterministic
    pre/post-processing, never delegated to the model.
  - **Section order** is enforced by a deterministic `reorderSections`
    pass, run unconditionally on every clean finish, re-sorting known
    headings into the shape read off `EFFORTS.md`'s own fenced
    `# The shape` block (`parseSectionShape`) — so a project can carry
    its own section order by editing one file. A skill whose shape can't
    be read falls back to the built-in list and reports it through
    `incomplete`. "Notes on this view" is always last.
  - **A heading is read as text, whatever the model sends.**
    `headingText` (`llmProvider.ts`) strips leading `#`s, since two models
    handed `update_cluster` the value `## Siding install`;
    `normalizeIntroHeading` treats a literal two-character `""` as the
    empty intro heading, since a README once came back with a `## ""`
    section; `contentCarriesHeading` turns back a section whose content
    opens with its own `## ` line.
  - **Coverage is measured by citation, never by heading**
    (`computeCoverageReport`): a thread is on the page when the README
    carries the exact `:ref{...}` of one of its nodes. It reports
    `missingThreads` (ranked, in the structure file's own order) and
    `fellAway`. Targeted passes chase only the uncited threads carrying
    `Blocking` or `Due` (`requiredThreads`); every other uncited thread is
    logged as off the page and not re-offered, because re-offering all of
    them was the pressure that grew a 41-thread graph into 2,500 words.
    `missingFiles` covers only nodes the page features: a featured node's
    attached-image line must survive into the README (a
    `:::gallery{}...:::` wrapper is fine; dropping the line is not), per
    `EFFORTS.md`'s "a file is never optional". It used to walk every node
    in every live thread and was the loudest line in every run report.
    Report-only, not a forced retry: a dropped file is an editorial
    choice, and auto-retrying risks looping on the same choice.
  - A full reset means resetting `graph-structure.md` (its
    `asOfGraphHash` goes with it), which naturally makes
    `appliedByProjectView` meaningless too — no separate "full" mode
    needed.
  - `POST /api/graphlog/graph-project-view` (enqueue) + `GET
    /api/graphlog/jobs/:jobId`. `nopal graphlog graph-project-view
    --project <path>`.
  - **The page is Efforts.** The skill is `EFFORTS.md` (renamed from
    `PROJECT_VIEW.md`; the stage, its CLI command, the constant
    `DEFAULT_PROJECT_VIEW_SKILL` and the defaults-row key `projectView`
    kept their names). The output file is still `README.md`, because
    status, sharing and the website all key on that name; its body is the
    page. Reseed creates a missing seeded file (`"created"`) and deletes a
    legacy `PROJECT_VIEW.md` (`"removed"`); `project_view.md` stays
    reserved so an unreseeded project never feeds its old skill into
    every stage.
  - **The shape** is declared in the skill's own fence: an unlabeled
    opening (where we stand, the tension, the blind spot, what moved) and
    one ask, then Regroup / On the bench / Ready next / Shelf / Drawer /
    Look-ahead. A bench effort is `### <Person> · <Effort> · <XS|S|M|L|XL>`
    with Now / Next / Why it matters / Not logged bullets, and a one-line
    size key closes the bench. Nothing on the page exists for code to
    read: no field line, no change tags, no labels a reader would have to
    be taught.
  - **What code reads instead** (`effortReadings.server.ts`): an effort's
    threads come from the nodes its bullets cite (`assignEffortThreads`:
    citation, node, home thread). Size is the heading's third segment
    (`splitHeading`); posture and direction arrive through the
    `describe_effort` tool, which writes to the sidecar only, and the
    heading letter wins over a `describe_effort` size
    (`applyEffortDescriptions`; an effort not re-described this run keeps
    its previous description).
  - **The readings block** hands the model every number the skill
    mentions (`buildReadingsBlock`): per-thread dates, days quiet, speed
    over 14-day windows, writers, cross-writer links, neighbors both
    ways, the load picture, first names for headings (`firstName`), what
    arrived since the previous sidecar (`arrivedSince`), fallen-away and
    off-page threads as Drawer candidates, and highlighted questions no
    node links back to. "One writer" and "a question nothing links back
    to" are labeled stand-ins for owner and unanswered, which the graph
    does not store. None of it appears on the page.
  - **`Graph/efforts.md`** is written on a clean finish
    (`buildEffortsSidecar`): the page as JSON with counted readings merged
    per effort, `read`, `ask`, and change marks (`markChanges`: efforts
    match the previous sidecar on shared threads, since names move
    between runs; `new` / `moved` / `unchanged`, `changedLines`, and
    `removed`). `stripChangeTags` remains only for legacy pages that
    carried tags on headings. It is the seam for a layout that draws.
  - **Length and mechanical voice rules are held by code, not the
    skill** (`sectionShapeNotes`): `update_section` turns a section back
    once per run naming every count that is off: its word budget
    (`SECTION_WORD_BUDGETS`, summing to `PAGE_WORD_CEILING` 1,000;
    citations, gallery lines and list markers are free), more than three
    quoted phrases in an effort, a label repeated or holding more than
    three items, a bullet with a semicolon or more than about 20 words
    outside its quote, a bench heading naming someone outside the writers
    list or by more than a first name, a size written as `Size:` or in
    words, an em dash, an arrow or curly quote, an underline, most bullets
    opening bold. What needs meaning to check stays in `VOICE.md`.
  - **`VOICE.md`** is a fifth seeded default (`DEFAULT_VOICE_SKILL`, key
    `voice`), a reserved name, composed first among this stage's extras
    (`withVoiceFirst`) and into no other stage, so a voice edit is README
    drift only.
  - An edited log re-extracts in production because `dailyLogSync`
    recomputes `content_hash` on the project's copy;
    `updateFileRef({content})` alone does not.

## Annotations: marks, and refiling a misfiled entry

A person reading a project's Efforts page can write on it. The unit they
write on, what that mark becomes, and how long it shows are all decided by
code; the model reads marks the way it reads any other input.

- **What can be marked** — `oxmarkdown-core/src/markUnits.ts`. One bullet,
  one `##`/`###` heading, one sentence of a paragraph, one gallery photo,
  and nothing smaller: no drag, no character ranges. The same module runs
  on the server (to validate a mark) and in the renderer (to place it), so
  both agree on a unit's key; sentence splitting is a fixed regex, never
  `Intl.Segmenter`, whose ICU data differs between Node and browsers. A
  key only has to hold within one page body, which is all a mark needs.
- **A mark is an entry** — `graphLogMarks.server.ts`, table
  `graphlog_marks`. Verbatim, dated, authored, never rewritten by the
  system. Its author may rewrite or delete it until a run reads it; after
  that a page may cite it, so it stands. Code projects the rows into
  `<project>/Syncs/Marks/<date>-<humanId>.md`, named and synced exactly
  like a Card's copy beside it, so `sync-graph` extracts marks as ordinary
  sources. Each mark is written with its own record in words (the passage,
  the section, whose day that passage cites) because node ids are
  renumbered on re-extraction and a page is rewritten every run.
- **A mark always becomes a node.** The model reads a marks file like any
  source and links what it captures, and `marksNotCaptured` writes
  anything it passed over verbatim afterwards, with no links. Every other
  source is a day's writing, where judging what is worth capturing is the
  job; a mark is one deliberate act about one named passage, and the
  first one in production was judged not worth capturing.
- **ADR-012 for marks.** A marks file mixes a person's words with a
  code-written context line quoting the page, so `renderQuoteBlocks` takes
  a per-block predicate there (`isInsideMarkText`) instead of one answer
  for the whole source. Only the marker's own words get `==`.
- **Marks are not writers.** Nodes that came from a marks file are left
  out of the writers line and the bench-name gate in
  `graph-project-view`: writing in the margin is not working on the
  project, and only writers get a bench heading.
- **How long a mark shows.** Until a run reads it (`read_at`), and no
  longer: it is a node by then and `Syncs/Marks/` is the record. A mark
  the page has moved past but nothing has read still shows, re-anchored to
  a line citing the same entry, then its section heading, then the top,
  and says it is waiting. There is no page archive; `pageBody.server.ts`
  exists only to say which page a mark was written on.
- **What the run does with them** — `graph-project-view`. Unread marks
  open the gate the way an unread note does, and add one prompt block plus
  two tools (`read_mark`, `propose_move`). With no marks the prompt and
  the tool array are byte-identical to what they always were; `viewTools`
  returns `TOOLS` itself. Marks are stamped read only on a clean finish.
- **Refiling** — `graphLogMoves.server.ts`, table `graphlog_moves`. A
  misfiled entry is corrected at the source: the `##` section (or the
  whole Card) is cut from the Card it was filed under and put, unchanged,
  into a Card for the right project on the same day, which is then mounted
  on that day's page. There is no routing layer; every stage rebuilds from
  the Cards. Guards: the entry must be one the marked passage cites, the
  destination must be a project both people can see, and only the author's
  own entry moves — anyone else's becomes a request they confirm
  (`POST /api/graphlog/moves/:id`). `removeChunk` returns the Card
  unchanged when the section is not found, never empty. Undo restores the
  words at the end of the Card.
- **Another project's name never appears on a page.** A mark that asked
  for a move is held out of the source project's marks file and replaced
  by a trace in words; a reader who cannot open the destination sees a
  placeholder instead of the mark's text; and the page run refuses a write
  naming a project this one has refiled to, treating a page that still
  says one as a reason to rewrite (`namesAnotherProject`).
- **A day whose sources are all empty leaves the graph** — `sync-graph`
  removes it with no model call. That is what makes a refiled day
  disappear from the project it left, and it also stops a blank entry
  costing a call on every run.

## Reset

GraphLog has three independent, narrower resets — `graphLogReset.server.ts`
— plus one combined command that runs all three in order:

- **`nopal graphlog reset-project-view`** (`resetProjectView`) — deletes
  every direct child of the project folder except `skills`/`syncs`/
  `graph`, and clears `README.md`'s BODY (front matter, which holds
  Sharing Roles/`status`, is preserved byte-for-byte).
- **`nopal graphlog reset-graph`** (`resetGraph`) — deletes the `Graph`
  space folder outright: every `graph-log-*.md` file plus
  `graph-structure.md`, taking `asOfGraphHash`/`appliedByProjectView`
  with it. A no-op if the project has no `Graph` folder yet.
- **`nopal graphlog reset-knowledge`** (`resetKnowledge`) — recursively
  deletes every `_knowledge/` sidecar folder nested under `syncs/`.
- **`nopal graphlog reset`** (`resetProjectAll`) — runs all three above,
  in order (project-view first, then graph, then knowledge) — the single
  deepest "start completely over" reset.

All four are destructive, require `--yes` at the CLI layer, and are
deliberately never run automatically by anything else. Deterministic and
free (no LLM calls, no `{ ok, error }` wrapper). Each has its own job name
on the `graphlog` queue and its own `POST /api/graphlog/reset*` route,
following the same enqueue-then-poll shape (`GET
/api/graphlog/jobs/:jobId`) every agentic stage uses, even though these
three are actually synchronous work.

The combined `reset` and the full `run` are also reachable from
`/vault`'s "More Actions" dropdown — see "Vault UI, scheduling,
and live run status" below.

## `project-n02` spaces

The ONLY `ContainerFolderTypeKey` in `vaultFolderTypes.ts` (PhyLog's
`project-n01` has been fully retired and removed from the type entirely).
`README.md` is the index, `skills`/`syncs` are the only human-writable
children, everything else (including the `Graph` space) is
`writable: "system"`.

- **`graph`** — a `SpaceFolderTypeKey`, singleton per `project-n02`
  container, holding `graph-log-*.md` files plus `graph-structure.md`.
  Lazily created the first time there's actually something to write —
  NOT seeded at project-creation time, unlike `skills`.
- `projectN02.server.ts`:
  - `ensureProjectN02(folder)` — tags `folder` `project-n02` and seeds
    `skills/KNOWLEDGE.md`/`GRAPH.md`/`GRAPH_STRUCTURE.md`/`EFFORTS.md`/
    `VOICE.md` from `graphLogDefaults.server.ts` (one table,
    `SKILL_FILE_NAMES`, maps keys to file names for seeding and reseeding). `vault.server.ts`'s
    `createVaultFolder` calls this for every brand new project (and
    `personal`) directly — there's no other container type to default to.
  - `resolveProjectN02(folderId)` — the "resolve + validate + retrofit"
    chokepoint every GraphLog CLI/API entry point runs a `--project` path
    through.
  - `ensureProjectGraphFolder(projectFolder)` — lazy `Graph` folder
    creation, called by `sync-graph` the first time it has something to
    write.
- `graphLogDefaults.server.ts` holds the five starter
  `DEFAULT_KNOWLEDGE_SKILL`/`DEFAULT_GRAPH_SKILL`/`DEFAULT_GRAPH_STRUCTURE_SKILL`/
  `DEFAULT_PROJECT_VIEW_SKILL` (the `EFFORTS.md` text; constant and key kept
  their names on the 2026-09-16 rename)/`DEFAULT_VOICE_SKILL` constants, plus
  an admin-editable-override
  layer reviewable at `/maker/graphlog/defaults` (see "Maker
  pages" below).

## The "Daily Logs" symlink

**Decision: Option A (the low-cost path), not a new Vault symlink
primitive.** The vault-wide `daily-logs` ROOT (see the `vault` skill's
"Vault Root Folders") is retired as its own container; a human's daily
log content instead resolves to their `personal` space's own
`syncs/Daily Logs` folder. A real symlink primitive (`target_folder_id`,
proxying reads/writes) was considered and explicitly deferred — revisit
only if a second real symlink need shows up.

`vault.server.ts`'s `resolveDailyLogsFolder(humanId)` is the single
chokepoint every daily-log read/write path now goes through:

- Canonically resolves to `personal/syncs/Daily Logs` (lazily created).
- A legacy vault-wide `daily-logs` root (anyone who used Nopal before this
  shipped) is MOVED there in place via the existing `moveVaultFolder`
  primitive — re-parented, never recreated, so every file's own id (a
  day's `readme.md`, a Card, an attachment) and every date subfolder's own
  id survives completely unchanged, and nothing addressed by fileId (a
  `::card{file="..."}` reference, the `daily_logs` cache table keyed by
  humanId+date) needs a separate content migration.
- The legacy root is always resolved FIRST, before the destination is
  even looked at, and `mergeFolderContentsInto` merges any same-named
  children found at both locations (recursing into folders, auto-deduping
  colliding filenames the same way `copyFileIntoFolder` already does) —
  this closes a real check-then-create race where looking at the
  destination first could permanently orphan a human's entire daily-log
  history behind an invisible legacy root.
- `ensureVaultRootFolders` no longer auto-creates a `daily-logs` root if
  one doesn't already exist, so a migrated human's old root can't be
  silently resurrected empty on their next page load.
  `VAULT_ROOTS`/`VaultRootKey` still include `"daily-logs"` (only
  `ensureVaultRootFolders`'s runtime behavior changed) so anything reading
  a not-yet-migrated folder's `vault_root_key` keeps working during the
  transitional period.
- **Known, accepted follow-up**: the Vault sidebar doesn't yet turn the
  root-level "Daily Logs" entry into a redirect into `personal/syncs/Daily
  Logs` — it just stops appearing once a human is migrated. Purely
  navigation/discoverability polish; the actual Daily Log editing page
  doesn't go through the Vault sidebar at all.
- **Known, accepted perf tradeoff**: `resolveDailyLogsFolder` does several
  sequential lookups with no per-request caching/memoization yet — revisit
  if it proves to be a real bottleneck.

## The `:ref{...}` directive

A read-only attribution mark — who said/wrote something, when, and where
it came from. Lives in `oxmarkdown-core/src/refDirective.ts`
(`RefAttrs`/`buildRefDirectiveMarkdown`/`parseRefAttrs`), rendered by
`components/OxRenderer.tsx`'s `RefDirectiveStatic`/`RefDirectiveMarker`.
Demoed in `fruits/app/routes/styles_.oxmarkdown.tsx`'s "Try it" playground.

- A TEXT directive (`:ref{...}`, inline, no children) — same built-in
  tier as `::file{...}`/`::card{...}` (never a caller-registered
  `DirectiveRegistry` entry), but never editable — GraphLog is the only
  writer, so it does NOT get the generic directive-attrs-editing popover
  every other directive gets.
- Attributes (`REF_ATTR_KEYS`): `name`, `human-id` (optional), `datetime`
  (ISO 8601), `location` (a path back to the source), `verbose` (`"true"`
  or omitted — omitted means `false`).
- `verbose` is a STATIC attribute, decided by the WRITER, never by
  rendering context — GraphLog passes `verbose="true"` only when writing
  into a `Graph/graph-log-*.md` file.
- Two renderings: `verbose="true"` is fully spelled-out plain inline text
  (name · date · a "source" link, no popover); omitted/`false` is a
  single `*` glyph that opens a small read-only `OxPopover` with
  Name/When/Source (Name links to `human-id`'s vault root if present).
- **Gotcha**: `micromark-extension-directive`'s attribute-value parser has
  no escape mechanism for a literal `"` inside a value — a
  backslash-escaped quote breaks attribute parsing outright (the whole
  `attributes` object comes back `null`), not just the one attribute.
  Every directive attribute value in this codebase shares this
  limitation, not just `ref`'s — `buildRefDirectiveMarkdown`'s
  `escapeDirectiveAttrValue` substitutes a right double quotation mark
  (`"` → `”`) rather than attempting to escape.
- **Gotcha**: `formatRefDatetime` must pin an explicit locale AND
  `timeZone: "UTC"` — `toLocaleString(undefined, ...)` resolves to
  whatever locale/timezone the RUNTIME is in (server during SSR, browser
  during hydration), which caused a real hydration mismatch once. Same
  fix `fruits/app/routes/profile.tsx`'s `formatSignedAt` uses, for the same reason.
- **Known, accepted gap**: `humanProfileHref` builds an `/{humanId}:root`
  href (same `/humanId:path` shape the `oxmarkdown` skill documents for
  `@`-mentions), but there's no real human-profile PAGE to resolve it to
  yet — the same already-accepted gap `@`-mentions have today. Whoever
  finishes that for mentions should cover this the same way.

## Migration from `project-n01` (historical — completed and removed)

GraphLog originally coexisted with PhyLog while projects were migrated one
at a time. That migration has been run for real across every project and
`personal` space, and the migration tooling itself
(`migrateToN02.server.ts`, the `nopal graphlog migrate-to-n02` CLI
command, and its API routes) has since been deleted entirely, alongside
the rest of PhyLog. `project-n01` no longer exists as a valid folder type.

Two generalizable lessons from bugs found while building that migration,
kept here since the shape of both is a real, reusable lesson even though
the code they fixed is gone:

1. A retrofit function silently retagged an already-migrated folder back
   to its old type whenever a call site meant only "backfill an UNTYPED
   legacy folder" but couldn't distinguish "untyped" from "validly typed
   as something else" — guard this shape with an early-return for a
   folder that's already the target type, not just a check for whether it
   has one.
2. A check-then-create race in "does folder X already exist?" checks
   produced duplicate system-managed folders on several real projects —
   fixed at the root with a deterministic folder id
   (`systemVaultFolderKey`), so creating "the same" folder twice is a
   no-op instead of a duplicate row. This fix is NOT migration-specific
   and remains in `projectN02.server.ts`'s `applyProjectN02Shape` today.

## Maker pages

Same gate (Admin/Super only), same layout, same range-toggle convention
as the rest of `/maker`.

- `graphLogMetrics.server.ts`'s `getGraphLogUsageSummary(days)`/
  `pruneOldGraphLogUsageEvents`, alongside `recordGraphLogUsage` — an
  aggregation layer (byStage/byProject/byHuman/byDate, cost estimation via
  `llmPricing.ts`).
- `graphLogDefaults.server.ts`'s admin-editable-override layer
  (`getEffectiveGraphLogDefaultSkill`/`getAllEffectiveGraphLogDefaultSkills`/
  `setGraphLogDefaultSkillOverride`, table `graphlog_default_skills`) —
  one DB row, one OPTIONAL field per stage, unset means "use the
  hardcoded constant"; never retroactive — only changes a brand new
  project's seed content going forward. `projectN02.server.ts`'s
  `applyProjectN02Shape` seeds from these effective values instead of the
  raw `DEFAULT_*_SKILL` constants directly.
- `/maker`'s "GraphLog Usage" summary section.
- `/maker/graphlog` — the full usage breakdown page (Overview/By
  Stage/Calls Per Day/By Project/By Human) plus "Recent Runs" (see
  "Performance tracing" below).
- `/maker/graphlog/defaults` — the default-skill-text review/edit
  UI (Knowledge/Graph/Structure/Project View/Voice).

## Performance tracing (per-run timelines)

Separate from `graphLogMetrics.server.ts`'s own token/cost usage
tracking: `graphLogPerf.server.ts` records a per-run TIMELINE of real,
code-measured event durations — API calls, LLM calls, plain function
calls — never a number the model itself reports. Two tables:
`graphlog_runs` (one row per run: started/finished/ok/error) and
`graphlog_run_events` (one row per timed event: `process`/`type`/`name`/
`params`/`duration_ms`/`started_at`/`outcome`, ordered by actual start
time). A run reuses the owning BullMQ job's own id directly as its
record id (`worker.ts`'s `processGraphLogJob` calls
`startGraphLogRun`/`finishGraphLogRun` around every GraphLog job).

- **`GraphLogPerfRecorder`** (`event`/`time`) is what every stage
  function's own `opts.perf` is typed as — a real recorder when invoked
  from the worker, or `noopGraphLogRunRecorder` when a stage is exercised
  directly with no run/job context. `time()` wraps an async call,
  measuring it wall-clock and recording the event automatically
  (including on a thrown error, before rethrowing).
- **`process` values**: the five stage names, plus the deterministic
  jobs' own names (`"reset"`/`"reset-project-view"`/`"reset-graph"`/
  `"reset-knowledge"`). `runGraphLogPipeline` (the `"run"` job) shares
  ONE recorder across all five stages.
- **`type` values**: `"llm"` (a real Anthropic call), `"api"` (a non-LLM
  external call, today just `sync-knowledge`'s `downloadFileBytes` S3
  read), `"fn"` (a plain function call — each stage's own top-level
  wrapper, so a skipped/fast stage still shows up as one bar), `"other"`
  (reserved, unused today).
- **Two levels of granularity, nested by actual start time**: each of
  `sync-graph`'s per-day loop, `graph-structure`'s per-batch loop, and
  `graph-project-view`'s pass loop records BOTH an aggregate event
  (`day`/`batch`/`readme`) AND one `turn` event per turn
  (`graph-project-view` also records one `pass` event carrying
  `offered`/`cited`/`citations`/`matched`/`unmatched`, per ADR-005 — an
  `unmatched` citation is one the model composed rather than copied). A
  turn event's `params` carries `stopReason`, any tool call names, and
  the model's own plain text for that turn.
- **The model's own plain text, captured per turn** — `LlmResponse.text`
  used to be thrown away once folded back into the conversation history;
  every `turn` event's `params.text` now carries it (trimmed, capped at
  8000 characters), specifically because it's the only record of what a
  model was mid-sentence writing when a turn hit `max_tokens` and got cut
  off.
- `/maker/graphlog`'s "Recent Runs" section lists recent runs
  (`listRecentGraphLogRuns`); each links to
  `/maker/graphlog/runs/$runId` (`getGraphLogRun`) — a full
  timeline, one row per event ordered by actual start time, with a
  right-aligned duration bar (max 33% of the row's width). A row with
  `params.text` renders it in a collapsed `<details>`/`<summary>`.
- **Not yet wired to a cron route**: `pruneOldGraphLogRuns` (30-day
  default retention) exists but nothing calls it on a schedule yet —
  worth doing sooner than usual, since per-turn events (each carrying up
  to 8000 characters of text) accumulate meaningfully faster than the old
  per-day/per-batch/per-loop events did.

## Local dev gotcha: the worker not hot-reloading (FIXED)

`packages/worker`'s `vite-node worker.ts` is a plain, long-running
process, its own standalone package (not part of `webapp`) so its deploy
doesn't drag along dependencies it doesn't need. This used to mean it did
NOT watch for file changes at all — editing `worker.ts` or any
`robustness-core`/`oxmarkdown-core` file a GraphLog job transitively
imports left the running `nopal-worker-1` container silently serving the
OLD code until someone remembered to `docker restart nopal-worker-1` by
hand.

**Fixed**: `docker-compose.yml`'s `worker` service now runs `pnpm
--filter worker run dev` (`vite-node --watch worker.ts`) instead of `run
start` (unchanged, still what production's own Dockerfile CMD uses —
watch mode is dev-only). `--watch` follows pnpm's real workspace symlinks
back to each package's actual source, so editing any file the worker's
module graph touches now respawns the whole process automatically.

**Applying this to an already-running local stack requires recreating the
container**, not just editing the compose file — `docker compose up -d
worker` (or a full `docker compose up -d`). A plain `docker restart
nopal-worker-1` reuses whatever command the container was already created
with, so it does NOT pick this up on its own. Recreating interrupts any
GraphLog job currently running — do it between runs, not mid-run.
`make reset` also picks it up, but wipes every named volume (including
local SurrealDB/MinIO data), so it's a much bigger hammer than needed.

## Vault UI, scheduling, and live run status

- **Run/Reset from the Vault UI**, not just the CLI. `/vault`'s
  "More Actions" dropdown, on any `project-n02` folder (project OR
  `personal`), has "Run GraphLog"/"Reset GraphLog" entries — gated on
  `permissions.isAdmin(user)` (Admin or Super) only, deliberately
  independent of that folder's own ownership/Sharing Role, since a staff
  member using this may not own or be shared on the project at all. The
  three routes it calls (`api.graphlog.run.tsx`, `api.graphlog.reset.tsx`,
  `api.graphlog.jobs.$jobId.tsx`) accept `role?.isOwner || isStaff`. The
  UI enqueues, then polls `GET /api/graphlog/jobs/:jobId` every 3s.
  "Reset" additionally requires a confirm dialog.
- **A nightly automatic run, opt-in per project**
  (`graphLogSchedule.server.ts`). The same dropdown gains an "Enable
  GraphLog Schedule"/"Disable GraphLog Schedule" toggle — **Admin/Super
  ONLY, no owner fallback** (enrolling something in an unattended
  nightly run is a more consequential call than triggering one run by
  hand). Backed by a denormalized `graphlog_scheduled`/
  `graphlog_scheduled_at` pair on `vault_folders`, written only by
  `setGraphLogScheduled`, read by `getGraphLogScheduledFolders`. The
  midnight trigger lives in `fruits/server.js` (all session-gated routes
  and their crons live in `fruits`, not `webapp` — see the
  marketing-app-split-plan doc), anchored to actual local midnight
  (`msUntilNextMidnight()` — unlike the other crons, which just repeat
  every 24h from server start), same `CRON_SECRET` bearer-token
  protection, hitting `POST /api/graphlog/scheduled-run` which fans out
  one normal `"run"` job per scheduled project (`actingHumanId` set to
  the project's own `human_id`, since no human is present to attribute
  the run to). No separate "fresh vs incremental" mode was needed —
  every one of the five stages already decides for itself whether it has
  new work from what's on disk.
- **Live run status, Stop, and CLI parity**
  (`graphLogQueue.server.ts`'s cooperative cancellation / live project
  status, `graphLogPerf.server.ts`'s
  `getLatestUnfinishedGraphLogRun`/`getLatestCompletedGraphLogRun`).
  - `GET /api/graphlog/status?projectFolderId=...` (Admin/Super only)
    reports whether a job is running/queued, when the last one finished
    and whether it succeeded, and whether the project is enrolled in the
    nightly schedule — backed by `getGraphLogProjectStatus`, which
    cross-checks a "still running" row in `graphlog_runs` against that
    run's real BullMQ job state and self-heals (marks it failed) if the
    worker crashed mid-run without recording its own outcome. The Vault
    UI polls this every 5s; `nopal graphlog schedule status --project
    <path>` reads the same endpoint.
  - `POST /api/graphlog/cancel` (Admin/Super only, `cancelGraphLogJob`) —
    "Stop GraphLog." A queued-but-not-started job is removed from the
    BullMQ queue outright. An active job instead gets a Redis
    cooperative-cancellation flag (`graphlog:cancel:<projectFolderId>`,
    TTL'd as a safety net) — there's no way to preemptively kill a job
    mid-`await`, so every stage checks `throwIfGraphLogCancelled` at its
    own safe checkpoints (between each of the five `run` stages; once per
    turn inside `graph-structure`'s and `graph-project-view`'s agentic
    loops and `sync-graph`'s per-day loop; once per file inside
    `sync-knowledge`'s loop), throwing `GraphLogCancelledError`, which the
    worker's existing catch block records like any other failure. Stop
    can take as long as the current turn/file/day/stage takes to finish —
    never instant. `worker.ts` clears the flag unconditionally in
    `processGraphLogJob`'s own outer `finally`.
  - `api.graphlog.run.tsx`/`.reset.tsx`/`.scheduled-run.tsx` all refuse to
    enqueue a second job for a project that's already running (a 409 from
    the first two; a silent skip, counted as `skippedAlreadyRunning`,
    from the cron) — the Vault UI's own client-side gate is a courtesy,
    never the enforcement point.
  - `nopal graphlog schedule enable/disable/status --project <path>` —
    CLI parity for the Vault UI's Schedule toggle and status line. No CLI
    equivalent for Stop exists yet.

## Status

All five pipeline stages, Reset, the Maker usage/defaults pages, the
migration (since run for real and removed), and the Vault UI
Run/Reset/Schedule/Stop/live-status surface described above are built
and shipped. Known open items:

- `graph-structure`'s and `graph-project-view`'s tool-loop designs
  (diff-and-place per cluster; the multi-pass README loop) haven't been
  re-verified against a scripted fake `LlmProvider` the way earlier
  redesigns in this pipeline were before being trusted in production —
  worth doing before relying on either as heavily as the already-proven
  shapes they replaced.
- `graph-structure`'s id-based diff won't catch a node whose text changed
  without its id changing (see "The pipeline").
- The `sync-graph` ↔ `graph-structure` sort feedback loop is a known,
  accepted risk (ADR-008).
- Vault sidebar navigation for the retired "Daily Logs" root, and
  `resolveDailyLogsFolder`'s per-request caching, are known, accepted
  follow-ups (see "The 'Daily Logs' symlink").
- `pruneOldGraphLogRuns` has no cron route wired up yet (see "Performance
  tracing").
- `:ref{...}`'s `human-id` has no real profile page to resolve to yet,
  same gap as `@`-mentions (see "The `:ref{...}` directive").

## Load-bearing decisions (ADRs)

A handful of GraphLog's behaviors look like tuning parameters or
inefficiencies to a future rewrite, but are actually brakes on real
feedback loops (e.g. the three-link cap, ranking by distinct authors
before raw count, quiet threads staying in `sync-graph`'s candidate list).
Removing any of them is silent — nothing errors, the system just slowly
stops doing the thing it was built to do. The reasoning for each is kept
in `docs/adr/000N-slug.md` (index and format in `docs/adr/README.md`),
numbered so code can point at one directly (`// brake, not a default —
see ADR-002`) without spelling out the reasoning inline in every call
site. **This directory is committed and public**, deliberately — hiding
the "why" from contributors (human or agent) working from a plain clone
would recreate exactly the blind spot these records exist to close.
Read the relevant ADR before touching anything it's cited from.

## The Janitor

The five seeded skills and every `.agents/skills/*/SKILL.md` (this file
included) are watched. `webapp/app/tests/janitor.test.ts` fails when a
number, tool or field a seeded skill states stops matching the code that
holds it; the fix is a person choosing which side is right, never making
the test pass. On a pull request, `webapp/scripts/janitor/run.ts` posts one
comment listing any watched file that changed, with its size before and
after. It never edits anything and size is never judged (ADR-017,
ADR-018). If you change a skill, expect that comment, and say in the PR
what changed and why.

## Related skills

- `vault` — Vault Folder Types, Daily Logs/Cards, Sharing Roles, and (in
  its own "GraphLog" section) the lineage from PhyLog, which this skill's
  system replaced and which has since been fully retired.
- `oxmarkdown` — the directive/interactable model `:ref{...}` follows;
  keep both skills in sync as `:ref{...}` evolves.
