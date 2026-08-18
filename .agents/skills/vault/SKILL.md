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

The root of the vault holds only locked, system-provisioned folders — humans cannot create, rename, delete, or move them. Defined in `packages/robustness-core/src/data/vaultRoots.ts` (`VAULT_ROOTS`, a pnpm workspace package shared with the PhyLog pipeline/worker):

- `daily-logs`: one folder per day, sorted latest → oldest. Written by the Daily Log page (`fruits_.daily-log.tsx`), but humans can add files/folders inside too.
- `projects`: each folder inside is a "project". The only shareable subtree.
- `personal`: general catch-all for the human's own files.

`skills` and `syncs` used to be their own top-level roots; they're now **Vault Folder Types** (below) — sub-folders created one level down, inside a project or `personal`, so every project gets its own identity/data-collection folders instead of one global `skills`/`syncs` for the whole vault.

Every folder carries a denormalized `vault_root_key` (re-stamped on move) identifying its root subtree. Per-root policy (shareable, publishable, child sort order, writable) lives in `VAULT_ROOTS`. `ensureVaultRootFolders` (vault loader + new-user provisioning) iterates `VAULT_ROOT_KEYS` generically, so a new root is auto-provisioned for every human with no other code changes. All three roots are `writable: "owner"` — the Admin/Super gate that used to live on the `skills` root now lives on the `skills` folder TYPE instead (below).

## Vault Folder Types

Where a root is a fixed, system-provisioned top-level container, a folder TYPE (`packages/robustness-core/src/data/vaultFolderTypes.ts`) is a tag a folder carries beyond its root. Three tiers:

**Container types** — `project-n01` (name is intentional: v1 of the concept — see the `phylog` skill's "project-n01 spaces" section). Every `projects/<name>` folder and the `personal` root carry this, stamped at creation (`createVaultFolder`/`ensureVaultRootFolders`) and lazily backfilled onto anything older via `ensureProjectN01`/`resolveProjectN01` (`projectN01.server.ts`). Unlike the other two tiers, a human never picks this from "New folder" — it's automatic. `README.md` is that space's index; a human may only write directly into its `skills`/`syncs` children — everything else is `writable: "system"`, managed by the PhyLog pipeline (see the `phylog` skill). Folder-object-level operations (rename/delete/move/share/publish) on the anchor ITSELF are a separate, still-owner-writable concern (`canWriteToFolderId`/`canManageCurrent`). A `project-n01`'s own README renders via `ProjectView` — a thin wrapper around plain `OxRenderer` on the front-matter-stripped body, same as the `project-newspaper` page and every other markdown file in the vault. It used to also resolve `::gallery{...}`/`::csv-table{...}`/`::svg{...}` directives into real content (the old `MdxEditorView`/`nopalDirectives.ts` extension mechanism) — dropped when `MdxEditor` was retired (see the `oxmarkdown` skill's Build status); those directives now render as `OxRenderer`'s generic "unknown directive" marker.

**Space types** — `skills`, `syncs`, and the not-yet-buildable `newspapers`. Creatable directly inside a `project-n01` folder (a project, or `personal`) — nowhere else. Singleton per parent, enforced server-side (`validateFolderTypeForParent`) against direct children only.

- `skills` codifies the identity of that project — instructions steering how it's built/organized/maintained. `writable: "owner"` (the project's creator, or an owner-tier collaborator — see Sharing Roles). Auto-seeded at creation with three default files: `PRE_CAPTURE.md`, `CAPTURE.md`, `POST_CAPTURE.md` (see the `phylog` skill).
- `syncs` is a pure data-collection container (see "Sync types" below) — files land in connector folders created inside it, not in `syncs` itself.
- `newspapers` is reserved for PhyLog's post-capture stage to eventually generate digests into — not implemented (`comingSoon: true`), `writable: "system"`. Not to be confused with the unrelated, already-shipped `project-newspaper` VIEW of a project's README.

**Sync types** — `sync-one-way`, `sync-two-way`, and the not-yet-implemented `sync-api` / `sync-email` / `sync-custom` (`comingSoon: true`, visible-but-disabled in the picker). Creatable inside a `syncs` folder, one per data source — not singleton. Every sync type's job is the same (land plain files in the vault); mechanism differs:

- `sync-one-way` / `sync-two-way`: the CLI's folder sync (`nopal sync add [--two-way] [--project NAME]`) — a local directory mirrors in (one-way) or both ways (two-way). Resolves/creates the target space's `syncs` folder, then creates the connector folder tagged with the right type.
- `sync-api` / `sync-email` / `sync-custom`: hooks for an external API, forwarded email/text, or a hand-built collector — not built yet.

### Denormalization (`folder_type`, `is_folder_type_root`)

`folder_type` is denormalized onto every descendant folder (same trick `vault_root_key` uses). A folder either DEFINES its type (`is_folder_type_root: true`) or INHERITS its parent's. `is_folder_type_root` folders are STICKY (never overwritten by a move) and PINNED (can't be moved at all — delete-and-recreate to relocate). Moving an ordinary folder containing nested type anchors preserves those anchors' own types (`cascadeFolderType`).

`isFolderUnderSyncs(folderId)` — true for the `syncs` folder itself and every connector inside one, at any depth — is the resource check sync-scoped API tokens are restricted to.

### Write/publish policy (`writable: "owner" | "admin" | "system"`, `shareable`, `publishable`)

Each folder type carries the same three policy knobs `VAULT_ROOTS` does, layered ON TOP of (never replacing) the containing root's own policy — both must agree. `canWriteToFolderId(folderId, role)` / `isFolderIdShareable(folderId)` / `isFolderIdPublishable(folderId)` (`vault.server.ts`) are the single helpers both directions funnel through. `skills.writable` is `"owner"` (a project's creator, no Admin/Super gate) — a Crafter/Observer collaborator's ability to edit `skills` is a separate Role-aware check (see Sharing Roles), not this policy chain. `project-n01.writable` (and `newspapers.writable`) is `"system"` — no human role can write content there; only PhyLog's server code, via the data layer directly, never the `api.vault.*` write routes. Enforced server-side everywhere a folder/file is created, renamed, moved, deleted, published, or uploaded/replaced:

- `api.vault.folders.tsx` — create (checks the PARENT; validates `folder_type` against `validateFolderTypeForParent`).
- `api.vault.folders.$folderId.tsx` — rename/delete/publish (own policy) and move (own + destination policy; blocks moving a folder-type anchor). A `project-n01` anchor is an exception: its own object-level ops need only the ROOT policy, so its owner can still rename/delete/share/publish it even though nothing may be written inside. No longer handles sharing (see Sharing Roles).
- `api.vault.$fileId.tsx` — PATCH/DELETE (own folder) and move-via-`folder_id`/share (destination policy).
- `api.vault.upload.tsx` / `api.vault.multipart-init.tsx` — target folder's policy.
- `api.vault.replace.$fileId.tsx` — the file's own folder's policy.

Client-side, `fruits_.vault.tsx` hides write/share/publish UI when these say no — a UX nicety, never a substitute for the server checks. `canWriteCurrent` (content) is folder-type-gated as always; `canManageCurrent` (Rename/Move/Share/Publish/Delete) mirrors the same anchor exception, down to root-level check only.

## Data model

- `vault_folders`: `human_id`, `name`, `parent_folder_id`, `shared_with` (a plain `string[]` of human ids — no "everyone" option, see Sharing Roles), `vault_root_key`, `folder_type`, `is_folder_type_root`
- `file_refs`: `human_id`, `name`, `content` (markdown stored in DB) or `s3_key`/`s3_url` (binary in S3), `content_type`, `folder_id`, `md_versions` (daily snapshots via `computeMdUpdate`), `source` (`"daily_log"` | `"daily_log_card"` — see Daily Logs), `project_folder_id` (only on a `"daily_log_card"` file). Every markdown viewer/editor (`OxRenderer`/`OxEditor`, `SkillFileEditor`, PhyLog's `getProjectStageSkill`/`listExtraSkillFiles`) reads `content` directly, never S3 — `api.vault.upload.tsx`/`api.vault.replace.$fileId.tsx` special-case a markdown upload (by name/`.md` or `content_type: text/markdown`, under a 5MB inline cap) to store text as `content` with no S3 object, rather than the generic S3-blob path. `replace` also self-heals any file that's markdown-shaped now but was S3-backed from before (switches to content-only, cleans up the orphaned S3 object).
- `sharing_roles`: `name`, `is_owner` — role DEFINITIONS, see Sharing Roles.
- Server functions: `packages/robustness-core/src/data/vault.server.ts`; client-safe types/helpers: `vault.types.ts`, `vaultRoots.ts`, `vaultFolderTypes.ts` (same package).
- `getProjectFolders(humanId)`: every direct child folder of the human's own `projects` root — deliberately NOT `project.server.ts`'s heavier `resolveProjectManifest` (which additionally resolves directive-referenced files for the project detail page, and never fails closed on an invalid manifest). `getAccessibleProjectFolders(humanId)` additionally includes every project shared with them via any Sharing Role — what the Daily Log's Cards feature uses as its target list, since a Card is how any role (including Observer) contributes to a project it doesn't own.

## Actions (policy-gated)

Folder: Upload file, New folder (optionally picking a folder TYPE), Rename (not root containers), Move (not root containers, not folder-type anchors, not shared folders or folders containing shared descendants; re-stamps `vault_root_key`/`folder_type` across the subtree), Share (project folders only — see Sharing Roles).
File: Download (S3-backed files), Replace (same file id, new bytes — `/api/vault/replace/:fileId`).

Enforcement is server-side in `api.vault.folders.$folderId.tsx` / `api.vault.$fileId.tsx`, not just hidden buttons.

## Project Status

Every project (a folder directly under `projects`) carries a lifecycle **status**: `active` (default), `completed`, or `trashed`. Same architecture as Sharing Roles below — the project's own README front matter (`status`) is the source of truth (`project.types.ts`'s `parseProjectStatus`/`withProjectStatus`), and `vault_folders.project_status`/`project_status_at` is a denormalized cache kept in sync by `projectStatus.server.ts`'s `setProjectStatus` — reads that only need "what status is this" (dashboard list, trash-cleanup cron) go straight to the cache. Unlike `shared_with`, status is NOT cascaded to descendants — a single flag on the project folder itself.

- `getProjectStatus(folder)` is a synchronous cache read, no DB call, defaults `"active"`.
- `setProjectStatus(actingHumanId, projectFolder, status)` is the only intended writer — only the project's creator may change it (a personal organizational tool, unlike collaborator-facing Sharing Roles). Rewrites both the README front matter and the cache, stamps `project_status_at`.
- API: `GET`/`PUT /api/vault/projects/:folderId/status`.
- The dashboard (`fruits.tsx`) groups projects by status (`?status=active|completed|trashed`, defaulting to `active`), with a per-project `<select>` to change it.
- **Trashed is a soft-delete**: `POST /api/vault/trash-cleanup`, same `CRON_SECRET` as `archive-cleanup`/`daily-log/sort-all`, same daily cron in `server.js` — permanently deletes (`deleteVaultFolderCascade`) any project `"trashed"` for 30+ days (`getTrashedProjectFoldersForCleanup`, a direct query against the cache).

## Sharing Roles

PhyLog's replacement for the old "private / everyone / specific people" model — sharing a PROJECT (a folder directly under `projects`; nothing else is independently shareable) means giving each collaborator a named Role instead of a flat yes/no. "Shared with everyone" is gone entirely.

- **Role DEFINITIONS** (`name` + `is_owner`) live in the `sharing_roles` DB table (`sharingRoles.server.ts`), lazily seeded with three defaults: `Owner` (is_owner: true), `Crafter` (is_owner: true), `Observer` (is_owner: false). `is_owner` is the only permission tier today — an Owner/Crafter acts as a full CO-OWNER of everything inside the project (upload, create/rename/move/delete/replace/publish, change `shared_type`/`is_public`, edit `skills`, change sharing itself), via `projectSharing.server.ts`'s `canActAsProjectOwner`; an Observer gets none of that — just viewing and contributing a daily-log Card.
- **Role ASSIGNMENTS** are NOT a DB table — they live directly in that project's own `README.md` YAML front matter as a `sharing` list: `[{ human: humanId, role: roleName }]` (`project.types.ts`'s `parseProjectSharing`/`withProjectSharing`, `projectSharing.server.ts`). The project's creator is never listed — always an implicit "Owner" (`getProjectRole`). Because this is the ONLY place role assignments live, anything that touches README.md must preserve its front matter, never overwrite/delete the whole file — see the `phylog` skill's "Reset" section (`withReadmeBody` clears/replaces only the body everywhere generated content gets rewritten).
- `vault_folders.shared_with` is a DERIVED, DENORMALIZED CACHE of the `sharing` list (recomputed + cascaded to every descendant via `cascadeShareVaultFolder` on `setProjectSharing`), kept purely so the existing O(1) view-access plumbing (`canViewFileRef`, `getSharedFoldersForHuman`, the sidebar's "Shared with me") keeps working unchanged. Never write `shared_with` directly for a project folder.
- API: `GET`/`PUT /api/vault/projects/:folderId/sharing` — `PUT` replaces the whole collaborator list, requires an owner-tier role (creator, Owner, or Crafter); Observers may not change sharing. The old `PATCH /api/vault/folders/:folderId { shared_with }` path is gone (400s with a pointer to the new endpoint).
- **Owner-tier collaborators act as full co-owners of project CONTENT.** `canActAsProjectOwner(actingHumanId, ownerHumanId, folderId)` — true when acting human owns it, or holds an owner-tier Role on the project the folder lives under — is the single check every vault write route uses in place of a bare `human_id === user._id` comparison (upload/multipart routes, folder create/rename/move/delete/publish, replace, and file rename/move/delete/publish/`shared_type`/content). `skills.writable` is `"owner"` (creator always writable); a non-owner-tier collaborator (Observer) gets a flat 403 on any `skills` file regardless of the file's own `shared_type`, since `skills.shareable` is `false` (a file inside it can never be individually shared).
- **Excluded from `canActAsProjectOwner`: the project ANCHOR's own object-level lifecycle** — renaming/deleting/publishing the WHOLE project still checks literal `folder.human_id === user._id` (`isProjectN01Anchor` branch). Same precedent as Project Status: an Owner/Crafter can reorganize everything inside a project but can't rename/delete/trash the project itself. A project anchor can't be moved at all (`is_folder_type_root` folders are pinned), so this only matters for rename/delete/publish.
- **`human_id` on anything created inside someone else's folder must be the FOLDER OWNER's, never the acting collaborator's** — `listFolderChildren` queries by `WHERE human_id = $folderOwnerId AND parent_folder_id/folder_id = $id`, so a file/folder stamped with the acting human's own id would silently vanish from the listing it was just added to. `createFileRef`/`createVaultFolder` in the upload/multipart-complete/create-folder routes all pass the TARGET folder's `human_id` (same convention `copyFileIntoFolder` and `ensureSkillFile` already use) — a no-op for a project's own creator.
- **Client-side mirror**: `fruits_.vault.tsx`'s loader resolves `viewerIsOwnerTierOnProject` (server-side `getProjectRoleForFolderId` check) and ORs it into `isEffectiveOwner = isOwnedByViewer || viewerIsOwnerTierOnProject`, used everywhere a toolbar/menu action is gated. The one exception is `canManageAnchorLifecycle` (`!isProjectN01AnchorCurrent || isOwnedByViewer`), keeping Rename/Delete/Publish on the project anchor itself creator-only, mirroring the server split — Share is exempt from this since `setProjectSharing` treats any owner-tier role as equally authorized. Still just a UX nicety, never a substitute for the server checks.
- `nopal vault share <path> --with email:Role [--with email:Role ...]` / `--private` (CLI) — project folders only; role names checked server-side against `sharing_roles`.
- **A CLI/GUI vault path resolves shared projects exactly like owned ones.** `crates/core/src/vault.rs`'s `Client::children` always requests `GET /api/vault/folders/:folderId/children?withShared=1` — when `:folderId` is the caller's own `projects` root, the server merges in every project shared with them (`getTopLevelSharedFolders`), own-name-wins on collision. This is what makes `nopal phylog capture --project "projects/some-shared-project"` (or `vault ls`/`cat`/`sync add --project`/the GUI app) resolve the same way for an owner-tier collaborator as for the owner. Deliberately opt-in server-side (`withShared` not default) so the web Vault's own "Shared with me" sidebar section doesn't get duplicates — only Rust CLI/GUI consumers request it.
- Markdown files can be public (`is_public`) — public view at `/card/:fileId`.
- File share types (view / workable / editable) correspond to the @mdx-editor modes — orthogonal to Sharing Roles (a per-FILE grant, not project-wide).

## File Referencing & Renaming

`file_references` (`fileReferences.server.ts`) is an index of every outgoing reference a markdown file's content contains, so renaming/moving a file or folder can find and fix every place it's referenced in O(references-to-that-target) instead of scanning the whole vault. ID-only rows (`source_file_id`, `target_type`/`target_id`, `kind`) — `ref_text` is a CACHE of the exact raw text currently expressing the reference, never a second source of truth.

Two reference kinds, deliberately excluding anything already ID-based (`::file{fileId=...}`, `::card{file=... projectFolderId=...}` are skipped entirely):

- **`mention`** — an `@`-mention link (`oxmarkdown/mention.ts`'s `[@Name](/humanId:path/to/target)`), kept in its shipped, human-readable-path form rather than opaque ids, so a targeted rewrite on rename is cheap without changing the saved markdown format. Cross-human: a mention can point into another human's shared project; propagation only ever rewrites the REFERRER's own file, never needing write access to the target owner's vault.
- **`directive-attr`** — a `file="..."`/`folder="..."` attribute on another leaf directive (`::csv-table{file=...}`, `::gallery{folder=...}`), resolved against the attribute's own containing folder's direct children by name. Tracked purely for rename-propagation via `robustness-core/util/nopalDirectives.ts`'s leaf-directive matcher — independent of rendering, since `project.server.ts`'s `resolveProjectManifest` no longer resolves these for display (see the `oxmarkdown` skill's Build status).

**Sync** is centralized inside `vault.server.ts`'s `createFileRef`/`updateFileRef` — every markdown save triggers a full delete-and-re-extract resync of that file's own outgoing references, so no route has to remember to do this itself.

**Propagation** — `propagateTargetChange(targets)` handles rename and move identically (both change a target's computed path): finds every `file_references` row pointing at any of `targets`, groups by referencing file, recomputes each one's current path/name, rewrites the exact cached `ref_text` span in place. A folder rename/move expands `targets` to itself plus every descendant (`collectFolderAndDescendantTargets`) since their paths changed too. Hooked into `updateVaultFolder` (name), `moveVaultFolder` (move), `updateFileRef` (a file's own name/`folder_id` change).

**Deletion** — `propagateTargetDeletion(target, deletedName)`, hooked into `deleteFileRef` and `deleteVaultFolderCascade`. A dead `mention`'s LABEL is rewritten to flag it (`[Name (deleted)](oldHref)`) rather than silently left stale or removed — href left as-is. A `directive-attr` reference has no label to annotate; its stale value is left untouched. Either way, the now-meaningless `file_references` rows are deleted.

**Out of scope for now**: task/checkbox references (checking one instance across files) — a separate, not-yet-designed feature. **Not built**: a "broken links" scanner — `file_references` plus a resolvability check would make one straightforward to add later.

## Media

File bytes are always served via `/api/vault/view/:fileId` (302 → short-lived presigned S3 URL; ownership re-checked per request). Presigned URLs are signed against the browser-reachable S3 host (`S3_PUBLIC_HOSTNAME`) — see `createPresignS3Client` in `file.server.ts`.

## Daily Logs

Daily logs are stored in the vault (vault is the source of truth; `daily_logs` table is a cache — see `dailyLog.server.ts`). Treat daily-log files like any other vault file, except: past days are locked (`isFileRefLocked`), and each day's `readme.md` lives at `daily-logs/YYYY-MM-DD/`.

### Cards

A Card (`::card{file="..."}` — see the `oxmarkdown` skill's Build status) is an explicit, project-scoped section a human inserts into their daily log. Its content lives in a SEPARATE file alongside that day's `readme.md` (same `daily-logs/YYYY-MM-DD/` folder), named `card-<projectFolderId>.md`, marked `source: "daily_log_card"` + `project_folder_id` + `date` (same locking convention as `readme.md`). The day's `readme.md` is the source of truth for WHICH cards exist and their order — each gets a `::card{file="..." projectFolderId="..."}` leaf directive; `dailyLog.server.ts`'s helpers only resolve WHERE a card's content lives:

- `getDailyLogCards(humanId, date)` — every Card for a day, content included, for SSR-ready loading.
- `createDailyLogCard(humanId, date, projectFolderId)` — idempotent by design: always resolves to the SAME file for a given project/date, creating one only if missing. Makes one-card-per-project-per-day a property of the file layer, not just a client-side filter.
- `saveDailyLogCard(fileId, content)` — a plain content overwrite, no `md_versions` snapshotting (a Card's own history is scoped by the day it belongs to).

File attachments inside a Card use the exact same `::file{...}` upload path as the day's own prose (`POST /api/daily-log/upload`) — a Card is just another place in the same day's document that can hold one.

### The Sorter and the Release Log

The Sorter (`sorter.server.ts`) turns EXPLICIT signals already present in a CLOSED daily log into Release Log entries — deliberately zero-inference (an unlabeled paragraph is left untouched forever; nothing is force-filed into a catch-all). It only ever acts on:

- An `@mention` in the day's own prose that resolves to one of the human's OWN project folders (cross-human mentions aren't yet actionable here, unlike Cards) — logged as a purely informational backlink, no changeset, can never be reverted.
- A completed task (`[x]`) inside a Card — the Card is already project-scoped, so no inference is needed. Also purely informational.
- A file attachment (`::file{...}`) inside a Card — ACTUALLY filed into the project's ROOT folder (`copyFileIntoFolder`): a new `file_refs` row pointing at the same S3 bytes, no duplication. Cross-human safe (a Card can target a project shared via any Sharing Role, including Observer). The ONE signal kind that produces a real changeset, and so the only kind that can be reverted. Extracted into `fileCardAttachments` so the PhyLog Agent can perform this same deterministic step directly without a separate `nopal sort run` — both callers share the same `kind: "file-added"` idempotency key, so running both for the same day never double-files an attachment.

Runs once per closed day per human, idempotently: `DailyLog.sortedAt` short-circuits a re-run unless `force` is passed, and every entry is ALSO idempotent against its own `source_ref` (`findReleaseLogEntryBySource`) — keyed off the originating signal, never off anything a re-run would freshly create. A day with no `daily_logs` cache row at all is left alone entirely (not marked sorted, since `sortedAt` lives on that same row).

Triggered two ways, both landing on the exact same `sortDailyLog(humanId, date)`:

- **The once-a-day cron** — `POST /api/daily-log/sort-all`, same `CRON_SECRET` as `archive-cleanup`, wired into `server.js` alongside it. Calls `sortAllDueDailyLogs()`, which finds every human's `daily_logs` rows strictly before today's UTC date with no `sortedAt` (`getUnsortedDailyLogsBefore`) and sorts each — self-healing if a run is missed.
- **On demand** — `POST /api/daily-log/sort` (session or bearer auth; any non-`"sync"` token scope, including `"sorter"` — see `apiTokens.server.ts`), and `nopal sort run [--date YYYY-MM-DD] [--force]` in the CLI — a thin client over that same endpoint. One real implementation, usable by a human via CLI today and an eventual sorting agent later.
- **A manual "Sort this day" testing button** on the Daily Log page (`SortTestPanel`, below today's entry) — hits the same endpoint with `force: true` and shows the result plus the day's `release-log.md` inline, so a human can iterate without waiting for the cron. Deliberately styled as an obvious dev panel, not a permanent part of daily-log-writing.

**Release Log entries are structured DB rows, not hand-appended markdown** — `release_log_entries` (id, project, date, acting human, `kind`, `summary`, a stable `source_ref`, a project-scoped `sequence`, `reverted_at`) is the source of truth; both markdown files below are pure, regenerated-on-change reflections of it (`regenerateProjectReleaseLog`/`regenerateDailyReleaseLog`), never appended to directly — a deliberate INVERSION of the Sharing Roles pattern (there, the file is truth and the DB is a cache), since a revertible entry needs a stable id and strict order. Each rendered bullet carries an invisible `<!-- release-log-entry:<id> -->` marker so a future UI can target "revert this one" without re-deriving identity from rendered text.

Every entry is reflected into BOTH places (same rows, two views):

- `daily-logs/YYYY-MM-DD/release-log.md` — that human's own receipt for the day, grouped by project (`## <Project Name>`), resolved fresh every time.
- `projects/<name>/release-log.md` — everyone with project access, grouped by date (`## YYYY-MM-DD`). One file per project, right alongside `README.md` (and `skills/`, if present).

**A CHANGESET** (`release_log_changesets`) is one (entry, file) pair recording a full `before`/`after` snapshot of a project file mutation — not a diff (small files, a snapshot is simpler/more robust than `file_refs.md_versions`' own reasoning). An entry with no changesets (a mention or task) is purely informational. Today only the file-attachment signal produces one, action `"created"` (`before: null`, `after`: enough fields to recreate the `file_refs` row).

**Revert/replay is real but deliberately not exposed anywhere yet** (`revertReleaseLogEntry`, `POST /api/release-log/:entryId/revert`, `nopal release-log revert <entryId>`) — built ahead of an actual UI need. Reverting entry N restores every file its changesets touched to its `before` state, then REPLAYS every LATER, not-yet-reverted entry touching those same files (in `sequence` order), reapplying each one's stored `after` snapshot — a `"created"` replay recreates the file under a fresh id, so that entry's own changeset `file_id` is updated in place. Requires an owner-tier Sharing Role; an entry with no changesets is rejected outright.

**A real, explicitly-flagged limitation**: "replay = reapply the stored snapshot" is only guaranteed correct for INDEPENDENT operations — true of every Sorter changeset (each `"created"` is a brand-new file, never touched by another entry). The PhyLog Agent is the first real producer of chained `content-edit` changesets on the SAME file (successive README rewrites) — a later edit might assume an earlier one was already applied, so reapplying its stored `after` post-revert could reintroduce or duplicate content. Not solved, flagged on purpose.

## The PhyLog Agent

Where the Sorter is deliberately zero-inference, PhyLog is the actual "AI magic" layered on top of everything above (Cards, the Sorter, Release Log entries/changesets/revert, `project-n01` spaces) — a three-stage pipeline (pre-capture -> capture -> post-capture) that turns a project's daily-log Cards and synced files into filed content, written summaries, and an up-to-date, organized README.md. Fully documented in its own standalone `phylog` skill (`.agents/skills/phylog/SKILL.md`) — consult it for anything touching `phylogAgent.server.ts`, `preCapture.server.ts`, `capture.server.ts`, `postCapture.server.ts`, `projectN01.server.ts`, `llmProvider.ts`, `anthropicProvider.server.ts`, or `nopal phylog`.
