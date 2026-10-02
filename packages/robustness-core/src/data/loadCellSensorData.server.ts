/**
 * Sensor Data: the project page's own view of load-cell test results.
 *
 * Deliberately narrow (Gerald, 2026-10-02: "this process should only be
 * for the syncs load-cell folder... this keeps things within our control
 * for now and doesn't open this up to all things") — this module knows how
 * to read exactly ONE `sync-api` analysis shape: the `load-cell` folder
 * `nopal record-load-cell` creates (`crates/cli/src/main.rs`'s
 * `load_cell_schema()`/`load_cell_row()`). A different sensor gets its own
 * recognizer and its own cleaning rules, written when that sensor is
 * actually in hand — never a generic "clean any CSV" path. See the vault
 * skill's "Sync types" section for `sync-api` in general.
 *
 * `isLoadCellAnalysisFolder` is the one gate everything else sits behind:
 * a folder named "load-cell" (case-insensitive — `--analysis` can rename
 * it) whose schema is EXACTLY `record-load-cell`'s own five columns.
 * Anything else — a differently-named analysis, or "load-cell" with a
 * hand-edited schema — is left alone entirely, including by the Sensor
 * Data tab, which simply doesn't appear for it.
 */

import {
  createFileRef,
  createVaultFolder,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import {
  getSyncApiSchema,
  listSyncApiRuns,
  type SyncApiColumn,
  type SyncApiRun,
  type SyncApiSchema,
} from "./syncApi.server";
import { splitFrontmatter } from "./project.types";
import { parse as parseYaml } from "yaml";

export const LOAD_CELL_ANALYSIS_NAME = "load-cell";

const LOAD_CELL_SCHEMA_COLUMNS: readonly SyncApiColumn[] = [
  { name: "elapsed_s", type: "number" },
  { name: "kind", type: "string" },
  { name: "force_lbs", type: "number" },
  { name: "raw_mv_v", type: "number" },
  { name: "distance_in", type: "number" },
];

function schemaMatchesLoadCell(schema: SyncApiSchema | undefined): boolean {
  if (!schema || schema.columns.length !== LOAD_CELL_SCHEMA_COLUMNS.length) return false;
  return LOAD_CELL_SCHEMA_COLUMNS.every((want) =>
    schema.columns.some((c) => c.name === want.name && c.type === want.type),
  );
}

/** True only for the one sync-api shape this module cleans/charts. */
export function isLoadCellAnalysisFolder(folder: VaultFolder, schema: SyncApiSchema | undefined): boolean {
  return (
    folder.folder_type === "sync-api" &&
    !!folder.is_folder_type_root &&
    folder.name.trim().toLowerCase() === LOAD_CELL_ANALYSIS_NAME &&
    schemaMatchesLoadCell(schema)
  );
}

/** Finds this project's (or Personal's) recognized `load-cell` analysis
 * folder, if it has one — null otherwise. The one check that decides
 * whether the Sensor Data tab appears at all. */
export async function findLoadCellAnalysisFolder(spaceFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(spaceFolder.human_id, spaceFolder._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return null;
  const { folders: syncFolders } = await listFolderChildren(spaceFolder.human_id, syncs._id);
  const candidate = syncFolders.find(
    (f) => f.is_folder_type_root && f.folder_type === "sync-api" && f.name.trim().toLowerCase() === LOAD_CELL_ANALYSIS_NAME,
  );
  if (!candidate) return null;
  const schema = await getSyncApiSchema(candidate);
  return isLoadCellAnalysisFolder(candidate, schema) ? candidate : null;
}

// ─── Parsing + cleaning ─────────────────────────────────────────────────

export type LoadCellRawRow = {
  elapsed_s: number;
  kind: string;
  force_lbs: number | null;
  raw_mv_v: number | null;
  distance_in: number | null;
};

export type LoadCellCleanedRow = {
  elapsed_s: number;
  is_checkpoint: boolean;
  force_lbs: number;
  raw_mv_v: number;
  displacement_in: number;
};

export type LoadCellCleanedMeta = {
  forceBaselineLbs: number;
  rawMvBaselineV: number;
  rowCount: number;
  checkpointCount: number;
  peakForceLbs: number;
  peakForceAtS: number;
  peakDisplacementIn: number;
  maxDisplacementIn: number;
  durationS: number;
};

export type LoadCellCleanedResult = {
  rows: LoadCellCleanedRow[];
  meta: LoadCellCleanedMeta;
};

/** A plain, positional parser for exactly this schema's own header order —
 * not a general CSV parser. Safe because every value this schema ever
 * holds is a bare number or the bare word `force`/`distance` (see
 * `rowToCsvLine`'s own quoting rule: nothing here ever needs quoting). */
function parseLoadCellCsv(csvText: string): LoadCellRawRow[] {
  const lines = csvText.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iElapsed = col("elapsed_s");
  const iKind = col("kind");
  const iForce = col("force_lbs");
  const iRaw = col("raw_mv_v");
  const iDist = col("distance_in");
  if (iElapsed < 0 || iKind < 0) return [];

  const num = (cells: string[], i: number): number | null => {
    if (i < 0) return null;
    const v = cells[i];
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const rows: LoadCellRawRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const elapsed = num(cells, iElapsed);
    if (elapsed === null) continue;
    rows.push({
      elapsed_s: elapsed,
      kind: (cells[iKind] ?? "").trim(),
      force_lbs: num(cells, iForce),
      raw_mv_v: num(cells, iRaw),
      distance_in: num(cells, iDist),
    });
  }
  return rows;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const BASELINE_WINDOW_S = 3;

/**
 * The one cleaning recipe this module knows, mechanical and deterministic
 * (no AI judgment involved, same instinct as the Sorter):
 *   1. Tare — each run's own pre-load baseline (median force/raw_mv over
 *      its first `BASELINE_WINDOW_S` seconds) is subtracted out, so every
 *      run's curve starts at 0 regardless of how the load cell happened
 *      to be sitting at rest.
 *   2. Fill displacement — a `distance` row's `distance_in` is a manual
 *      checkpoint (every ~0.125in of travel); forward-filled onto every
 *      `force` row in between so there's a continuous displacement value
 *      for every timestamp, with `is_checkpoint` marking which rows were
 *      actually measured.
 *   3. Dedupe — exact duplicate (elapsed_s, kind) rows are dropped.
 * No row is ever discarded for being "dead time" — a quiet stretch before
 * load was applied is real data about when loading began, not noise.
 */
export function cleanLoadCellRows(raw: LoadCellRawRow[]): LoadCellCleanedResult {
  const sorted = [...raw].sort((a, b) => a.elapsed_s - b.elapsed_s);
  const deduped: LoadCellRawRow[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    const key = `${r.elapsed_s}:${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const baselineRows = deduped.filter((r) => r.elapsed_s <= BASELINE_WINDOW_S);
  const forceBaseline = median(baselineRows.map((r) => r.force_lbs).filter((v): v is number => v !== null));
  const rawBaseline = median(baselineRows.map((r) => r.raw_mv_v).filter((v): v is number => v !== null));

  let lastDisplacement = 0;
  const rows: LoadCellCleanedRow[] = deduped.map((r) => {
    const isCheckpoint = r.kind === "distance";
    if (isCheckpoint && r.distance_in !== null) lastDisplacement = r.distance_in;
    return {
      elapsed_s: round(r.elapsed_s, 3),
      is_checkpoint: isCheckpoint,
      force_lbs: Math.max(0, round((r.force_lbs ?? 0) - forceBaseline, 3)),
      raw_mv_v: round((r.raw_mv_v ?? 0) - rawBaseline, 5),
      displacement_in: round(lastDisplacement, 3),
    };
  });

  let peak = rows[0] ?? { elapsed_s: 0, is_checkpoint: false, force_lbs: 0, raw_mv_v: 0, displacement_in: 0 };
  for (const r of rows) if (r.force_lbs > peak.force_lbs) peak = r;
  const maxDisplacement = rows.reduce((m, r) => Math.max(m, r.displacement_in), 0);
  const duration = rows.length ? rows[rows.length - 1].elapsed_s : 0;

  return {
    rows,
    meta: {
      forceBaselineLbs: round(forceBaseline, 3),
      rawMvBaselineV: round(rawBaseline, 5),
      rowCount: rows.length,
      checkpointCount: rows.filter((r) => r.is_checkpoint).length,
      peakForceLbs: round(peak.force_lbs, 2),
      peakForceAtS: round(peak.elapsed_s, 2),
      peakDisplacementIn: round(peak.displacement_in, 3),
      maxDisplacementIn: round(maxDisplacement, 3),
      durationS: round(duration, 2),
    },
  };
}

function cleanedRowsToCsv(rows: LoadCellCleanedRow[]): string {
  const header = "elapsed_s,is_checkpoint,force_lbs,raw_mv_v,displacement_in";
  const lines = rows.map((r) => `${r.elapsed_s},${r.is_checkpoint},${r.force_lbs},${r.raw_mv_v},${r.displacement_in}`);
  return [header, ...lines].join("\n") + "\n";
}

// ─── The `_cleaned/` sidecar ────────────────────────────────────────────
//
// Mirrors `syncKnowledge.server.ts`'s `_knowledge/` convention exactly: a
// reserved subfolder, one sidecar file per source, written directly
// through the data layer (never through the human write-permission gate,
// since nothing here is human-authored content). Unlike `_knowledge`,
// there's no hash-gated "only if changed" check — a run's CSV is at most
// a few thousand rows, recomputing is cheap, and always-fresh is simpler
// than getting staleness tracking right for no real benefit here.

const CLEANED_FOLDER_NAME = "_cleaned";

function cleanedCsvFileName(runName: string): string {
  return `${runName}.cleaned.csv`;
}

async function ensureCleanedFolder(humanId: string, analysisFolderId: string): Promise<VaultFolder> {
  const { folders } = await listFolderChildren(humanId, analysisFolderId);
  const existing = folders.find((f) => f.name === CLEANED_FOLDER_NAME);
  if (existing) return existing;
  const created = await createVaultFolder({
    human_id: humanId,
    name: CLEANED_FOLDER_NAME,
    parent_folder_id: analysisFolderId,
  });
  if (!created) throw new Error("Failed to create a _cleaned folder");
  return created;
}

/** Recomputes `<run>.cleaned.csv` from the run's CURRENT raw CSV and
 * (over)writes it into the analysis's `_cleaned/` sidecar folder, creating
 * both on first use. Returns the cleaned result so a caller can use it
 * immediately without re-reading the file just written. Call sites:
 * right after a row append (`api.vault.sync-api.$folderId.runs.$runName.rows.tsx`,
 * best-effort), and whenever the Sensor Data tab is viewed (self-healing
 * backfill for runs that predate this feature). */
export async function refreshLoadCellCleanedRun(
  analysisFolder: VaultFolder,
  run: SyncApiRun,
): Promise<LoadCellCleanedResult> {
  const csvFile = await getFileRefById(run.csvFile._id);
  const cleaned = cleanLoadCellRows(parseLoadCellCsv(csvFile?.content ?? ""));

  const cleanedFolder = await ensureCleanedFolder(analysisFolder.human_id, analysisFolder._id);
  const { files } = await listFolderChildren(analysisFolder.human_id, cleanedFolder._id);
  const name = cleanedCsvFileName(run.name);
  const existing = files.find((f) => f.name === name);
  const content = cleanedRowsToCsv(cleaned.rows);
  if (existing) {
    await updateFileRef(existing._id, { content });
  } else {
    await createFileRef({
      human_id: analysisFolder.human_id,
      name,
      content,
      content_type: "text/csv",
      folder_id: cleanedFolder._id,
    });
  }
  return cleaned;
}

async function getLoadCellCleanedFileId(analysisFolder: VaultFolder, runName: string): Promise<string | null> {
  const { folders } = await listFolderChildren(analysisFolder.human_id, analysisFolder._id);
  const cleanedFolder = folders.find((f) => f.name === CLEANED_FOLDER_NAME);
  if (!cleanedFolder) return null;
  const { files } = await listFolderChildren(analysisFolder.human_id, cleanedFolder._id);
  return files.find((f) => f.name === cleanedCsvFileName(runName))?._id ?? null;
}

function runTitle(mdContent: string, fallback: string): string {
  const { frontmatter } = splitFrontmatter(mdContent);
  if (!frontmatter) return fallback;
  try {
    const parsed = parseYaml(frontmatter) as { title?: unknown };
    return typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback;
  } catch {
    return fallback;
  }
}

// ─── The Sensor Data tab's own data ─────────────────────────────────────

export type SensorDataRunSummary = {
  name: string;
  title: string;
  rowCount: number;
  checkpointCount: number;
  peakForceLbs: number;
  maxDisplacementIn: number;
  durationS: number;
  rawFileId: string;
  cleanedFileId: string | null;
};

export type SensorDataTab = {
  analysisFolderId: string;
  runs: SensorDataRunSummary[];
  selected: { name: string; rows: LoadCellCleanedRow[]; meta: LoadCellCleanedMeta } | null;
};

/** Everything the Sensor Data tab needs for one request: every run's
 * summary (refreshing each run's `_cleaned/` sidecar as it goes — cheap,
 * and it's what backfills a run that predates this feature the first time
 * anyone opens the tab), plus the selected run's full cleaned rows for the
 * chart/table. Defaults to the most recent run when none is requested. */
export async function loadSensorDataTab(
  analysisFolder: VaultFolder,
  selectedRunName: string | null,
): Promise<SensorDataTab> {
  const runs = await listSyncApiRuns(analysisFolder);
  const summaries: SensorDataRunSummary[] = [];
  const cleanedByName = new Map<string, LoadCellCleanedResult>();

  for (const run of runs) {
    const cleaned = await refreshLoadCellCleanedRun(analysisFolder, run);
    cleanedByName.set(run.name, cleaned);
    const mdFile = await getFileRefById(run.mdFile._id);
    summaries.push({
      name: run.name,
      title: runTitle(mdFile?.content ?? "", run.name),
      rowCount: cleaned.meta.rowCount,
      checkpointCount: cleaned.meta.checkpointCount,
      peakForceLbs: cleaned.meta.peakForceLbs,
      maxDisplacementIn: cleaned.meta.maxDisplacementIn,
      durationS: cleaned.meta.durationS,
      rawFileId: run.csvFile._id,
      cleanedFileId: await getLoadCellCleanedFileId(analysisFolder, run.name),
    });
  }

  const chosenName = (selectedRunName && runs.some((r) => r.name === selectedRunName))
    ? selectedRunName
    : runs[runs.length - 1]?.name ?? null;
  const chosen = chosenName ? cleanedByName.get(chosenName) : undefined;

  return {
    analysisFolderId: analysisFolder._id,
    runs: summaries,
    selected: chosen && chosenName ? { name: chosenName, rows: chosen.rows, meta: chosen.meta } : null,
  };
}
