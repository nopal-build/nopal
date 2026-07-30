/**
 * Release Log — the structured record of what the Sorter (`sorter.server.ts`)
 * did, and (eventually) what an AI-driven filing step does too. Deliberately
 * NOT a confirmation-gated review queue: the system acts on an explicit
 * signal (a Card, an `@mention`) and just logs what it did — see the
 * `vault` skill's "Cards" section.
 *
 * SOURCE OF TRUTH INVERSION, on purpose: unlike Sharing Roles (where the
 * project's own README.md file is the source of truth and the DB is a
 * cache), a release-log entry needs a stable id, a strict order, and a
 * structured record of what changed so it can be REVERTED — none of which
 * a hand-appended markdown bullet can give cheaply. So here it's the other
 * way around: the `release_log_entries` (+ `release_log_changesets`) DB
 * tables are the source of truth, and BOTH markdown files a human actually
 * reads —
 *
 *   - `daily-logs/YYYY-MM-DD/release-log.md` — that human's own receipt
 *     for the day, grouped by project (`## <Project Name>`).
 *   - `projects/<name>/release-log.md` — everyone with project access,
 *     grouped by date (`## YYYY-MM-DD`).
 *
 * — are plain, regenerated-on-change CACHES/reflections of those rows
 * (`regenerateProjectReleaseLog`/`regenerateDailyReleaseLog`), never
 * hand-edited or appended to directly. Each rendered bullet carries an
 * invisible `<!-- release-log-entry:<id> -->` marker (stripped by any
 * normal markdown renderer) so a future UI can target "revert THIS one"
 * without guessing identity back out of rendered text.
 *
 * A CHANGESET (`release_log_changesets`) is one (entry, file) pair
 * recording enough to undo AND redo a project file mutation — a full
 * `before`/`after` snapshot (not a diff; these are small files, and a
 * snapshot is simpler/more robust — same choice `file_refs.md_versions`
 * already made elsewhere). An entry with NO changesets (a mention
 * backlink, a completed task) is purely informational and can never be
 * reverted — see `revertReleaseLogEntry`.
 *
 * REVERT/REPLAY is real but not yet exposed anywhere — built now, on
 * purpose, because exposing it later would be a much bigger lift than
 * building the mechanism up front. Reverting entry N restores every file
 * it touched to its `before` snapshot, then REPLAYS every later,
 * not-yet-reverted entry touching that same file (in order), reapplying
 * each one's own stored `after` snapshot. This is only guaranteed correct
 * for INDEPENDENT operations (true of every changeset kind this file
 * produces today — each "created" changeset is a brand new project file,
 * never touched by any other entry). Once a future AI-driven editing step
 * produces chained `content-edit` changesets on the SAME file, a later
 * edit might have been generated ASSUMING an earlier one was already
 * applied — at that point "replay = reapply the stored snapshot" may stop
 * being correct and might need to mean "re-run the original operation"
 * instead. Deliberately not solved here; flagged so it isn't rediscovered
 * from scratch later.
 */

import { RecordId } from "surrealdb";
import {
  createFileRef,
  deleteFileRef,
  getFolderById,
  updateFileRef,
} from "./vault.server";
import { getDailyLogFolderAndReadmeId } from "./dailyLog.server";
import { getProjectRole } from "./projectSharing.server";
import { query, upsert, merge, formatRecord, type Data } from "./generic.server";
import type { FileRef } from "./vault.types";

const RELEASE_LOG_FILENAME = "release-log.md";

// ─── Types ──────────────────────────────────────────────────────────────

export type ReleaseLogEntryKind = "mention" | "task" | "file-added";

export type ReleaseLogEntry = Data & {
  /** The PROJECT's own owner \u2014 whose vault this entry's project-side
   * release-log.md lives in. See `appendProjectReleaseLogEntries`'s old
   * doc comment (now folded into `createReleaseLogEntry`) for why this is
   * never just `actingHumanId`. */
  human_id: string;
  project_folder_id: string;
  /** YYYY-MM-DD \u2014 the daily log day this entry originated from. */
  date: string;
  /** Who actually triggered this (the Card/day author) \u2014 may differ from
   * `human_id` now that Sharing Roles make cross-human Cards real. */
  acting_human_id: string;
  kind: ReleaseLogEntryKind;
  /** The human-readable bullet text, e.g. `Completed task: "..." \u2014
   * [View](...)`. Used verbatim in BOTH the project's and the day's own
   * rendering \u2014 deliberately ONE phrasing per entry, not two. */
  summary: string;
  /** A stable key identifying the ORIGINATING signal (e.g. a Card's own
   * fileId + task text, or an attachment's own fileId) \u2014 NEVER derived
   * from anything a changeset itself creates (like a freshly-copied
   * file's new id). Lets a forced Sorter re-run recognize "already
   * recorded this" without re-doing the underlying mutation (e.g.
   * re-copying a file into the project a second time). */
  source_ref: string;
  /** Strict, project-scoped ordering \u2014 revert/replay's "what came after
   * this entry" is defined by this, not by `created_at` (simple integer,
   * assigned once at creation, never reused). */
  sequence: number;
  reverted_at: string | null;
  reverted_by_human_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangesetAction = "created" | "content-edit";

/** Enough to recreate a "created" changeset's file from scratch on
 * replay \u2014 a plain snapshot of the `file_refs` fields that matter,
 * captured at creation time. */
export type CreatedFileSnapshot = {
  human_id: string;
  name: string;
  content_type: string;
  s3_url?: string | null;
  s3_key?: string | null;
  content?: string | null;
  content_hash?: string | null;
  folder_id: string;
  size?: number | null;
};

export type ContentSnapshot = { content: string };

export type ReleaseLogChangeset = Data & {
  entry_id: string;
  file_id: string;
  action: ChangesetAction;
  /** `null` for `"created"` (the file didn't exist before). */
  before: ContentSnapshot | null;
  after: CreatedFileSnapshot | ContentSnapshot;
  created_at: string;
};

export type ChangesetInput = {
  fileId: string;
  action: ChangesetAction;
  before: ContentSnapshot | null;
  after: CreatedFileSnapshot | ContentSnapshot;
};

// ─── release-log.md file cache (read/write plumbing only) ─────────────────

async function getOrCreateReleaseLogFile(
  humanId: string,
  folderId: string,
): Promise<FileRef> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId AND folder_id = $folderId AND name = $name
     LIMIT 1`,
    { humanId, folderId, name: RELEASE_LOG_FILENAME },
  );
  const existing = result?.[0]?.[0]
    ? formatRecord(result[0][0] as unknown as FileRef)
    : null;
  if (existing) return existing;

  const created = await createFileRef({
    human_id: humanId,
    name: RELEASE_LOG_FILENAME,
    content: "",
    content_type: "text/markdown",
    folder_id: folderId,
  });
  if (!created) throw new Error("Failed to create release-log.md");
  return created;
}

/** Reads a folder's `release-log.md` content, or `""` if it doesn't exist
 * yet \u2014 read-only, never creates the file. Used by `sortDailyLog`'s own
 * return value for the manual "Sort this day" testing button on the Daily
 * Log page. */
export async function getReleaseLogContent(
  humanId: string,
  folderId: string,
): Promise<string> {
  const result = await query<[FileRef[]]>(
    `SELECT * FROM file_refs
     WHERE human_id = $humanId AND folder_id = $folderId AND name = $name
     LIMIT 1`,
    { humanId, folderId, name: RELEASE_LOG_FILENAME },
  );
  const existing = result?.[0]?.[0]
    ? formatRecord(result[0][0] as unknown as FileRef)
    : null;
  return existing?.content ?? "";
}

/** The invisible per-entry marker every rendered bullet carries \u2014 a plain
 * HTML comment, stripped by any normal markdown renderer, so today it's
 * purely groundwork for a future "revert this" UI, not user-visible. */
function entryMarker(entry: ReleaseLogEntry): string {
  return `<!-- release-log-entry:${entry._id} -->`;
}

function renderEntryBullet(entry: ReleaseLogEntry): string {
  const marker = entryMarker(entry);
  if (entry.reverted_at) {
    return `- ~~${entry.summary}~~ *(reverted)* ${marker}`;
  }
  return `- ${entry.summary} ${marker}`;
}

function renderSections(groups: Array<[string, ReleaseLogEntry[]]>): string {
  const sections = groups
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries]) => `## ${heading}\n\n${entries.map(renderEntryBullet).join("\n")}`);
  return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}

/** Regenerates a project's own `release-log.md` (grouped by date, oldest
 * first) from its CURRENT `release_log_entries` rows \u2014 the file is a pure
 * reflection of the DB, so this always REPLACES its content wholesale
 * rather than appending. */
export async function regenerateProjectReleaseLog(projectFolderId: string): Promise<void> {
  const projectFolder = await getFolderById(projectFolderId);
  if (!projectFolder) return;

  const entries = await getProjectReleaseLogEntries(projectFolderId);
  const byDate = new Map<string, ReleaseLogEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  const groups = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const content = renderSections(groups);
  const file = await getOrCreateReleaseLogFile(projectFolder.human_id, projectFolderId);
  if (file.content !== content) await updateFileRef(file._id, { content });
}

/** Regenerates a day's own `release-log.md` (grouped by project name) from
 * the CURRENT `release_log_entries` rows for `actingHumanId`+`date`. */
export async function regenerateDailyReleaseLog(
  actingHumanId: string,
  date: string,
  dateFolderId: string,
): Promise<void> {
  const entries = await getDailyReleaseLogEntries(actingHumanId, date);
  const nameById = new Map<string, string>();
  const byProject = new Map<string, ReleaseLogEntry[]>();
  for (const entry of entries) {
    const list = byProject.get(entry.project_folder_id);
    if (list) list.push(entry);
    else byProject.set(entry.project_folder_id, [entry]);
  }
  for (const projectFolderId of byProject.keys()) {
    const projectFolder = await getFolderById(projectFolderId);
    nameById.set(projectFolderId, projectFolder?.name ?? "Unknown project");
  }
  const groups = [...byProject.entries()].map(
    ([id, list]): [string, ReleaseLogEntry[]] => [nameById.get(id) ?? "Unknown project", list],
  );

  const content = renderSections(groups);
  const file = await getOrCreateReleaseLogFile(actingHumanId, dateFolderId);
  if (file.content !== content) await updateFileRef(file._id, { content });
}

// ─── Entries/changesets CRUD ────────────────────────────────────────────

async function nextSequence(projectFolderId: string): Promise<number> {
  const result = await query<[{ sequence: number }[]]>(
    `SELECT sequence FROM release_log_entries
     WHERE project_folder_id = $projectFolderId
     ORDER BY sequence DESC LIMIT 1`,
    { projectFolderId },
  );
  return (result?.[0]?.[0]?.sequence ?? 0) + 1;
}

export type CreateReleaseLogEntryInput = {
  projectFolderId: string;
  date: string;
  actingHumanId: string;
  kind: ReleaseLogEntryKind;
  summary: string;
  sourceRef: string;
  changesets?: ChangesetInput[];
};

/** Finds an already-recorded entry for the same originating signal, if
 * any \u2014 what makes a forced Sorter re-run idempotent (see `source_ref`'s
 * own doc comment). Checked regardless of reverted status: a human
 * revert is a deliberate action a re-sort should never silently undo by
 * recreating the same entry. */
export async function findReleaseLogEntryBySource(
  projectFolderId: string,
  date: string,
  kind: ReleaseLogEntryKind,
  sourceRef: string,
): Promise<ReleaseLogEntry | null> {
  const result = await query<[ReleaseLogEntry[]]>(
    `SELECT * FROM release_log_entries
     WHERE project_folder_id = $projectFolderId AND date = $date
       AND kind = $kind AND source_ref = $sourceRef
     LIMIT 1`,
    { projectFolderId, date, kind, sourceRef },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record as unknown as ReleaseLogEntry) : null;
}

/**
 * Records one Release Log entry (and any changesets describing what file
 * mutation it made) \u2014 does NOT regenerate either markdown cache itself;
 * callers batch-create everything for a run and regenerate once at the end
 * (`regenerateProjectReleaseLog`/`regenerateDailyReleaseLog`), same
 * batching `sortDailyLog` always used. Idempotent against `source_ref`
 * (see `findReleaseLogEntryBySource`) \u2014 returns the EXISTING entry,
 * `created: false`, rather than inserting a duplicate.
 */
export async function createReleaseLogEntry(
  input: CreateReleaseLogEntryInput,
): Promise<{ entry: ReleaseLogEntry; created: boolean }> {
  const existing = await findReleaseLogEntryBySource(
    input.projectFolderId,
    input.date,
    input.kind,
    input.sourceRef,
  );
  if (existing) return { entry: existing, created: false };

  const projectFolder = await getFolderById(input.projectFolderId);
  const ownerHumanId = projectFolder?.human_id ?? input.actingHumanId;
  const sequence = await nextSequence(input.projectFolderId);
  const now = new Date().toISOString();

  const result = await upsert("release_log_entries", {
    human_id: ownerHumanId,
    project_folder_id: input.projectFolderId,
    date: input.date,
    acting_human_id: input.actingHumanId,
    kind: input.kind,
    summary: input.summary,
    source_ref: input.sourceRef,
    sequence,
    reverted_at: null,
    reverted_by_human_id: null,
    created_at: now,
    updated_at: now,
  });
  const record = Array.isArray(result) ? result[0] : result;
  const entry = formatRecord(record as unknown as ReleaseLogEntry);

  for (const cs of input.changesets ?? []) {
    await upsert("release_log_changesets", {
      entry_id: entry._id,
      file_id: cs.fileId,
      action: cs.action,
      before: cs.before,
      after: cs.after,
      created_at: now,
    });
  }

  return { entry, created: true };
}

export async function getProjectReleaseLogEntries(
  projectFolderId: string,
): Promise<ReleaseLogEntry[]> {
  const result = await query<[ReleaseLogEntry[]]>(
    `SELECT * FROM release_log_entries WHERE project_folder_id = $projectFolderId ORDER BY sequence ASC`,
    { projectFolderId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getDailyReleaseLogEntries(
  actingHumanId: string,
  date: string,
): Promise<ReleaseLogEntry[]> {
  const result = await query<[ReleaseLogEntry[]]>(
    `SELECT * FROM release_log_entries
     WHERE acting_human_id = $actingHumanId AND date = $date
     ORDER BY sequence ASC`,
    { actingHumanId, date },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

export async function getReleaseLogEntryById(
  entryId: string,
): Promise<ReleaseLogEntry | undefined> {
  const result = await query<[ReleaseLogEntry[]]>(
    `SELECT * FROM release_log_entries WHERE id = $rid`,
    { rid: new RecordId("release_log_entries", entryId) },
  );
  const record = result?.[0]?.[0];
  return record ? formatRecord(record) : undefined;
}

export async function getChangesetsForEntry(
  entryId: string,
): Promise<ReleaseLogChangeset[]> {
  const result = await query<[ReleaseLogChangeset[]]>(
    `SELECT * FROM release_log_changesets WHERE entry_id = $entryId`,
    { entryId },
  );
  return (result?.[0] ?? []).map(formatRecord);
}

// ─── Revert / replay ────────────────────────────────────────────────────

type LaterChangeset = ReleaseLogChangeset & { entrySequence: number };

/** Every changeset touching `fileId`, belonging to a NOT-reverted entry
 * later than `afterSequence` in the same project \u2014 what `revertReleaseLogEntry`
 * replays after rolling `fileId` back. Ordered ascending, so replaying in
 * order reproduces the same end state that existed before the revert. */
async function getLaterChangesetsForFile(
  projectFolderId: string,
  afterSequence: number,
  fileId: string,
): Promise<LaterChangeset[]> {
  const laterEntries = await query<[ReleaseLogEntry[]]>(
    `SELECT * FROM release_log_entries
     WHERE project_folder_id = $projectFolderId AND sequence > $afterSequence
     ORDER BY sequence ASC`,
    { projectFolderId, afterSequence },
  );
  const entries = (laterEntries?.[0] ?? []).map(formatRecord).filter((e) => !e.reverted_at);

  const out: LaterChangeset[] = [];
  for (const entry of entries) {
    const changesets = await getChangesetsForEntry(entry._id);
    for (const cs of changesets) {
      if (cs.file_id === fileId) out.push({ ...cs, entrySequence: entry.sequence });
    }
  }
  return out;
}

async function undoChangeset(cs: ReleaseLogChangeset): Promise<void> {
  if (cs.action === "created") {
    await deleteFileRef(cs.file_id);
    return;
  }
  const before = cs.before as ContentSnapshot | null;
  await updateFileRef(cs.file_id, { content: before?.content ?? "" });
}

/** Re-applies `cs`'s own stored `after` snapshot \u2014 for a `"created"`
 * changeset this means recreating the file (necessarily under a FRESH
 * id, since the old row was deleted by `undoChangeset` \u2014 `cs`'s own
 * `file_id` is updated in place afterward so this entry stays correctly
 * revertible in the future). See this file's own module doc for why this
 * "replay = reapply the stored snapshot" approach is only guaranteed
 * correct for independent operations. */
async function replayChangeset(cs: LaterChangeset): Promise<void> {
  if (cs.action === "created") {
    const snapshot = cs.after as CreatedFileSnapshot;
    const recreated = await createFileRef({
      human_id: snapshot.human_id,
      name: snapshot.name,
      s3_url: snapshot.s3_url ?? null,
      s3_key: snapshot.s3_key ?? null,
      content: snapshot.content ?? null,
      content_type: snapshot.content_type,
      content_hash: snapshot.content_hash ?? null,
      folder_id: snapshot.folder_id,
      size: snapshot.size ?? null,
    });
    if (recreated) {
      await merge("release_log_changesets", cs._id, { file_id: recreated._id });
    }
    return;
  }
  const snapshot = cs.after as ContentSnapshot;
  await updateFileRef(cs.file_id, { content: snapshot.content ?? "" });
}

export type RevertResult = { ok: true } | { ok: false; error: string };

/**
 * Reverts one Release Log entry: restores every file its changesets
 * touched to its `before` state, then replays every LATER, not-yet-reverted
 * entry touching those same files (in order) so anything unrelated that
 * happened afterward isn't lost. One-way for now \u2014 no built-in
 * "un-revert"; redo the original action if you want it back.
 *
 * Requires `actingHumanId` to hold an owner-tier Sharing Role on the
 * project (the creator, or an Owner/Crafter) \u2014 same permission bar as
 * changing sharing itself (`setProjectSharing`). An entry with no
 * changesets (a mention/task \u2014 informational only) can't be reverted at
 * all; see this file's own module doc for why reverting is scoped to
 * file-mutating entries only.
 */
export async function revertReleaseLogEntry(
  entryId: string,
  actingHumanId: string,
): Promise<RevertResult> {
  const entry = await getReleaseLogEntryById(entryId);
  if (!entry) return { ok: false, error: "Release log entry not found" };
  if (entry.reverted_at) {
    return { ok: false, error: "This entry has already been reverted" };
  }

  const changesets = await getChangesetsForEntry(entryId);
  if (changesets.length === 0) {
    return {
      ok: false,
      error:
        "This entry has nothing to revert — only entries that changed a project file (not mentions or completed tasks) can be reverted",
    };
  }

  const projectFolder = await getFolderById(entry.project_folder_id);
  if (!projectFolder) return { ok: false, error: "Project not found" };

  const role = await getProjectRole(projectFolder, actingHumanId);
  if (!role?.isOwner) {
    return {
      ok: false,
      error: "You don't have permission to revert entries on this project",
    };
  }

  for (const changeset of changesets) {
    await undoChangeset(changeset);
    const later = await getLaterChangesetsForFile(
      entry.project_folder_id,
      entry.sequence,
      changeset.file_id,
    );
    for (const laterChangeset of later) {
      await replayChangeset(laterChangeset);
    }
  }

  await merge("release_log_entries", entryId, {
    reverted_at: new Date().toISOString(),
    reverted_by_human_id: actingHumanId,
    updated_at: new Date().toISOString(),
  });

  await regenerateProjectReleaseLog(entry.project_folder_id);
  const { dateFolderId } = await getDailyLogFolderAndReadmeId(
    entry.acting_human_id,
    entry.date,
  );
  await regenerateDailyReleaseLog(entry.acting_human_id, entry.date, dateFolderId);

  return { ok: true };
}
