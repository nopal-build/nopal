/**
 * Sensor Data: the project page's own view of BoxHardware wall-temperature
 * test results — the second-generation `hot-box` hardware (one Pico 2 W
 * monitoring both an "inside" and "outside" 3x3 DS18B20 grid + ambient
 * sensor at once, see `hot-box/box-hardware/README.md`).
 *
 * Mirrors `loadCellSensorData.server.ts`'s own shape exactly (same
 * deliberately-narrow instinct: a different sensor gets its own recognizer
 * and its own cleaning rules, never a generic "clean any CSV" path) — this
 * module knows how to read exactly ONE `sync-api` analysis shape: the
 * `box-hardware-data` folder `box-hardware/vault.py`'s `ensure_run` creates
 * (`vault.py`'s own `SCHEMA`).
 *
 * `isBoxHardwareAnalysisFolder` is the one gate everything else sits
 * behind: a folder named "box-hardware-data" (case-insensitive) whose
 * schema is EXACTLY `vault.py`'s own six columns. Anything else is left
 * alone entirely, including by the Sensor Data tab.
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
  type SyncApiSchema,
} from "./syncApi.server";
import { splitFrontmatter } from "./project.types";
import { parse as parseYaml } from "yaml";

export const BOX_HARDWARE_ANALYSIS_NAME = "box-hardware-data";

const BOX_HARDWARE_SCHEMA_COLUMNS: readonly SyncApiColumn[] = [
  { name: "timestamp", type: "timestamp" },
  { name: "device_name", type: "string" },
  { name: "side", type: "string" },
  { name: "sensor_id", type: "string" },
  { name: "sensor_name", type: "string" },
  { name: "temperature_c", type: "number" },
];

function schemaMatchesBoxHardware(schema: SyncApiSchema | undefined): boolean {
  if (!schema || schema.columns.length !== BOX_HARDWARE_SCHEMA_COLUMNS.length) return false;
  return BOX_HARDWARE_SCHEMA_COLUMNS.every((want) =>
    schema.columns.some((c) => c.name === want.name && c.type === want.type),
  );
}

/** True only for the one sync-api shape this module cleans/charts. */
export function isBoxHardwareAnalysisFolder(folder: VaultFolder, schema: SyncApiSchema | undefined): boolean {
  return (
    folder.folder_type === "sync-api" &&
    !!folder.is_folder_type_root &&
    folder.name.trim().toLowerCase() === BOX_HARDWARE_ANALYSIS_NAME &&
    schemaMatchesBoxHardware(schema)
  );
}

/** Finds this project's (or Personal's) recognized `box-hardware-data`
 * analysis folder, if it has one — null otherwise. The one check that
 * decides whether its half of the Sensor Data tab appears at all. */
export async function findBoxHardwareAnalysisFolder(spaceFolder: VaultFolder): Promise<VaultFolder | null> {
  const { folders } = await listFolderChildren(spaceFolder.human_id, spaceFolder._id);
  const syncs = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncs) return null;
  const { folders: syncFolders } = await listFolderChildren(spaceFolder.human_id, syncs._id);
  const candidate = syncFolders.find(
    (f) => f.is_folder_type_root && f.folder_type === "sync-api" && f.name.trim().toLowerCase() === BOX_HARDWARE_ANALYSIS_NAME,
  );
  if (!candidate) return null;
  const schema = await getSyncApiSchema(candidate);
  return isBoxHardwareAnalysisFolder(candidate, schema) ? candidate : null;
}

// ─── Parsing + cleaning ─────────────────────────────────────────────────

export type BoxHardwareRawRow = {
  timestamp: string;
  device_name: string;
  side: string;
  sensor_id: string;
  sensor_name: string;
  temperature_c: number;
};

/** One reading cycle (every sensor fires within the same `main.py` loop
 * iteration, sharing one `timestamp`), reduced to the four numbers a wall
 * assembly test actually cares about: each side's ambient air temp and its
 * 9-sensor wall-face grid average, plus the exterior-minus-interior delta
 * for both — the same headline comparison `hot-box/termodyn/south_wall_monitoring.py`
 * plots as "wall_comparison.png"/"wall_delta_t.png" for the proof-of-concept
 * hardware's two-separate-devices version of this same test. */
export type BoxHardwareCleanedRow = {
  timestamp: string;
  elapsed_s: number;
  inside_ambient_c: number | null;
  inside_grid_mean_c: number | null;
  outside_ambient_c: number | null;
  outside_grid_mean_c: number | null;
  ambient_delta_c: number | null;
  grid_mean_delta_c: number | null;
};

export type BoxHardwareCleanedMeta = {
  rowCount: number;
  cycleCount: number;
  sensorCount: number;
  durationS: number;
  startAt: string | null;
  endAt: string | null;
  minTempC: number;
  maxTempC: number;
  peakAmbientDeltaC: number | null;
  peakGridMeanDeltaC: number | null;
};

export type BoxHardwareCleanedResult = {
  rows: BoxHardwareCleanedRow[];
  meta: BoxHardwareCleanedMeta;
};

/** A plain, positional-by-header parser for exactly this schema's columns
 * — not a general CSV parser. Safe because every value this schema ever
 * holds is a bare identifier/number (see `rowToCsvLine`'s own quoting
 * rule in `syncApi.server.ts`: nothing here ever needs quoting). */
function parseBoxHardwareCsv(csvText: string): BoxHardwareRawRow[] {
  const lines = csvText.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iTs = col("timestamp");
  const iDevice = col("device_name");
  const iSide = col("side");
  const iSensorId = col("sensor_id");
  const iSensorName = col("sensor_name");
  const iTemp = col("temperature_c");
  if (iTs < 0 || iTemp < 0) return [];

  const rows: BoxHardwareRawRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const timestamp = (cells[iTs] ?? "").trim();
    const tempRaw = cells[iTemp];
    const temperature_c = tempRaw === undefined || tempRaw === "" ? NaN : Number(tempRaw);
    if (!timestamp || !Number.isFinite(temperature_c)) continue;
    rows.push({
      timestamp,
      device_name: (cells[iDevice] ?? "").trim(),
      side: (cells[iSide] ?? "").trim().toLowerCase(),
      sensor_id: (cells[iSensorId] ?? "").trim(),
      sensor_name: (cells[iSensorName] ?? "").trim(),
      temperature_c,
    });
  }
  return rows;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const AMBIENT_RE = /(?:^|-)ambient$/i;
const GRID_RE = /b\d+-\d+$/i;

const SIDES = ["inside", "outside"] as const;
type Side = (typeof SIDES)[number];

/**
 * The one cleaning recipe this module knows, mechanical and deterministic:
 *   1. Drop garbage-clock placeholder rows — this hardware's RTC defaults
 *      to 2021-01-01 until the first successful NTP sync (`main.py`'s
 *      "Known limitations"); a real reading with that garbage timestamp is
 *      dropped rather than guessed at, the same rule
 *      `south_wall_monitoring.py` applies to the proof-of-concept hardware.
 *   2. Dedupe — exact duplicate (timestamp, sensor_id) rows are dropped.
 *   3. Group into cycles — every sensor in one `take_reading()` loop shares
 *      the same `timestamp` string; each cycle collapses to one row: each
 *      side's ambient sensor reading and the mean of its 9 `b<row>-<col>`
 *      wall-grid sensors, plus exterior-minus-interior delta for both.
 * No row is ever discarded for being "uneventful" — a quiet overnight
 * stretch is real data about how slowly the wall responds, not noise.
 */
export function cleanBoxHardwareRows(raw: BoxHardwareRawRow[]): BoxHardwareCleanedResult {
  const sorted = [...raw].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const deduped: BoxHardwareRawRow[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    const key = `${r.timestamp}:${r.sensor_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Garbage-clock placeholder rows fall on the Pico's default RTC epoch
    // (2021-01-01) — real reading, garbage clock. Drop them.
    if (Number(r.timestamp.slice(0, 4)) < 2022) continue;
    deduped.push(r);
  }

  const cycles = new Map<string, BoxHardwareRawRow[]>();
  for (const r of deduped) {
    const list = cycles.get(r.timestamp);
    if (list) list.push(r);
    else cycles.set(r.timestamp, [r]);
  }

  const cycleTimestamps = [...cycles.keys()].sort((a, b) => a.localeCompare(b));
  const startMs = cycleTimestamps.length ? Date.parse(cycleTimestamps[0]) : NaN;

  const rows: BoxHardwareCleanedRow[] = cycleTimestamps.map((ts) => {
    const cycleRows = cycles.get(ts)!;
    const bySide: Record<Side, { ambient: number | null; gridMean: number | null }> = {
      inside: { ambient: null, gridMean: null },
      outside: { ambient: null, gridMean: null },
    };
    for (const side of SIDES) {
      const sideRows = cycleRows.filter((r) => r.side === side);
      const ambient = sideRows.find((r) => AMBIENT_RE.test(r.sensor_name))?.temperature_c ?? null;
      const gridMean = mean(sideRows.filter((r) => GRID_RE.test(r.sensor_name)).map((r) => r.temperature_c));
      bySide[side] = { ambient, gridMean };
    }
    const ms = Date.parse(ts);
    const ambientDelta =
      bySide.outside.ambient !== null && bySide.inside.ambient !== null
        ? bySide.outside.ambient - bySide.inside.ambient
        : null;
    const gridMeanDelta =
      bySide.outside.gridMean !== null && bySide.inside.gridMean !== null
        ? bySide.outside.gridMean - bySide.inside.gridMean
        : null;
    return {
      timestamp: ts,
      elapsed_s: Number.isFinite(startMs) && Number.isFinite(ms) ? round((ms - startMs) / 1000, 0) : 0,
      inside_ambient_c: bySide.inside.ambient !== null ? round(bySide.inside.ambient, 3) : null,
      inside_grid_mean_c: bySide.inside.gridMean !== null ? round(bySide.inside.gridMean, 3) : null,
      outside_ambient_c: bySide.outside.ambient !== null ? round(bySide.outside.ambient, 3) : null,
      outside_grid_mean_c: bySide.outside.gridMean !== null ? round(bySide.outside.gridMean, 3) : null,
      ambient_delta_c: ambientDelta !== null ? round(ambientDelta, 3) : null,
      grid_mean_delta_c: gridMeanDelta !== null ? round(gridMeanDelta, 3) : null,
    };
  });

  const allTemps = deduped.map((r) => r.temperature_c);
  const peakByAbs = (values: (number | null)[]): number | null => {
    const defined = values.filter((v): v is number => v !== null);
    if (defined.length === 0) return null;
    return defined.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), defined[0]);
  };
  const duration = rows.length ? rows[rows.length - 1].elapsed_s : 0;

  return {
    rows,
    meta: {
      rowCount: deduped.length,
      cycleCount: rows.length,
      sensorCount: new Set(deduped.map((r) => r.sensor_id)).size,
      durationS: duration,
      startAt: cycleTimestamps[0] ?? null,
      endAt: cycleTimestamps[cycleTimestamps.length - 1] ?? null,
      minTempC: allTemps.length ? round(Math.min(...allTemps), 3) : 0,
      maxTempC: allTemps.length ? round(Math.max(...allTemps), 3) : 0,
      peakAmbientDeltaC: peakByAbs(rows.map((r) => r.ambient_delta_c)),
      peakGridMeanDeltaC: peakByAbs(rows.map((r) => r.grid_mean_delta_c)),
    },
  };
}

function cell(v: number | null): string {
  return v === null ? "" : String(v);
}

function cleanedRowsToCsv(rows: BoxHardwareCleanedRow[]): string {
  const header = "timestamp,elapsed_s,inside_ambient_c,inside_grid_mean_c,outside_ambient_c,outside_grid_mean_c,ambient_delta_c,grid_mean_delta_c";
  const lines = rows.map(
    (r) =>
      `${r.timestamp},${r.elapsed_s},${cell(r.inside_ambient_c)},${cell(r.inside_grid_mean_c)},${cell(r.outside_ambient_c)},${cell(r.outside_grid_mean_c)},${cell(r.ambient_delta_c)},${cell(r.grid_mean_delta_c)}`,
  );
  return [header, ...lines].join("\n") + "\n";
}

// ─── The `_cleaned/` sidecar ────────────────────────────────────────────
// Mirrors `loadCellSensorData.server.ts`'s own `_cleaned/` sidecar exactly
// (itself mirroring `syncKnowledge.server.ts`'s `_knowledge/` convention):
// a reserved subfolder, one sidecar file per run, written directly through
// the data layer, always recomputed (no hash-gated staleness tracking —
// a run's CSV is at most a few thousand rows, recomputing is cheap).

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

/** Recomputes `<runName>.cleaned.csv` from `csvFileId`'s CURRENT raw
 * content and (over)writes it into the analysis's `_cleaned/` sidecar
 * folder, creating both on first use. Returns the cleaned result so a
 * caller can use it immediately without re-reading the file just written.
 * Call sites: right after a row append
 * (`api.vault.sync-api.$folderId.runs.$runName.rows.tsx`, best-effort), and
 * whenever the Sensor Data tab is viewed (self-healing backfill for runs
 * that predate this feature). */
export async function refreshBoxHardwareCleanedRun(
  analysisFolder: VaultFolder,
  runName: string,
  csvFileId: string,
): Promise<BoxHardwareCleanedResult> {
  const csvFile = await getFileRefById(csvFileId);
  const cleaned = cleanBoxHardwareRows(parseBoxHardwareCsv(csvFile?.content ?? ""));

  const cleanedFolder = await ensureCleanedFolder(analysisFolder.human_id, analysisFolder._id);
  const { files } = await listFolderChildren(analysisFolder.human_id, cleanedFolder._id);
  const name = cleanedCsvFileName(runName);
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

export async function getBoxHardwareCleanedFileId(analysisFolder: VaultFolder, runName: string): Promise<string | null> {
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

export type BoxHardwareRunSummary = {
  name: string;
  title: string;
  rowCount: number;
  cycleCount: number;
  durationS: number;
  peakAmbientDeltaC: number | null;
  peakGridMeanDeltaC: number | null;
  rawFileId: string;
  cleanedFileId: string | null;
};

export type BoxHardwareDataTab = {
  analysisFolderId: string;
  runs: BoxHardwareRunSummary[];
  selected: { name: string; rows: BoxHardwareCleanedRow[]; meta: BoxHardwareCleanedMeta } | null;
};

/** Everything the Sensor Data tab needs for one request, for its
 * BoxHardware half: every run's summary (refreshing each run's `_cleaned/`
 * sidecar as it goes — cheap, and backfills a run that predates this
 * feature the first time anyone opens the tab), plus the selected run's
 * full cleaned rows for the chart/table. Defaults to the most recent run
 * when none is requested. */
export async function loadBoxHardwareDataTab(
  analysisFolder: VaultFolder,
  selectedRunName: string | null,
): Promise<BoxHardwareDataTab> {
  const runs = await listSyncApiRuns(analysisFolder);
  const summaries: BoxHardwareRunSummary[] = [];
  const cleanedByName = new Map<string, BoxHardwareCleanedResult>();

  for (const run of runs) {
    const cleaned = await refreshBoxHardwareCleanedRun(analysisFolder, run.name, run.csvFile._id);
    cleanedByName.set(run.name, cleaned);
    const mdFile = await getFileRefById(run.mdFile._id);
    summaries.push({
      name: run.name,
      title: runTitle(mdFile?.content ?? "", run.name),
      rowCount: cleaned.meta.rowCount,
      cycleCount: cleaned.meta.cycleCount,
      durationS: cleaned.meta.durationS,
      peakAmbientDeltaC: cleaned.meta.peakAmbientDeltaC,
      peakGridMeanDeltaC: cleaned.meta.peakGridMeanDeltaC,
      rawFileId: run.csvFile._id,
      cleanedFileId: await getBoxHardwareCleanedFileId(analysisFolder, run.name),
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
