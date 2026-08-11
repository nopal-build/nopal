---
name: phylog
description: PhyLog, Nopal's AI pipeline that turns a project-n01 space's daily-log Cards and synced files into written summaries, filed/organized project content, and an up-to-date README. Use when working on app/data/phylogAgent.server.ts, app/data/preCapture.server.ts, app/data/capture.server.ts, app/data/postCapture.server.ts, app/data/projectN01.server.ts, app/data/sorter.server.ts's fileCardAttachments, app/data/llmProvider.ts, app/data/anthropicProvider.server.ts, the api.phylog.* routes, or crates/cli/src/phylog.rs — or when asked about "phylog", the PhyLog pipeline, pre-capture/capture/post-capture, or project-n01 spaces.
---

# PhyLog

PhyLog is Nopal's on-demand AI pipeline for one `project-n01` space at a
time — a project (a folder directly under `projects`), or a human's own
`personal` space. It turns raw daily-log Cards and synced files into
durable, organized project state: written summaries next to source files,
that content filed and organized inside the project, and an up-to-date
`README.md` that indexes the result. See the `vault` skill's Daily Logs /
Sorter / Release Log / Vault Folder Types sections first if any of those
terms are unfamiliar — this skill sits directly on top of that
architecture. Deliberately standalone (not a subsection of `vault`)
because PhyLog is a big enough subsystem — its own pipeline stages, its
own LLM provider seam, its own CLI surface — to warrant its own home.

Every PhyLog call costs real money and produces non-deterministic output,
so it is **never** wired into a cron — always triggered on demand, by a
human (or an eventual sorting agent), through the CLI or the API. There is
**no preview/dry-run mode anywhere in this pipeline** — every call applies
for real. `nopal phylog reset` (wipe) + `capture --full` (rebuild from
scratch) is the "inspect before committing" workflow that used to be a
`--apply` flag's absence; `nopal release-log revert` remains the safety
net for undoing a specific capture's README edit.

## `project-n01` spaces

Every project, and the `personal` root, carries the `project-n01` Vault
Folder Type (`webapp/app/data/vaultFolderTypes.ts` — see the `vault`
skill's "Vault Folder Types" section for the general mechanism). The name
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

`ensureProjectN01`/`resolveProjectN01` (`webapp/app/data/projectN01.server.ts`)
stamp + seed a `project-n01` folder — called at CREATION time
(`createVaultFolder` for a new project, `ensureVaultRootFolders` for
`personal`) and LAZILY, as a self-healing retrofit for anything that
predates this type (`getProjectFolders`, and every PhyLog CLI/API entry
point's own `resolveProjectN01` call). Seeding creates a `skills` folder
(if missing) containing three default files — `PRE_CAPTURE.md`,
`CAPTURE.md`, `POST_CAPTURE.md` — one per pipeline stage below, each with
a sensible default body so a brand new project is immediately usable
without a human writing anything first.

### Reset

`resetProjectN01Content` (`projectN01.server.ts`) deletes every direct
child of a `project-n01` folder EXCEPT its `skills`/`syncs`/`newspapers`
anchors (and everything nested under them) — "everything else is
disposable" made real. It ALSO clears this project's own Release Log
history (`clearReleaseLogForProject`, `releaseLog.server.ts`): those rows
describe state (filed attachments, past README versions) that a reset
just deleted, so leaving them behind would make a later `capture --full`
think everything was already applied and silently skip reprocessing it.

Reset is **always an explicit, separate operation** (`nopal phylog
reset`) — never run implicitly by anything else, including
`capture --full` on its own initiative conceptually being "the same
idea". This is deliberate: a human can inspect the emptied-out
`project-n01` folder (skills/syncs still intact) before deciding to
rebuild. `capture --full` internally calls the exact same
`resetProjectN01Content` itself, right before reprocessing everything —
so running `reset` first is optional, not required, but useful whenever
you want to verify the wipe alone.

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

### Stage 1 — pre-capture (`preCapture.server.ts`)

Gated by `skills/PRE_CAPTURE.md` (default: skip). When not skipped,
examines every candidate source file that doesn't already have a sibling
`<name>-summary.md` next to it (`summaryFileName`, `sorter.server.ts`) —
candidates come from two places:

- Every `::file{...}` attachment across this project's daily-log Cards.
- Every file inside this project's own `syncs/` folder tree, at any depth.

For each candidate, an LLM decides (grounded in the skill's own
instructions, injected as context) whether and how to summarize it:

- An image gets a real vision call (`PhotoDescriber.describePhoto` — see
  "LLM provider architecture" below), the skill's instructions folded into
  the call's own text `context` alongside the human's caption (if any) and
  the Card's own content.
- A file with readable text content (`file_refs.content`) gets a plain
  text-summarization call (`LlmProvider.complete`, no tools — just the
  skill's instructions as the system prompt).
- Anything else (a binary file with no extracted text, not an image) is
  left unsummarized and reported as `unsupported` — there's genuinely
  nothing to feed the model.

Writes the summary as a sibling markdown file (front matter: `source`
fileId, `sourceHash`, `generatedAt`), in the SAME folder the source file
already lives in — the acting human's own `daily-logs` folder for a Card
attachment, or the project's own `syncs/<connector>/` for a synced file.
**Never gated by anything but the skill file itself** — both destinations
are folders the acting human/project owner already has an unconditional
write relationship with, so there's no separate apply-gate here.

**Idempotent** against a hash of the source file's own bytes/content
(`content_hash`, falling back to `s3_key`/id) plus, for a Card attachment,
its caption — stored in the summary's own front matter (`sourceHash`) and
re-derived fresh each call. An unchanged file/caption pair is a total
no-op; editing a caption or replacing a file's bytes invalidates the
cached summary.

**Invocation shapes** (all one function, `runPreCapture`, different
options — mirrors the CLI's own flags):

- Individual file: pass `fileId` (CLI: `--file <vault-path>`).
- One day's Card: pass `date` (CLI: `--date YYYY-MM-DD`) — plus, always, a
  syncs sweep (cheap: only genuinely new/changed files ever call a model).
- Everything (all history's Cards + syncs sweep): omit both — this is also
  the natural "end of day, sweep everything new" shape, since a repeat
  call only ever acts on what's actually new/changed.

### Stage 2 — capture (`capture.server.ts`)

Two parts, run per day (oldest first, across whatever date range applies):

1. **Deterministic filing** (`sorter.server.ts`'s `fileCardAttachments`,
   unchanged, zero-inference) — every not-yet-filed `::file{...}` Card
   attachment (and its pre-capture summary sibling, if one exists) lands
   in the project's root. Independent of anything the model decides below.
2. **Organize + README** — an LLM agent loop, driven by
   `skills/CAPTURE.md` (default: file everything into the root, keep
   README a plain index — see `DEFAULT_CAPTURE_SKILL`). Given the
   project's CURRENT file tree (everything EXCEPT `skills/`/`syncs/`/
   `newspapers/`, which capture never even shows the model, let alone
   touches), the day's Card content, any pre-capture summaries for
   today's attachments, and the current README, the model may call:
   - `create_folder({ path })` — mkdir -p, relative to the project root.
   - `move_file({ name, destinationPath })` — relocate an already-filed
     file by name.
   - `update_readme({ newBody, reason })` — at most meaningfully once per
     day; replaces the README body only (front matter untouched).
   Both `create_folder`/`move_file` refuse to target `skills`/`syncs`/
   `newspapers` by name — those subtrees are permanently off limits to
   this stage.

**Two modes** (`runCapture`'s `full` option; CLI: `--full`):

- **Incremental** (default) — walks every day this project has a Card
  for, SKIPPING any already recorded (idempotent against a hash of that
  day's Card content, `source_ref` — same mechanism the old single-tool
  README-writer used). "Just the daily logs that haven't been applied
  yet."
- **Full** — calls `resetProjectN01Content` FIRST (see "Reset" above),
  then walks every day from scratch (nothing is "already recorded"
  anymore, since reset also clears this project's Release Log history).

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
default model (`claude-sonnet-4-5-20250929`) everywhere.

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
```

- `--project` — vault path, e.g. `projects/sunny`, or `personal`.
- `run` — all three stages in order. `--full` forwards to capture's
  full-rebuild mode (pre-capture/post-capture have no "full" concept of
  their own — pre-capture already sweeps everything when `--date`/`--file`
  are omitted; post-capture is project-wide, not date-scoped).
- `pre-capture` — omit both `--date` and `--file` to sweep everything.
- `capture` — `--full` resets first, then reprocesses every day from
  scratch; default is incremental (only unapplied days). `--since`/
  `--until` bound the date range either way.
- `reset` — destructive; requires `--yes`. Prints a reminder to run
  `capture --full` afterward.

Every CLI command resolves `--project` to a folder, then makes ONE POST
call and prints the server's own `log` array (built up via an
`onProgress` callback threaded through every stage) followed by a
human-readable summary of what happened — not a raw JSON dump. This is
NOT real-time streaming (a single request/response round-trip); it's
still meaningfully more informative than the old "silent until the final
JSON" behavior, especially for a `run`/`capture --full` spanning many
days.

API: `POST /api/phylog/run` (`{ projectFolderId, full?, since?, until? }`),
`POST /api/phylog/pre-capture` (`{ projectFolderId, date?, fileId? }`),
`POST /api/phylog/capture` (`{ projectFolderId, full?, since?, until? }`),
`POST /api/phylog/post-capture` (`{ projectFolderId }`), `POST
/api/phylog/reset` (`{ projectFolderId }`). All require an owner-tier
Sharing Role on the project (or being the project/`personal`'s own owner)
— there is no lower-bar preview tier anymore now that every call commits;
`nopal sort run` remains the lower-bar path (any role) for the Sorter's
own, zero-inference filing.

## Files

- `webapp/app/data/projectN01.server.ts` — `project-n01` seeding/retrofit
  (`ensureProjectN01`/`resolveProjectN01`), default skill file content,
  `resetProjectN01Content`, `getProjectStageSkill`/`isSkipInstruction`.
- `webapp/app/data/preCapture.server.ts` — stage 1.
- `webapp/app/data/capture.server.ts` — stage 2 (deterministic filing via
  `sorter.server.ts`'s `fileCardAttachments`, plus the organize/README
  agent loop and its tools).
- `webapp/app/data/postCapture.server.ts` — stage 3 (placeholder).
- `webapp/app/data/phylogAgent.server.ts` — orchestrates all three stages
  (`runPhylogPipeline`) and `resetProject`.
- `webapp/app/data/sorter.server.ts` — `fileCardAttachments` (shared with
  the Sorter), plus the shared `summaryFileName`/`isImageContentType`
  helpers pre-capture also uses.
- `webapp/app/data/llmProvider.ts` — provider-agnostic interfaces
  (`LlmProvider`, `PhotoDescriber`), no server-only imports.
- `webapp/app/data/anthropicProvider.server.ts` — the one real provider
  today, implementing both interfaces.
- `webapp/app/data/file.server.ts`'s `downloadFileBytes` — the one
  server-side-direct (non-presigned) S3 read in the app, used only by
  pre-capture's image summarization.
- `webapp/app/routes/api.phylog.run.tsx` / `api.phylog.pre-capture.tsx` /
  `api.phylog.capture.tsx` / `api.phylog.post-capture.tsx` /
  `api.phylog.reset.tsx` — API surface.
- `crates/cli/src/phylog.rs` — CLI surface (`nopal phylog ...`).
