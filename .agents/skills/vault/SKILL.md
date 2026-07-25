---
name: vault
description: Nopal Vault
---

The vault is where a human (user) goes to find their files. It's a GitHub-style file browser: a cached folder tree on the left, and a main view showing either a folder's contents (folders + files in a table, with README.md rendered below when present) or a single file (markdown rendered, images/videos displayed inline).

URL: /fruits/vault (`webapp/app/routes/fruits_.vault.tsx`)
URL state: `?folder=<folderId>` or `?file=<fileId>`; neither → root view.

The vault terminology:
- Card: Markdown file
- File Tree: the left-hand hierarchical view of folders + files
- Folder view: how we display the contents of a folder
- File view: how we display the contents of a file

## Vault Root Folders

The root of the vault holds only locked, system-provisioned folders — humans cannot create, rename, delete, or move them. The set is defined in `webapp/app/data/vaultRoots.ts` (`VAULT_ROOTS`) and will grow over time:

- `daily-logs`: one folder per day, sorted latest → oldest. Written by the Daily Log page (`fruits_.daily-log.tsx`), but humans can add files/folders inside too.
- `projects`: each folder inside is a "project". The only shareable subtree.
- `personal`: general catch-all for the human's own files.
- `syncs`: the CLI/sync engine's own subtree — sync-scoped API tokens may only read/write here (see `isFolderUnderSyncs`).
- `skills`: instructions steering an eventual sorting agent (mentions→backlinks, Card→project filing, etc.). Every human still gets their OWN `skills` root folder, same as every other root — this one is just locked down to platform-curated content: writing here requires the ACTING human to hold the `Admin` or `Super` role, not merely ownership of the vault. Convention (not yet enforced by code, just a naming/placement pattern): a project gets a `SKILL.md` file sitting right next to its `README.md`, mirroring this very repo's `.agents/skills/*/SKILL.md` layout — project-local instructions vs. this vault-wide `skills` root's global ones.

Every folder carries a denormalized `vault_root_key` identifying which root subtree it belongs to (re-stamped on move). Per-root policy (shareable, publishable, child sort order, and now **writable**) lives in `VAULT_ROOTS`. Root containers are provisioned by `ensureVaultRootFolders` (called from the vault loader and new-user provisioning) — it iterates `VAULT_ROOT_KEYS` generically, so any new root added to that list is automatically provisioned for every human, existing or new, with no other code changes.

### Root write policy (`writable: "owner" | "admin"`)

Most roots use `"owner"` — the ordinary rule that the owning human may write to their own vault (still gated by all the usual folder/file checks — locked daily logs, shared-folder move restrictions, etc.). `skills` uses `"admin"`: writing anywhere under a human's OWN `skills` root ALSO requires that human's `role` to be `Admin` or `Super`. This is layered ON TOP of the ownership check, never a replacement for it.

`canWriteToRoot(rootKey, role)` (`vaultRoots.ts`) is the single helper both directions of policy funnel through — fail-closed (an unrecognized root key requires Admin/Super, never silently allows a plain `Human` write). It's enforced SERVER-SIDE, in every route that can create/rename/move/delete a folder or file, or upload/replace file bytes:

- `api.vault.folders.tsx` — create (checks the PARENT folder's root key).
- `api.vault.folders.$folderId.tsx` — rename/delete (checks the folder's own root key) and move (checks BOTH the folder's own root key and the DESTINATION's root key — moving into a restricted root needs the same role as creating directly inside it would).
- `api.vault.$fileId.tsx` — PATCH/DELETE (checks the file's own root key) and move-via-`folder_id`-change (checks the destination's root key, same as folder move).
- `api.vault.upload.tsx` / `api.vault.multipart-init.tsx` — checks the target folder's root key.
- `api.vault.replace.$fileId.tsx` — checks the file's own root key.

Client-side, `fruits_.vault.tsx` hides the write-triggering UI (Upload/New Folder toolbar buttons, Rename/Move/Delete/Replace menu entries) when `canWriteToRoot` says no — this is a UX nicety layered on top, never a substitute for the server checks above (see "Enforcement" below).

## Data model

- `vault_folders`: `human_id`, `name`, `parent_folder_id`, `shared_with` (ids | "everyone"), `vault_root_key`
- `file_refs`: `human_id`, `name`, `content` (markdown stored in DB) or `s3_key`/`s3_url` (binary in S3), `content_type`, `folder_id`, `md_versions` (daily snapshots via `computeMdUpdate`), `source` (`"daily_log"` | `"daily_log_card"` — see "Daily Logs" below), `project_folder_id` (only on a `"daily_log_card"` file — which project it's for)
- Server functions: `webapp/app/data/vault.server.ts`; client-safe types/helpers: `vault.types.ts`, `vaultRoots.ts`
- `getProjectFolders(humanId)` (`vault.server.ts`): every direct child folder of the human's OWN `projects` root — the simple "a project is just a folder under `projects`" notion, deliberately NOT `project.server.ts`'s heavier `resolveProjectManifest` (which additionally requires a valid `README.md` manifest, and exists for the project detail PAGE, not "what projects exist"). Used by the Daily Log's Cards feature. Scoped to owned projects only — projects shared with the human by someone else aren't yet offered as Card targets (a deliberate, tracked scope line).

## Actions (policy-gated)

Folder: Upload file, New folder, Rename (not root containers), Move (not root containers, not shared folders or folders containing shared descendants; re-stamps `vault_root_key` across the subtree), Share (only inside `projects`).
File: Download (S3-backed files), Replace (same file id, new bytes — `/api/vault/replace/:fileId`).

Enforcement is server-side in `api.vault.folders.$folderId.tsx` / `api.vault.$fileId.tsx`, not just hidden buttons.

## Sharing

- Folder sharing cascades to all descendants (`cascadeShareVaultFolder`); allowed only where the root policy permits (`projects`).
- Markdown files can be public (`is_public`) — public view at `/card/:fileId`.
- File share types (view / workable / editable) correspond to the @mdx-editor modes.

## Media

File bytes are always served via `/api/vault/view/:fileId` (302 → short-lived presigned S3 URL; ownership re-checked per request). Presigned URLs are signed against the browser-reachable S3 host (`S3_PUBLIC_HOSTNAME`) — see `createPresignS3Client` in `file.server.ts`.

## Daily Logs

Daily logs are stored in the vault (vault is the source of truth; `daily_logs` table is a cache — see `dailyLog.server.ts`). Treat daily-log files like any other vault file, except: past days are locked (`isFileRefLocked`), and each day's `readme.md` lives at `daily-logs/YYYY-MM-DD/`.

### Cards

A Card (`::card{file="..."}` — see the `oxmarkdown` skill's Build status) is an explicit, project-scoped section a human inserts into their daily log. Its own markdown content lives in a SEPARATE file sitting right alongside that day's `readme.md` (same `daily-logs/YYYY-MM-DD/` folder), named `card-<projectFolderId>.md` and marked `source: "daily_log_card"` + `project_folder_id` (which project it's for) + `date` (same locking convention `readme.md` itself uses). The day's `readme.md` is the source of truth for WHICH cards exist and their order — each one gets a `::card{file="..." projectFolderId="..."}` leaf directive; these helpers (`dailyLog.server.ts`) only resolve WHERE a card's own content lives:

- `getDailyLogCards(humanId, date)` — every Card that already exists for a day, content included, for SSR-ready loading (no client-side fetch needed before a card renders).
- `createDailyLogCard(humanId, date, projectFolderId)` — idempotent BY DESIGN: always resolves to the SAME file for a given project/date, creating one only if it doesn't exist yet. This is what makes one-card-per-project-per-day a property of the file layer itself, not just a client-side chip filter (`fruits_.daily-log.tsx`'s `AddCardSection`).
- `saveDailyLogCard(fileId, content)` — a plain content overwrite, no `md_versions` snapshotting (a Card's own history is naturally scoped by the day it belongs to).

File attachments inside a Card use the exact same `::file{...}` upload path as the day's own prose (`POST /api/daily-log/upload`) — a Card is just another place in the SAME day's document that can hold one.

### The Sorter and the Release Log

The Sorter (`sorter.server.ts`) turns EXPLICIT signals already present in a CLOSED daily log into Release Log entries — deliberately zero-inference (an unlabeled daily-log paragraph is left untouched forever; nothing is force-filed into a "personal" catch-all). It only ever acts on:

- An `@mention` link in the day's own prose (`readme.md`) that resolves to one of the human's OWN project folders (`/humanId:projects/<Name>[...]` — cross-human mentions aren't yet actionable, same scope line `getProjectFolders` already draws for Cards) — logged as a backlink ("this project was mentioned today").
- A completed task (`[x]`) inside a Card — the Card itself is already an explicit, project-scoped section, so no inference is needed to know which project a task inside it belongs to.
- A file attachment (`::file{...}`) inside a Card — same reasoning.

Runs once per closed day per human, idempotently: `DailyLog.sortedAt` (`dailyLog.server.ts`) short-circuits a re-run unless `force` is passed, and `appendReleaseLogEntries` additionally skips any exact-duplicate line as cheap insurance. A day with no `daily_logs` cache row at all (never had a `readme.md` saved) is left alone entirely — deliberately NOT marked sorted, since `sortedAt` lives on that same cache row and marking a nonexistent row would corrupt it (a `merge` onto a missing record creates a malformed one, findable by nothing since it wouldn't carry `humanId`/`date`).

Triggered two ways, both landing on the exact same `sortDailyLog(humanId, date)` function:

- **The once-a-day cron** — `POST /api/daily-log/sort-all`, protected by the same `CRON_SECRET` env var `archive-cleanup` uses, wired into `server.js` right alongside it (staggered a little, not simultaneous). Calls `sortAllDueDailyLogs()`, which finds every human's `daily_logs` rows strictly before today's UTC date with no `sortedAt` yet (`getUnsortedDailyLogsBefore`) and sorts each — self-healing if a run is ever missed, same robustness `archive-cleanup` already has.
- **On demand** — `POST /api/daily-log/sort` (session or bearer auth; any non-`"sync"` token scope, including the new `"sorter"` scope — see `apiTokens.server.ts`), and `nopal sort run [--date YYYY-MM-DD] [--force]` in the CLI (`crates/cli/src/sort.rs`), a thin client over that same endpoint. This is the "CLI/API is the agent's tool surface" design point: one real implementation, usable by a human via the CLI today and an eventual sorting agent later, with no separate code path for either.

**Release Log entries are plain markdown bullets today** (`releaseLog.server.ts`), not yet the `::release-item{...}` directive the original design sketched for per-viewer conditional rendering (an entry authored by someone else would render as plain "by Jane" text; your own as a real link back to your own daily log). Every entry the Sorter can produce today is necessarily self-authored — mentions/Cards only ever reach a human's OWN projects, no sharing yet — so that nuance has no observable effect yet; tracked as a follow-up once shared-project filing exists, not forgotten.

Every entry is written to BOTH places on purpose (same data, two views — context for the day, access for the project):

- `daily-logs/YYYY-MM-DD/release-log.md` — that human's own receipt for the day, grouped by project (`## <Project Name>`), resolved fresh every time (never cached), same convention `getDailyLogCards`'s `projectName` already uses.
- `projects/<name>/release-log.md` — everyone with project access, grouped by date (`## YYYY-MM-DD`). Lives directly inside the project's own folder, right alongside its `README.md`/`SKILL.md` — one file per project; manual overflow (a hand-created `release-log-p2.md`) only if one ever becomes unwieldy, no pre-emptive partitioning.

Both are ordinary `file_refs` (get-or-created on first entry, plain content overwrite thereafter — no `md_versions` snapshotting, same reasoning Cards already use: per-day/per-project granularity is its own natural history). `appendReleaseLogEntries`'s heading-insert is a deliberately dumb line-based text scan (find `## <heading>`, insert before the next heading or EOF) rather than a full mdast round-trip — headings here are simple, unique markers, so this keeps every OTHER section's exact formatting (blank lines, nested-bullet indentation) completely untouched by an append to one section.
