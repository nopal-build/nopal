/**
 * Shared types for the `::LoadCellGraph{fileId="..."}` leaf directive —
 * embeds one load-cell test run's Sensor Data tab widget (summary stats,
 * raw/cleaned CSV downloads, Force vs. Time + Force vs. Displacement
 * charts) directly into a README/project page, resolved from OUTSIDE (see
 * `LoadCellGraphResolver` below) — same "resolved externally, by a stable
 * vault id" shape as `::video{fileId="..."}`/`::file{fileId="..."}`,
 * distinct from `::gallery{folder="..."}`'s by-NAME resolution (a load-cell
 * run CSV is referenced the same way any other individual vault file is,
 * not by a folder name a project happens to have).
 *
 * `fileId` is the run's RAW csv file id — the same id
 * `SensorDataRunSummary.rawFileId` already exposes
 * (`robustness-core/data/loadCellSensorData.server.ts`), so a author
 * copying a `fileId` out of the Sensor Data tab's own "Download raw CSV"
 * button network request (or `nopal vault info <path>`) always has the
 * right value. The real parsing/cleaning logic lives in `robustness-core`
 * (it already owns the one recognized load-cell CSV shape); this package
 * only holds the shape every renderer/resolver agrees on, with zero
 * vault/React dependency, mirroring `galleryDirective.ts`/`cardDirective.ts`.
 */

export type LoadCellGraphPoint = { x: number; y: number };

export type LoadCellGraphMeta = {
  peakForceLbs: number;
  peakDisplacementIn: number;
  maxDisplacementIn: number;
  durationS: number;
};

export type LoadCellGraphRow = {
  elapsed_s: number;
  is_checkpoint: boolean;
  force_lbs: number;
  raw_mv_v: number;
  displacement_in: number;
};

export interface ResolvedLoadCellGraph {
  /** Defaults to the run's own name (the CSV's filename, minus `.csv`) —
   * overridable per-embed via the directive's own `title="..."` attribute,
   * same convention as `::gallery{folder="..." title="..."}`. */
  title: string;
  meta: LoadCellGraphMeta;
  rows: LoadCellGraphRow[];
  /** The raw CSV's own vault file id — same value as the `fileId` attribute,
   * handed back here so a renderer never needs to re-read the directive's
   * attrs to build its own "Download raw CSV" button. */
  rawFileId: string;
  /** Null when no `_cleaned/` sidecar exists yet (and couldn't be created —
   * e.g. a read-only render context) — the "Download cleaned CSV" button
   * disables, exactly like the Sensor Data tab's own run view. */
  cleanedFileId: string | null;
}

/** A plain lookup function, same spirit as `GalleryFolderResolver`/
 * `CardResolver` — the renderer has no concept of "vault" or "load cell";
 * it just calls this with a `::LoadCellGraph{fileId="..."}` directive's
 * `fileId` attribute and renders whatever comes back. Returns
 * `null`/`undefined` for a fileId this particular render pass has no data
 * for (unknown id, not a recognized load-cell CSV, still loading, ...) —
 * the directive then renders nothing rather than an empty box. */
export type LoadCellGraphResolver = (fileId: string) => ResolvedLoadCellGraph | null | undefined;
