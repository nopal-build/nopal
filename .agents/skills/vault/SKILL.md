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

Every folder carries a denormalized `vault_root_key` identifying which root subtree it belongs to (re-stamped on move). Per-root policy (shareable, child sort order) lives in `VAULT_ROOTS`. Root containers are provisioned by `ensureVaultRootFolders` (called from the vault loader and new-user provisioning).

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
