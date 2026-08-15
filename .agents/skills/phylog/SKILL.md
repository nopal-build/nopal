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
terms are unfamiliar — this skill sits directly on top of that
architecture. Deliberately standalone (not a subsection of `vault`)
because PhyLog is a big enough subsystem — its own pipeline stages, its
own LLM provider seam, its own CLI surface — to warrant its own home.

Every PhyLog call costs real money and produces non-deterministic output,
so it is **never** wired into a cron — always triggered on demand, by a
human (or an eventual sorting agent), through the CLI or the API. There is
**no preview/dry-run mode anywhere in this pipeline** — every call applies
for real. `nopal phylog reset` (wipe, keeping `daily-logs/`) +
`capture --full` (rebuild from scratch, straight from what's already
staged) is the "inspect before committing" workflow that used to be a
`--apply` flag's absence; `reset-pre-capture` goes one level deeper
(wipes `daily-logs/` too — see "Reset" below); `nopal release-log revert`
remains the safety net for undoing a specific capture's README edit.

**Deciding WHICH daily logs need to be applied is entirely
database-tracked, never AI-driven.** Both stages below determine their
own work list with a plain query (`listDailyLogEntries`/`_meta.md`'s
`sourceHash` for capture; a Card's own existence for pre-capture) plus an
idempotency check against `release_log_entries`/`_meta.md` — an LLM is
only ever invoked AFTER that deterministic check says "yes, this genuinely
needs (re)processing," to decide WHAT to write, never WHETHER to run at
all. See "Idempotency, precisely" under Stage 2 below for the exact
mechanism.

## `project-n01` spaces

Every project, and the `personal` root, carries the `project-n01` Vault
Folder Type (`packages/robustness-core/src/data/vaultFolderTypes.ts` —
see the `vault` skill's "Vault Folder Types" section for the general
mechanism). The name
is deliberately literal, a placeholder for "this is v1 of the concept" —
expect it to gain a friendlier name later; that's a superficial rename,
not an architectural one.

Rules, enforced by the vault's own write-policy chain (`canWriteToFolderId`,
`vault.server.ts`) — never just a hidden button:

- **`README.md` is the space's index** — the entry point a human (or the
  `project-newspaper` view, a different, unrelated feature) reads first.
- **`skills/` and `syncs/` are the ONLY folders a human may write to
  directly.** Every other write path into a `project-n01` folder — a
  human uploading a file, creating a folder, or editing `README.md`
  directly through the Vault UI or API — is rejected server-side
  (`writable: "system"` in `vaultFolderTypes.ts`; `canWriteToFolderType`
  fails closed for EVERY role, Admin/Super included). PhyLog's own
  server-side code is exempt because it calls the data layer
  (`vault.server.ts`'s `createFileRef`/`updateFileRef`/etc.) directly,
  never through the `api.vault.*` write routes this restriction gates.
- **Everything else is managed entirely by the PhyLog pipeline** —
  organized structure, filed attachments, pre-capture summaries, and the
  README body are all PhyLog's to create, move, and rewrite. Treat
  anything a human might have manually dropped into a project outside
  `skills`/`syncs` (from before this rule existed) as **disposable** — a
  `phylog reset` is explicitly allowed to delete it.
- Renaming/deleting/moving/sharing/publishing the `project-n01` folder
  ITSELF (not its content) is a separate, still-owner-writable concern —
  see the `vault` skill's write-policy section for the exact carve-out.
- A future **`newspapers`** space type (also inside a `project-n01`) is
  reserved for individual/daily newspapers PhyLog's post-capture stage
  will eventually generate — not implemented yet (`comingSoon: true`).
  Not to be confused with the already-shipped, unrelated
  `project-newspaper` skill's VIEW of a project's README.
- **`daily-logs/`** is a project-scoped space type too (NOT the same
  concept as the vault-wide `daily-logs` ROOT — see the `vault` skill's
  "Vault Folder Types" section) — pre-capture's own staging area, one
  subfolder per (day, contributor), that capture reads to decide how to
  organize the project. `writable: "system"`, same as the rest of a
  `project-n01` — not human-editable. See "Stage 1" and "Stage 2" below
  for the full data flow.

`ensureProjectN01`/`resolveProjectN01`
(`packages/robustness-core/src/data/projectN01.server.ts`) stamp + seed a
`project-n01` folder — called at CREATION time
(`createVaultFolder` for a new project, `ensureVaultRootFolders` for
`personal`) and LAZILY, as a self-healing retrofit for anything that
predates this type (`getProjectFolders`, and every PhyLog CLI/API entry
point's own `resolveProjectN01` call). Seeding creates a `skills` folder
(if missing) containing three default files — `PRE_CAPTURE.md`,
`CAPTURE.md`, `POST_CAPTURE.md` — one per pipeline stage below, each with
a sensible default body so a brand new project is immediately usable
without a human writing anything first.

### Reset — two distinct depths

`resetProjectN01Content` (`projectN01.server.ts`) deletes every direct
child of a `project-n01` folder EXCEPT its `skills`/`syncs`/`newspapers`
anchors (and everything nested under them) — "everything else is
disposable" made real. It ALSO clears this project's own Release Log
history (`clearReleaseLogForProject`, `releaseLog.server.ts`): those rows
describe state (filed attachments, past README versions, which
`daily-logs` entry was already captured) that a reset just invalidated,
so leaving them behind would make a later `capture --full` think
everything was already applied and silently skip reprocessing it.

A `wipeDailyLogs` option controls whether `daily-logs/` (pre-capture's
own staged output — see Stage 1 below) ALSO gets deleted, giving two
distinct commands for two distinct depths:

- **`nopal phylog reset`** (`wipeDailyLogs: false`, the default) — wipes
  everything capture manages (organized structure, filed attachments, the
  README), but leaves `skills`/`syncs`/`daily-logs` alone. Since
  `daily-logs/` already holds every Card's staged content, a plain
  `nopal phylog capture --project <path> --full` afterward rebuilds the
  whole project straight from what's already there — no need to re-run
  pre-capture, no new LLM calls for summaries that haven't changed.
- **`nopal phylog reset-pre-capture`** — the DEEPER reset: everything
  `reset` wipes, PLUS `daily-logs/` itself. Needed when pre-capture's own
  output should be regenerated from scratch (e.g. after editing
  `skills/PRE_CAPTURE.md` to change how summaries are written). Requires
  `nopal phylog pre-capture` (to restage `daily-logs/`) before
  `capture --full` has anything to rebuild from again.

Either reset is **always an explicit, separate operation** — never run
implicitly by anything else, including `capture --full` on its own
initiative conceptually being "the same idea". This is deliberate: a
human can inspect the emptied-out `project-n01` folder before deciding to
rebuild. `capture --full` internally calls the exact same
`resetProjectN01Content` itself (always with `wipeDailyLogs: false` — it
only ever rebuilds FROM `daily-logs/`, never wipes it), right before
reprocessing everything — so running `reset` first is optional, not
required, but useful whenever you want to verify the wipe alone.

**`README.md` is NEVER deleted by either reset depth -- only its BODY is
cleared, with its front matter preserved byte-for-byte**
(`withReadmeBody`, `project.types.ts`, with an empty new body -- the
same file also has `splitReadmeSections`/`joinReadmeSections`, the
line-based `## Heading` splitter/joiner capture's `update_section`/
`remove_section` tools are built on, see "Stage 2" above). A real,
confirmed bug this fixes: README's front matter is the ONLY place a
project's Sharing Roles (`sharing` — see the `vault` skill's Sharing
Roles section and `projectSharing.server.ts`) and lifecycle `status`
(`projectStatus.server.ts`) are stored. Before this fix, `resetProjectN01Content`
deleted README.md outright like any other disposable file — which meant
**every single `phylog reset`/`reset-pre-capture`/`capture --full`
silently revoked every collaborator's Sharing Role** (and reset the
project's status back to "active"), even though neither field is
PhyLog-generated content the way the README's BODY is. This is exactly
why a shared collaborator (e.g. Austin, given a Crafter role) could lose
the ability to run `phylog` commands on a project entirely after its
owner ran an ordinary reset — `getProjectRole` reads the role list
straight from the CURRENT README's front matter, with no caching layer,
so the moment the file's front matter was gone, so was the role.
Preserving front matter here costs nothing else: `captureOneDay` already
merges a fresh body into whatever front matter is already there via this
SAME `withReadmeBody` helper, so a later capture run rebuilds correctly
on top of it (confirmed directly: reset → `capture --full` → the rebuilt
README has both the newly generated body AND the original sharing list).
Not counted in `ResetSummary.deletedFiles` — the file's own identity and
metadata survive, only its generated content was cleared.

## The pipeline

```
project-n01 space (Cards in daily-logs, files in syncs/)
  -> STAGE 1: pre-capture   (preCapture.server.ts)
  -> STAGE 2: capture        (capture.server.ts)
  -> STAGE 3: post-capture   (postCapture.server.ts)
```

`nopal phylog run` (and `POST /api/phylog/run`, `runPhylogPipeline` in
`phylogAgent.server.ts`) runs all three, in order, for one project. Each
stage is ALSO independently runnable — `nopal phylog pre-capture` /
`capture` / `post-capture`, and their matching `POST /api/phylog/*`
routes — useful while iterating on a project's own skill files without
paying for the other stages every time.

**Entirely skill-driven, per stage**: each stage reads its own file inside
the project's `skills/` folder (`PRE_CAPTURE.md`, `CAPTURE.md`,
`POST_CAPTURE.md` — `getProjectStageSkill`, `projectN01.server.ts`) and
follows those instructions. A stage whose skill file's first non-blank
line is exactly `skip` (case-insensitive) — the seeded default for
pre-capture and post-capture — is a TOTAL no-op: no files are examined, no
model is ever called (`isSkipInstruction`). This is the "if nothing is
asked, nothing should be defined" design: PhyLog does nothing surprising
by default, and a project owner opts in by editing the relevant skill
file.

**Any OTHER file in `skills/`** — e.g. a `VOICE.md` a project's own
`CAPTURE.md` tells the model to "read and follow" — is auto-folded into
every pre-capture and capture prompt too (`listExtraSkillFiles`,
`projectN01.server.ts`), the same way the legacy general `SKILL.md` file
already is. This is deliberately NOT a tool call the model can skip:
capture's agent loop only has `create_folder`/`move_file`/`update_readme`,
nothing that reads arbitrary files, so a skill file that references a
companion doc by name would otherwise be asking the model to do something
it has no way to do. Reserved names (`PRE_CAPTURE.md`/`CAPTURE.md`/
`POST_CAPTURE.md`/`SKILL.md`) are excluded since those are already fetched
by name for their own purpose.

> Prior to this, a skill file that said "read VOICE.md" was a silent
> dead end — the model had no way to honor it, and nothing surfaced why a
> capture run then produced no README update. See the diagnostic logging
> note under Stage 2 below for the other half of that fix.

### Stage 1 — pre-capture (`preCapture.server.ts`)

TWO jobs, one UNCONDITIONAL and one skill-gated — this split matters, see
below:

1. **STAGING (unconditional in sweep mode)** — for every (day,
   contributor) that has a Card for this project
   (`listCardEntriesForProject`, `dailyLog.server.ts`), ensures that
   entry's own folder exists under the project's `daily-logs/` space
   (`getOrCreateDailyLogEntryFolder`, named `YYYY-MM-DD-<slug of
   contributor's name>` — cosmetic only, see below), keeps a plain-text
   copy of the Card's own content current there (`card.md`), and drops a
   visible COPY of every `::file{...}` attachment into that same folder
   (`copyFileIntoFolder` — a new `file_refs` row pointing at the same S3
   bytes, no duplication) so a human browsing `daily-logs/` sees the
   actual files waiting to be organized, not just a description of them.
2. **SUMMARIZATION (gated by `skills/PRE_CAPTURE.md`, default: skip)** —
   for every candidate that doesn't already have a matching
   `<name>-summary.md` (`summaryFileName`, `sorter.server.ts`) written for
   its CURRENT content, an LLM decides (grounded in the skill's own
   instructions, injected as context) whether and how to summarize it.
   Candidates come from two places:
   - Every Card attachment just staged above (summary written into that
     SAME `daily-logs/<date>-<person>/` entry folder, alongside the
     visible copy — never back into the contributor's own vault).
   - Every file inside this project's own `syncs/` folder tree, at any
     depth (summary written as an ordinary sibling there, unchanged from
     before — `syncs/` has no separate "staging" concept, since
     summarizing IS the only thing pre-capture does there).

   For each candidate:
   - An image gets a real vision call (`PhotoDescriber.describePhoto` —
     see "LLM provider architecture" below), the skill's instructions
     folded into the call's own text `context` alongside the human's
     caption (if any) and the Card's own content.
   - A file with readable text content (`file_refs.content`) gets a plain
     text-summarization call (`LlmProvider.complete`, no tools — just the
     skill's instructions as the system prompt).
   - Anything else (a binary file with no extracted text, not an image)
     is left unsummarized and reported as `unsupported` — there's
     genuinely nothing to feed the model.

**WHY staging is unconditional**: `skills/PRE_CAPTURE.md` is seeded
"skip" by DEFAULT for every new project, and `capture.server.ts` now
reads its OWN input exclusively from `daily-logs/`/`syncs/` (Stage 2
below) — if staging were ALSO skill-gated, a brand-new, still-default
project would never get any `daily-logs/` entries at all, and capture
would have nothing to organize. So `skills/PRE_CAPTURE.md` only ever
controls whether SUMMARIES get written — the raw Card text and
attachments always make it into `daily-logs/` regardless.

**Idempotent, at two levels**:
- A generated summary is keyed off a hash of the source file's own
  bytes/content (`content_hash`, falling back to `s3_key`/id) plus, for a
  Card attachment, its caption — stored in the summary's own front
  matter (`sourceHash`) and re-derived fresh each call. An unchanged
  file/caption pair is a total no-op; editing a caption or replacing a
  file's bytes invalidates the cached summary.
- A daily-logs entry folder's own manifest (`_meta.md`, written by
  `writeDailyLogEntryMeta`) carries an AGGREGATE `sourceHash` — the
  Card's own text plus every current attachment's hash, folded together
  — refreshed every pre-capture run regardless of whether any individual
  summary needed regenerating. This is what `capture.server.ts`'s OWN
  idempotency check keys off (see Stage 2's "Idempotency, precisely").

**Entry folder NAMING is cosmetic, never load-bearing.** A human-readable
name (`YYYY-MM-DD-<slug>`) is assigned once at creation for browsability,
but FINDING an existing entry again always happens by reading every
candidate folder's own `_meta.md` front matter and matching on
`(humanId, date)` — never by re-deriving or parsing the name. This means
a contributor's later display-name change, or two contributors who happen
to share a name, can never break idempotency or misattribute an entry.

**A real, shipped performance bug, found and fixed**: the sweep used to
call `getOrCreateDailyLogEntryFolder` once PER CARD, and that function
re-ran the ENTIRE `listDailyLogEntries` scan (every existing entry
folder, each needing its own `_meta.md` read) from scratch every time —
an O(cards × existing entries) blowup that got genuinely slow once a
project had real history (hundreds/thousands of sequential DB round
trips for a sweep that should take a handful). Fixed by splitting the
find/create halves apart: `listDailyLogEntries` is now called ONCE per
sweep (and internally resolves every entry folder in PARALLEL via
`Promise.all`, not one at a time), then each Card does a pure, in-memory
lookup (`findDailyLogEntry`) against that single fetched list, only
ever calling `createDailyLogEntryFolder` for a genuinely brand-new
(humanId, date) pair. `getOrCreateDailyLogEntryFolder` still exists as a
convenience wrapper around both for a caller handling just one lookup —
any future caller processing MANY entries in a loop should use the two
pieces directly instead, the same way `preCapture.server.ts` now does.

**Invocation shapes** (all one function, `runPreCapture`, different
options — mirrors the CLI's own flags):

- Individual file: pass `fileId` (CLI: `--file <vault-path>`) — a pure
  summarization debug path, fully skill-gated (skip means a true total
  no-op here), with NO daily-logs staging involved — there's no (day,
  contributor) context to stage an arbitrary single file into.
- One day's Cards: pass `date` (CLI: `--date YYYY-MM-DD`) — stages (and,
  unless skipped, summarizes) every contributor's Card for that specific
  date, plus, always, a syncs summary sweep.
- Everything (all history's Cards + syncs sweep): omit both — this is
  also the natural "end of day, sweep everything new" shape, since a
  repeat call only ever acts on what's actually new/changed.

**CROSS-HUMAN BY DESIGN** (same as Stage 2): sweep mode processes every
contributor's Cards for this project, not just whoever's running the
command — see Stage 2's own "Cross-human by design" note, which applies
identically here.

### Stage 2 — capture (`capture.server.ts`)

Reads its input exclusively from `daily-logs/` and `syncs/` — NEVER the
live Card or a contributor's own vault directly (a real, deliberate
behavior change from capture's earlier design, which read `card.content`
straight off the Card). Two parts, run per DAILY-LOGS ENTRY (one per
day+contributor Stage 1 has already staged — `listDailyLogEntries`,
oldest first):

1. **Deterministic filing** (`sorter.server.ts`'s `fileCardAttachments`,
   unchanged, zero-inference, still sourced from the ORIGINAL Card, not
   the daily-logs entry's own staged copy — see "Why filing still reads
   the original Card" below) — every not-yet-filed `::file{...}` Card
   attachment lands in the project's root. Independent of anything the
   model decides below.
2. **Organize + README** — an LLM agent loop, driven by
   `skills/CAPTURE.md` (default: file everything into the root, keep
   README a plain index — see `DEFAULT_CAPTURE_SKILL`). Given the
   project's CURRENT file tree (everything EXCEPT `skills/`/`syncs/`/
   `newspapers/`/`daily-logs/`, which capture never even shows the model,
   let alone touches), the entry's own staged Card text (`card.md`, read
   straight from its `daily-logs/<date>-<person>/` folder) and pre-capture
   summaries (same folder), and the current README, the model may call:
   - `create_folder({ path })` — mkdir -p, relative to the project root.
   - `move_file({ name, destinationPath })` — relocate an already-filed
     file by name.
   - `write_file({ path, chunk, done })` -- create or fully replace a
     markdown REFERENCE file (any name except README.md) relative to the
     project root, for splitting out substantial, topic-specific detail
     (a full build log, a long spec) so it doesn't have to live inline in
     a section -- link to it from there instead.
   - `update_section({ heading, chunk, done })` -- **the PRIMARY way to
     change the README.** Replaces (or creates) ONE section, identified
     by its exact `## Heading` text (`heading: ""` addresses the INTRO --
     everything before the first `## `, including any title). Most days
     touch one or a few sections, not the whole document; this bounds an
     edit's blast radius to just the section that actually changed.
   - `remove_section({ heading })` -- deletes one section entirely. A
     deliberate, EXPLICIT action, distinct from `update_section` with
     empty content (which is refused -- see the safety net below).
   - `update_readme({ chunk, done, reason })` -- replaces the ENTIRE
     README body at once. Reserved for genuine full reorganizations (the
     file has become hard to navigate, section boundaries themselves
     need to change) or the very first pass on an empty README --
     the system prompt explicitly tells the model NOT to reach for this
     as the default way to make an ordinary update.

   `write_file`/`update_section`/`update_readme` all take their content
   as ONE OR MORE chunks rather than a single all-at-once string: on a
   normal day `chunk` is the whole content and `done` is `true` in one
   call, but a long update can instead be sent as several calls in a row
   (each `chunk` continuing directly from the last, `done: true` only on
   the final one). This exists because these tools are otherwise single
   responses capped at the provider's own output token limit -- content
   regenerated in one shot can get cut off mid-generation (see the safety
   net below), and chunking keeps any ONE call safely short regardless of
   the total length. `write_file`/`update_section` are keyed by
   `path`/`heading` respectively, so multiple chunk calls for the SAME
   target accumulate into that target's own buffer; `update_readme` has
   exactly one target so its chunks just accumulate in order.
   `runAgentLoop`'s `maxTurns` was raised 6 -> 16 for capture
   specifically to leave room for a chunked update on top of any
   `create_folder`/`move_file` calls. `remove_section` takes no content,
   so it never needs chunking.
   `create_folder`/`move_file`/`write_file` refuse to target `skills`/
   `syncs`/`newspapers`/`daily-logs` by name -- those subtrees are
   permanently off limits to this stage, and `write_file` additionally
   refuses `README.md` itself (use `update_section`/`update_readme` for
   that).

   The model has NO tool for reading an arbitrary file by name -- it only
   ever sees filenames in the tree, never their content, except for what's
   assembled into the prompt above. Any `skills/` file besides the four
   reserved pipeline names (a `VOICE.md`, say) is therefore auto-folded
   into the prompt directly (`listExtraSkillFiles`) rather than left for
   the model to "go read" -- see the pipeline-wide note above. When a
   day's run produces no README change and no `create_folder`/
   `move_file`/`write_file` call, the model's own final turn of plain
   text (its stated reasoning for doing nothing) is logged verbatim
   (`capture: <date> -- no README update or reorganization; model said:
   ...`) so "why didn't this update" is diagnosable from `nopal phylog
   capture`'s own output, instead of a silent no-op.

   **README-mutating tools commit IMMEDIATELY, sharing one mutable
   `currentReadmeContent`/`currentReadmeFileId` pair** (`captureOneDay`)
   -- calling `update_section` twice, or `update_section` then
   `update_readme`, in one day's loop always builds on the PREVIOUS
   tool's own result, never a stale pre-loop snapshot. This is also WHY
   the safety net below no longer needs a separate "apply afterward"
   step: nothing commits until a complete, validated result arrives, so
   an incomplete/truncated attempt simply never writes anything, by
   construction. At the end of the day's loop, ONE Release Log entry
   covers the CUMULATIVE change (`readmeContent` before vs.
   `currentReadmeContent` after), with a summary combining every
   individual edit description (`readmeEditSummaries`) -- not one entry
   per section touched.

   **The safety net (a bad call can wipe real content -- confirmed
   live, back when `update_readme` was the ONLY, single-shot way to
   change the README: a project with real accumulated history hit
   Anthropic's `stop_reason: "max_tokens"` mid-generation of that one
   tool call's JSON, which under the old 4096-token cap produced an
   empty `newBody`, applied unquestioned):**
   - **`runAgentLoop` never executes a truncated turn's tool calls at
     all.** If a turn's `stopReason` is `"max_tokens"`, the loop discards
     that entire response (it may contain incomplete or corrupted
     arguments, since its own JSON may never have finished streaming) and
     stops -- whatever earlier, COMPLETE turns already committed stands.
     This is what actually stops a bad chunk from ever reaching disk; the
     `truncated` flag it returns is purely informational, for the
     `capture: <date> -- the model's generation was cut off ...` log line.
   - **Each tool refuses to commit an incomplete or empty result.** A
     chunk sequence that never gets a final `done: true` (ran out of
     turns, or the model simply stopped) just leaves its buffer
     un-flushed -- nothing is ever written for it. A `done: true` call
     whose assembled content is blank is refused OUTRIGHT (`hadRefusal`)
     whenever it would erase real, existing content (a section that
     currently has text, or the whole README when the CURRENT body or
     today's own Card/summary content is non-empty) -- a legitimately
     empty target is only possible when there was nothing there yet.
     Because the blast radius is now ONE SECTION instead of the whole
     document, a refusal (or an incomplete attempt on one section) never
     blocks other sections' edits from committing in the same run.
   A refused/incomplete call leaves its target byte-for-byte unchanged,
   is logged inline as it happens, and (via the `incomplete` flag on that
   day's `phylogMetrics` event -- see "A refusal is an error too" under
   Usage tracking) does NOT get recorded as fully "applied" -- so the
   SAME entry is retried on the next `nopal phylog capture` run rather
   than being silently skipped forever. `DEFAULT_MAX_TOKENS` in
   `anthropicProvider.server.ts` was also raised 4096 -> 8192 to make
   hitting this less likely in the first place, though section-scoped
   edits (chunked when needed) are what actually remove the ceiling.

**Why filing still reads the original Card, not the daily-logs entry's
own staged copy**: `fileCardAttachments` is SHARED with the Sorter
(`sorter.server.ts`'s `sortDailyLog`, `nopal sort run`), which files
attachments straight from the original Card into the project root using a
`sourceRef` keyed off the ORIGINAL attachment's own fileId. If capture
instead filed the daily-logs entry's own COPY (a different fileId, made
by pre-capture), the two would no longer agree on identity and could each
file a separate copy of the same photo into the project root. Keeping
capture's deterministic-filing step pointed at the original Card preserves
that existing dedup guarantee untouched; only the AGENT's own context
(Card text + summaries) moved to `daily-logs/`.

**Idempotency, precisely**: each daily-logs entry's own `_meta.md` carries
a `sourceHash` (an aggregate hash of the Card's text plus every current
attachment, refreshed by pre-capture every run — see Stage 1). Capture's
own Release Log `source_ref` is `${entryFolderId}:${sourceHash}` — a
plain `findReleaseLogEntryBySource` lookup, no AI involved, decides
whether an entry needs (re)processing at all. This replaces the OLDER
scheme (`${cardFileId}:${hashOfCardContent}`, computed by capture itself)
now that pre-capture already computes and stores an equivalent hash as
part of staging — same idempotency guarantee, just relocated to where the
content already gets touched.

A Card can vanish out from under an already-staged entry (deleted, or
edited out of that day's `readme.md`) — filing (part 1 above) is simply
skipped when that happens; the organize/README agent (part 2) still runs
off whatever's already staged in `daily-logs/`, since that's its only
source of truth regardless of the live Card's own fate.

**The model is told about OxMarkdown's directives** (`DIRECTIVE_GUIDE` in
`capture.server.ts`, injected into the system prompt every call) so it can
write real directive syntax instead of plain bullet-list links —
especially `::gallery{folder="<name>" title="..."}`, which renders every
image inside a project-root subfolder as a titled photo grid. The usual
pattern: `create_folder` a plain, SINGLE-level name (e.g. "Hip
Installation" — the directive only resolves DIRECT children of the
project root, never nested paths), `move_file` the relevant photos into
it, then reference that folder by name from `update_readme`.
`::csv-table{file="..."}`/`::svg{file="..."}` are mentioned too, for
completeness. All three are resolved server-side by
`project.server.ts`'s `resolveProjectManifest` — the SAME mechanism the
`project-newspaper` skill's page already used, now ALSO wired into the
Vault's own file-view page (`fruits_.vault.tsx`): viewing a `project-n01`
folder's own README (either by browsing into the folder, or via
`?file=<readmeId>` directly) resolves and renders through `ProjectView`
instead of a directive-blind plain `MdxEditorView`, so a gallery PhyLog
writes actually displays as photos wherever a human looks at it, not as
an "unknown directive" marker. This is a `project-n01`-specific carve-out
(checked via `folder_type === "project-n01" && is_folder_type_root`) —
every OTHER markdown file in the Vault renders exactly as before.

**Two modes** (`runCapture`'s `full` option; CLI: `--full`):

- **Incremental** (default) — walks every daily-logs entry this project
  has, SKIPPING any already recorded (idempotent against that entry's own
  `_meta.md.sourceHash` — see "Idempotency, precisely" above)."Just the
  entries that haven't been applied yet."
- **Full** — calls `resetProjectN01Content` FIRST with `wipeDailyLogs:
  false` (see "Reset" above — `daily-logs/` itself is deliberately NOT
  wiped here), then walks every entry from scratch (nothing is "already
  recorded" anymore, since reset also clears this project's Release Log
  history). Rebuilds straight from whatever's already staged — no need to
  re-run pre-capture first.

**CROSS-HUMAN BY DESIGN — sweeps every collaborator's daily-logs entries,
not just whoever's running the command.** `listDailyLogEntries`
(`projectN01.server.ts`) enumerates every (day, contributor) entry staged
for this project across EVERY human whose Card was ever pre-captured, not
merely the acting human passed into `runCapture`/`runPreCapture` (that
parameter now only matters for a handful of invoker-scoped bookkeeping
calls, e.g. the "agent not configured" early return — it no longer
restricts which entries get discovered). Each entry is then processed
under ITS OWN humanId (filing via `fileCardAttachments`, the
organize/README agent loop, usage tracking, and regenerating THAT
human's own `daily-logs/<date>/release-log.md` — note this is the
vault-wide per-HUMAN `daily-logs` root, a different concept from the
per-PROJECT `daily-logs` folder type this whole stage reads from) — a
single date can legitimately produce multiple `CaptureDayResult`s if
several collaborators each wrote their own Card for it. This isn't a new
trust boundary: a Card was already cross-human safe by construction (any
Sharing Role, including Observer, may write one for a project they can
see — see "Cards" in the `vault` skill — and `sorter.server.ts`'s
`fileCardAttachments` already filed a collaborator's attachments into the
project without needing write access to their vault); capture used to
silently defeat that by only ever looking at the CALLER's own Cards,
which meant a project owner's `phylog capture` run could never see a
collaborator's Card, no matter how many times it ran. `nopal phylog
capture --project <path>` (or `run`/`pre-capture`) now always applies
everyone's outstanding entries for that project in one pass, regardless
of who invokes it — always safe to run, same as before, just no longer
scoped to one identity.

**Release Log integration**: a day that produces a README change gets an
`"ai-update"` entry with a real `content-edit` changeset (revertible via
`nopal release-log revert`, same machinery every other project-file
mutation uses). A day with reorganization but no README change still gets
an entry (for visibility in the project's own receipt) but with NO
changeset — **`create_folder`/`move_file` actions are not currently
individually revertible**, only reported in the entry's summary text. Not
solved, flagged on purpose (same spirit as the `vault` skill's own
chained-edit replay caveat).

### Stage 3 — post-capture (`postCapture.server.ts`)

Gated by `skills/POST_CAPTURE.md` (default: skip). A deliberate
placeholder today — when the skill file isn't "skip", this only REPORTS
that instructions exist; no model call is made and no tools are wired up
yet, since there's genuinely nothing for it to do. Exists so the
pipeline's SHAPE (pre-capture -> capture -> post-capture) is already real
and callable ahead of defining what runs here. The first planned use is
generating the `newspapers` space (an individual/daily digest built from
what capture just produced) — see "project-n01 spaces" above.

## LLM provider architecture

`llmProvider.ts` has NO server-only imports (safe to import from
anywhere) and defines two small, deliberately separate interfaces:

- **`LlmProvider`** — `complete({ system, messages, tools })`, a
  provider-agnostic multi-turn TOOL-CALLING exchange. Used by capture's
  organize/README agent loop, and by pre-capture's plain text
  summarization calls (with `tools: []`).
- **`PhotoDescriber`** — `describePhoto({ imageBase64, mediaType, context })
  -> string`, a plain single-turn VISION call, no tools, no message
  history. Used by pre-capture's image summarization.

These are kept separate rather than folding an optional image param into
`complete` because the two calls share nothing else: no tools, no
multi-turn loop, no system-prompt swapping — just "describe this photo,
given this context".

`anthropicProvider.server.ts`'s `AnthropicProvider` is the first, and
today only, implementation of BOTH interfaces, off one shared
`@anthropic-ai/sdk` client instance. A second provider (a different
vendor) is a new file implementing either or both interfaces — never a
change to the pipeline stage files themselves. `isPhylogAgentConfigured()`
gates on `ANTHROPIC_API_KEY` being set — same "absent env var = disabled"
convention `SORTER_ENABLED` already established, so a fresh deploy never
spends money on an LLM call (vision, tool-calling, or plain completion)
until explicitly configured. `PHYLOG_ANTHROPIC_MODEL` overrides the
default model (`claude-sonnet-5`, upgraded from `claude-sonnet-4-5-20250929`)
everywhere.

### Prompt caching

On by default, no config flag, but DELIBERATELY SELECTIVE -- see "is
it worth it" below for why blanket-always-on was tried and reconsidered.
Entirely inside `AnthropicProvider.complete` (`anthropicProvider.server.ts`),
so both call sites (capture's agent loop AND pre-capture's text
summarization) get it with zero changes at their own call sites beyond
passing one hint. Two cache_control breakpoints:

- **The system prompt is marked only when reuse is actually expected.**
  `complete`'s optional `cacheSystemPrompt` flag (`llmProvider.ts`) is a
  hint from the CALLER, who knows things a single call can't: `runCapture`
  passes `entries.length > 1` (this project has more than one
  day/contributor entry to process in this run, so `skillContent`'s
  identical system prompt WILL be resent), `runPreCapture` passes
  `candidates.length > 1` (same idea, more than one file to summarize).
  A single-entry/single-file run passes `false` -- no reuse is coming,
  so there's nothing to gain from paying the write premium. (Since
  tools+system precede messages in the request, marking system ALSO
  covers the static tool definitions as part of the same cached prefix,
  for free, whenever it IS marked.)
- **The last message is marked once a call is already mid-multi-turn**
  (`messages.length > 1`, computed inside `complete` itself, not a
  caller hint -- a provider-level fact, not something the caller
  decides). A turn-1 call doesn't yet know if there'll be a turn 2, so
  marking it there would risk a wasted premium on the (likely dominant,
  given capture's own "do nothing on a quiet day" bias) single-turn
  case. From turn 2 on, we're already committed to a multi-turn
  exchange -- marking the newest message means turn 2 reads everything
  through turn 1 from cache, turn 3 reads through turn 2, and so on.

**"Is it worth it, or should we only cache specific scenarios" -- yes,
and this IS the specific-scenarios version**, arrived at after
reconsidering an earlier always-on design: a project processing exactly
one fresh entry, whose agent loop finishes in exactly one turn (the
most common case by the pipeline's own design -- most days need no
README change) would have paid TWO write premiums (system AND the
whole first user prompt, likely the bulk of that call's input tokens)
for ZERO read benefit under blanket caching. The two conditions above
exist specifically to eliminate that loss while keeping the real wins:
backlog processing (many days/files sharing one project run) and any
genuinely multi-turn day (a chunked large update, several organize
actions).

**Negatives, plainly:**

- A cache WRITE costs ~25% MORE than an ordinary input token for that
  prefix -- only worth it if something reads it back before the cache
  expires. This is exactly what the two conditions above exist to avoid
  paying when there's no realistic chance of a read.
- `photoDescriber.describePhoto` (vision calls) is DELIBERATELY NOT
  wired into any of this -- its system prompt is a short, fixed ~100
  tokens, almost certainly under Anthropic's ~1024-token minimum for
  caching to engage at all, so there was nothing to gain from touching
  it.
- The cache is an exact-content match with a short idle TTL (5 minutes
  by default, refreshed on every hit). A gap longer than that between
  calls, or ANY change anywhere in the cached prefix (editing
  CAPTURE.md/VOICE.md mid-run, a different day's tree/README content),
  is simply a miss -- falls back to a normal-priced write, no penalty
  beyond that.
- **There is no manual "clear the cache" operation, and none is needed.**
  Anthropic's cache is a pure function of the exact cached bytes; it
  can't go stale in a way that serves wrong content, and it expires on
  its own. The only way to force a miss is to change the underlying
  content, which already happens naturally whenever a skill file is
  edited.

**Cost accounting**: `LlmUsage.cacheReadTokens`/`cacheWriteTokens`
(already returned by `AnthropicProvider`, previously unused) now flow all
the way through: `recordPhylogUsage` persists them on both
`phylog_usage_events` and the `phylog_usage_daily` rollup, and
`llmPricing.ts`'s `estimateCostUsd` takes them as two extra (optional,
default-0) arguments, pricing a cache write at 1.25x and a cache read at
0.1x the model's own `inputPerMTok` -- Anthropic's fixed ratios, the same
across every model that supports caching, so they live once in
`llmPricing.ts` rather than per-model. `/fruits/maker/phylog` shows Cache
Read/Write Tokens and a Cache Hit Rate stat alongside the existing
token/cost cards, so the savings (or a write-heavy, rarely-reused pattern
that ISN'T saving anything) are visible, not just assumed.

## CLI / API surface

All thin clients over the pipeline stage functions — all real logic lives
server-side (`phylogAgent.server.ts`/`preCapture.server.ts`/
`capture.server.ts`/`postCapture.server.ts`/`projectN01.server.ts`).
ALWAYS APPLIES — no `--apply` flag, no `dryRun` anywhere.

```
nopal phylog run --project <path> [--full] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
nopal phylog pre-capture --project <path> [--date YYYY-MM-DD] [--file <path>]
nopal phylog capture --project <path> [--full] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
nopal phylog post-capture --project <path>
nopal phylog reset --project <path> --yes
nopal phylog reset-pre-capture --project <path> --yes
```

- `--project` — vault path, e.g. `projects/sunny`, or `personal`.
- `run` — all three stages in order. `--full` forwards to capture's
  full-rebuild mode (pre-capture/post-capture have no "full" concept of
  their own — pre-capture already sweeps everything when `--date`/`--file`
  are omitted; post-capture is project-wide, not date-scoped).
- `pre-capture` — omit both `--date` and `--file` to sweep everything.
  Stages `daily-logs/` content unconditionally; only summary GENERATION is
  skill-gated (see Stage 1 above).
- `capture` — `--full` resets (keeping `daily-logs/`) first, then
  reprocesses every entry from scratch; default is incremental (only
  unapplied entries). `--since`/`--until` bound the date range either way.
- `reset` — destructive; requires `--yes`. Leaves `skills`/`syncs`/
  `daily-logs` untouched. Prints a reminder to run `capture --full`
  afterward.
- `reset-pre-capture` — the DEEPER reset; also destructive, requires
  `--yes`. ALSO wipes `daily-logs/` (still leaves `skills`/`syncs`).
  Prints a reminder to run `pre-capture` (to restage) then
  `capture --full` (to rebuild) afterward.

Every CLI command resolves `--project` to a folder, then **enqueues a job
and polls for it** — see "Scaling & Process Isolation" below for why.
The API route returns immediately (`202` + `{ jobId }`); the CLI then
polls `GET /api/phylog/jobs/:jobId` on a ~1.2s interval, printing new
progress-log lines as they arrive (the endpoint always returns the FULL
cumulative log, not a delta — the CLI tracks how many lines it's already
printed and slices client-side), until the job reaches `completed` (then
prints a human-readable summary of the result, not a raw JSON dump) or
`failed` (then prints the failure reason and exits non-zero). This is
real progress, not real-time token-by-token streaming — a line appears
per file/day/stage processed (via the `onProgress` callback threaded
through every stage), which is what matters for a `run`/`capture --full`
spanning many days.

API: `POST /api/phylog/run` (`{ projectFolderId, full?, since?, until? }`),
`POST /api/phylog/pre-capture` (`{ projectFolderId, date?, fileId? }`),
`POST /api/phylog/capture` (`{ projectFolderId, full?, since?, until? }`),
`POST /api/phylog/post-capture` (`{ projectFolderId }`), `POST
/api/phylog/reset` (`{ projectFolderId }`), `POST
/api/phylog/reset-pre-capture` (`{ projectFolderId }`) — each of these ENQUEUES
(`phylogQueue.server.ts`) and returns `202` immediately, never runs the
pipeline inline. `GET /api/phylog/jobs/:jobId` polls one job's status.
All require an owner-tier Sharing Role on the project (or being the
project/`personal`'s own owner) — there is no lower-bar preview tier
anymore now that every call commits; `nopal sort run` remains the
lower-bar path (any role) for the Sorter's own, zero-inference filing.
This gate is about who may TRIGGER a run, not whose content it processes:
once triggered, pre-capture/capture sweep every collaborator's Cards for
the project (see "Cross-human by design" above), not just the invoker's
own.

## Scaling & Process Isolation

A PhyLog run can legitimately take minutes (LLM calls, vision on every
synced photo, multi-day capture). Running that inline inside an HTTP
request handler means one slow/hung/crashed run degrades the ENTIRE web
server for every human, not just the one who triggered it — a
single-process web server has no isolation between one request and
everyone else's. So PhyLog work is queued and runs in a dedicated process:

- **`phylogQueue.server.ts`** — BullMQ over Redis (a separate piece of
  infrastructure from the app's own SurrealDB, on purpose: queue
  infra load/failure shouldn't be entangled with the primary database's).
  `enqueuePhylogJob(name, data)` adds a job; `getPhylogJobStatus(jobId)`/
  `getPhylogJobOwner(jobId)` read it back. Jobs use `attempts: 1` — no
  automatic retry, because each pipeline call is already internally
  idempotent (see "Incremental vs full" above and pre-capture's own
  skip-if-summary-exists check), so a human re-running the CLI is the
  correct retry path; an automatic retry could race a still-in-flight
  attempt and reintroduce a duplicate-write bug already fixed once.
- **`packages/worker`** — its OWN pnpm workspace package (`worker.ts`,
  run via `pnpm --filter worker run start`, i.e. `vite-node worker.ts`),
  NOT part of `webapp` at all. Drains the queue and calls the exact same
  pipeline functions (from `robustness-core`) the web app used to call
  inline — zero rewrite of pipeline logic, only WHERE it runs (and which
  dependency graph it ships with) changed. Runs with `concurrency: 1`
  deliberately: scale throughput by running more worker PROCESSES/
  machines, not by raising in-process concurrency.
- **`acquireProjectPhylogLock` (`phylogQueue.server.ts`)** — a plain
  Redis `SET NX PX` lock, keyed by `projectFolderId`, held by
  `worker.ts`'s `processJob` for the ENTIRE duration of a job's actual
  pipeline work (run/pre-capture/capture/post-capture/reset/
  reset-pre-capture all take it — every one of them mutates the same
  project-n01 tree). `concurrency: 1` alone only guarantees "never twice
  at once WITHIN one process" — this is what keeps two DIFFERENT worker
  PROCESSES (the documented scaling path above) from ever running the
  SAME project's pipeline concurrently and racing on the same
  README/daily-logs content. A second job for an already-locked project
  POLLS (every 3s, logging a "waiting..." line) rather than failing or
  running anyway, giving up only after 30 minutes (almost certainly a
  wedged holder, not a real run). The lock's own TTL (10 minutes) is the
  backstop for that case — a crashed holder can't wedge a project's
  pipeline forever. Validated directly against a scratch Redis: a second
  acquire genuinely waits for the first's release, a double-release is a
  safe no-op, and two DIFFERENT projects never block each other.
  DELIBERATELY simple (a hand-rolled lock, not BullMQ Pro's paid "job
  groups" feature) — revisit only if evidence shows it's insufficient.
- **The CLI polls, it doesn't stream** — see "CLI / API surface" above.

**Why `packages/worker`/`packages/robustness-core`/`packages/oxmarkdown-core`
are separate pnpm workspace packages, not just a separate process sharing
`webapp`'s `package.json`** (an earlier, since-abandoned version of this
setup did exactly that): the worker's own dependency graph (BullMQ, the
Anthropic/AWS SDKs, SurrealDB, a few small markdown-parsing packages) is a
small fraction of `webapp`'s (React, MDXEditor, PDFKit, Express, webauthn,
etc. — none of which any pipeline file ever imports). Sharing one
`package.json` meant the worker's deploy always carried ALL of `webapp`'s
dependencies too, since `npm prune --omit=dev` only removes true
devDependencies, not "unused by this specific entrypoint" — measured at
~322MB of `node_modules` shared, of which the worker's OWN real footprint
was only ~100MB. Splitting into real pnpm workspace packages (root
`pnpm-workspace.yaml`; see `robustness-core/package.json`'s explicit
`exports` map for the subset of `app/data` that moved) plus
`pnpm --filter worker deploy --prod` (which produces a genuinely pruned,
standalone `node_modules` for just that package) gets the real win: a
deployed worker image with `node_modules` around 100MB, zero
React/MDXEditor/PDFKit/etc, confirmed via `packages/worker/Dockerfile`.
`packages/oxmarkdown-core` exists as ITS OWN third package (not folded
into `robustness-core`) specifically because it's consumed by BOTH
`webapp` (the editor/renderer) and `robustness-core` (the pipeline) — it
can't live inside either one without the other reaching across a package
boundary the wrong way.

**Deployment**: `webapp` and `packages/worker` are now separate Fly
apps (`webapp/fly.toml` / `packages/worker/fly.toml`), each with its own
Dockerfile — but BOTH need the build context to be the REPO ROOT (not
their own directory), since both depend on the `robustness-core`/
`oxmarkdown-core` workspace packages:

```
fly deploy . --config webapp/fly.toml --dockerfile webapp/Dockerfile
fly deploy . --config packages/worker/fly.toml --dockerfile packages/worker/Dockerfile
```

(`make deploy` runs both, from the repo root.) Locally, `docker-compose.yml`
has `redis` and `worker` services alongside `webapp` — each bind-mounts
the WHOLE repo root (pnpm needs to see every workspace package), with its
own complete set of `node_modules` volumes so the two containers'
`pnpm install`s never race on shared files.

**Deliberately polyglot-ready**: nothing about the job schema
(`PhylogJobName`/`PhylogJobData`, plain JSON) assumes a Node worker
consumes it. This is a real long-term direction — the CLI (Rust) and
future native macOS/Windows apps already live in Rust, and a Rust server
for CPU-bound or high-throughput work is a plausible future step — but
not one taken now for lack of concrete evidence it's needed. If a future
job type ever earns a Rust worker, that worker would poll this SAME Redis
queue for its own job name, running alongside the Node worker with zero
disruption to anything else. Treat this as Phase 0 of a staged plan:
Phase 0 (this — decouple long-running work from the request cycle, still
all Node) → Phase 1 (split the web/API deployables further, still Node)
→ Phase 2 (port specific hot paths to Rust, only if evidence supports
it). Don't jump ahead of the phase the evidence supports.

## Usage tracking

Every LLM call PhyLog makes is recorded via `phylogMetrics.server.ts`'s
`recordPhylogUsage` — tokens and timing ONLY, deliberately anonymized for
"understand aggregate usage over time," never a forensic log of what any
one run did (no file names, no prompt/response content, no raw error
text — errors are classified into a small closed set via
`classifyLlmError`). Two tables:

- `phylog_usage_events` — one row per LLM call (or skipped/errored
  attempt). Short-lived on purpose: pruned past a 30-day retention window
  (`pruneOldPhylogUsageEvents`, `POST /api/phylog/usage-cleanup`, same
  `CRON_SECRET` cron pattern as `archive-cleanup`/`trash-cleanup`, wired
  into `server.js`).
- `phylog_usage_daily` — one row per (date, human, project, stage),
  incremented at the SAME time every raw event is written (no separate
  batch rollup step). This is the durable table — tiny (bounded by
  active humans/projects/days, not by files processed), kept
  indefinitely, and what the dashboards below actually read, so pruning
  the raw table never loses the ability to show usage trends over time.

`getPhylogUsageSummary(days)` aggregates the daily rollup for a given
range (calls/tokens/duration, broken down by stage/project/human/date) —
read by `/fruits/maker`'s own "PhyLog Usage" summary section and its
linked deep-dive page, `/fruits/maker/phylog` (both Admin/Super-gated,
same as the rest of the Maker dashboard).

Each stage records exactly one event per meaningful unit of work: one per
file pre-capture attempts to summarize (`preCapture.server.ts`), one per
day capture runs its organize/README agent loop for (`capture.server.ts`
-- usage/duration accumulated across every turn of that loop, via
`runAgentLoop`'s own return value), and one per post-capture invocation.
Capture's per-day agent loop is wrapped in its own try/catch
(`captureOneDay`) so one bad day (a rate limit, a transient error) can't
abort the rest of a multi-day run -- mirrors the per-file resilience
`preCapture.server.ts` already had. A metrics write failing never breaks
the PhyLog run it's describing (`recordPhylogUsage` swallows its own
errors).

**A refusal is an error too, not a quiet no-op.** A thrown exception
(a real API failure, a network blip) is the only case `classifyLlmError`
handles -- but capture's own safety net (refusing a truncated, never-
finished, or wrongly-empty `update_readme`/`write_file` result -- see
Stage 2 above) and a run hitting its own turn budget (`hitMaxTurns`)
BOTH return normally, without throwing. Left alone, those would look
identical to a legitimately quiet day on `/fruits/maker` -- no error,
just nothing happened. `captureOneDay` now decides this event's outcome
AFTER computing its own refusal/truncation/turn-limit checks, not before:
any of `truncated`, `hitMaxTurns`, or a non-null `refusalReason` makes it
`outcome: "error", errorKind: "incomplete"` instead of `"success"`, so it
counts against the SAME "Errors" stat both Maker pages already show --
no new UI was needed. `preCapture.server.ts`'s text-summary path got the
analogous fix: a summary generation that hits `stop_reason: "max_tokens"`
is now discarded and recorded as `"incomplete"` rather than saved as if
it were a finished summary (the file is simply left unsummarized, so the
next pre-capture run retries it).

**Known limitation**: the daily rollup stores sums and a `maxDurationMs`
per bucket, not a real distribution — a true p95/p99 needs the raw
events, which are pruned after 30 days. Revisit if tail latency ever
needs closer tracking than "worst call that day."

### Estimated cost (`llmPricing.ts`)

Anthropic has no public "current price for model X" API — the closest
thing, the Usage & Cost Admin API
(`GET /v1/organizations/cost_report`), reports ACTUAL BILLED SPEND after
the fact (not a price list) and requires a separate Admin API key plus
organization-level Console access this app doesn't have configured. So
`llmPricing.ts`'s `MODEL_PRICING` table is hand-transcribed from
https://platform.claude.com/docs/en/about-claude/pricing, with a
`PRICING_AS_OF` date bumped whenever it's re-verified. There's no way to
auto-refresh it, only to flag it: `isPricingStale()`/`pricingAgeDays()`
(>30 days old) surface a warning `Badge` on both dashboards prompting a
human to go re-check the pricing page and bump the constant — "re-fetch"
in spirit, since there's no real fetch to do.

`model` is now part of the daily rollup's own bucket key (not just a
stored field) so a future model change shows up as a new bucket with its
own correct price, rather than blending two price points into one row.
`getPhylogUsageSummary` applies `estimateCostUsd` per row at aggregation
time and sums into `estimatedCostUsd` (overall, per stage, per project,
per human, per day) — a rough gauge for "how much are we spending,"
deliberately never presented as a reconciled bill.

## Files

Most of PhyLog's own logic lives in **`packages/robustness-core`**, a
pnpm workspace package — NOT under `webapp/app/data` anymore. See
"Scaling & Process Isolation" below for why, and its own module doc
(`phylogQueue.server.ts`) for the full reasoning.

- `packages/robustness-core/src/data/projectN01.server.ts` —
  `project-n01` seeding/retrofit (`ensureProjectN01`/`resolveProjectN01`),
  default skill file content, `resetProjectN01Content`
  (`wipeDailyLogs` option), `getProjectStageSkill`/`isSkipInstruction`/
  `listExtraSkillFiles`, and the `daily-logs` space's own
  find/create/list/manifest helpers (`ensureProjectDailyLogsFolder`,
  `getOrCreateDailyLogEntryFolder`, `listDailyLogEntries`,
  `writeDailyLogEntryMeta`, `CARD_COPY_FILE`/`DAILY_LOG_ENTRY_META_FILE`).
- `packages/robustness-core/src/data/preCapture.server.ts` — stage 1.
- `packages/robustness-core/src/data/capture.server.ts` — stage 2
  (deterministic filing via `sorter.server.ts`'s `fileCardAttachments`,
  plus the organize/README agent loop and its tools).
- `packages/robustness-core/src/data/postCapture.server.ts` — stage 3
  (placeholder).
- `packages/robustness-core/src/data/phylogAgent.server.ts` —
  orchestrates all three stages (`runPhylogPipeline`) and `resetProject`.
- `packages/robustness-core/src/data/sorter.server.ts` —
  `fileCardAttachments` (shared with the Sorter), plus the shared
  `summaryFileName`/`isImageContentType` helpers pre-capture also uses.
- `packages/robustness-core/src/data/llmProvider.ts` — provider-agnostic
  interfaces (`LlmProvider`, `PhotoDescriber`), no server-only imports.
- `packages/robustness-core/src/data/anthropicProvider.server.ts` — the
  one real provider today, implementing both interfaces.
- `packages/robustness-core/src/data/file.server.ts`'s
  `downloadFileBytes` — the one server-side-direct (non-presigned) S3
  read in the app, used only by pre-capture's image summarization.
- `packages/robustness-core/src/data/phylogQueue.server.ts` — the BullMQ
  queue (see "Scaling & Process Isolation" below).
- `packages/robustness-core/src/data/phylogMetrics.server.ts` — usage
  tracking (see "Usage tracking" above).
- `packages/robustness-core/src/data/llmPricing.ts` — static,
  hand-maintained model pricing (see "Estimated cost" above). No
  server-only imports.
- `packages/oxmarkdown-core/src/` (`document.ts`/`cardDirective.ts`/
  `mention.ts`) — the framework-agnostic markdown/directive/mention
  parsing PhyLog needs (e.g. `fileReferences.server.ts`'s
  `parseOxDocument`, `dailyLog.server.ts`'s `cardFileName`), shared with
  `webapp`'s own editor/renderer — see its own module doc.
- `packages/worker/worker.ts` — the standalone queue-worker process (see
  "Scaling & Process Isolation" below). Imports `robustness-core`
  directly; zero pipeline-logic duplication.
- `webapp/app/routes/api.phylog.run.tsx` / `api.phylog.pre-capture.tsx` /
  `api.phylog.capture.tsx` / `api.phylog.post-capture.tsx` /
  `api.phylog.reset.tsx` / `api.phylog.reset-pre-capture.tsx` /
  `api.phylog.jobs.$jobId.tsx` — API surface (enqueue + poll — thin, no
  pipeline logic of their own).
- `crates/cli/src/phylog.rs` — CLI surface (`nopal phylog ...`).
- `webapp/app/routes/api.phylog.usage-cleanup.tsx` — raw usage-event
  pruning cron.
- `webapp/app/routes/fruits_.maker.tsx` / `fruits_.maker_.phylog.tsx` —
  the usage dashboards (Admin/Super only).
