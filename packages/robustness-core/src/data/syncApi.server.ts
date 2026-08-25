/**
 * `sync-api` — a Sync Folder Type (see `vaultFolderTypes.ts`, and the
 * `vault` skill's "Sync types" section) for programmatic data collection:
 * an external client (a CLI command, a piece of test-bench hardware, an
 * embedded device) defines a typed CSV schema once, then creates any number
 * of RUNS against it, appending rows to each run over whatever timeframe
 * makes sense for that data source — a single bulk append at the end (the
 * `record-load-cell` CLI command's "entire result set" case) or many small
 * batches spread over hours/days (a continuously-monitoring sensor).
 *
 * A `sync-api`-typed folder is called an ANALYSIS — the point of collecting
 * this data in the first place. A run is exactly two ordinary vault files,
 * sitting side by side in the analysis folder, named after the run:
 *   - `<run>.md`  — title/notes/photos. A completely normal vault markdown
 *     file once created; edited via the existing file routes/editor, never
 *     through this module.
 *   - `<run>.csv` — a header row (from the schema, captured at run-creation
 *     time) plus whatever rows have been appended since.
 *
 * The schema itself lives in one more ordinary file, `_schema.json`,
 * mirroring `website.server.ts`'s `_site-settings.json` convention exactly
 * (a plain JSON file sitting in the folder, editable by hand if needed).
 * Changing the schema later only affects RUNS CREATED AFTER the change —
 * existing runs keep whatever header their own CSV was created with.
 */

import {
  createFileRef,
  createVaultFolder,
  ensureVaultRootFolders,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  updateFileRef,
  type FileRef,
  type FileRefListing,
  type VaultFolder,
} from "./vault.server";

const SCHEMA_FILE_NAME = "_schema.json";

export type SyncApiColumnType = "string" | "number" | "boolean" | "timestamp";

export type SyncApiColumn = {
  name: string;
  type: SyncApiColumnType;
};

export type SyncApiSchema = {
  columns: SyncApiColumn[];
};

export type SyncApiRun = {
  name: string;
  mdFile: FileRefListing;
  csvFile: FileRefListing;
};

function isSyncApiAnalysis(folder: VaultFolder): boolean {
  return folder.folder_type === "sync-api" && !!folder.is_folder_type_root;
}

function isValidColumnType(type: unknown): type is SyncApiColumnType {
  return type === "string" || type === "number" || type === "boolean" || type === "timestamp";
}

/** Validates a schema payload (as received over the API) — a non-empty list
 * of columns, each with a unique, non-empty name and a known type. Returns
 * an error string, or null when valid. */
export function validateSyncApiSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== "object" || !Array.isArray((schema as SyncApiSchema).columns)) {
    return "schema.columns must be an array";
  }
  const columns = (schema as SyncApiSchema).columns;
  if (columns.length === 0) {
    return "schema.columns must not be empty";
  }
  const seen = new Set<string>();
  for (const col of columns) {
    if (!col || typeof col.name !== "string" || !col.name.trim()) {
      return "Every column needs a non-empty name";
    }
    if (seen.has(col.name)) {
      return `Duplicate column name: ${col.name}`;
    }
    seen.add(col.name);
    if (!isValidColumnType(col.type)) {
      return `Column '${col.name}' has an unknown type: ${String(col.type)}`;
    }
  }
  return null;
}

/** Reads `_schema.json` for a `sync-api` analysis folder — undefined if the
 * folder isn't a `sync-api` analysis, or the schema hasn't been set yet. */
export async function getSyncApiSchema(
  analysisFolder: VaultFolder,
): Promise<SyncApiSchema | undefined> {
  if (!isSyncApiAnalysis(analysisFolder)) return undefined;
  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const listing = files.find((f) => f.name.toLowerCase() === SCHEMA_FILE_NAME.toLowerCase());
  if (!listing) return undefined;
  const file = await getFileRefById(listing._id);
  if (!file?.content) return undefined;
  try {
    const parsed = JSON.parse(file.content);
    return validateSyncApiSchema(parsed) === null ? (parsed as SyncApiSchema) : undefined;
  } catch {
    return undefined;
  }
}

export type SetSyncApiSchemaResult =
  | { ok: true; schema: SyncApiSchema }
  | { ok: false; error: string };

/** Creates or wholesale-replaces `_schema.json`. Callers are responsible for
 * their own permission check before calling this (mirrors
 * `setWebsiteSettings`'s split) — this function is mechanical only. */
export async function setSyncApiSchema(
  analysisFolder: VaultFolder,
  schema: SyncApiSchema,
): Promise<SetSyncApiSchemaResult> {
  if (!isSyncApiAnalysis(analysisFolder)) {
    return { ok: false, error: "Not a sync-api analysis folder" };
  }
  const error = validateSyncApiSchema(schema);
  if (error) return { ok: false, error };

  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const existing = files.find((f) => f.name.toLowerCase() === SCHEMA_FILE_NAME.toLowerCase());
  const content = JSON.stringify(schema, null, 2) + "\n";

  if (existing) {
    await updateFileRef(existing._id, { content });
  } else {
    await createFileRef({
      human_id: analysisFolder.human_id,
      name: SCHEMA_FILE_NAME,
      content,
      content_type: "application/json",
      folder_id: analysisFolder._id,
    });
  }
  return { ok: true, schema };
}

// ─── CSV encoding ───────────────────────────────────────────────────────

/** Minimal RFC 4180 quoting — wraps a field in quotes (doubling any interior
 * quotes) whenever it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function coerceCell(value: unknown, type: SyncApiColumnType): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`expected a finite number, got ${JSON.stringify(value)}`);
      }
      return String(value);
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`expected a boolean, got ${JSON.stringify(value)}`);
      }
      return value ? "true" : "false";
    case "timestamp":
    case "string":
    default:
      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`expected a string, got ${JSON.stringify(value)}`);
      }
      return String(value);
  }
}

function csvHeaderLine(schema: SyncApiSchema): string {
  return schema.columns.map((c) => csvField(c.name)).join(",");
}

/** Strict: every schema column must be present (null/undefined allowed —
 * encoded as an empty cell) and no unknown keys — typos surface immediately
 * instead of silently producing a misaligned CSV. */
function rowToCsvLine(schema: SyncApiSchema, row: Record<string, unknown>): string {
  const knownNames = new Set(schema.columns.map((c) => c.name));
  const unknown = Object.keys(row).filter((k) => !knownNames.has(k));
  if (unknown.length > 0) {
    throw new Error(`Unknown column(s): ${unknown.join(", ")}`);
  }
  const cells = schema.columns.map((col) => {
    if (!(col.name in row)) {
      throw new Error(`Missing column: ${col.name}`);
    }
    try {
      return csvField(coerceCell(row[col.name], col.type));
    } catch (e) {
      throw new Error(`Column '${col.name}': ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return cells.join(",");
}

// ─── Runs ───────────────────────────────────────────────────────────────

const RUN_NAME_RE = /^[A-Za-z0-9._-]+$/;

function runFileNames(name: string): { md: string; csv: string } {
  return { md: `${name}.md`, csv: `${name}.csv` };
}

/** Every existing run in an analysis folder — paired up by matching
 * `<name>.md` / `<name>.csv` file names. A `.csv` with no matching `.md`
 * (or vice versa) is skipped — shouldn't happen via this module's own API,
 * but a hand-edited folder could end up that way. */
export async function listSyncApiRuns(analysisFolder: VaultFolder): Promise<SyncApiRun[]> {
  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const byName = new Map<string, FileRefListing>();
  for (const f of files) byName.set(f.name, f);

  const runs: SyncApiRun[] = [];
  for (const f of files) {
    if (!f.name.endsWith(".csv")) continue;
    const name = f.name.slice(0, -4);
    const md = byName.get(`${name}.md`);
    if (md) runs.push({ name, mdFile: md, csvFile: f });
  }
  runs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return runs;
}

/** Picks the next unused `<prefix>-N` name in this analysis (N starts at 1
 * and increments past any existing run, regardless of gaps). */
async function nextAutoName(analysisFolder: VaultFolder, prefix: string): Promise<string> {
  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const existing = new Set(files.map((f) => f.name));
  let n = 1;
  while (existing.has(`${prefix}-${n}.md`) || existing.has(`${prefix}-${n}.csv`)) {
    n++;
  }
  return `${prefix}-${n}`;
}

export type CreateSyncApiRunResult =
  | { ok: true; run: SyncApiRun }
  | { ok: false; error: string };

/**
 * Creates a new run: `<name>.md` (title + optional body) and `<name>.csv`
 * (header row only, snapshotting the analysis's CURRENT schema). Exactly
 * one of `name`/`prefix` is meaningful — `name` for an exact, caller-chosen
 * run name; `prefix` (e.g. "test") to auto-number against existing runs
 * sharing that prefix ("test-1", "test-2", ...). Defaults to prefix "test"
 * when neither is given.
 */
export async function createSyncApiRun(
  analysisFolder: VaultFolder,
  options: { name?: string; prefix?: string; title?: string; body?: string },
): Promise<CreateSyncApiRunResult> {
  if (!isSyncApiAnalysis(analysisFolder)) {
    return { ok: false, error: "Not a sync-api analysis folder" };
  }
  const schema = await getSyncApiSchema(analysisFolder);
  if (!schema) {
    return { ok: false, error: "This analysis has no schema yet — set one before creating a run" };
  }

  let name: string;
  if (options.name) {
    name = options.name.trim();
    if (!RUN_NAME_RE.test(name)) {
      return { ok: false, error: "Run name may only contain letters, numbers, '.', '_', and '-'" };
    }
  } else {
    name = await nextAutoName(analysisFolder, (options.prefix ?? "test").trim() || "test");
  }

  const { md, csv } = runFileNames(name);
  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  if (files.some((f) => f.name === md || f.name === csv)) {
    return { ok: false, error: `A run named '${name}' already exists` };
  }

  const title = options.title?.trim() || name;
  const frontmatter = ["---", `title: ${JSON.stringify(title)}`, `createdAt: ${new Date().toISOString()}`, "---", ""].join("\n");
  const mdContent = `${frontmatter}\n# ${title}\n\n${options.body?.trim() ?? ""}\n`;
  const csvContent = csvHeaderLine(schema) + "\n";

  const [mdFile, csvFile] = await Promise.all([
    createFileRef({
      human_id: analysisFolder.human_id,
      name: md,
      content: mdContent,
      content_type: "text/markdown",
      folder_id: analysisFolder._id,
    }),
    createFileRef({
      human_id: analysisFolder.human_id,
      name: csv,
      content: csvContent,
      content_type: "text/csv",
      folder_id: analysisFolder._id,
    }),
  ]);
  if (!mdFile || !csvFile) {
    return { ok: false, error: "Failed to create run files" };
  }

  return {
    ok: true,
    run: {
      name,
      mdFile: toListing(mdFile),
      csvFile: toListing(csvFile),
    },
  };
}

function toListing(file: FileRef): FileRefListing {
  return {
    id: file.id,
    _id: file._id,
    human_id: file.human_id,
    name: file.name,
    content_type: file.content_type,
    content_hash: file.content_hash ?? null,
    folder_id: file.folder_id,
    size: file.size,
    source: file.source,
    date: file.date,
    created_at: file.created_at,
    updated_at: file.updated_at,
    archived_at: file.archived_at ?? null,
    has_s3: !!file.s3_key,
  };
}

export type AppendSyncApiRowsResult =
  | { ok: true; appended: number }
  | { ok: false; error: string };

/**
 * Appends rows to an existing run's CSV — always a server-side
 * read-current-content-append-write, never something the client does
 * itself (the client only ever sends the NEW rows). Validated strictly
 * against the analysis's schema (see `rowToCsvLine`): a bad row fails the
 * WHOLE call before anything is written, so a run's CSV never ends up with
 * a partially-applied batch.
 */
export async function appendSyncApiRows(
  analysisFolder: VaultFolder,
  runName: string,
  rows: Record<string, unknown>[],
): Promise<AppendSyncApiRowsResult> {
  if (!isSyncApiAnalysis(analysisFolder)) {
    return { ok: false, error: "Not a sync-api analysis folder" };
  }
  if (rows.length === 0) {
    return { ok: true, appended: 0 };
  }

  const schema = await getSyncApiSchema(analysisFolder);
  if (!schema) {
    return { ok: false, error: "This analysis has no schema" };
  }

  const { csv } = runFileNames(runName);
  const { files } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const listing = files.find((f) => f.name === csv);
  if (!listing) {
    return { ok: false, error: `No run named '${runName}'` };
  }
  const csvFile = await getFileRefById(listing._id);
  if (!csvFile) {
    return { ok: false, error: `No run named '${runName}'` };
  }

  let lines: string[];
  try {
    lines = rows.map((row) => rowToCsvLine(schema, row));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const base = csvFile.content ?? csvHeaderLine(schema) + "\n";
  const separator = base.endsWith("\n") ? "" : "\n";
  const content = base + separator + lines.join("\n") + "\n";

  await updateFileRef(csvFile._id, { content });
  return { ok: true, appended: lines.length };
}

/** Resolves a folder id to a `sync-api` analysis folder, or an error
 * suitable for a 4xx response — the one check every route in this feature
 * needs before doing anything else. */
export async function resolveSyncApiAnalysis(
  folderId: string,
): Promise<{ ok: true; folder: VaultFolder } | { ok: false; status: number; error: string }> {
  const folder = await getFolderById(folderId);
  if (!folder) return { ok: false, status: 404, error: "Folder not found" };
  if (!isSyncApiAnalysis(folder)) {
    return { ok: false, status: 400, error: "Not a sync-api analysis folder" };
  }
  return { ok: true, folder };
}

export type EnsureSyncApiAnalysisResult =
  | { ok: true; folder: VaultFolder }
  | { ok: false; status: number; error: string };

/**
 * The single-call "get me an analysis folder id" primitive for a
 * CONSTRAINED client — an embedded device, or anything else that
 * shouldn't have to walk the vault tree itself the way the CLI's
 * `nopal_core::sync_api::ensure_analysis` does (several
 * `/api/vault/folders/:folderId/children` calls). That route only accepts
 * a FULL bearer token (`getUserFromRequest`), not a sync-scoped one — so a
 * device holding a long-lived, revocable, sync-only credential (the right
 * credential for something unattended, see the vault skill) has no other
 * way to discover its own analysis folder id. This route does the whole
 * resolve-or-create dance server-side in one call and hands back the id.
 *
 * `project`, if given, is a PLAIN PROJECT NAME (a direct child of the
 * caller's own `projects` root) — deliberately NOT a full vault path like
 * the CLI's own `--project` flag accepts (e.g. `"projects/sunny"`), since
 * this is meant for simpler caller contexts (a captive-portal form field on
 * a physical device) that shouldn't need to know vault path syntax. Omit
 * or leave blank for the caller's Personal space.
 *
 * Always (re)sets the schema on the resolved analysis (see
 * `setSyncApiSchema`'s own doc for why that's safe) — a caller is expected
 * to call this once per boot/session with its own hardcoded schema, same
 * as `ensure_analysis` on the CLI side.
 */
export async function ensureSyncApiAnalysis(
  humanId: string,
  project: string | null | undefined,
  name: string,
  schema: SyncApiSchema,
): Promise<EnsureSyncApiAnalysisResult> {
  if (!name.trim()) return { ok: false, status: 400, error: "name is required" };
  const schemaError = validateSyncApiSchema(schema);
  if (schemaError) return { ok: false, status: 400, error: schemaError };

  const roots = await ensureVaultRootFolders(humanId);

  let space: VaultFolder | undefined;
  if (project && project.trim()) {
    const projectsRoot = roots.find((f) => f.vault_root_key === "projects");
    if (!projectsRoot) return { ok: false, status: 404, error: "Projects root not found" };
    const { folders } = await listFolderChildren(humanId, projectsRoot._id);
    const wanted = project.trim().toLowerCase();
    space = folders.find((f) => f.name.toLowerCase() === wanted);
    if (!space) return { ok: false, status: 404, error: `No project named '${project}'` };
  } else {
    space = roots.find((f) => f.vault_root_key === "personal");
    if (!space) return { ok: false, status: 404, error: "Personal space not found" };
  }

  const { folders: spaceChildren } = await listFolderChildren(humanId, space._id);
  let syncs = spaceChildren.find((f) => f.folder_type === "syncs" && f.is_folder_type_root);
  if (!syncs) {
    syncs = await createVaultFolder({
      human_id: humanId,
      name: "syncs",
      parent_folder_id: space._id,
      folder_type: "syncs",
    });
    if (!syncs) return { ok: false, status: 500, error: "Failed to create syncs folder" };
  }

  const trimmedName = name.trim();
  const { folders: syncsChildren } = await listFolderChildren(humanId, syncs._id);
  let analysis = syncsChildren.find(
    (f) => f.name === trimmedName && f.folder_type === "sync-api" && f.is_folder_type_root,
  );
  if (!analysis) {
    if (syncsChildren.some((f) => f.name === trimmedName)) {
      return {
        ok: false,
        status: 409,
        error: `${trimmedName} already exists but isn't a sync-api analysis`,
      };
    }
    analysis = await createVaultFolder({
      human_id: humanId,
      name: trimmedName,
      parent_folder_id: syncs._id,
      folder_type: "sync-api",
    });
    if (!analysis) return { ok: false, status: 500, error: "Failed to create analysis folder" };
  }

  const schemaResult = await setSyncApiSchema(analysis, schema);
  if (!schemaResult.ok) return { ok: false, status: 400, error: schemaResult.error };

  return { ok: true, folder: analysis };
}
