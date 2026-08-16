---
name: phylog
description: PhyLog, Nopal's AI pipeline that turns a project-n01 space's daily-log Cards and synced files into written summaries, filed/organized project content, and an up-to-date README. Use when working on packages/robustness-core/src/data/phylogAgent.server.ts, preCapture.server.ts, capture.server.ts, postCapture.server.ts, projectN01.server.ts, sorter.server.ts's fileCardAttachments, llmProvider.ts, anthropicProvider.server.ts (all in packages/robustness-core), packages/worker/worker.ts, the webapp/app/routes/api.phylog.* routes, or crates/cli/src/phylog.rs — or when asked about "phylog", the PhyLog pipeline, pre-capture/capture/post-capture, project-n01 spaces, or the robustness-core/oxmarkdown-core/worker workspace packages.
---

# PhyLog

PhyLog is Nopal's on-demand AI pipeline for one `project-n01` space at a
time — a project (a folder directly under `projects`), or a human's own
`personal` space. It turns raw daily-log Cards and synced files into
durable, organized project state: pre-capture STAGES that raw material
into the project's own `daily-logs/` folder (summaries alongside a copy
of each day's Card and its attachments), then capture reads `daily-logs/`
and `syncs/` to decide how to file/organize content and keep
`README.md` an up-to-date index. See the `vault` skill's Daily Logs /
Sorter / Release Log / Vault Folder Types sections first if any of those
terms are unfamiliar. Standalone from `vault` because PhyLog is its own
subsystem — its own pipeline stages, its own LLM provider seam, its own
CLI surface.

Every PhyLog call costs real money and is non-deterministic, so it is
**never** wired into a cron — always triggered on demand (CLI or API).
**There is no preview/dry-run mode anywhere in this pipeline** — every
call applies for real. `nopal phylog reset` (wipe, keeping `daily-logs/`)
+ `capture --full` (rebuild from what's already staged) is the
"inspect before committing" workflow; `reset-pre-capture` goes deeper
(also wipes `daily-logs/`); `nopal release-log revert` undoes one
capture's README edit.

**Deciding WHICH daily logs need (re)processing is always DB-tracked,
never AI-driven.** Each stage determines its own work list with a plain
query plus an idempotency check (`release_log_entries` / a `_meta.md`
hash) — an LLM only runs after that check says "yes, this needs
(re)processing," to decide WHAT to write, never WHETHER to run.

## `project-n01` spaces

Every project, and the `personal` root, carries the `project-n01` Vault
Folder Type (`packages/robustness-core/src/data/vaultFolderTypes.ts` —
see the `vault` skill's "Vault Folder Types" section). The name is a
placeholder for "v1 of the concept."

Enforced server-side by the vault's write-policy chain
(`canWriteToFolderId`, `vault.server.ts`), never just a hidden button:

- **`README.md` is the space's index.**
- **`skills/` and `syncs/` are the ONLY folders a human may write to
  directly.** Every other write into a `project-n01` tree (upload,
  folder creation, editing `README.md`) is rejected server-side for
  every role, Admin/Super included (`writable: "system"` in
  `vaultFolderTypes.ts`). PhyLog's own server code is exempt since it
  calls the data layer directly, never the `api.vault.*` write routes.
- **Everything else — organized structure, filed attachments,
  pre-capture summaries, README body — is PhyLog's to create, move, and
  rewrite.** Anything a human manually dropped in outside
  `skills`/`syncs` is disposable; `phylog reset` may delete it.
- Renaming/deleting/moving/sharing/publishing the `project-n01` folder
  itself is a separate, still-owner-writable concern (see `vault`
  skill's write-policy section).
- A future **`newspapers`** space type (inside `project-n01`) is
  reserved for post-capture-generated digests — not implemented
  (`comingSoon: true`). Not the same as the already-shipped
  `project-newspaper` skill's VIEW of a project's README.
- **`daily-logs/`** is a project-scoped space type (distinct from the
  vault-wide `daily-logs` ROOT) — pre-capture's staging area, one
  subfolder per (day, contributor), that capture reads to decide how to
  organize the project. `writable: "system"`, not human-editable.

`ensureProjectN01`/`resolveProjectN01`
(`packages/robustness-core/src/data/projectN01.server.ts`) stamp + seed a
`project-n01` folder — at project creation, and lazily as a self-healing
retrofit for anything older. Seeding creates `skills/` (if missing) with
three default files — `PRE_CAPTURE.md`, `CAPTURE.md`, `POST_CAPTURE.md`
— one per pipeline stage, each with a sensible default so a new project
is usable without any human editing.

### Reset — two distinct depths

`resetProjectN01Content` (`projectN01.server.ts`) deletes every direct
child of a `project-n01` folder EXCEPT `skills`/`syncs`/`newspapers` (and
everything nested under them), and clears this project's own Release Log
history (`clearReleaseLogForProject`) so a later `capture --full` doesn't
think everything was already applied.

A `wipeDailyLogs` option gives two commands for two depths:

- **`nopal phylog reset`** (`wipeDailyLogs: false`, default) — wipes
  everything capture manages, leaves `skills`/`syncs`/`daily-logs`
  alone. `capture --full` afterward rebuilds straight from
  `daily-logs/` with no new pre-capture LLM calls.
- **`nopal phylog reset-pre-capture`** — also wipes `daily-logs/`
  itself. Needed after editing `skills/PRE_CAPTURE.md` to regenerate
  summaries from scratch. Requires `pre-capture` (to restage) before
  `capture --full` has anything to rebuild from.

Either reset is always explicit — never run implicitly. `capture --full`
internally calls the same `resetProjectN01Content` (always
`wipeDailyLogs: false`) right before reprocessing, so running `reset`
first is optional.

**`README.md` is NEVER deleted by either reset — only its BODY is
cleared, front matter preserved byte-for-byte** (`withReadmeBody`,
`project.types.ts`). Front matter is the only place a project's Sharing
Roles (`sharing`) and lifecycle `status` live — deleting the whole file
on reset would silently revoke every collaborator's role and reset
status to "active," since `getProjectRole` reads roles straight from the
current README's front matter with no cache. `captureOneDay` merges a
fresh body into whatever front matter is already there via the same
helper, so a later capture rebuilds correctly on top of it. Not counted
in `ResetSummary.deletedFiles`.

## The pipeline

```
project-n01 space (Cards in daily-logs, files in syncs/)
  -> STAGE 1: pre-capture   (preCapture.server.ts)
  -> STAGE 2: capture        (capture.server.ts)
  -> STAGE 3: post-capture   (postCapture.server.ts)
```

`nopal phylog run` (and `POST /api/phylog/run`, `runPhylogPipeline` in
`phylogAgent.server.ts`) runs all three, in order, for one project. Each
stage is also independently runnable (`pre-capture`/`capture`/
`post-capture`, matching `POST /api/phylog/*` routes) — useful while
iterating on a project's own skill files.

**Entirely skill-driven, per stage**: each stage reads its own file
inside `skills/` (`PRE_CAPTURE.md`, `CAPTURE.md`, `POST_CAPTURE.md` —
`getProjectStageSkill`) and follows those instructions. A skill file
whose first non-blank line is exactly `skip` (case-insensitive — the
seeded default for pre-capture and post-capture) is a total no-op: no
files examined, no model called (`isSkipInstruction`).

**Any OTHER file in `skills/`** (e.g. a `VOICE.md` that `CAPTURE.md`
tells the model to "read and follow") is auto-folded into every
pre-capture and capture prompt (`listExtraSkillFiles`) — capture's tools
have no way to read an arbitrary file by name, so this is the only way
such a reference can actually be honored. Reserved names
(`PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md`/`SKILL.md`) are
excluded since those are fetched by name already.

### Stage 1 — pre-capture (`preCapture.server.ts`)

Two jobs, one unconditional and one skill-gated:

1. **Staging (unconditional in sweep mode)** — for every (day,
   contributor) with a Card for this project
   (`listCardEntriesForProject`), ensures that entry's folder exists
   under `daily-logs/` (`getOrCreateDailyLogEntryFolder`, named
   `YYYY-MM-DD-<slug>` — cosmetic only, see below), keeps a plain-text
   copy of the Card (`card.md`) current there, and copies every
   `::file{...}` attachment into that folder (`copyFileIntoFolder` — a
   new `file_refs` row over the same S3 bytes, no duplication).
2. **Summarization (gated by `skills/PRE_CAPTURE.md`, default: skip)** —
   for every candidate without a matching `<name>-summary.md` for its
   CURRENT content, an LLM decides whether/how to summarize, per the
   skill's instructions. Candidates: every Card attachment just staged
   (summary written alongside it in `daily-logs/`), and every file under
   this project's `syncs/` tree (summary written as a sibling there).
   - Image -> vision call (`PhotoDescriber.describePhoto`).
   - Text file -> plain summarization call (`LlmProvider.complete`, no
     tools).
   - Anything else (binary, no extracted text) -> left unsummarized,
     reported `unsupported`.

Staging is unconditional (never skill-gated) because `PRE_CAPTURE.md`
defaults to "skip" and capture reads exclusively from `daily-logs/`/
`syncs/` — if staging were also gated, a default-configured new project
would never populate `daily-logs/` for capture to work from. So the
skill only ever controls whether SUMMARIES get written.

**Idempotent at two levels**: a summary is keyed off a hash of the
source file's bytes/content plus (for a Card attachment) its caption,
stored in the summary's own front matter (`sourceHash`); an unchanged
file/caption is a no-op. Each entry's own `_meta.md`
(`writeDailyLogEntryMeta`) carries an aggregate `sourceHash` — the
Card's text plus every current attachment's hash — refreshed every run
regardless of whether any individual summary needed regenerating. This
aggregate is what capture's own idempotency check keys off (see Stage
2).

**Entry folder naming is cosmetic, never load-bearing** — an existing
entry is always found by matching `(humanId, date)` in every folder's
own `_meta.md`, never by parsing the folder name. A contributor renaming
themselves, or two contributors sharing a name, can't break this.

**Invocation shapes** (one function, `runPreCapture`, different
options): `fileId` (CLI `--file`) — single-file summarization debug
path, no staging; `date` (CLI `--date`) — stage+summarize one day's
Cards plus a syncs sweep; omit both — sweep everything, idempotent
against what's already staged/summarized.

**Cross-human by design** (same as capture): sweep mode processes every
contributor's Cards for this project, not just whoever runs the command.

### Stage 2 — capture (`capture.server.ts`)

Reads its input exclusively from `daily-logs/` and `syncs/` — never the
live Card or a contributor's own vault directly. Runs per daily-logs
entry (`listDailyLogEntries`, oldest first):

1. **Deterministic filing** (`sorter.server.ts`'s `fileCardAttachments`,
   zero-inference, shared with the Sorter) — every not-yet-filed
   `::file{...}` Card attachment lands in the project root. This reads
   the ORIGINAL Card, not the daily-logs entry's staged copy, so its
   `sourceRef`/dedup identity matches what the Sorter already uses —
   filing the staged copy instead would risk double-filing the same
   photo under two different fileIds.
2. **Organize + README** — an LLM agent loop driven by
   `skills/CAPTURE.md` (default: file everything into the root, keep
   README a plain index — `DEFAULT_CAPTURE_SKILL`). Given the project's
   current file tree (everything except `skills`/`syncs`/`newspapers`/
   `daily-logs`), the entry's staged Card text + summaries, and the
   current README, the model may call:
   - `create_folder({ path })` — mkdir -p, relative to project root.
   - `move_file({ name, destinationPath })` — relocate an already-filed
     file by name.
   - `write_file({ path, chunk, done })` — create/replace a markdown
     REFERENCE file (not README.md) for splitting out substantial
     detail, linked to from a section.
   - `update_section({ heading, chunk, done })` — **the primary way to
     change the README.** Replaces/creates one `## Heading` section
     (`heading: ""` = the intro). Bounds an edit's blast radius to the
     section that actually changed.
   - `remove_section({ heading })` — deletes one section (explicit,
     distinct from an empty `update_section`, which is refused).
   - `update_readme({ chunk, done, reason })` — replaces the entire
     README body. Reserved for genuine full reorganizations or the
     first pass on an empty README; the system prompt tells the model
     not to reach for this as the default.
   - `request_reorganize({ reason })` — see "Reorganizing" below.

   `write_file`/`update_section`/`update_readme` accept content as one
   or more `chunk`s (`done: true` on the final one) so a long update
   isn't capped by a single response's output-token limit; calls for
   the same `path`/`heading` accumulate into that target's buffer.
   `maxTurns` is 16 for the daily loop to leave room for this.
   `create_folder`/`move_file`/`write_file` refuse to target `skills`/
   `syncs`/`newspapers`/`daily-logs`, and `write_file` also refuses
   `README.md` itself.

   The model never reads arbitrary file content — only what's in the
   prompt (tree, Card/summaries, README, any extra `skills/` file via
   `listExtraSkillFiles`). When a run makes no README change and no
   file/folder change, the model's final turn of plain text is logged
   verbatim so "why didn't this update" stays diagnosable.

   **README-mutating tools commit immediately**, sharing one mutable
   `currentReadmeContent`/`currentReadmeFileId` (`captureOneDay`) — a
   second call in the same loop builds on the previous tool's own
   result, never a stale snapshot. One Release Log entry covers the
   day's cumulative change.

   **Safety net against a truncated/incomplete write wiping content**:
   `runAgentLoop` never executes a turn whose `stopReason` is
   `"max_tokens"` — that response is discarded entirely, and whatever
   earlier complete turns already committed stands (the `truncated` flag
   is purely informational, logged). Each tool also refuses to commit an
   unfinished chunk sequence (no final `done: true` -> left un-flushed)
   or a `done: true` call whose assembled content is blank when it would
   erase real existing content (`hadRefusal`) — a legitimately empty
   target is only refused-free when nothing was there yet. Because the
   blast radius is one section, a refusal on one section never blocks
   others from committing in the same run. A refused/incomplete call is
   logged inline, doesn't count as "applied" (see `incomplete` under
   Usage tracking), and is retried on the next `capture` run.
   `DEFAULT_MAX_TOKENS` is 8192.

**The base system prompt defers to the project's own `CAPTURE.md`** on
how much a day should change, rather than asserting a hardcoded caution
that would fight a project's own organization strategy — only falls back
to the cautious default when `CAPTURE.md` doesn't say more
(`buildSystemPrompt`).

**`createReadmeAndFileExecutors`** is the shared factory behind all six
file/README tools — both `captureOneDay`'s daily loop and `runReorganize`
call it, so the safety nets above live in one place.

#### Reorganizing: a dedicated, whole-README pass

The daily loop only ever sees one day's log plus the current README, so
"should the structure change" is a narrow, incremental judgment.
`runReorganize` is a separate pass that sees the ENTIRE current README
and an explicit charter to restructure freely (move/split/merge
sections, fix what's inlined vs. split into its own file) while never
inventing, removing, or altering the substance of anything already
written.

Two ways to reach it:

- **Automatically**, when a day's log explicitly asks for it (someone
  journaling "we should restructure this") — the model calls
  `request_reorganize`, and `runCapture` runs `runReorganize` right
  after that day's edits, tagged `${sourceRef}:reorganize`. At most one
  reorganize pass runs per `runCapture` invocation even if several
  entries request one.
- **On demand** — `nopal phylog reorganize --project <path>` /
  `POST /api/phylog/reorganize` runs the same pass directly.

Same `phylogMetrics` event shape and safety nets as the daily pass, own
Release Log entry, higher turn budget (24 vs. 16).

When a day's log triggers a reorganize, `captureOneDay` does NOT mark
that entry's `capturedNoOpSourceHash` (see idempotency below) — only
`runCapture` does, and only once `runReorganize` confirms it finished
cleanly (not truncated, not turn-limited, no refusal) — otherwise an
incomplete reorganize could never be retried.

**Idempotency, precisely**: each daily-logs entry's `_meta.md` carries a
`sourceHash` (from pre-capture, see Stage 1). Capture's Release Log
`source_ref` is `${entryFolderId}:${sourceHash}` — a plain
`findReleaseLogEntryBySource` lookup decides whether an entry needs
(re)processing, no AI involved. A Card can vanish out from under an
already-staged entry (deleted/edited away) — filing is simply skipped,
but the organize/README agent still runs off whatever's staged.

A second, independent way an entry counts "done": `capturedNoOpSourceHash`
on `_meta.md`, set only when a day's run is a genuinely clean no-op (the
model correctly decided nothing needed to change) — set ONLY by
`captureOneDay`'s final branch, and never when `truncated`/
`hitMaxTurns`/a refusal/an incomplete chunk occurred (those must keep
retrying). Since it's set to the current `sourceHash`, a later content
change naturally invalidates it. `runCapture`'s skip check treats this
the same as an applied Release Log entry, logged distinctly ("already
reviewed... nothing needed to change" vs. "already applied") so a quiet
day isn't re-examined by every future `capture` run forever.

**Directives**: the model is told about OxMarkdown directive syntax
(`DIRECTIVE_GUIDE`, injected into the system prompt) so it writes real
directives instead of plain links — especially
`::gallery{folder="<name>" title="..."}` (renders every image in a
project-root subfolder as a photo grid; only resolves direct children of
the root, never nested paths) via `create_folder` + `move_file` +
referencing the folder from `update_readme`/`update_section`.
`::csv-table{file="..."}`/`::svg{file="..."}` also exist. All three are
resolved server-side by `project.server.ts`'s `resolveProjectManifest` —
viewing a `project-n01` folder's README (browsing in, or `?file=<id>`)
renders through `ProjectView` instead of a directive-blind
`MdxEditorView`.

**Two modes** (`runCapture`'s `full` option; CLI `--full`):

- **Incremental** (default) — walks every daily-logs entry, skipping any
  already recorded (idempotent per above).
- **Full** — calls `resetProjectN01Content` first (`wipeDailyLogs:
  false`), then walks every entry from scratch. Rebuilds from whatever's
  already staged — no need to re-run pre-capture.

**Cross-human by design** — sweeps every collaborator's daily-logs
entries for this project, not just whoever runs the command
(`listDailyLogEntries` enumerates across every human whose Card was ever
pre-captured). Each entry is processed under its own humanId (filing,
agent loop, usage tracking, that human's own
`daily-logs/<date>/release-log.md`). A Card was already cross-human safe
by construction (any Sharing Role may write one; the Sorter already
files a collaborator's attachments without vault write access) — capture
now matches that instead of only ever looking at the invoking human's
own Cards.

**Release Log integration**: a day with a README change gets an
`"ai-update"` entry with a revertible `content-edit` changeset. A day
with reorganization but no README change still gets an entry (for
visibility) but no changeset — `create_folder`/`move_file` actions
aren't individually revertible yet, only reported in the summary text
(a known, flagged limitation, same spirit as the `vault` skill's chained
-edit replay caveat).

### Stage 3 — post-capture (`postCapture.server.ts`)

Gated by `skills/POST_CAPTURE.md` (default: skip). Currently a
placeholder — when the skill file isn't "skip," it only reports that
instructions exist; no model call, no tools wired up yet. Exists so the
pipeline's shape is real and callable ahead of defining behavior. First
planned use: generating the `newspapers` space (see above).

## LLM provider architecture

`llmProvider.ts` has no server-only imports and defines two interfaces:

- **`LlmProvider`** — `complete({ system, messages, tools })`, a
  provider-agnostic multi-turn tool-calling exchange. Used by capture's
  agent loop and pre-capture's text summarization (`tools: []`).
- **`PhotoDescriber`** — `describePhoto({ imageBase64, mediaType, context })
  -> string`, a single-turn vision call, no tools/history. Used by
  pre-capture's image summarization.

Kept separate because the two calls share nothing else (no tools, no
multi-turn loop, no system-prompt swap).

`anthropicProvider.server.ts`'s `AnthropicProvider` is the only
implementation of both today, off one shared `@anthropic-ai/sdk` client.
A second provider is a new file implementing either/both interfaces —
never a change to the pipeline stage files. `isPhylogAgentConfigured()`
gates on `ANTHROPIC_API_KEY` being set (same convention as
`SORTER_ENABLED`), so a fresh deploy spends nothing until configured.
`PHYLOG_ANTHROPIC_MODEL` overrides the default model (`claude-sonnet-5`).

### Prompt caching

On by default, no config flag, but deliberately selective rather than
always-on — a single-turn, single-entry run (the common case, since most
days need no change) would otherwise pay two cache-write premiums for
zero read benefit. Entirely inside `AnthropicProvider.complete`, so both
call sites get it for free. Two `cache_control` breakpoints:

- **System prompt** marked from the SECOND real LLM call onward within
  one `runCapture`/`runPreCapture` invocation — a caller-provided hint
  (`cacheSystemPrompt`) tracking real calls actually reaching the LLM
  this run (`realCaptureCallsSoFar`/`realTextSummaryCallsSoFar`), not
  the total historical count of entries/candidates ever staged (which
  only grows and would make the hint permanently true). Since
  tools+system precede messages, this also covers the static tool
  definitions for free.
- **Last message** marked once a call is already mid-multi-turn
  (`messages.length > 1`, decided inside `complete` itself) — a turn-1
  call doesn't yet know if there'll be a turn 2.

**Negatives**: a cache write costs ~25% more than a normal input token,
only worth it if read back before the ~5-minute idle TTL expires (a gap
or any change to the cached prefix is just a miss, falling back to
normal pricing). Vision calls (`describePhoto`) are deliberately not
cached — their system prompt is far under Anthropic's ~1024-token
minimum to engage caching at all. No manual "clear the cache" exists or
is needed — it's a pure function of exact cached bytes and expires on
its own.

**Not yet built**: the hint is scoped to one project's own run, with no
visibility into other projects processed nearby in time. A future daily
all-projects orchestrator (there's no `run-all` job yet, unlike the
Sorter's `sort-all`) is the natural place to add a batch-scoped
cross-project cache hint, if/when projects turn out to share
byte-identical skill content worth caching across them.

**Cost accounting**: `LlmUsage.cacheReadTokens`/`cacheWriteTokens` flow
through `recordPhylogUsage` into both usage tables, and
`llmPricing.ts`'s `estimateCostUsd` prices a cache write at 1.25x and a
cache read at 0.1x the model's `inputPerMTok` (Anthropic's fixed ratios,
same across every model). `/fruits/maker/phylog` shows Cache Read/Write
Tokens and a Cache Hit Rate stat alongside token/cost.

## CLI / API surface

All thin clients over the pipeline stage functions — all real logic
lives server-side. Always applies — no `--apply`/`dryRun` anywhere.

```
nopal phylog run --project <path> [--full] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
nopal phylog pre-capture --project <path> [--date YYYY-MM-DD] [--file <path>]
nopal phylog capture --project <path> [--full] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
nopal phylog post-capture --project <path>
nopal phylog reorganize --project <path>
nopal phylog reset --project <path> --yes
nopal phylog reset-pre-capture --project <path> --yes
```

- `--project` — vault path, e.g. `projects/sunny`, or `personal`.
- `run` — all three stages in order; `--full` forwards to capture (the
  only stage with a "full" concept — pre-capture already sweeps
  everything by default, post-capture is project-wide).
- `pre-capture` — omit `--date`/`--file` to sweep everything; only
  summary generation is skill-gated, staging always happens.
- `capture` — `--full` resets (keeping `daily-logs/`) then reprocesses
  everything; default is incremental. `--since`/`--until` bound the date
  range either way. Also triggers `reorganize` automatically when a
  day's log asks for it.
- `reorganize` — same pass `capture` can trigger, run directly; never
  destructive.
- `reset` / `reset-pre-capture` — destructive, require `--yes`; the
  latter also wipes `daily-logs/`. Each prints a reminder of the
  follow-up command needed to rebuild.

Every CLI command resolves `--project`, then enqueues a job and polls
(see "Scaling & Process Isolation") — `GET /api/phylog/jobs/:jobId` on a
~1.2s interval, printing new progress-log lines (the endpoint always
returns the full cumulative log; the CLI slices client-side) until
`completed` (prints a summary) or `failed` (prints the reason, exits
non-zero). Real progress per file/day/stage, not token-level streaming.

API: `POST /api/phylog/{run,pre-capture,capture,post-capture,reset,
reset-pre-capture}` (each takes `projectFolderId` plus stage-specific
options) — all enqueue and return `202` immediately, never run inline.
`GET /api/phylog/jobs/:jobId` polls one job. All require an owner-tier
Sharing Role (or being the project/`personal` owner) to TRIGGER — `nopal
sort run` remains the lower-bar (any role) path for the Sorter's own
zero-inference filing. Once triggered, pre-capture/capture still sweep
every collaborator's Cards, not just the invoker's own.

## Scaling & Process Isolation

A PhyLog run can take minutes (LLM calls, vision on synced photos,
multi-day capture) — running that inline in an HTTP handler would let
one slow/hung run degrade the whole web server. So PhyLog work is
queued and runs in a dedicated process:

- **`phylogQueue.server.ts`** — BullMQ over Redis (separate
  infrastructure from the app's SurrealDB, on purpose).
  `enqueuePhylogJob`/`getPhylogJobStatus`/`getPhylogJobOwner`. Jobs use
  `attempts: 1` — no automatic retry, since each pipeline call is
  already internally idempotent; a human re-running the CLI is the
  correct retry path (an automatic retry could race a still-in-flight
  attempt).
- **`packages/worker`** — its own pnpm workspace package (`worker.ts`,
  run via `pnpm --filter worker run start`), not part of `webapp`.
  Drains the queue and calls the same pipeline functions from
  `robustness-core` the web app used to call inline. `concurrency: 1`
  deliberately — scale by running more worker processes/machines, not
  in-process concurrency.
- **`acquireProjectPhylogLock`** — a Redis `SET NX PX` lock keyed by
  `projectFolderId`, held for the entire duration of a job's pipeline
  work. Needed because `concurrency: 1` only guarantees "never twice at
  once within one process" — this stops two different worker processes
  from racing on the same project's README/daily-logs content. A second
  job for an already-locked project polls (every 3s) rather than
  failing, giving up after 30 minutes; the lock's own 10-minute TTL is
  the backstop for a crashed holder. Deliberately a hand-rolled lock, not
  a paid BullMQ Pro feature.
- **The CLI polls, it doesn't stream.**

**Why `packages/worker`/`packages/robustness-core`/`packages/oxmarkdown-core`
are separate pnpm workspace packages**, not a process sharing `webapp`'s
`package.json`: the worker's real dependency footprint is a small
fraction of `webapp`'s (React, MDXEditor, PDFKit, Express, webauthn,
etc. are never imported by any pipeline file) — sharing one
`package.json` meant every worker deploy carried all of `webapp`'s deps
too. Real pnpm workspace packages plus
`pnpm --filter worker deploy --prod` gets a genuinely pruned worker
image. `oxmarkdown-core` is its own third package (not folded into
`robustness-core`) because it's consumed by both `webapp` (editor/
renderer) and `robustness-core` (pipeline).

**Deployment**: `webapp` and `packages/worker` are separate Fly apps
(`webapp/fly.toml` / `packages/worker/fly.toml`), each built from the
REPO ROOT (both depend on the workspace packages):

```
fly deploy . --config webapp/fly.toml --dockerfile webapp/Dockerfile
fly deploy . --config packages/worker/fly.toml --dockerfile packages/worker/Dockerfile
```

(`make deploy` runs both.) Locally, `docker-compose.yml` has `redis` and
`worker` services alongside `webapp`, each bind-mounting the whole repo
root with its own `node_modules` volumes.

**Deliberately polyglot-ready**: the job schema (`PhylogJobName`/
`PhylogJobData`) is plain JSON, not Node-specific — a future Rust worker
(the CLI and future native apps already live in Rust) could poll the
same queue for its own job name alongside the Node worker, if/when
evidence supports it. Not built now.

## Usage tracking

Every LLM call is recorded via `phylogMetrics.server.ts`'s
`recordPhylogUsage` — tokens and timing only, deliberately anonymized
(no file names, prompt/response content, or raw error text; errors are
classified into a small closed set via `classifyLlmError`). Two tables:

- `phylog_usage_events` — one row per LLM call (or skipped/errored
  attempt). Pruned past a 30-day retention window
  (`pruneOldPhylogUsageEvents`, `POST /api/phylog/usage-cleanup`, same
  `CRON_SECRET` pattern as other daily jobs).
- `phylog_usage_daily` — one row per (date, human, project, stage),
  incremented alongside every raw event write. The durable table (tiny,
  kept indefinitely) that dashboards actually read.

`getPhylogUsageSummary(days)` aggregates the daily rollup — read by
`/fruits/maker`'s "PhyLog Usage" section and `/fruits/maker/phylog`
(both Admin/Super only).

One event per meaningful unit of work: one per file pre-capture
summarizes, one per day capture runs its agent loop for (usage/duration
accumulated across every turn), one per post-capture invocation.
`captureOneDay` wraps each day in its own try/catch so one bad day can't
abort the rest of a multi-day run. A metrics write failing never breaks
the run it's describing (`recordPhylogUsage` swallows its own errors).

**A refusal counts as an error, not a quiet no-op**: `truncated`,
`hitMaxTurns`, or a non-null refusal reason (see Stage 2's safety net)
makes an event `outcome: "error", errorKind: "incomplete"` rather than
`"success"`, so it shows up under the same "Errors" stat both Maker
pages already surface. Pre-capture's text-summary path applies the same
rule — a summary that hits `stop_reason: "max_tokens"` is discarded and
recorded `"incomplete"` rather than saved as finished.

**Known limitation**: the daily rollup stores sums and a
`maxDurationMs`, not a real distribution — true p95/p99 needs the raw
events, pruned after 30 days.

### Estimated cost (`llmPricing.ts`)

Anthropic has no public "current price" API usable here (the Cost Report
Admin API reports actual billed spend, not a price list, and needs
Admin-level access this app doesn't have). `MODEL_PRICING` is
hand-transcribed from https://platform.claude.com/docs/en/about-claude/pricing,
with a `PRICING_AS_OF` date bumped on re-verification.
`isPricingStale()`/`pricingAgeDays()` (>30 days) surface a warning
`Badge` on both dashboards.

`model` is part of the daily rollup's bucket key so a model change shows
up as a new, correctly-priced bucket instead of blending two price
points. `getPhylogUsageSummary` applies `estimateCostUsd` per row and
sums into `estimatedCostUsd` (overall/stage/project/human/day) — a rough
gauge, never a reconciled bill.

## Files

Most of PhyLog's logic lives in **`packages/robustness-core`**, a pnpm
workspace package — not under `webapp/app/data` (see "Scaling & Process
Isolation" above for why).

- `packages/robustness-core/src/data/projectN01.server.ts` —
  `project-n01` seeding/retrofit, default skill content,
  `resetProjectN01Content`, `getProjectStageSkill`/`isSkipInstruction`/
  `listExtraSkillFiles`, and the `daily-logs` space's find/create/list/
  manifest helpers.
- `packages/robustness-core/src/data/preCapture.server.ts` — stage 1.
- `packages/robustness-core/src/data/capture.server.ts` — stage 2
  (deterministic filing, the organize/README agent loop and its tools,
  `createReadmeAndFileExecutors`, `runReorganize`).
- `packages/robustness-core/src/data/postCapture.server.ts` — stage 3
  (placeholder).
- `packages/robustness-core/src/data/phylogAgent.server.ts` —
  orchestrates all three stages (`runPhylogPipeline`), `resetProject`.
- `packages/robustness-core/src/data/sorter.server.ts` —
  `fileCardAttachments` (shared with the Sorter), `summaryFileName`/
  `isImageContentType`.
- `packages/robustness-core/src/data/llmProvider.ts` — provider-agnostic
  interfaces (`LlmProvider`, `PhotoDescriber`).
- `packages/robustness-core/src/data/anthropicProvider.server.ts` — the
  one real provider today.
- `packages/robustness-core/src/data/file.server.ts`'s
  `downloadFileBytes` — the one server-side-direct S3 read in the app,
  used by pre-capture's image summarization.
- `packages/robustness-core/src/data/phylogQueue.server.ts` — BullMQ
  queue (see "Scaling & Process Isolation").
- `packages/robustness-core/src/data/phylogMetrics.server.ts` — usage
  tracking.
- `packages/robustness-core/src/data/llmPricing.ts` — static,
  hand-maintained model pricing.
- `packages/oxmarkdown-core/src/` (`document.ts`/`cardDirective.ts`/
  `mention.ts`) — framework-agnostic markdown/directive/mention parsing
  shared with `webapp`'s editor/renderer.
- `packages/worker/worker.ts` — the standalone queue-worker process;
  imports `robustness-core` directly.
- `webapp/app/routes/api.phylog.run.tsx` / `api.phylog.pre-capture.tsx` /
  `api.phylog.capture.tsx` / `api.phylog.post-capture.tsx` /
  `api.phylog.reorganize.tsx` / `api.phylog.reset.tsx` /
  `api.phylog.reset-pre-capture.tsx` / `api.phylog.jobs.$jobId.tsx` — API
  surface (enqueue + poll only).
- `crates/cli/src/phylog.rs` — CLI surface (`nopal phylog ...`).
- `webapp/app/routes/api.phylog.usage-cleanup.tsx` — raw usage-event
  pruning cron.
- `webapp/app/routes/fruits_.maker.tsx` / `fruits_.maker_.phylog.tsx` —
  usage dashboards (Admin/Super only).
