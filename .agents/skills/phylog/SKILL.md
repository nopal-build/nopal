---
name: phylog
description: PhyLog, Nopal's AI pipeline that turns a project-n01 space's daily-log Cards and synced files into written summaries, filed/organized project content, and an up-to-date README. Use when working on packages/robustness-core/src/data/phylogAgent.server.ts, preCapture.server.ts, capture.server.ts, postCapture.server.ts, projectN01.server.ts, sorter.server.ts's fileCardAttachments, llmProvider.ts, anthropicProvider.server.ts (all in packages/robustness-core), packages/worker/worker.ts, the webapp/app/routes/api.phylog.* routes, or crates/cli/src/phylog.rs — or when asked about "phylog", the PhyLog pipeline, pre-capture/capture/post-capture, project-n01 spaces, or the robustness-core/oxmarkdown-core/worker workspace packages.
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

- **Incremental** (default) — walks every day this project has a Card
  for, SKIPPING any already recorded (idempotent against a hash of that
  day's Card content, `source_ref` — same mechanism the old single-tool
  README-writer used). "Just the daily logs that haven't been applied
  yet."
- **Full** — calls `resetProjectN01Content` FIRST (see "Reset" above),
  then walks every day from scratch (nothing is "already recorded"
  anymore, since reset also clears this project's Release Log history).

**CROSS-HUMAN BY DESIGN — sweeps every collaborator's Cards, not just
whoever's running the command.** `listCardEntriesForProject`
(`dailyLog.server.ts`) enumerates every `(humanId, date)` pair with a Card
for this project across EVERY human who's ever written one, not merely
the acting human passed into `runCapture`/`runPreCapture` (that parameter
now only matters for a handful of invoker-scoped bookkeeping calls, e.g.
the "agent not configured" early return — it no longer restricts which
Cards get discovered). Each entry is then processed under ITS OWN
humanId (filing via `fileCardAttachments`, the organize/README agent
loop, usage tracking, and regenerating THAT human's own
`daily-logs/<date>/release-log.md`) — a single date can legitimately
produce multiple `CaptureDayResult`s if several collaborators each wrote
their own Card for it. This isn't a new trust boundary: a Card was
already cross-human safe by construction (any Sharing Role, including
Observer, may write one for a project they can see — see "Cards" in the
`vault` skill — and `sorter.server.ts`'s `fileCardAttachments` already
filed a collaborator's attachments into the project without needing
write access to their vault); capture used to silently defeat that by
only ever looking at the CALLER's own Cards, which meant a project
owner's `phylog capture` run could never see a collaborator's Card, no
matter how many times it ran. `nopal phylog capture --project <path>` (or
`run`/`pre-capture`) now always applies everyone's outstanding Cards for
that project in one pass, regardless of who invokes it — always safe to
run, same as before, just no longer scoped to one identity.

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
/api/phylog/reset` (`{ projectFolderId }`) — each of these ENQUEUES
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
  machines, not by raising in-process concurrency (never run the same
  project's pipeline twice concurrently — the same safety concern behind
  `attempts: 1` above).
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
day capture runs its organize/README agent loop for (`capture.server.ts`—
usage/duration accumulated across every turn of that loop, via
`runAgentLoop`'s own return value), and one per post-capture invocation.
Capture's per-day agent loop is wrapped in its own try/catch
(`captureOneDay`) so one bad day (a rate limit, a transient error) can't
abort the rest of a multi-day run — mirrors the per-file resilience
`preCapture.server.ts` already had. A metrics write failing never breaks
the PhyLog run it's describing (`recordPhylogUsage` swallows its own
errors).

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
  default skill file content, `resetProjectN01Content`,
  `getProjectStageSkill`/`isSkipInstruction`.
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
  `api.phylog.reset.tsx` / `api.phylog.jobs.$jobId.tsx` — API surface
  (enqueue + poll — thin, no pipeline logic of their own).
- `crates/cli/src/phylog.rs` — CLI surface (`nopal phylog ...`).
- `webapp/app/routes/api.phylog.usage-cleanup.tsx` — raw usage-event
  pruning cron.
- `webapp/app/routes/fruits_.maker.tsx` / `fruits_.maker_.phylog.tsx` —
  the usage dashboards (Admin/Super only).
