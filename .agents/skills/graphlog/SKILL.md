---
name: graphlog
description: GraphLog, the AI pipeline for `project-n02` spaces — the planned successor to PhyLog/`project-n01`. Turns synced content into a `Graph/` of cited, linkable nodes, organizes the whole graph into a weighted `graph-structure.md` index, then into an up-to-date `README.md` Project View. Use when working on `project-n02`, `projectN02.server.ts`, `graphLogDefaults.server.ts`, the `Graph`/`project-n02` Vault Folder Types, the `:ref{...}` directive (`oxmarkdown-core/src/refDirective.ts`), or when asked about "GraphLog", daily-log-sync, sync-knowledge, sync-graph, graph-structure, or graph-project-view.
---

# GraphLog

GraphLog is `project-n02`'s AI pipeline — the direct architectural successor
to PhyLog (`project-n01`, see the `phylog` skill), reusing the same overall
shape (a deterministic pre-step, then agentic stages driven by per-project
skill files) but with a different flavor: instead of filing attachments and
keeping a README index, GraphLog extracts CITABLE, LINKABLE nodes from
synced content into a daily `Graph/` log, then synthesizes those into a
README. Read the `vault` and `phylog` skills first for the Vault Folder Type
system and PhyLog's own pipeline shape — this skill assumes both.

**Status: all five pipeline stages, the migration tool (including a
`--full` discover-everything sweep), and a Maker usage/defaults page are
built and verified.** Only running the migration for real across existing
projects, and PhyLog/`project-n01`'s eventual code retirement, remain —
see "Build status" below for exactly what exists today. Written as a
living design doc, same convention as `oxmarkdown`'s skill — update it as
GraphLog gets built, don't let it drift into describing a design that was
later changed without a matching code change.

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

**TWO real, confirmed data-integrity bugs were found and fixed while
building the `--full` migration sweep — read "Migration from
`project-n01`"'s two bug write-ups below before touching
`ensureProjectN01`/`resolveProjectN01`/`applyProjectN02Shape`/
`getProjectFolders`/`ensureVaultRootFolders` again, and before assuming
ANY project currently reading as `project-n01` hasn't actually been
migrated before, or that a project's `skills/` folder is unique. Both
were found against real data, both already repaired.**

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

`project-n01` and PhyLog are expected to be fully retired once every
project/`personal` space has been migrated to `project-n02` — see "Planned:
migration" below. Until then, both systems coexist; nothing here changes
`project-n01`'s existing behavior.

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
  (same mechanism the `phylog` skill's Cards section describes), so copying
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
  Idempotent the same way PhyLog's pre-capture is (a content hash decides
  what still needs (re)covering — see the `phylog` skill's own idempotency
  doc for the pattern to follow once this is actually implemented).
- **sync-graph** — reads a project's `syncs/` tree (including
  `_knowledge/*.knowledge.md`) and, per `skills/GRAPH.md`, extracts
  citable nodes — verbatim or near-verbatim statements worth remembering
  on their own — into `Graph/graph-log-YYYY-MM-DD.md`, one file per day
  with new content (no file at all for a day with nothing worth
  capturing). Each node gets a plain, predictable `### Node <N>` heading
  (an incrementing counter per day's file, never an LLM-generated title)
  and a `:ref{...verbose="true"}` citation. Runs once a day IN INTENT
  (matches the day a new Daily Log/sync content landed) but, like PhyLog,
  is **never wired to run automatically yet** — every stage is CLI-only
  for now (see "CLI surface" below), same "always on-demand, never a
  cron" philosophy the `phylog` skill's header establishes for the same
  cost/non-determinism reasons.
  - **Regeneration, not append**: if a day's underlying source content
    changed after its `graph-log-*.md` was already written, DELETE that
    file and fully regenerate it — no partial-append logic.
  - **Links**: a node may link to an EARLIER day's node by heading anchor
    (`[<date> Node <N>](./graph-log-2026-08-10.md#node-n)` — the date is
    always part of the link TEXT, since a bare "Node 1" is ambiguous
    across many days; the node's own heading doesn't carry the date,
    only links to it do), or to ANOTHER node from the SAME day's file, in
    either direction — never forward to a day that hasn't been processed
    yet. Max 3 links per node, written as a plain bullet list
    (`- [...](...)`) with no reason text attached (a deliberate
    simplification over an earlier draft that required one) and omitted
    entirely when a node has none.
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
    exactly as before.
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

## Reset

Unlike PhyLog's two reset depths (`nopal phylog reset`/`reset-pre-capture`),
GraphLog has THREE independent, narrower resets — `graphLogReset.server.ts`
— since it has three separate kinds of generated content worth being able
to wipe on their own, plus one combined command that runs all three in
order:

- **`nopal graphlog reset-project-view`** (`resetProjectView`) — deletes
  every direct child of the project folder EXCEPT `skills`/`syncs`/
  `graph`, and clears `README.md`'s BODY (front matter preserved
  byte-for-byte, same Sharing-Roles/`status` reasoning as PhyLog's own
  reset and `migrateToN02.server.ts`'s README handling). In practice
  there's rarely anything else at the project root to delete here yet
  (GraphLog doesn't file loose content at the root the way PhyLog does) —
  this exists mainly to clear a stale README body and catch anything
  unexpected left there.
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

All four are destructive, require `--yes` at the CLI layer (same
convention as `phylog reset`/`migrate-to-n02`), and are deliberately NOT
run automatically by anything else — always an explicit, separate call,
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

## `project-n02` spaces

Added to `vaultFolderTypes.ts` as a second `ContainerFolderTypeKey`
alongside `project-n01` (not a replacement — both coexist until the
migration below is actually run). Same policy shape as `project-n01`:
`README.md` is the index, `skills`/`syncs` are the only human-writable
children, everything else (including the new `Graph` space) is
`writable: "system"`.

- **`graph`** — new `SpaceFolderTypeKey`, singleton per `project-n02`
  container, holding `graph-log-*.md` files. Same "lazily created the
  first time there's actually something to write" convention as
  `project-n01`'s own `daily-logs` type — NOT seeded at project-creation
  time, unlike `skills`.
- **`skills`/`syncs` are REUSED as-is**, not duplicated per container
  type — `validateFolderTypeForParent` (`vault.server.ts`) now accepts
  either `project-n01` or `project-n02` as a valid parent for any space
  type.
- `projectN02.server.ts` mirrors `projectN01.server.ts`'s shape closely:
  - `ensureProjectN02(folder)` — tags `folder` `project-n02` and seeds
    `skills/KNOWLEDGE.md`/`GRAPH.md`/`GRAPH_STRUCTURE.md`/`PROJECT_VIEW.md`
    from `graphLogDefaults.server.ts`. **Refuses to touch a folder that's
    already a `project-n01` anchor** — retagging is the explicit
    migration step (not yet built), never an implicit side effect.
  - `resolveProjectN02(folderId)` — the same "resolve + validate + retrofit"
    chokepoint `resolveProjectN01` is for PhyLog; not yet called from
    anywhere (no CLI/API surface exists yet — see "Build status").
  - `ensureProjectGraphFolder(projectFolder)` — lazy `Graph` folder
    creation, mirroring `ensureProjectDailyLogsFolder`. Not yet called by
    anything (`sync-graph` doesn't exist yet).
- `graphLogDefaults.server.ts` holds the four starter
  `DEFAULT_KNOWLEDGE_SKILL`/`DEFAULT_GRAPH_SKILL`/`DEFAULT_GRAPH_STRUCTURE_SKILL`/
  `DEFAULT_PROJECT_VIEW_SKILL` constants — genuinely early drafts, expected to change once the stages
  reading them are real. Deliberately does NOT have `phylogDefaults.server.ts`'s
  admin-editable-override layer (a DB row + Maker review UI) yet — add that
  once a real Maker page exists to review these from, not before.

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

## Migration from `project-n01`

**Done — the structural conversion.** `migrateToN02.server.ts`'s
`migrateProjectToN02`, `nopal graphlog migrate-to-n02 --project <path>
--yes` (destructive, requires explicit `--yes` like `phylog reset`;
refuses outright if the folder isn't currently a `project-n01` anchor —
already migrated, or not a real project). Runs on the SAME `graphlog`
queue as every other GraphLog job (deterministic/free, but potentially
slow for a project with a lot of history, so it still goes through
enqueue-then-poll rather than blocking one request) — `POST
/api/graphlog/migrate-to-n02`.

What it actually does, in order:

1. Deletes every direct child EXCEPT the `skills`/`syncs` folders —
   including PhyLog's own project-scoped `daily-logs` staging folder,
   `newspapers`, and any organized content PhyLog ever filed at the
   project root. **`README.md` is a special case**: the FILE survives,
   only its BODY is cleared (front matter preserved byte-for-byte) —
   same reasoning as PhyLog's own reset, since Sharing Roles/`status`
   live ONLY in that front matter and deleting the whole file would
   silently revoke every collaborator's role.
2. Retags the folder `project-n02` and seeds
   `skills/KNOWLEDGE.md`/`GRAPH.md`/`GRAPH_STRUCTURE.md`/`PROJECT_VIEW.md`
   (`applyProjectN02Shape` — `ensureProjectN02`'s retag+seed mechanics,
   split out so migration can call it directly, deliberately bypassing
   `ensureProjectN02`'s own n01-refusal guard, since performing exactly
   that retag IS what migration means).
3. Removes PhyLog's own `PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md`
   from `skills/` — but PRESERVES everything else already there (a
   general `SKILL.md` project-identity file, or any other custom file a
   human dropped in), since those aren't PhyLog-specific.
4. Runs `daily-log-sync` once, unconditionally, across the project's
   ENTIRE history (no date filter) — backfills `syncs/Daily Logs`
   immediately so the agentic stages have real history to work from.

**Deliberately does NOT run any agentic stage itself** (no LLM cost) —
same "never wired into anything automatic" philosophy PhyLog holds for
real-money calls. `nopal graphlog run` is a separate, explicit follow-up
step the CLI itself prints as a reminder once migration finishes.

**Verified directly** against the real local dev SurrealDB: built a
realistic `project-n01` space (via the real `ensureProjectN01` seeding)
with PhyLog clutter, a custom skill file, Sharing-Roles front matter on
README.md, and a real Card, then migrated it and confirmed every behavior
above — including that a SECOND migration attempt on the now-`project-n02`
folder is correctly refused.

**Done — `--full`, a discover-and-convert-everything sweep**, so running
the real migration doesn't mean enumerating every path by hand.
`migrateToN02.server.ts`'s `listOwnedProjectN01Anchors(humanId)` finds
every `project-n01` anchor the CALLER owns (their own `personal` root, if
still `project-n01`, plus every owned direct child of their own
`projects` root still on `project-n01`) — deliberately scoped to OWNED
anchors only, same boundary the single-project route already enforces, so
a collaborator's own `--full` sweep never touches a project they don't
own. Deliberately does NOT go through `getProjectFolders` (see the next
section for why that would have been actively dangerous) — it's a pure
read via `ensureVaultRootFolders`/`listFolderChildren`, never retagging
anything itself.

- `GET /api/graphlog/n01-projects` — returns the caller's own anchors as
  `{ folderId, name, path }` (`path` is a display label only, e.g.
  `"projects/Sunny"` or `"personal"`; every real reference is by
  `folderId`, never re-resolved from the path string).
- `nopal graphlog migrate-to-n02 --full --yes` (`crates/cli/src/graphlog.rs`'s
  `migrate_to_n02_full`) — lists anchors, prints them, requires `--yes`
  ONCE for the whole sweep (not per project), then migrates each one
  through the exact same single-project enqueue-then-poll path
  (`migrate_one`, extracted from the original `migrate_to_n02` so both
  forms share identical request/print behavior). One project failing
  doesn't abort the rest — every anchor is attempted, with a final
  succeeded/failed summary. `--project <path>` and `--full` are mutually
  exclusive; exactly one is required.
- **Verified directly** against the real local dev SurrealDB (not just
  typechecked): `listOwnedProjectN01Anchors` against a real human
  correctly listed their real `personal` root plus every real
  still-n01 project, correctly excluding ones already on `project-n02`.

### A real bug: `ensureProjectN01` retagging an already-migrated `project-n02` folder back to `project-n01`

**Found while building `--full`, confirmed against real data, now
fixed.** `ensureProjectN01`'s own guard was `if (folder_type !==
"project-n01" || !is_folder_type_root)` — true for a `project-n02`
folder too (it's a DIFFERENT type, not `"project-n01"`), so it would
silently retag ANY `project-n02` folder back to `project-n01` and
re-seed PhyLog's `PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md` into its
`skills/` folder — as an unintended side effect of `getProjectFolders`
(called by the Daily Log page, Sorter, `@mention` resolution) and
`ensureVaultRootFolders`'s own `personal`-root retrofit (called on
virtually every vault-touching request). Neither call site was ever
trying to migrate anything back — they only meant "backfill an UNTYPED
legacy folder," but their own guard couldn't tell "untyped" apart from
"validly typed as something else."

**Fixed** by adding an early-return guard directly inside
`ensureProjectN01` (`projectN01.server.ts`) — a `project-n02` anchor is
now left completely untouched, no DB call attempted at all. Also hardened
`resolveProjectN01` to REFUSE outright (matching `migrateProjectToN02`'s
own refusal in the opposite direction) rather than silently coerce, so
PhyLog's own CLI/API entry points (`runPhylogPipeline`/`resetProject`)
can never run against a migrated space either.

**Confirmed this bug had ALREADY corrupted real data**, discovered by
running `listOwnedProjectN01Anchors` for real: `projects/Nopal O.` —
migrated to `project-n02` and used for a real (billed) `nopal graphlog
run` earlier in this same project's life (real `sync-graph`/
`graph-project-view` usage rows exist, ~$0.33 in real Anthropic calls) —
was found back on `folder_type: "project-n01"`, with BOTH skill sets
present in `skills/` simultaneously (`KNOWLEDGE.md`/`GRAPH.md`/
`PROJECT_VIEW.md` from the original migration, PLUS a freshly re-added
`PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md` from this bug), while its
real `Graph/` folder (containing actual graph-log content from that paid
run) was still sitting there, untouched but now orphaned from a data
model that no longer thought this was a `project-n02` folder at all.

**Repaired directly against the real DB** (not via `migrate-to-n02` —
that would have DELETED the real `Graph/` folder and cleared `README.md`'s
body, since `migrateProjectToN02`'s deletion step only preserves children
typed `skills`/`syncs`, and a true never-migrated `project-n01` folder
could never have a `Graph` folder to need preserving in the first place).
The actual fix: called `applyProjectN02Shape` directly (safe — no-ops on
skill files that already exist) to retag the folder back to `project-n02`,
then deleted ONLY the three re-added PhyLog files
(`PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md`). `Graph/`, `Syncs/`, and
`README.md` were never touched. Confirmed after: `skills/` holds exactly
`KNOWLEDGE.md`/`GRAPH.md`/`PROJECT_VIEW.md`, folder is `project-n02`
again, `Graph/`'s real content is untouched.

### A second, SEPARATE real bug: duplicate "Skills" folders from a check-then-create race

**Also found while investigating the above (a human noticed two Skills
folders on one project during a real migration run) — confirmed, and
fixed.** `ensureProjectN01`'s (and `applyProjectN02Shape`'s identical
shape) own "does a Skills folder already exist?" check had no
concurrency protection at all — the exact same class of bug
`getOrCreateVaultFolder`'s own doc already describes and fixes elsewhere
in `vault.server.ts` (a deterministic `id` via `systemVaultFolderKey`,
so creating "the same" folder twice is a no-op instead of a duplicate
row), just never applied to THIS check-then-create call site.

**Confirmed this had ALREADY produced real duplicates** on THREE real
projects (`Sunny`, `Crouch Casita`, `Hot box` — found via a direct query
for every `vault_folders` row named/typed `skills` across ALL humans, not
just the one project a human happened to notice it on). Each pair held
BYTE-IDENTICAL PhyLog skill content (verified before deleting anything) —
consistent with two separate `ensureProjectN01` calls each finding "no
Skills folder yet" and independently creating/seeding one. Repaired by
deleting the newer duplicate in each pair (verified identical content
first, kept the older row so its `_id` — potentially already referenced
elsewhere — survives) and re-swept every human's vault afterward to
confirm zero remaining duplicates anywhere, not just on the three found.

**Fixed at the root** in both `projectN01.server.ts`'s `ensureProjectN01`
and `projectN02.server.ts`'s `applyProjectN02Shape`: (1) the existing-folder
lookup now sorts oldest-first before picking (deterministic behavior even
if a duplicate somehow exists again), and (2) a brand new Skills folder
is now created with `id: systemVaultFolderKey(humanId, "Skills",
projectFolderId)` — exported from `vault.server.ts` for this reuse — so
a concurrent create can never produce a second row. Deliberately the
SAME key formula in both files: whichever of n01/n02 seeding ever runs
against a given project, both converge on the identical Skills folder
row, never two.

**Known, NOT yet checked**: the same unprotected check-then-create shape
likely also exists in `ensureProjectGraphFolder`'s `Graph` folder
creation and `dailyLogSync.server.ts`'s sync-folder creation — not
confirmed broken (no evidence found), not fixed preemptively here since
that would be guessing rather than confirming a real problem. Worth an
explicit audit pass if either ever shows the same duplicate-folder
symptom.

**Not yet done**: running the (now-safe) migration across every REAL
existing project + every human's `personal` space, repairing
`projects/Nopal O.` specifically (see above), then retiring
PhyLog/`project-n01` entirely (delete `phylogAgent.server.ts`/
`preCapture`/`capture`/`postCapture`/`projectN01.server.ts`/
`phylogDefaults.server.ts`, `api.phylog.*`, `crates/cli/src/phylog.rs`,
the Maker PhyLog pages) once every space has been migrated and verified
for real.

## Maker pages

Mirrors PhyLog's own `/fruits/maker` surface exactly (see the `phylog`
skill's "Usage tracking" section) — same gate (Admin/Super only), same
layout, same range-toggle convention, just against GraphLog's own
tables/stage set.

- **`graphLogMetrics.server.ts`'s `getGraphLogUsageSummary(days)`/
  `pruneOldGraphLogUsageEvents`** — added alongside the existing
  `recordGraphLogUsage`, mirroring `phylogMetrics.server.ts`'s
  aggregation layer exactly (byStage/byProject/byHuman/byDate, cost
  estimation via the same `llmPricing.ts`). This file's own header used
  to say this was deliberately deferred "until a real Maker page exists"
  — added once that page actually existed.
- **`graphLogDefaults.server.ts`'s admin-editable-override layer**
  (`getEffectiveGraphLogDefaultSkill`/`getAllEffectiveGraphLogDefaultSkills`/
  `setGraphLogDefaultSkillOverride`, table `graphlog_default_skills`) —
  mirrors `phylogDefaults.server.ts` exactly (one DB row, one OPTIONAL
  field per stage, unset means "use the hardcoded constant"; NEVER
  retroactive — only changes a brand new project's seed content going
  forward). `projectN02.server.ts`'s `applyProjectN02Shape` now seeds
  from these effective values instead of the raw `DEFAULT_*_SKILL`
  constants directly, same as `ensureProjectN01` already does for PhyLog.
- **`/fruits/maker`'s "GraphLog Usage" summary section** — same card
  layout as the existing "PhyLog Usage" section, right below it.
- **`/fruits/maker/graphlog`** — the full usage breakdown page (Overview/
  By Stage/Calls Per Day/By Project/By Human), a direct structural mirror
  of `/fruits/maker/phylog`.
- **`/fruits/maker/graphlog/defaults`** — the default-skill-text review/
  edit UI (Knowledge/Graph/Project View), a direct structural mirror of
  `/fruits/maker/phylog/defaults`.
- **Verified directly** against the real local dev SurrealDB: `projects/Nopal
  O.`'s real earlier `nopal graphlog run` already left real
  `graphlog_usage_daily` rows (16 calls, sync-graph + graph-project-view,
  ~$0.33 estimated) — `getGraphLogUsageSummary(30)` correctly aggregated
  them end to end (byStage/byProject/byHuman/byDate all populated
  correctly) on the first real call, not just against synthetic data.

## Local dev gotcha: the worker doesn't hot-reload

`packages/worker`'s `vite-node worker.ts` (see the `phylog` skill's
"Scaling & Process Isolation") is a plain, long-running process — unlike
the webapp's own Vite dev server, it does NOT watch for file changes.
After editing `worker.ts` OR ANY `robustness-core` file a GraphLog/PhyLog
job transitively imports, the running `nopal-worker-1` container is still
serving the OLD code until restarted: `docker restart nopal-worker-1`
(confirmed directly — a job enqueued right after a code change failed
with `Unknown GraphLog job name: ...` until the container was restarted).
`make reset` also fixes this (a full `docker compose down -v` + fresh
`up`), but wipes every named volume — including the local SurrealDB/MinIO
data — so it's a much bigger hammer than needed just to pick up a code
change.

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
   `POST /api/graphlog/daily-log-sync` (synchronous, no job queue — see
   its own doc for why this differs from PhyLog's enqueue-then-poll
   shape), `nopal graphlog daily-log-sync --project <path> [--date]`.
   The Option-A root retirement (`vault.server.ts`'s `resolveDailyLogsFolder`
   + `ensureVaultRootFolders`'s "daily-logs" special case) shipped as its
   own carefully-scoped, separately-tested follow-up — see "The 'Daily
   Logs' symlink" above for the full design and what's still open
   (sidebar navigation polish, per-request caching).
4. **Done — `sync-knowledge`.** `syncKnowledge.server.ts`
   (`runSyncKnowledge`) walks a project's `syncs/` tree recursively
   (skipping `_knowledge/` folders themselves), and for every file without
   an up-to-date sidecar, asks an LLM (per `skills/KNOWLEDGE.md`'s own
   instructions — default "skip", a total no-op) to extract concrete
   metadata into `_knowledge/<name>.knowledge.md`, right inside the SAME
   folder the source lives in. Idempotent via a stored `content_hash` in
   the sidecar's own front matter, same convention pre-capture uses.
   Reuses `LlmProvider`/`PhotoDescriber`/`AnthropicProvider` from PhyLog's
   provider seam unchanged — no new LLM infra needed.
   - **Own usage-tracking + queue infra, deliberately NOT shared with
     PhyLog's** — `graphLogMetrics.server.ts` (`graphlog_usage_events`/
     `graphlog_usage_daily` tables, `recordGraphLogUsage`) and
     `graphLogQueue.server.ts` (its own BullMQ queue `"graphlog"`, own
     per-project Redis lock keyed `graphlog:lock:...`) mirror
     `phylogMetrics.server.ts`/`phylogQueue.server.ts`'s shapes closely but
     stay fully independent, so retiring PhyLog later never touches
     GraphLog's own code. `classifyLlmError`/`SKIP_MARKER`/
     `getProjectStageSkill`/`listExtraSkillFiles`/`isSkipInstruction` are
     likewise small, deliberate DUPLICATIONS (into `graphLogMetrics.server.ts`/
     `projectN02.server.ts`) rather than cross-pipeline imports, same
     reasoning `graphLogDefaults.server.ts` already established.
   - **Runs in the SAME worker process as PhyLog**, as a second,
     independent BullMQ `Worker` in `packages/worker/worker.ts` against
     the `"graphlog"` queue — no new deploy target needed. Deliberately
     does NOT resolve through `resolveProjectN01`/`resolveProjectN02`
     (unlike PhyLog's own dispatch) — GraphLog's stages are
     container-type-agnostic by design (a plain `getFolderById` is enough,
     same as `dailyLogSync.server.ts`'s own resolution), so sync-knowledge
     can be exercised against an ordinary `project-n01` project today,
     ahead of any real n01→n02 migration tooling existing.
   - `POST /api/graphlog/sync-knowledge` (enqueue) + `GET
     /api/graphlog/jobs/:jobId` (poll) — agentic, so this follows PhyLog's
     own enqueue-then-poll shape, unlike `daily-log-sync`'s synchronous
     one. `nopal graphlog sync-knowledge --project <path>`
     (`crates/cli/src/graphlog.rs`, mirroring `phylog.rs`'s own
     enqueue/poll helpers).
   - **Verified directly** (not just typechecked): a throwaway script
     exercised `runSyncKnowledge` against the real local dev SurrealDB
     with a FAKE `LlmProvider`/`PhotoDescriber` (no real Anthropic calls,
     no cost) via its own `opts.provider`/`opts.photoDescriber` override
     seam (the same one PhyLog's `runPreCapture` already supports for
     testability) — confirmed the skip-gate (no `KNOWLEDGE.md` -> zero
     calls), correct `_knowledge/<name>.knowledge.md` naming, idempotency
     on an unchanged file, and correct regeneration once a source file's
     `content_hash` changes. Also confirmed both `packages/worker`
     BullMQ workers (`"phylog"` and `"graphlog"` queues) start cleanly
     side by side against the local Redis.
5. **Done — `sync-graph`.** `syncGraph.server.ts` (`runSyncGraph`) walks
   every file under `syncs/` that carries a `date` (today, only
   `daily-log-sync`'s own output does — it now stamps `date: entryDate`
   on every synced Card copy), groups by date, and for each day whose
   aggregate hash (every candidate's `content_hash` PLUS its
   `_knowledge/` sidecar's own hash, if any) has changed, asks an LLM
   (per `skills/GRAPH.md`'s own real starter instructions — NOT "skip") to
   extract citable nodes into `Graph/graph-log-YYYY-MM-DD.md`.
   - **Citations are PRE-COMPUTED, never left to the model** — each
     candidate's exact `:ref{...verbose="true"}` markdown
     (`buildRefDirectiveMarkdown`) is handed to the model as "copy this
     verbatim if you quote this source," so a citation's name/datetime/
     location can never be hallucinated. `location` is a real, working
     `/fruits/vault?file=<fileId>` link into the SYNCED COPY inside this
     project's own vault (never the original Card in a contributor's
     personal vault, which other project viewers may not have access
     to). `datetime` is `<date>T12:00:00Z` (noon UTC) — a deliberate
     simplification since a Card carries a calendar date, never a
     sub-day timestamp; flagged here as a known limitation, not silently
     fabricated precision.
   - **Contributor attribution** is recovered from the synced copy's own
     FILENAME (`dailyLogSync.server.ts`'s new `parseSyncedCardFileName`,
     the reverse of `syncedCardFileName`) — the file's own `human_id` is
     always the PROJECT's owner (whoever's vault it's synced into), never
     the actual contributor, since the copy lives in the project's own
     tree. Falls back to "Unknown"/no `human-id` for any future non-
     daily-log sync source's file that doesn't match this naming shape —
     `:ref{...}`'s `human-id` is optional for exactly this reason.
   - **Node headings are `### Node <N>` — a plain incrementing counter,
     never an LLM-generated title.** Decided this way specifically
     because a free-form title is one more thing the model could get
     wrong/inconsistent, where a counter can't. Resets to 1 for each new
     day's file, counting up across every contributor's content that
     day (never restarted per contributor).
   - **Links point backward across days, OR sideways within the same
     day.** The candidate list for backward links is now
     `Graph/graph-structure.md`'s own clustered, glossed, weighted
     content (see item 7 below) — a real upgrade from the original
     design, which only ever handed the model a bare, gloss-free list of
     `[2026-08-10 Node 3](./graph-log-2026-08-10.md#node-3)`-style links
     with literally nothing to judge relevance against (a node's heading
     is just "Node 3"). One cycle stale by construction (reflects the
     graph as of `graph-structure`'s last run), falling back to the OLD
     flat heading scan for a project that's never had `graph-structure`
     run yet. A node may ALSO link to another node from the SAME day's
     file, in either direction (a later node linking back to an earlier
     one, or vice versa) — this one the model handles entirely on its own
     within one completion, tracked live via `headingsByDate` regardless
     of which candidate source is in play, since `graph-structure.md`
     could never reflect a node written earlier in the SAME run; verified
     directly that a same-day link (`Node 2` → `Node 1`, same file)
     round-trips through the pipeline with no issue. Still never forward
     to a day that hasn't been processed yet, even within the same run.
   - **Delete-and-regenerate, never partial-patch** — a day whose
     aggregate hash changed has its existing `graph-log-*.md` deleted
     BEFORE the model is asked to redo it from scratch; a day the model
     decides has "nothing worth capturing" (a literal `NOTHING_TO_CAPTURE`
     sentinel it can return) ends up with NO file at all, even if an
     earlier run had written one for that same day.
   - `POST /api/graphlog/sync-graph` (enqueue) + the SAME
     `GET /api/graphlog/jobs/:jobId` sync-knowledge already uses (one
     polling route for every GraphLog job name). `nopal graphlog
     sync-graph --project <path>`.
   - **Verified directly** (not just typechecked) against the real local
     dev SurrealDB with a FAKE `LlmProvider` (no real Anthropic calls, no
     cost): two days processed with correct cross-day linking; a second
     run made zero new LLM calls (fully idempotent); changing one day's
     `content_hash` regenerated ONLY that day; the `NOTHING_TO_CAPTURE`
     sentinel correctly deleted that day's file while leaving the other
     day's untouched.
   - **A real bug in production output, found and fixed**: a verbatim
     quote that was itself a numbered list got wrapped in ONE
     `==...==` span around the whole list, which silently broke instead
     of highlighting -- confirmed the root cause is structural, not a
     rendering bug: `==...==` is inline markup exactly like `**bold**`,
     and inline markup can never cross a blank line or list-item
     boundary in any CommonMark-based parser (reproduced the identical
     failure with plain `**bold**` around the same list, in
     `oxmarkdown-core`). Fixed at the source, not the renderer:
     `DEFAULT_GRAPH_SKILL` (`graphLogDefaults.server.ts`) now instructs
     marking each list item's own text separately when the verbatim
     words are/contain a list, keeping each item's own `1.`/`-` marker
     outside the highlight.
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

**Not yet done: running the migration for real across every existing
project/`personal` space, and the actual PhyLog/`project-n01` code
retirement once that's complete** — the only remaining work against the
original phased plan.

## Related skills

- `phylog` — the system this replaces; read first for the Vault Folder
  Type system, the Sorter/Cards/Release Log machinery `daily-log-sync`
  reuses, and the queue/worker/CLI scaffolding GraphLog's later stages are
  expected to reuse unchanged.
- `vault` — Vault Folder Types, Daily Logs/Cards, Sharing Roles.
- `oxmarkdown` — the directive/interactable model `:ref{...}` follows;
  keep both skills in sync as `:ref{...}` evolves.
