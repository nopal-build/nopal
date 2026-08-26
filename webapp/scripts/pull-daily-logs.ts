// webapp/scripts/pull-daily-logs.ts
//
// Pulls YOUR OWN daily-logs history down from a real deployment (production
// by default) and seeds it into local dev, so GraphLog can be built/tested
// against real content instead of fixtures.
//
// Usage (from webapp/):
//   npx vite-node scripts/pull-daily-logs.ts --token=<bearer-token> --email=you@example.com [--host=https://nopal.build] [--name="Your Name"] [--projects=Sunny,Other] [--ignoreProject=Footage]
//
// Where to get --token: whatever bearer token your CLI is already using
// against that host (`~/.config/nopal/credentials.json`, or your OS
// keychain's leftover "nopal-cli" entry if you haven't run any CLI
// command since upgrading past the point that entry got migrated out) —
// the same token `nopal vault ls` etc. already send as
// `Authorization: Bearer ...`. --email should be the SAME account's email;
// it's used only to create/update a matching local `humans` row so logging
// into LOCAL DEV as that address surfaces this seeded data as yours.
//
// --projects=Name1,Name2   only these projects (among the ones referenced
//                          by a pulled Card) are eligible to be pulled —
//                          everything else referenced is skipped entirely,
//                          files included. Case-insensitive.
// --ignoreProject=Name1,Name2
//                          these projects are NEVER pulled, even if
//                          referenced by a Card and even if --projects
//                          would otherwise include them — for a project
//                          whose attachments are too large to want locally
//                          (e.g. a raw-footage folder). Case-insensitive.
// Neither flag affects daily-logs themselves — only which REFERENCED
// projects get pulled alongside them.
//
// Also pulls down every PROJECT actually referenced by a Card among the
// pulled days (recursively — the whole folder, including a `skills/`
// subfolder if one exists) — enough for a Card to show its real project
// name instead of "Unknown project", and for `nopal graphlog run` to have a
// real README.md (and SKILL.md) to work with locally. Deliberately NOT
// your entire `projects/` tree — only the ones your pulled Cards actually
// point at.
//
// Non-text attachments (images, PDFs, ...) have their actual BYTES copied
// into local S3 too — not just their `s3_key`/`s3_url` pointer, which would
// be meaningless once presigned against local MinIO's own, completely
// separate bucket. Downloads via `/api/vault/download/:fileId` (the same
// bearer-aware endpoint `nopal vault download` already relies on) and
// re-uploads via `uploadPrivateFileToS3`. Re-running this script also
// repairs any attachment pulled by an earlier version of it that never
// copied bytes (see `isLocalizedS3Key`).
//
// Every pulled file/folder keeps its EXACT production id locally (see
// `createFileRef`/`createVaultFolder`'s own `id` parameter) instead of
// getting a fresh, auto-generated one. This matters because Card content
// embeds ids directly in directives (`::file{fileId="..."}`,
// `::card{file="..." projectFolderId="..."}` — see the `vault` skill's
// "Cards" section) rather than by name/path, so a mismatched local id would
// silently break every attachment/project-link a pulled Card has. Keeping
// ids identical means those directives just work, with no separate remap
// pass needed. Idempotency follows from the same fact: "already pulled" is
// simply "a local record already exists at this exact id" — see
// `getFileRefById`/`getFolderById` below.
//
// NOTE: a version of this script that predates id-preservation may have
// left behind local files/folders with DIFFERENT (locally auto-generated)
// ids than production. Re-running this version won't detect or clean those
// up — it'll just create a second, correctly-id'd copy alongside them. If
// you pulled data before this change, run `make reset` (or otherwise clear
// your local vault for this human) before re-pulling for a clean result.

import {
  createFileRef,
  createVaultFolder,
  ensureVaultRootFolders,
  getFileRefById,
  getFolderById,
  getOrCreateVaultFolder,
  resolveDailyLogsFolder,
} from "robustness-core/data/vault.server";
import { cacheDailyLog } from "robustness-core/data/dailyLog.server";
import { uploadPrivateFileToS3 } from "robustness-core/data/file.server";
import { merge } from "robustness-core/data/generic.server";
import { getDb } from "robustness-core/data/db.server";
import { ensureProjectN02 } from "robustness-core/data/projectN02.server";
import { parseSyncedCardFileName, parseSyncedAttachmentFileName } from "robustness-core/data/dailyLogSync.server";
import { RecordId } from "surrealdb";
import type { VaultFolder } from "robustness-core/data/vault.types";

/** A REAL, CONFIRMED GAP, FOUND AND FIXED: this script mirrors a
 * project's ALREADY-SYNCED `syncs/Daily Logs/*` tree byte-for-byte via
 * `pullFolderTree` below, but never set `date` on any of it -- and for
 * every contributor OTHER than whoever ran this script, that pulled
 * mirror is the ONLY local copy that will ever exist (their own RAW
 * daily-log Cards were never pulled, so a local `runDailyLogSync` re-run
 * can never regenerate -- or fix -- their days). `sync-graph`'s own
 * `collectDatedCandidates` requires a real `date` (`!!f.date`), so every
 * one of those days was silently invisible to the whole graph, no matter
 * what either skill said. Fixed here since `date` is fully recoverable
 * from the filename shape itself (`dailyLogSync.server.ts`'s own
 * `parseSyncedCardFileName`/`parseSyncedAttachmentFileName`), with no
 * need to ask production for it. */
function dateFromSyncedName(name: string): string | null {
  return parseSyncedCardFileName(name)?.date ?? parseSyncedAttachmentFileName(name)?.date ?? null;
}

type Args = {
  host: string;
  token: string;
  email: string;
  name: string;
  /** Only these project names are eligible to be pulled (case-insensitive)
   * — an empty list means "no restriction" (every referenced project is
   * eligible). Everything else referenced by a Card is skipped entirely,
   * including its files — useful for pulling just the project you're
   * actually working on. */
  projectsFilter: string[];
  /** These project names are never pulled (case-insensitive), even if
   * referenced by a Card and even if `projectsFilter` would otherwise
   * include them — for a project with attachments too large to want
   * locally (e.g. a "Footage" folder of raw video). */
  ignoreProjects: string[];
};

function splitNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(): Args {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
  }
  const token = flags.get("token");
  const email = flags.get("email");
  if (!token || !email) {
    throw new Error(
      "Usage: vite-node scripts/pull-daily-logs.ts --token=<bearer-token> --email=you@example.com [--host=https://nopal.build] [--name=\"Your Name\"] [--projects=Sunny,Other] [--ignoreProject=Footage]",
    );
  }
  return {
    host: flags.get("host") ?? "https://nopal.build",
    token,
    email: email.trim().toLowerCase(),
    name: flags.get("name") ?? email,
    projectsFilter: splitNames(flags.get("projects")),
    ignoreProjects: splitNames(flags.get("ignoreProject")),
  };
}

/** Whether `name` should actually be pulled, given `--projects`/
 * `--ignoreProject` — case-insensitive on both sides. */
function shouldPullProject(
  name: string,
  projectsFilter: string[],
  ignoreProjects: string[],
): boolean {
  const lower = name.toLowerCase();
  if (
    projectsFilter.length > 0 &&
    !projectsFilter.some((p) => p.toLowerCase() === lower)
  ) {
    return false;
  }
  if (ignoreProjects.some((p) => p.toLowerCase() === lower)) {
    return false;
  }
  return true;
}

// ─── Remote read (production, over HTTP) ───────────────────────────────

type RemoteFileListing = {
  _id: string;
  name: string;
  content_type: string;
  size: number | null;
  source?: "daily_log" | "daily_log_card";
  date?: string;
  project_folder_id?: string | null;
};

type RemoteFullFile = RemoteFileListing & {
  content: string | null;
  s3_key: string | null;
  s3_url: string | null;
};

async function remoteJson<T>(host: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

async function remoteChildren(
  host: string,
  token: string,
  folderId: string,
): Promise<{ folders: VaultFolder[]; files: RemoteFileListing[] }> {
  return remoteJson(host, token, `/api/vault/folders/${folderId}/children`);
}

async function remoteFile(host: string, token: string, fileId: string): Promise<RemoteFullFile> {
  const { file } = await remoteJson<{ file: RemoteFullFile }>(host, token, `/api/vault/${fileId}`);
  return file;
}

/**
 * Resolves the token's OWN daily-log storage folder, mirroring
 * `resolveDailyLogsFolder` (`vault.server.ts`) over HTTP instead of DB
 * access — see the `graphlog` skill's "Daily Logs symlink" section. The
 * vault-wide `daily-logs` ROOT was retired there in favor of
 * `personal/syncs/Daily Logs`; a not-yet-migrated human may still have the
 * legacy root, so that's checked FIRST (same order `resolveDailyLogsFolder`
 * itself uses) before falling back to the new location.
 */
async function remoteResolveDailyLogsFolder(
  host: string,
  token: string,
  root: { folders: VaultFolder[] },
): Promise<VaultFolder> {
  const legacyRoot = root.folders.find((f) => f.vault_root_key === "daily-logs");
  if (legacyRoot) return legacyRoot;

  const personal = root.folders.find((f) => f.vault_root_key === "personal");
  if (!personal) {
    throw new Error("No daily-logs root or personal root found for this token -- is it valid?");
  }

  const { folders: personalChildren } = await remoteChildren(host, token, personal._id);
  const syncsFolder = personalChildren.find(
    (f) => f.is_folder_type_root && f.folder_type === "syncs",
  );
  if (!syncsFolder) {
    throw new Error("No Syncs folder found under this token's personal space.");
  }

  const { folders: syncsChildren } = await remoteChildren(host, token, syncsFolder._id);
  const dailyLogsFolder = syncsChildren.find((f) => f.name === "Daily Logs");
  if (!dailyLogsFolder) {
    throw new Error("No Daily Logs folder found under this token's personal/Syncs space.");
  }
  return dailyLogsFolder;
}

// ─── Local write (direct DB, same pattern scripts/seed/index.ts uses) ─────

async function ensureLocalHuman(id: string, email: string, name: string): Promise<void> {
  // `getDb()` returns a SINGLE connection cached and reused for the whole
  // process's lifetime (see db.server.ts's own doc comment) — every other
  // vault.server.ts/generic.server.ts call this script makes later shares
  // this exact same connection, so it must NEVER be closed here. Closing it
  // used to leave every later call (e.g. resolveDailyLogsFolder) failing
  // with a `ConnectionUnavailable` against the now-dead cached connection.
  const db = await getDb();
  const existing = await db.select(new RecordId("humans", id));
  if (existing) {
    // `db.upsert` REPLACES the entire record (SurrealDB's own docs: "UPSERT
    // replaces the entire record if it exists") — doing that here would
    // silently stomp an already-promoted local role (Super/Admin) back
    // down to "Human" on every single re-run of this script, which is
    // exactly the bug this guarded against. `db.merge` only touches the
    // fields we actually pass, leaving role (and anything else) alone.
    await db.merge(new RecordId("humans", id), { email, name });
  } else {
    await db.upsert(new RecordId("humans", id), {
      email,
      name,
      role: "Human",
    });
  }
}

type PullCounts = { filesCreated: number; filesSkipped: number; attachmentsCopied: number };

/** Our own local S3 keys always start with this prefix (see `api.vault.upload.tsx`'s
 * own convention, mirrored here) — a raw production key never will, so this
 * is how we tell "already copied locally" apart from "still points at
 * production" on a re-run. */
function isLocalizedS3Key(key: string | null | undefined): boolean {
  return !!key && key.startsWith("vault/");
}

/**
 * Downloads a file's actual bytes from the REMOTE deployment (via
 * `/api/vault/download/:fileId` — the same bearer-aware endpoint
 * `nopal vault download` already relies on; it returns a presigned
 * PRODUCTION S3 url as JSON, which we then fetch) and re-uploads them into
 * LOCAL S3, so `/api/vault/view/:fileId` works locally too. Without this,
 * only the raw production `s3_key` pointer would exist locally —
 * meaningless once presigned against local MinIO's own, completely
 * separate bucket, which has never heard of that object. Returns `null`
 * (logging a warning) rather than throwing, so one failed attachment never
 * aborts the whole pull.
 */
async function localizeAttachment(
  host: string,
  token: string,
  humanId: string,
  localFolderId: string,
  fileId: string,
  fileName: string,
): Promise<{ s3_key: string; s3_url: string } | null> {
  try {
    const { url } = await remoteJson<{ url: string }>(
      host,
      token,
      `/api/vault/download/${fileId}`,
    );
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // Same key shape `api.vault.upload.tsx` uses for a real upload.
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3_key = `vault/${humanId}/${localFolderId}/${Date.now()}-${safeName}`;
    const s3_url = await uploadPrivateFileToS3(bytes, s3_key);
    return { s3_key, s3_url };
  } catch (err) {
    console.warn(
      `  ! Failed to copy bytes for "${fileName}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * Recursively mirrors ONE remote folder's entire subtree (sub-folders +
 * files, at any depth) into a local one — used for pulling a specific
 * project a Card referenced, including its `skills/` subfolder if it has
 * one. Preserves a sub-folder's own `folder_type` when it's a TYPE ANCHOR
 * (`is_folder_type_root`, e.g. a project's "Skills" folder) so GraphLog's
 * own skills lookup still recognizes it locally — an ordinary folder is
 * created untyped and just inherits from its new local parent, same as it
 * would remotely.
 *
 * Every file/folder keeps its remote id locally (see this file's own
 * header comment) — "already pulled" is therefore just "a local record
 * already exists at this exact id", checked directly by id rather than by
 * matching siblings by name.
 *
 * Deliberately separate from the flat daily-logs loop below (which never
 * needs to recurse — a date folder is always exactly one level deep).
 */
async function pullFolderTree(
  host: string,
  token: string,
  humanId: string,
  remoteFolderId: string,
  localParentId: string,
  counts: PullCounts,
): Promise<void> {
  const { folders, files } = await remoteChildren(host, token, remoteFolderId);

  for (const listing of files) {
    const isText = listing.content_type.startsWith("text/");
    const existingFile = await getFileRefById(listing._id);
    if (existingFile) {
      counts.filesSkipped++;
      // Repair a file pulled before this script copied S3 bytes locally —
      // its `s3_key` still points at PRODUCTION, meaningless once
      // presigned against local MinIO's own bucket.
      if (existingFile.s3_key && !isLocalizedS3Key(existingFile.s3_key)) {
        const localized = await localizeAttachment(
          host, token, humanId, localParentId, listing._id, listing.name,
        );
        if (localized) {
          await merge("file_refs", existingFile._id, localized);
          counts.attachmentsCopied++;
        }
      }
      // Backfill `date` on an already-pulled Daily Logs sync file that
      // predates this fix -- see this file's own "A REAL, CONFIRMED GAP"
      // module note above.
      const recoveredDate = dateFromSyncedName(existingFile.name);
      if (recoveredDate && existingFile.date !== recoveredDate) {
        await merge("file_refs", existingFile._id, { date: recoveredDate });
      }
      continue;
    }

    const full = isText
      ? await remoteFile(host, token, listing._id)
      : await remoteFile(host, token, listing._id).catch(() => null);

    let s3Key: string | null = null;
    let s3Url: string | null = null;
    if (full?.s3_key) {
      const localized = await localizeAttachment(
        host, token, humanId, localParentId, listing._id, listing.name,
      );
      if (localized) {
        s3Key = localized.s3_key;
        s3Url = localized.s3_url;
        counts.attachmentsCopied++;
      }
    }

    await createFileRef({
      id: listing._id,
      human_id: humanId,
      name: listing.name,
      content: full?.content ?? null,
      content_type: listing.content_type,
      s3_url: s3Url,
      s3_key: s3Key,
      size: listing.size,
      folder_id: localParentId,
      // See this file's own "A REAL, CONFIRMED GAP" module note above --
      // recoverable directly from the filename, no need to ask production.
      date: dateFromSyncedName(listing.name) ?? undefined,
    });
    counts.filesCreated++;
  }

  for (const sub of folders) {
    const existingSub = await getFolderById(sub._id);
    const localSub =
      existingSub ??
      (await createVaultFolder({
        id: sub._id,
        human_id: humanId,
        name: sub.name,
        parent_folder_id: localParentId,
        // Only set when THIS folder itself defines a type remotely — an
        // ordinary folder is passed `undefined` so it inherits from its
        // new local parent instead (see `createVaultFolder`'s own doc).
        folder_type: sub.is_folder_type_root ? sub.folder_type ?? null : undefined,
      }))!;
    await pullFolderTree(host, token, humanId, sub._id, localSub._id, counts);
  }
}

async function main() {
  const { host, token, email, name, projectsFilter, ignoreProjects } = parseArgs();

  console.log(`Reading daily-logs from ${host} ...`);
  const root = await remoteChildren(host, token, "root");
  const dailyLogsRoot = await remoteResolveDailyLogsFolder(host, token, root);
  const humanId = dailyLogsRoot.human_id;
  console.log(`Found daily-logs for human ${humanId}.`);

  await ensureLocalHuman(humanId, email, name);
  console.log(`Upserted local humans:${humanId} (${email}).`);

  // Mirrors the same personal/syncs/Daily Logs resolution remotely just
  // used, straight from the app's own vault.server.ts, so this can't drift
  // from how a real login would resolve the same human's local storage.
  const localRoot = await resolveDailyLogsFolder(humanId);

  const { folders: dateFolders } = await remoteChildren(host, token, dailyLogsRoot._id);
  console.log(`Found ${dateFolders.length} day(s) remotely.`);

  let daysCreated = 0;
  let filesCreated = 0;
  let filesSkipped = 0;
  let daysCached = 0;
  let attachmentsCopied = 0;
  const referencedProjectIds = new Set<string>();

  for (let i = 0; i < dateFolders.length; i++) {
    const dateFolder = dateFolders[i];
    const localDateFolder = await getOrCreateVaultFolder(humanId, dateFolder.name, localRoot._id);
    daysCreated++;

    const { files } = await remoteChildren(host, token, dateFolder._id);

    for (const listing of files) {
      const isText = listing.content_type.startsWith("text/");
      const existingFile = await getFileRefById(listing._id);
      if (existingFile) {
        filesSkipped++;
        if (existingFile.project_folder_id) {
          referencedProjectIds.add(existingFile.project_folder_id);
        }
        // Repair a file pulled before this script copied S3 bytes locally
        // (see `localizeAttachment`'s own doc comment) — its `s3_key`
        // still points at PRODUCTION, meaningless once presigned against
        // local MinIO's own, separate bucket.
        if (existingFile.s3_key && !isLocalizedS3Key(existingFile.s3_key)) {
          const localized = await localizeAttachment(
            host, token, humanId, localDateFolder._id, listing._id, listing.name,
          );
          if (localized) {
            await merge("file_refs", existingFile._id, localized);
            attachmentsCopied++;
          }
        }
        continue;
      }

      const full = isText
        ? await remoteFile(host, token, listing._id)
        : await remoteFile(host, token, listing._id).catch(() => null);

      let s3Key: string | null = null;
      let s3Url: string | null = null;
      if (full?.s3_key) {
        const localized = await localizeAttachment(
          host, token, humanId, localDateFolder._id, listing._id, listing.name,
        );
        if (localized) {
          s3Key = localized.s3_key;
          s3Url = localized.s3_url;
          attachmentsCopied++;
        }
      }

      await createFileRef({
        id: listing._id,
        human_id: humanId,
        name: listing.name,
        content: full?.content ?? null,
        content_type: listing.content_type,
        s3_url: s3Url,
        s3_key: s3Key,
        size: listing.size,
        folder_id: localDateFolder._id,
        source: listing.source,
        date: listing.date,
        // Same id as production (see `id` above) means this can be set
        // directly — no separate remap step needed to translate it into a
        // local project folder id, since there's no longer a difference.
        project_folder_id: full?.project_folder_id ?? null,
      });
      filesCreated++;
      if (full?.project_folder_id) referencedProjectIds.add(full.project_folder_id);
    }

    // `vault_folders`/`file_refs` (written above) are the vault's real
    // storage, but the Daily Log page's own listing reads from a SEPARATE
    // `daily_logs` CACHE table (`dailyLog.server.ts`) that nothing above
    // touches — without this, every pulled day is invisible on that page
    // (and to a plain look at the `daily_logs` table) even though the
    // real content is sitting in the vault correctly. Always re-cache
    // (not just when the file was newly created above) so this also
    // repairs a day left stale by an earlier, partial run.
    const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
    if (readmeListing) {
      const readme = await remoteFile(host, token, readmeListing._id);
      await cacheDailyLog(humanId, dateFolder.name, readme.content ?? "");
      daysCached++;
    }

    if (i % 20 === 0) {
      console.log(`  ... ${i + 1}/${dateFolders.length} days processed`);
    }
  }

  console.log(
    `\nDone with daily-logs. ${daysCreated} day folder(s) ensured locally, ${filesCreated} file(s) created, ${filesSkipped} already present (skipped), ${daysCached} day(s) cached for the Daily Log page, ${attachmentsCopied} attachment(s) copied to local S3.`,
  );

  // ── Projects referenced by a pulled Card ───────────────────────
  let projectsCreated = 0;
  const projectCounts: PullCounts = { filesCreated: 0, filesSkipped: 0, attachmentsCopied: 0 };
  if (referencedProjectIds.size > 0) {
    console.log(`\nPulling ${referencedProjectIds.size} referenced project(s)...`);
    const remoteProjectsRoot = root.folders.find((f) => f.vault_root_key === "projects");
    const localRoots = await ensureVaultRootFolders(humanId);
    const localProjectsRoot = localRoots.find((f) => f.vault_root_key === "projects");

    if (remoteProjectsRoot && localProjectsRoot) {
      const { folders: remoteProjects } = await remoteChildren(host, token, remoteProjectsRoot._id);

      for (const projectId of referencedProjectIds) {
        const remoteProject = remoteProjects.find((f) => f._id === projectId);
        if (!remoteProject) {
          console.log(`  ! Skipping ${projectId} — not found under your remote projects/ (maybe someone else's shared project).`);
          continue;
        }
        if (!shouldPullProject(remoteProject.name, projectsFilter, ignoreProjects)) {
          console.log(`  - Skipping "${remoteProject.name}" (excluded by --projects/--ignoreProject).`);
          continue;
        }
        const existingLocal = await getFolderById(remoteProject._id);
        // A REAL, CONFIRMED BUG, found and fixed here: tagging the local
        // project `project-n02` immediately at creation used to fire
        // `createVaultFolder`'s own `ensureProjectN02` side effect (auto-
        // provisioning a Skills folder, seeded with the DEFAULT skill
        // text) BEFORE `pullFolderTree` below ever got a chance to bring
        // in the REAL remote Skills folder (its own original id, its own
        // real content) -- leaving every freshly-pulled project-n02
        // project with TWO "Skills" folders, neither one deduped by the
        // deterministic-id fix (`projectN02.server.ts`'s own
        // `applyProjectN02Shape`), since that fix only prevents the SAME
        // code path racing against itself, not two genuinely different
        // creation paths (auto-provision vs. a real pull) each producing
        // one. Fixed by creating the local project UNTYPED here, pulling
        // the real tree first, and only THEN applying the remote's own
        // type below -- by the time `ensureProjectN02` runs, the real
        // Skills folder (if any) already exists, so it's a safe no-op
        // seed rather than a duplicate.
        const localProject =
          existingLocal ??
          (await createVaultFolder({
            id: remoteProject._id,
            human_id: humanId,
            name: remoteProject.name,
            parent_folder_id: localProjectsRoot._id,
          }))!;
        if (!existingLocal) projectsCreated++;
        console.log(`  → ${remoteProject.name}`);
        await pullFolderTree(host, token, humanId, remoteProject._id, localProject._id, projectCounts);

        if (!existingLocal && remoteProject.is_folder_type_root && remoteProject.folder_type) {
          await merge("vault_folders", localProject._id, {
            folder_type: remoteProject.folder_type,
            is_folder_type_root: true,
            updated_at: new Date().toISOString(),
          });
          if (remoteProject.folder_type === "project-n02") {
            const retagged = await getFolderById(localProject._id);
            if (retagged) await ensureProjectN02(retagged);
          }
        }
      }
    }

    console.log(
      `Done with projects. ${projectsCreated} project folder(s) created, ${projectCounts.filesCreated} file(s) created, ${projectCounts.filesSkipped} already present (skipped), ${projectCounts.attachmentsCopied} attachment(s) copied to local S3.`,
    );
  }

  console.log(
    `\nLog into local dev as ${email} to see this data.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
