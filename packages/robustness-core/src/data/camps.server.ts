/**
 * Camps + Log Books (garden/3-growing/camps-and-log-books.md) — a journey
 * of sequential goal-posts ("a place we are headed to"), each with its
 * own running journal. See `vaultFolderTypes.ts`'s own header comment,
 * item 4, for the full shape; this module is the one place that knows
 * how to read/write it, same role `guideProjectsBoard.server.ts` plays
 * for a `kanban-garden` board — the closest existing precedent.
 *
 * ```
 * [org root | project | personal]
 *   Camps/                     folder_type: "camp", is_folder_type_root: true (singleton)
 *     README.md                front matter: focused_camp_folder_id
 *     camp-1/                  inherits folder_type: "camp" (is_folder_type_root: false)
 *       README.md              front matter: statement, target_arrival
 *       OBSERVATIONS.md        (optional) front matter: statement, arrival_date — marks it COMPLETE
 *       Log/                   folder_type: "log-book", is_folder_type_root: true (singleton per camp)
 *         README.md
 *         entry-1/             inherits folder_type: "log-book"
 *           README.md          front matter: statement, entry_date, edited_date
 *           ...assets
 *         entry-2/
 *     camp-2/
 *       ...
 * ```
 *
 * Every create here is deliberately NOT validated against
 * `validateFolderTypeForParent` a second time — this module IS the
 * trusted, single writer (same as `guideProjectsBoard.server.ts`'s own
 * card creation); callers reach it through `camps.server.ts`'s own
 * functions, never by constructing a `camp`/`log-book` folder by hand
 * through the generic "New folder" path.
 */

import { parse as parseYaml } from "yaml";
import { splitFrontmatter } from "./project.types";
import {
  createFileRef,
  createVaultFolder,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import type { FileRefListing } from "./vault.types";

const CAMPS_FOLDER_NAME = "Camps";
const LOG_BOOK_FOLDER_NAME = "Log";

// ─── Front matter helpers ───────────────────────────────────────────────────

/** Parses a markdown file's YAML front matter into a plain object —
 * `{}` for no/invalid front matter, same "don't fail closed on bad front
 * matter" philosophy `guideProjectsBoard.server.ts`'s own card parsing
 * uses. Lazily imports `yaml` the same way that module does. */
function parseFrontmatterObject(content: string | null | undefined): Record<string, unknown> {
  const { frontmatter } = splitFrontmatter(content ?? "");
  if (!frontmatter) return {};
  try {
    const parsed = parseYaml(frontmatter);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  return typeof data[key] === "string" ? (data[key] as string) : null;
}

/** `JSON.stringify` for a YAML scalar value — YAML is a superset of JSON
 * for these, so this is valid YAML and sidesteps hand-rolling quoting/
 * escaping. Same trick `guideProjectsBoard.server.ts`'s own card creation
 * already uses. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function buildCampReadmeContent(fields: { statement: string; targetArrival: string }, body = ""): string {
  return `---\nstatement: ${yamlString(fields.statement)}\ntarget_arrival: ${yamlString(fields.targetArrival)}\n---\n${body}`;
}

function buildObservationsContent(fields: { statement: string; arrivalDate: string }): string {
  return `---\nstatement: ${yamlString(fields.statement)}\narrival_date: ${yamlString(fields.arrivalDate)}\n---\n`;
}

function buildEntryReadmeContent(
  fields: { statement: string; entryDate: string; editedDate: string },
  body = "",
): string {
  return `---\nstatement: ${yamlString(fields.statement)}\nentry_date: ${yamlString(fields.entryDate)}\nedited_date: ${yamlString(fields.editedDate)}\n---\n${body}`;
}

// ─── Sequential naming ──────────────────────────────────────────────────────

const SEQUENCE_RE = /-(\d+)$/;

function sequenceNumber(name: string): number {
  const match = SEQUENCE_RE.exec(name);
  return match ? parseInt(match[1], 10) : 0;
}

/** The next `<prefix>-N` name given the sibling names already in use —
 * same auto-numbering convention `sync-api`'s own run creation uses
 * (`syncApi.server.ts`), generalized to any prefix. Always 1 past the
 * HIGHEST existing number for this prefix, never just `count + 1` — a
 * deleted middle entry must never free up its old number for reuse. */
function nextSequentialName(existingNames: readonly string[], prefix: string): string {
  let max = 0;
  for (const name of existingNames) {
    if (!name.toLowerCase().startsWith(`${prefix}-`)) continue;
    const n = sequenceNumber(name);
    if (n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

function pickCanonicalTypedFolder(folders: readonly VaultFolder[], folderType: string): VaultFolder | undefined {
  return folders
    .filter((f) => f.is_folder_type_root && f.folder_type === folderType)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Camps ──────────────────────────────────────────────────────────────────

export type CampObservations = {
  statement: string | null;
  arrivalDate: string | null;
};

export type CampSummary = {
  folder: VaultFolder;
  name: string;
  statement: string | null;
  targetArrival: string | null;
  /** True purely because `OBSERVATIONS.md` exists — no separate status
   * field to keep in sync (garden seed's own "Decided"). */
  completed: boolean;
  observations: CampObservations | null;
};

export type CampDetail = CampSummary & {
  readmeFileId: string;
  /** The camp's own main content — everything in `README.md` below the
   * front matter. Freely editable at any time, even after Observations
   * exist (Gerald: "no limit to edits within a camp"). */
  body: string;
};

/** `anchor` is an already-resolved Organization root, project, or
 * Personal space folder — same "caller resolves the parent, this module
 * only acts on it" shape `guideProjectsBoard.server.ts` uses for an Org's
 * board anchor. */
export async function getCampsFolder(anchor: VaultFolder): Promise<VaultFolder | undefined> {
  const { folders } = await listFolderChildren(anchor.human_id, anchor._id);
  return pickCanonicalTypedFolder(folders, "camp");
}

/** Finds (or creates) `anchor`'s one `Camps` grouping folder — mirrors
 * `vault.server.ts`'s own `ensureSyncsFolder` shape (a re-check before
 * creating, since a transient miss is plausible but two in a row is
 * not). */
export async function ensureCampsFolder(anchor: VaultFolder): Promise<VaultFolder> {
  let existing = await getCampsFolder(anchor);
  if (!existing) existing = await getCampsFolder(anchor);
  if (existing) return existing;

  const created = await createVaultFolder({
    human_id: anchor.human_id,
    name: CAMPS_FOLDER_NAME,
    parent_folder_id: anchor._id,
    folder_type: "camp",
  });
  if (!created) throw new Error("Failed to create the Camps folder");
  await createFileRef({
    human_id: created.human_id,
    name: "README.md",
    content: `---\nfocused_camp_folder_id: null\n---\n`,
    content_type: "text/markdown",
    folder_id: created._id,
  });
  return created;
}

async function parseCampReadme(content: string | null | undefined) {
  const data = await parseFrontmatterObject(content);
  return { statement: stringField(data, "statement"), targetArrival: stringField(data, "target_arrival") };
}

async function parseObservations(content: string | null | undefined): Promise<CampObservations> {
  const data = await parseFrontmatterObject(content);
  return { statement: stringField(data, "statement"), arrivalDate: stringField(data, "arrival_date") };
}

async function summarizeCampFolder(folder: VaultFolder): Promise<CampSummary> {
  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
  const readme = readmeListing ? await getFileRefById(readmeListing._id) : undefined;
  const { statement, targetArrival } = await parseCampReadme(readme?.content);
  const obsListing = files.find((f) => f.name.toLowerCase() === "observations.md");
  const observations = obsListing ? await parseObservations((await getFileRefById(obsListing._id))?.content) : null;
  return { folder, name: folder.name, statement, targetArrival, completed: !!obsListing, observations };
}

/** Every camp under `campsFolder`, in sequence order — what the Camp Map
 * reads. */
export async function listCamps(campsFolder: VaultFolder): Promise<CampSummary[]> {
  const { folders } = await listFolderChildren(campsFolder.human_id, campsFolder._id);
  const sorted = folders
    .filter((f) => f.folder_type === "camp" && !f.is_folder_type_root)
    .sort((a, b) => sequenceNumber(a.name) - sequenceNumber(b.name));
  return Promise.all(sorted.map(summarizeCampFolder));
}

/** Convenience for a read-only view (e.g. the Camp Map) that doesn't want
 * to provision a `Camps` folder just by looking — `[]`, not an error,
 * when `anchor` has no camps yet. */
export async function listCampsForAnchor(anchor: VaultFolder): Promise<CampSummary[]> {
  const campsFolder = await getCampsFolder(anchor);
  if (!campsFolder) return [];
  return listCamps(campsFolder);
}

async function findCampsReadmeListing(campsFolder: VaultFolder): Promise<FileRefListing | undefined> {
  const { files } = await listFolderChildren(campsFolder.human_id, campsFolder._id);
  return files.find((f) => f.name.toLowerCase() === "readme.md");
}

/** Which camp is "current" — shown highlighted on the Camp Map. `null`
 * when none is set (no camps yet, or explicitly cleared). */
export async function getFocusedCampFolderId(campsFolder: VaultFolder): Promise<string | null> {
  const listing = await findCampsReadmeListing(campsFolder);
  if (!listing) return null;
  const readme = await getFileRefById(listing._id);
  const data = await parseFrontmatterObject(readme?.content);
  return stringField(data, "focused_camp_folder_id");
}

/** The one intended writer of `Camps/README.md`'s `focused_camp_folder_id`
 * — called automatically by `createCamp` (a brand new camp becomes
 * focused), also usable directly to re-focus an earlier camp. */
export async function setFocusedCamp(campsFolder: VaultFolder, campFolderId: string | null): Promise<void> {
  const listing = await findCampsReadmeListing(campsFolder);
  if (!listing) return;
  const readme = await getFileRefById(listing._id);
  const { body } = splitFrontmatter(readme?.content ?? "");
  const value = campFolderId ? yamlString(campFolderId) : "null";
  await updateFileRef(listing._id, { content: `---\nfocused_camp_folder_id: ${value}\n---\n${body}` });
}

/** Creates the next sequential `camp-N` under `anchor`'s `Camps` folder
 * (provisioning it on first use) and makes it the focused camp. */
export async function createCamp(anchor: VaultFolder, statement: string, targetArrival: string): Promise<VaultFolder> {
  const campsFolder = await ensureCampsFolder(anchor);
  const { folders: siblings } = await listFolderChildren(campsFolder.human_id, campsFolder._id);
  const name = nextSequentialName(
    siblings.map((f) => f.name),
    "camp",
  );
  const created = await createVaultFolder({
    human_id: campsFolder.human_id,
    name,
    parent_folder_id: campsFolder._id,
  });
  if (!created) throw new Error("Failed to create the camp folder");
  await createFileRef({
    human_id: created.human_id,
    name: "README.md",
    content: buildCampReadmeContent({ statement, targetArrival }),
    content_type: "text/markdown",
    folder_id: created._id,
  });
  await setFocusedCamp(campsFolder, created._id);
  return created;
}

/** One camp's full detail, by its own folder id — `null` if `campFolderId`
 * isn't actually a camp item (wrong type, or the `Camps` grouping root
 * itself) or has no `README.md`. */
export async function getCamp(campFolderId: string): Promise<CampDetail | null> {
  const folder = await getFolderById(campFolderId);
  if (!folder || folder.folder_type !== "camp" || folder.is_folder_type_root) return null;
  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
  if (!readmeListing) return null;
  const readme = await getFileRefById(readmeListing._id);
  const { statement, targetArrival } = await parseCampReadme(readme?.content);
  const { body } = splitFrontmatter(readme?.content ?? "");
  const obsListing = files.find((f) => f.name.toLowerCase() === "observations.md");
  const observations = obsListing ? await parseObservations((await getFileRefById(obsListing._id))?.content) : null;
  return {
    folder,
    name: folder.name,
    statement,
    targetArrival,
    completed: !!obsListing,
    observations,
    readmeFileId: readmeListing._id,
    body,
  };
}

/** Updates a camp's `statement`/`target_arrival` front matter, its main
 * `body`, or both — omit a field to leave it as-is. The one intended
 * writer of `camp-N/README.md`. */
export async function setCamp(
  campFolderId: string,
  fields: { statement?: string; targetArrival?: string; body?: string },
): Promise<CampDetail> {
  const camp = await getCamp(campFolderId);
  if (!camp) throw new Error("Camp not found");
  const content = buildCampReadmeContent(
    {
      statement: fields.statement ?? camp.statement ?? "",
      targetArrival: fields.targetArrival ?? camp.targetArrival ?? "",
    },
    fields.body ?? camp.body,
  );
  await updateFileRef(camp.readmeFileId, { content });
  const updated = await getCamp(campFolderId);
  if (!updated) throw new Error("Camp disappeared mid-update");
  return updated;
}

/** Records (or replaces) `OBSERVATIONS.md` — the one and only thing that
 * marks a camp complete. */
export async function recordCampObservations(
  campFolderId: string,
  statement: string,
  arrivalDate: string,
): Promise<void> {
  const folder = await getFolderById(campFolderId);
  if (!folder || folder.folder_type !== "camp" || folder.is_folder_type_root) throw new Error("Camp not found");
  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const existing = files.find((f) => f.name.toLowerCase() === "observations.md");
  const content = buildObservationsContent({ statement, arrivalDate });
  if (existing) {
    await updateFileRef(existing._id, { content });
  } else {
    await createFileRef({
      human_id: folder.human_id,
      name: "OBSERVATIONS.md",
      content,
      content_type: "text/markdown",
      folder_id: folder._id,
    });
  }
}

// ─── Log Book ───────────────────────────────────────────────────────────────

export type LogEntrySummary = {
  folder: VaultFolder;
  name: string;
  statement: string | null;
  /** Set once at creation, never changed. */
  entryDate: string | null;
  /** Bumped on every content edit. */
  editedDate: string | null;
};

export type LogEntryDetail = LogEntrySummary & {
  readmeFileId: string;
  body: string;
  /** Every other file in the entry's own folder — images/videos/docs. */
  assets: FileRefListing[];
};

export async function getLogBookFolder(campFolder: VaultFolder): Promise<VaultFolder | undefined> {
  const { folders } = await listFolderChildren(campFolder.human_id, campFolder._id);
  return pickCanonicalTypedFolder(folders, "log-book");
}

/** Finds (or creates) a camp's one `Log` folder — same re-check-before-
 * create shape as `ensureCampsFolder`. */
export async function ensureLogBookFolder(campFolder: VaultFolder): Promise<VaultFolder> {
  let existing = await getLogBookFolder(campFolder);
  if (!existing) existing = await getLogBookFolder(campFolder);
  if (existing) return existing;

  const created = await createVaultFolder({
    human_id: campFolder.human_id,
    name: LOG_BOOK_FOLDER_NAME,
    parent_folder_id: campFolder._id,
    folder_type: "log-book",
  });
  if (!created) throw new Error("Failed to create the Log Book folder");
  await createFileRef({
    human_id: created.human_id,
    name: "README.md",
    content: `---\ntitle: Log Book\n---\n`,
    content_type: "text/markdown",
    folder_id: created._id,
  });
  return created;
}

async function parseEntryReadme(content: string | null | undefined) {
  const data = await parseFrontmatterObject(content);
  return {
    statement: stringField(data, "statement"),
    entryDate: stringField(data, "entry_date"),
    editedDate: stringField(data, "edited_date"),
  };
}

async function summarizeEntryFolder(folder: VaultFolder): Promise<LogEntrySummary> {
  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
  const readme = readmeListing ? await getFileRefById(readmeListing._id) : undefined;
  const { statement, entryDate, editedDate } = await parseEntryReadme(readme?.content);
  return { folder, name: folder.name, statement, entryDate, editedDate };
}

/** Every entry in a log book, oldest-first (sequence order) — the caller
 * (the Log Book component's own loader) reverses this for newest-first
 * display, so there's one source of truth for "what order were these
 * actually written in." */
export async function listLogEntries(logBookFolder: VaultFolder): Promise<LogEntrySummary[]> {
  const { folders } = await listFolderChildren(logBookFolder.human_id, logBookFolder._id);
  const sorted = folders
    .filter((f) => f.folder_type === "log-book" && !f.is_folder_type_root)
    .sort((a, b) => sequenceNumber(a.name) - sequenceNumber(b.name));
  return Promise.all(sorted.map(summarizeEntryFolder));
}

/** Creates the next sequential `entry-N` under a camp's `Log` folder
 * (provisioning it on first use). `entryDate` defaults to today
 * (UTC calendar date) and, unlike `editedDate`, is never changed again. */
export async function createLogEntry(
  campFolder: VaultFolder,
  statement: string,
  entryDate: string = todayIsoDate(),
): Promise<VaultFolder> {
  const logBookFolder = await ensureLogBookFolder(campFolder);
  const { folders: siblings } = await listFolderChildren(logBookFolder.human_id, logBookFolder._id);
  const name = nextSequentialName(
    siblings.map((f) => f.name),
    "entry",
  );
  const created = await createVaultFolder({
    human_id: logBookFolder.human_id,
    name,
    parent_folder_id: logBookFolder._id,
  });
  if (!created) throw new Error("Failed to create the log entry folder");
  const now = new Date().toISOString();
  await createFileRef({
    human_id: created.human_id,
    name: "README.md",
    content: buildEntryReadmeContent({ statement, entryDate, editedDate: now }),
    content_type: "text/markdown",
    folder_id: created._id,
  });
  return created;
}

/** One log entry's full detail, by its own folder id. */
export async function getLogEntry(entryFolderId: string): Promise<LogEntryDetail | null> {
  const folder = await getFolderById(entryFolderId);
  if (!folder || folder.folder_type !== "log-book" || folder.is_folder_type_root) return null;
  const { files } = await listFolderChildren(folder.human_id, folder._id);
  const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
  if (!readmeListing) return null;
  const readme = await getFileRefById(readmeListing._id);
  const { statement, entryDate, editedDate } = await parseEntryReadme(readme?.content);
  const { body } = splitFrontmatter(readme?.content ?? "");
  const assets = files.filter((f) => f.name.toLowerCase() !== "readme.md");
  return { folder, name: folder.name, statement, entryDate, editedDate, readmeFileId: readmeListing._id, body, assets };
}

/** Updates an entry's `statement` (and/or main `body`), bumping
 * `edited_date` to now — `entry_date` is untouched, by design. */
export async function updateLogEntry(
  entryFolderId: string,
  fields: { statement?: string; body?: string },
): Promise<LogEntryDetail> {
  const entry = await getLogEntry(entryFolderId);
  if (!entry) throw new Error("Log entry not found");
  const content = buildEntryReadmeContent(
    {
      statement: fields.statement ?? entry.statement ?? "",
      entryDate: entry.entryDate ?? todayIsoDate(),
      editedDate: new Date().toISOString(),
    },
    fields.body ?? entry.body,
  );
  await updateFileRef(entry.readmeFileId, { content });
  const updated = await getLogEntry(entryFolderId);
  if (!updated) throw new Error("Log entry disappeared mid-update");
  return updated;
}
