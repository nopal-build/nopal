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
// point at. Projects you did NOT create but were SHARED with you count
// here too (`?withShared=1`, same flag the CLI's own `Client::children`
// always passes) — a Card can reference any project you can see, and
// those used to be skipped outright, leaving them as "Unknown project"
// locally. A shared project is mirrored as the local human's OWN project
// (there's only one human in local dev), keeping its production id.
//
// EVERY CONTRIBUTOR GETS A REAL LOCAL IDENTITY, or this script fails.
// Your own raw daily-log Cards are the only Cards pulled; everyone else's
// writing arrives as the project's already-synced `syncs/Daily Logs/`
// mirror. So this script used to create exactly ONE local `humans` row
// (yours) while pulling several people's words, and `sync-graph` resolved
// every one of those other people to the same literal "Unknown" -- which
// then went into their nodes' citations permanently, made every non-
// puller count as a single author in ADR-003's ranking, and made pulling
// MORE people's logs produce a WORSE README than pulling nobody's. See
// ADR-015. Every contributor id in the pulled mirror is now resolved to a
// real name and email via `/api/humans/related` and written to a local
// `humans` row; one that can't be resolved exits nonzero rather than
// leaving a plausible-looking, mis-attributed local copy behind.
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
import { parseProjectManifest } from "robustness-core/data/project.types";
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

/** The CONTRIBUTOR behind a mirrored daily-log file, off the same two
 * filename shapes `dateFromSyncedName` reads -- for every contributor
 * other than whoever ran this script, that filename is the only place
 * their identity exists locally at all. See `ensureContributorHumans`. */
function contributorIdFromSyncedName(name: string): string | null {
  return parseSyncedCardFileName(name)?.humanId ?? parseSyncedAttachmentFileName(name)?.humanId ?? null;
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

/**
 * `withShared` merges every project someone ELSE shared with this token's
 * human into the result — only meaningful when `folderId` is that human's
 * own top-level `projects` root (see
 * `api.vault.folders.$folderId.children.tsx`'s own doc). Without it, a
 * Card pointing at a project you didn't create resolves to nothing and is
 * skipped entirely, which is exactly the gap this closes; the CLI
 * (`crates/core/src/vault.rs`'s `Client::children`) always passes it, for
 * the same reason.
 */
async function remoteChildren(
  host: string,
  token: string,
  folderId: string,
  opts: { withShared?: boolean } = {},
): Promise<{ folders: VaultFolder[]; files: RemoteFileListing[] }> {
  const query = opts.withShared ? "?withShared=1" : "";
  return remoteJson(host, token, `/api/vault/folders/${folderId}/children${query}`);
}

async function remoteFile(host: string, token: string, fileId: string): Promise<RemoteFullFile> {
  const { file } = await remoteJson<{ file: RemoteFullFile }>(host, token, `/api/vault/${fileId}`);
  return file;
}

/**
 * `remoteFile` that never throws — one unreadable file must not abort a
 * whole pull, exactly like `localizeAttachment` already refuses to.
 *
 * This is NOT hypothetical: `/api/vault/:fileId` was owner-only until
 * recently, so on a deployment that hasn't picked up the `canViewFileRef`
 * change yet, every file inside a project that was merely SHARED with you
 * answers 404 — and the pull died mid-project on the first one. Skipping
 * still gets the folder tree, names and structure of that project locally
 * (a Card can at least resolve its real project name); only the file
 * CONTENT is missing, and a later re-run against an updated deployment
 * fills it in, since a content-less local file is still "already pulled"
 * by id.
 */
async function remoteFileOrNull(
  host: string,
  token: string,
  fileId: string,
  fileName: string,
): Promise<RemoteFullFile | null> {
  try {
    return await remoteFile(host, token, fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `  ! Could not read "${fileName}" remotely (${message.split("\n")[0]}) — pulled without content.`,
    );
    return null;
  }
}

/** `remoteChildren` that answers `null` instead of throwing when the
 * folder isn't readable by this token (404) — used to PROBE whether a
 * project is reachable at all, where "no" is a real answer, not an error. */
async function remoteChildrenOrNull(
  host: string,
  token: string,
  folderId: string,
): Promise<{ folders: VaultFolder[]; files: RemoteFileListing[] } | null> {
  try {
    return await remoteChildren(host, token, folderId);
  } catch {
    return null;
  }
}

/**
 * Resolves a project a Card points at but that the `projects` root listing
 * (even `?withShared=1`) never returned.
 *
 * `getTopLevelSharedFolders` — what `withShared` merges in — deliberately
 * returns only the folder that was ACTUALLY shared, filtering out any
 * shared folder whose parent is itself shared. So a project reachable
 * because something ABOVE it was shared with you never appears in that
 * list, even though `canViewFolder` grants you full access to it (sharing
 * cascades `shared_with` onto every descendant). Same for a project whose
 * `shared_with` cache has drifted from its README's own `sharing:` front
 * matter (see `projectSharing.server.ts` — that array is a DERIVED cache).
 *
 * There is no "GET one folder by id" endpoint, so reachability is probed
 * by listing the project's own children: a 404 means genuinely no access,
 * anything else means we can read it and should pull it. The folder RECORD
 * itself still isn't available that way, so its display name comes from
 * its own README.md front matter (`title:`) — falling back to the id,
 * which at least keeps the project distinguishable locally rather than
 * dropping it entirely.
 */
async function resolveUnlistedProject(
  host: string,
  token: string,
  projectId: string,
): Promise<VaultFolder | null> {
  const children = await remoteChildrenOrNull(host, token, projectId);
  if (!children) return null;

  const readmeListing = children.files.find((f) => f.name.toLowerCase() === "readme.md");
  const readme = readmeListing
    ? await remoteFileOrNull(host, token, readmeListing._id, readmeListing.name)
    : null;
  const title = readme?.content
    ? parseProjectManifest(readme.content).manifest?.title
    : undefined;

  return {
    _id: projectId,
    name: title || projectId,
    // Unknown — the folder record itself was never readable. Only used to
    // decide whether to log "shared with you by ...", so an empty owner
    // just means that line reads as unknown rather than being wrong.
    human_id: "",
    parent_folder_id: null,
    // A Card only ever points `projectFolderId` at a real project, so
    // this is safe to assert — and it's what makes `ensureProjectN02`
    // run for it below, exactly as for a listed project.
    is_folder_type_root: true,
    folder_type: "project-n02",
  } as VaultFolder;
}

type RemoteRelatedHuman = { _id: string; name: string; email: string };

/**
 * Every human this token can see -- the same list the vault's own share
 * picker uses, exposed as JSON for the CLI (`nopal vault share --with`).
 *
 * This is what lets a pulled node name a REAL person. Without it this
 * script creates exactly ONE local `humans` row (the puller's own, see
 * `ensureLocalHuman`), while the mirrored `syncs/Daily Logs/` tree it
 * pulls carries writing from everyone on the project -- so every other
 * contributor had no local identity at all and `sync-graph` resolved them
 * all to the same literal "Unknown" (ADR-015).
 *
 * For an Admin or Super `getRelatedHumans` returns every other human, so
 * the whole team resolves in this one call. For anyone else it returns
 * only relationship-scoped humans, which is a real and legitimate way to
 * hit the hard stop in `ensureContributorHumans` below.
 */
async function remoteRelatedHumans(host: string, token: string): Promise<RemoteRelatedHuman[]> {
  try {
    const { humans } = await remoteJson<{ humans: RemoteRelatedHuman[] }>(host, token, "/api/humans/related");
    return humans;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read /api/humans/related from ${host} (${message.split("\n")[0]}).\n` +
        `Without it every contributor other than you pulls in nameless, and a nameless contributor is exactly what this script exists to stop producing.`,
    );
  }
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

/**
 * Gives every contributor whose writing this pull brought down a REAL
 * local `humans` row — their actual name and email, from
 * `/api/humans/related`.
 *
 * A contributor this token cannot resolve FAILS the run (ADR-015). That
 * is deliberately harsher than skipping them, and the reason is that the
 * damage is not repairable afterwards: `sync-graph` bakes the name into
 * each node's `:ref{}` at write time, a node is permanent, and the day's
 * `sourceHash` covers only source file id and content hash — so seeding
 * the human later changes nothing already written and the day is skipped
 * as up to date. A partial identity set does not produce a partial
 * README; it produces a complete-looking one that is missing whole
 * people. That is the failure this whole script's identity handling
 * exists to close, so it stops here instead.
 *
 * The puller's own id is excluded: `getRelatedHumans` never returns you
 * to yourself, and `ensureLocalHuman` has already created that row.
 */
async function ensureContributorHumans(
  contributorIds: Set<string>,
  ownHumanId: string,
  related: RemoteRelatedHuman[],
): Promise<string[]> {
  const byId = new Map(related.map((h) => [h._id, h]));
  const unresolvable: string[] = [];
  let created = 0;

  for (const id of [...contributorIds].sort()) {
    if (id === ownHumanId) continue;
    const human = byId.get(id);
    if (!human || !human.name.trim()) {
      unresolvable.push(id);
      continue;
    }
    await ensureLocalHuman(id, human.email, human.name);
    created++;
    console.log(`  → humans:${id} (${human.name} <${human.email}>)`);
  }

  console.log(
    `Resolved ${created} other contributor(s) to a real local humans row.`,
  );
  return unresolvable;
}

type PullCounts = {
  filesCreated: number;
  filesSkipped: number;
  attachmentsCopied: number;
  /** Text files whose content an EARLIER run couldn't read (see
   * `remoteFileOrNull`) and this one filled in. */
  contentBackfilled: number;
  /** Sub-folders the host refused to list, whose subtree was skipped —
   * see `pullFolderTree`'s own note on the un-cascaded `shared_with` that
   * causes it. */
  foldersUnreadable: number;
  /** Every human id seen in a mirrored daily-log filename — i.e. everyone
   * whose writing this pull is bringing down. Not a count: these are
   * turned into real local `humans` rows by `ensureContributorHumans`,
   * and a single one that can't be named fails the run (ADR-015). */
  contributorIds: Set<string>;
};

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
  label: string,
): Promise<void> {
  /** A REAL, CONFIRMED BUG, reproduced here: this listing THREW, and since
   * nothing catches it, one unreadable sub-folder killed the entire run —
   * every project after the one being pulled was silently never reached
   * ("6 referenced projects", 2 pulled, no error about the other 4).
   *
   * It is genuinely reachable: sharing cascades `shared_with` onto
   * descendants at share-time, but a sub-folder CREATED INSIDE an already
   * shared project (a project's own auto-provisioned `Skills` folder, say)
   * is born without it, so the collaborator can list the project yet gets
   * 404 on that one child. `migrate-recascade-shared-with.ts` repairs
   * exactly this, but only for `project-n01` — today's projects are
   * `project-n02`, so it no longer matches them at all.
   *
   * Skipping the subtree keeps everything else — the rest of this project,
   * and every project after it. */
  const children = await remoteChildrenOrNull(host, token, remoteFolderId);
  if (!children) {
    console.warn(`  ! Skipping "${label}" — ${host} won't let this token list it.`);
    counts.foldersUnreadable++;
    return;
  }
  const { folders, files } = children;

  for (const listing of files) {
    const isText = listing.content_type.startsWith("text/");
    // Recorded BEFORE the already-pulled check below: a re-run skips
    // every file and would otherwise collect nobody, leaving the identity
    // check with nothing to check.
    const contributorId = contributorIdFromSyncedName(listing.name);
    if (contributorId) counts.contributorIds.add(contributorId);
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
      // Backfill CONTENT for a text file pulled while its remote read was
      // failing (see `remoteFileOrNull`) — without this, "already pulled"
      // by id would mean an empty README.md/SKILL.md stays empty forever,
      // even once the deployment can serve it.
      if (isText && !existingFile.content) {
        const refetched = await remoteFileOrNull(host, token, listing._id, listing.name);
        if (refetched?.content) {
          await merge("file_refs", existingFile._id, { content: refetched.content });
          counts.contentBackfilled++;
        }
      }
      continue;
    }

    const full = await remoteFileOrNull(host, token, listing._id, listing.name);

    let s3Key: string | null = null;
    let s3Url: string | null = null;
    // Try the bytes when the metadata read says there ARE bytes — or when
    // that read failed outright on a non-text file, since `s3_key` is the
    // one thing the children listing doesn't carry and `localizeAttachment`
    // fails soft anyway.
    if (full?.s3_key || (!full && !isText)) {
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
    await pullFolderTree(host, token, humanId, sub._id, localSub._id, counts, `${label}/${sub.name}`);
  }
}

async function main(): Promise<number> {
  const { host, token, email, name, projectsFilter, ignoreProjects } = parseArgs();

  /** Reasons this pull is NOT usable, collected as they happen and
   * reported together at the end — each one also makes the process exit
   * nonzero. An incomplete local copy that exits 0 is a README that looks
   * fine and is missing entire people. */
  const fatal: string[] = [];

  console.log(`Reading daily-logs from ${host} ...`);
  const root = await remoteChildren(host, token, "root");
  const dailyLogsRoot = await remoteResolveDailyLogsFolder(host, token, root);
  const humanId = dailyLogsRoot.human_id;
  console.log(`Found daily-logs for human ${humanId}.`);

  await ensureLocalHuman(humanId, email, name);
  console.log(`Upserted local humans:${humanId} (${email}).`);

  // Fetched once, up front, and used at the very end — every contributor
  // in the mirrored logs must resolve to one of these before this pull
  // counts as usable. See `ensureContributorHumans`.
  const related = await remoteRelatedHumans(host, token);
  console.log(`${host} can resolve ${related.length} other human(s) for this token.`);

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

      const full = await remoteFileOrNull(host, token, listing._id, listing.name);

      let s3Key: string | null = null;
      let s3Url: string | null = null;
      // See the same check in `pullFolderTree` above.
      if (full?.s3_key || (!full && !isText)) {
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
      // These are the token's OWN days, so this read should always
      // succeed — but a single unreadable one still shouldn't take down a
      // 19-day pull, so it degrades to "day not cached" like everything
      // else here.
      const readme = await remoteFileOrNull(host, token, readmeListing._id, readmeListing.name);
      if (readme) {
        await cacheDailyLog(humanId, dateFolder.name, readme.content ?? "");
        daysCached++;
      }
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
  /** Referenced projects the host refused outright — the one outcome that
   * is NOT fixable by re-running, so it's summarized at the end rather
   * than left as a line scrolled past mid-run. */
  let projectsUnreachable = 0;
  const projectCounts: PullCounts = {
    filesCreated: 0,
    filesSkipped: 0,
    attachmentsCopied: 0,
    contentBackfilled: 0,
    foldersUnreadable: 0,
    contributorIds: new Set<string>(),
  };
  if (referencedProjectIds.size > 0) {
    console.log(`\nPulling ${referencedProjectIds.size} referenced project(s)...`);
    const remoteProjectsRoot = root.folders.find((f) => f.vault_root_key === "projects");
    const localRoots = await ensureVaultRootFolders(humanId);
    const localProjectsRoot = localRoots.find((f) => f.vault_root_key === "projects");

    if (remoteProjectsRoot && localProjectsRoot) {
      // `withShared: true` so a project someone ELSE created and shared
      // with you gets pulled too — a Card can reference any project you
      // can SEE, not just one you own, and skipping those left every such
      // Card showing "Unknown project" locally (and gave `nopal graphlog
      // run` no local README.md/SKILL.md to work with for them).
      const { folders: remoteProjects } = await remoteChildren(
        host,
        token,
        remoteProjectsRoot._id,
        { withShared: true },
      );

      for (const projectId of referencedProjectIds) {
        // The listing is only the first place to look: it covers projects
        // you own plus the ones shared with you DIRECTLY. A project you
        // reach through a shared ANCESTOR is fully readable but never
        // listed — see `resolveUnlistedProject`, which probes for exactly
        // that before giving up.
        const remoteProject =
          remoteProjects.find((f) => f._id === projectId) ??
          (await resolveUnlistedProject(host, token, projectId));
        if (!remoteProject) {
          projectsUnreachable++;
          console.log(
            `  ! Skipping ${projectId} — ${host} won't let this token read it (not yours, and not shared with you).`,
          );
          continue;
        }
        // A shared-in project is owned REMOTELY by someone else, but there
        // is only ever one human in local dev — so it's mirrored as this
        // human's own project (`human_id: humanId` throughout, under their
        // own local `projects` root), which is what makes it show up at
        // all locally. Ids still match production exactly, so every
        // `::card{projectFolderId="..."}` directive in a pulled Card
        // resolves to it.
        if (remoteProject.human_id && remoteProject.human_id !== humanId) {
          console.log(`  (shared with you by ${remoteProject.human_id} — pulling as a local project)`);
        }
        if (!shouldPullProject(remoteProject.name, projectsFilter, ignoreProjects)) {
          console.log(`  - Skipping "${remoteProject.name}" (excluded by --projects/--ignoreProject).`);
          continue;
        }
        const existingLocal = await getFolderById(remoteProject._id);
        // A REAL, CONFIRMED BUG, found (twice) here: tagging the local
        // project `project-n02` immediately at creation fires
        // `createVaultFolder`'s own `ensureProjectN02` side effect (auto-
        // provisioning a Skills folder, seeded with the DEFAULT skill
        // text) BEFORE `pullFolderTree` below ever gets a chance to bring
        // in the REAL remote Skills folder (its own original id, its own
        // real content) -- leaving every freshly-pulled project-n02
        // project with TWO "Skills" folders, neither one deduped by the
        // deterministic-id fix (`projectN02.server.ts`'s own
        // `applyProjectN02Shape`), since that fix only prevents the SAME
        // code path racing against itself, not two genuinely different
        // creation paths (auto-provision vs. a real pull) each producing
        // one.
        //
        // The first fix attempted here just omitted `folder_type` below,
        // assuming that left the folder untyped until the retag after
        // `pullFolderTree`. It didn't: `createVaultFolder`'s own
        // "isNewProject" default forces any direct child of the `projects`
        // root to `project-n02` regardless of what the caller passes, so
        // the auto-seed still fired immediately and the duplicate came
        // back. Fixed for real with `deferAutoProvision` (see
        // `createVaultFolder`'s own doc, `vault.server.ts`) -- the folder
        // still ends up typed `project-n02` right away, but the auto-seed
        // itself is skipped until the explicit `ensureProjectN02` call
        // below, by which point the real tree (including a real remote
        // Skills folder, if any) has already been pulled in.
        const localProject =
          existingLocal ??
          (await createVaultFolder({
            id: remoteProject._id,
            human_id: humanId,
            name: remoteProject.name,
            parent_folder_id: localProjectsRoot._id,
            deferAutoProvision: true,
          }))!;
        if (!existingLocal) projectsCreated++;
        console.log(`  → ${remoteProject.name}`);
        await pullFolderTree(
          host,
          token,
          humanId,
          remoteProject._id,
          localProject._id,
          projectCounts,
          remoteProject.name,
        );

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
      `Done with projects. ${projectsCreated} project folder(s) created, ${projectCounts.filesCreated} file(s) created, ${projectCounts.filesSkipped} already present (skipped), ${projectCounts.attachmentsCopied} attachment(s) copied to local S3, ${projectCounts.contentBackfilled} file(s) had missing content backfilled.`,
    );
    if (projectCounts.foldersUnreadable > 0) {
      console.log(
        `${projectCounts.foldersUnreadable} sub-folder(s) couldn't be listed and were skipped — usually a folder created INSIDE an already-shared project, which never got the project's \`shared_with\` cascaded onto it (see \`migrate-recascade-shared-with.ts\`, which only covers the older \`project-n01\` type).`,
      );
    }
    if (projectsUnreachable > 0) {
      console.log(
        `${projectsUnreachable} referenced project(s) could not be read from ${host} at all — a Card pointing at one will still show "Unknown project" locally. Ask its owner to share it with ${email}, then re-run.`,
      );
    }
  }

  // ── Contributor identity ────────────────────────────────────────
  //
  // Runs LAST because the ids come out of the mirrored tree pulled above,
  // but before anything reads that tree — `nopal graphlog run` is a
  // separate command, and this pull is the gate in front of it.
  if (projectCounts.contributorIds.size > 0) {
    console.log(`\nResolving ${projectCounts.contributorIds.size} contributor(s) found in synced daily logs...`);
    const unresolvable = await ensureContributorHumans(projectCounts.contributorIds, humanId, related);
    if (unresolvable.length > 0) {
      fatal.push(
        `${unresolvable.length} contributor(s) in the pulled daily logs could not be resolved to a real person: ` +
          `${unresolvable.map((id) => `humans:${id}`).join(", ")}.\n` +
          `  ${host} did not return them from /api/humans/related, so this pull has their WRITING but not their NAME.\n` +
          `  Next step: ask an admin to relate this account to them, or re-run as an admin, then re-pull.\n` +
          `  Running graphlog against this local copy would attribute their nodes to nobody, permanently (ADR-015).`,
      );
    }
  }

  if (fatal.length > 0) {
    console.error(`\nThis pull is INCOMPLETE and must not be used to build a graph:\n`);
    for (const reason of fatal) console.error(`- ${reason}`);
    console.error(
      `\nNothing above is repaired by re-running graphlog: a node's author is written into it permanently, so a bad pull becomes a bad graph that only a reset and rebuild clears.`,
    );
    return 1;
  }

  console.log(
    `\nLog into local dev as ${email} to see this data.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
