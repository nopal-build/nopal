---
name: graphlog
description: GraphLog, the AI pipeline for `project-n02` spaces — the planned successor to PhyLog/`project-n01`. Turns synced content into a `Graph/` of cited, linkable nodes, then into an up-to-date `README.md` Project View. Use when working on `project-n02`, `projectN02.server.ts`, `graphLogDefaults.server.ts`, the `Graph`/`project-n02` Vault Folder Types, the `:ref{...}` directive (`oxmarkdown-core/src/refDirective.ts`), or when asked about "GraphLog", daily-log-sync, sync-knowledge, sync-graph, or graph-project-view.
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

**Status: early build-out, most pipeline stages not yet implemented.** See
"Build status" below for exactly what exists today vs. what's still
planned. Written as a living design doc, same convention as `oxmarkdown`'s
skill — update it as GraphLog gets built, don't let it drift into
describing a design that was later changed without a matching code change.

## Why a new name instead of extending PhyLog

`project-n01`/PhyLog's whole shape (stage skill files, filing attachments,
one evolving README) was designed around "organize scattered content into
a tidy project." `project-n02`/GraphLog's shape is designed around a
different goal: build a durable, linkable GRAPH of specific statements
("who said/decided what, when, sourced from where") that a README is later
synthesized FROM, rather than directly written to. Different enough in
both data model (a new `Graph/` space, cross-day node links, the `:ref{...}`
citation directive) and pipeline shape (four stages, not three, with the
first one deliberately NOT agentic) to warrant a new name rather than a
fourth PhyLog stage.

`project-n01` and PhyLog are expected to be fully retired once every
project/`personal` space has been migrated to `project-n02` — see "Planned:
migration" below. Until then, both systems coexist; nothing here changes
`project-n01`'s existing behavior.

## The pipeline

```
personal/syncs/Daily Logs (real Cards, one per project per day)
  -> STAGE 1: daily-log-sync    (deterministic copy, NOT agentic)
  -> STAGE 2: sync-knowledge     (agentic, skills/KNOWLEDGE.md)
  -> STAGE 3: sync-graph         (agentic, skills/GRAPH.md)
  -> STAGE 4: graph-project-view (agentic, skills/PROJECT_VIEW.md)
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
  capturing). Each node gets a stable heading (so later days can link to
  it) and a `:ref{...verbose="true"}` citation. Runs once a day IN INTENT
  (matches the day a new Daily Log/sync content landed) but, like PhyLog,
  is **never wired to run automatically yet** — every stage is CLI-only
  for now (see "CLI surface" below), same "always on-demand, never a
  cron" philosophy the `phylog` skill's header establishes for the same
  cost/non-determinism reasons.
  - **Regeneration, not append**: if a day's underlying source content
    changed after its `graph-log-*.md` was already written, DELETE that
    file and fully regenerate it — no partial-append logic.
  - **Cross-day links point only backward**: a day's nodes may link to an
    EARLIER day's node by heading anchor
    (`[...](./graph-log-2026-08-10.md#some-heading)`); never forward to a
    day that hasn't been processed yet.
- **graph-project-view** — reads `Graph/graph-log-*.md` files, per
  `skills/PROJECT_VIEW.md`, and keeps `README.md` an accurate, organized
  synthesis. **Incremental**: walks oldest-not-yet-applied graph-log file
  first, each one only touching the README sections it actually has
  something new to say about — same "bound the blast radius to what
  changed" philosophy as PhyLog's `update_section` tool. A full project
  reset rebuilds by walking every graph-log file again, in order, from
  scratch — never a from-scratch resynthesis driven by anything other
  than replaying the graph-log history.

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
    `skills/KNOWLEDGE.md`/`GRAPH.md`/`PROJECT_VIEW.md` from
    `graphLogDefaults.server.ts`. **Refuses to touch a folder that's
    already a `project-n01` anchor** — retagging is the explicit
    migration step (not yet built), never an implicit side effect.
  - `resolveProjectN02(folderId)` — the same "resolve + validate + retrofit"
    chokepoint `resolveProjectN01` is for PhyLog; not yet called from
    anywhere (no CLI/API surface exists yet — see "Build status").
  - `ensureProjectGraphFolder(projectFolder)` — lazy `Graph` folder
    creation, mirroring `ensureProjectDailyLogsFolder`. Not yet called by
    anything (`sync-graph` doesn't exist yet).
- `graphLogDefaults.server.ts` holds the three starter
  `DEFAULT_KNOWLEDGE_SKILL`/`DEFAULT_GRAPH_SKILL`/`DEFAULT_PROJECT_VIEW_SKILL`
  constants — genuinely early drafts, expected to change once the stages
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

## Planned: migration from `project-n01`

Not yet built. Intended shape (`nopal project migrate-to-n02 --project
<path> --yes`, destructive, requires explicit confirmation like `phylog
reset`):

1. Replace the project's `skills/*` with GraphLog's defaults
   (`KNOWLEDGE.md`/`GRAPH.md`/`PROJECT_VIEW.md`).
2. Delete every direct child EXCEPT `skills`/`syncs` (mirrors
   `resetProjectN01Content`'s own exclusion list).
3. Run `daily-log-sync` to backfill `syncs/Daily Logs` from history.
4. Run the full GraphLog pipeline to rebuild `Graph/` and `README.md`
   from scratch.

Run once across every project + every human's `personal` space, then
retire PhyLog/`project-n01` entirely (delete `phylogAgent.server.ts`/
`preCapture`/`capture`/`postCapture`/`projectN01.server.ts`/
`phylogDefaults.server.ts`, `api.phylog.*`, `crates/cli/src/phylog.rs`,
the Maker PhyLog pages) once every space has been migrated and verified.

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
   - **Cross-day links point only backward** — before processing a day,
     every EARLIER day's already-written `### heading`s (best-effort
     GFM-style slugified) are handed to the model as ready-to-use
     markdown links ("copy one of these verbatim, never invent a link
     that isn't in this list"); a day currently being processed is never
     told about later days, even within the same run. Confirmed directly:
     a later day's prompt correctly included an earlier day's heading
     link; the earliest day correctly saw "no earlier nodes exist yet."
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
6. **Not started — `graph-project-view`.** Needs: the incremental
   README-synthesis agent loop (can likely reuse `capture.server.ts`'s
   `createReadmeAndFileExecutors`-style tool factory pattern).
7. **Not started — migration tooling + PhyLog/`project-n01` retirement.**
   See "Planned: migration" above.

## Related skills

- `phylog` — the system this replaces; read first for the Vault Folder
  Type system, the Sorter/Cards/Release Log machinery `daily-log-sync`
  reuses, and the queue/worker/CLI scaffolding GraphLog's later stages are
  expected to reuse unchanged.
- `vault` — Vault Folder Types, Daily Logs/Cards, Sharing Roles.
- `oxmarkdown` — the directive/interactable model `:ref{...}` follows;
  keep both skills in sync as `:ref{...}` evolves.
