// Shared BoxHardware wall-temperature test result widget — summary stats,
// raw/cleaned CSV downloads, and two hover-able charts (Temperature vs.
// Time, Delta T vs. Time). The project page's "Sensor Data" tab's own
// BoxHardware half (`BoxHardwareView.tsx`'s `BoxHardwareRunView`) — see
// `boxHardwareData.server.ts` for the one recognized `box-hardware-data`
// sync-api CSV shape this reads.
import { useRef, useState } from "react";
import type { BoxHardwareCleanedRow } from "robustness-core/data/boxHardwareData.server";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors, colors } from "stamps/tokens";
import { Cluster } from "stamps/Cluster";
import { Chip } from "stamps/Chip";
import { ExpandIcon } from "stamps/ExpandIcon";
import { Modal } from "stamps/Modal";
import { CircleButton } from "stamps/CircleButton";
import { downloadFromUrl, vaultDownloadUrl, type LoadCellDownloadUrlFn } from "./LoadCellGraphCard";
import { useTemperatureUnitPref } from "../hooks/useTemperatureUnitPref";
import { celsiusDeltaToDisplay, celsiusToDisplay, temperatureUnitLabel, type TemperatureUnit } from "../util/temperature";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
        {label}
      </div>
      <div className={textSize.sm} style={{ fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

export interface BoxHardwareGraphCardMeta {
  cycleCount: number;
  durationS: number;
  peakAmbientDeltaC: number | null;
  peakGridMeanDeltaC: number | null;
}

export interface BoxHardwareGraphCardProps {
  /** Shown above the stat row — omit for the Sensor Data tab (the run
   * picker above it already names the run). */
  title?: string;
  meta: BoxHardwareGraphCardMeta;
  rows: BoxHardwareCleanedRow[];
  rawFileId: string;
  cleanedFileId: string | null;
  /** Base filename (no extension) the download buttons save as. */
  downloadName: string;
  showTable?: boolean;
  tableMaxRows?: number;
  downloadUrl?: LoadCellDownloadUrlFn | null;
}

function fmtHours(s: number): string {
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtDelta(deltaC: number | null, unit: TemperatureUnit): string {
  if (deltaC === null) return "—";
  const v = celsiusDeltaToDisplay(deltaC, unit);
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}${temperatureUnitLabel(unit)}`;
}

function UnitToggle({ unit, onChange }: { unit: TemperatureUnit; onChange: (next: TemperatureUnit) => void }) {
  return (
    <Cluster gap={2} align="center">
      {(["F", "C"] as const).map((option) => (
        <Chip key={option} active={unit === option} onClick={() => onChange(option)}>
          °{option}
        </Chip>
      ))}
    </Cluster>
  );
}

export function BoxHardwareGraphCard({
  title,
  meta,
  rows,
  rawFileId,
  cleanedFileId,
  downloadName,
  showTable = false,
  tableMaxRows = 500,
  downloadUrl = vaultDownloadUrl,
}: BoxHardwareGraphCardProps) {
  const [unit, setUnit] = useTemperatureUnitPref();
  const unitLabel = temperatureUnitLabel(unit);

  const tempSeries: ChartSeries[] = [
    { label: "Inside ambient", color: colors.purple, dashed: true, points: pointsFor(rows, "inside_ambient_c", (c) => celsiusToDisplay(c, unit)) },
    { label: "Inside wall grid avg", color: colors.purple, dashed: false, points: pointsFor(rows, "inside_grid_mean_c", (c) => celsiusToDisplay(c, unit)) },
    { label: "Outside ambient", color: colors.red, dashed: true, points: pointsFor(rows, "outside_ambient_c", (c) => celsiusToDisplay(c, unit)) },
    { label: "Outside wall grid avg", color: colors.red, dashed: false, points: pointsFor(rows, "outside_grid_mean_c", (c) => celsiusToDisplay(c, unit)) },
  ];
  const deltaSeries: ChartSeries[] = [
    { label: "Ambient delta", color: colors.yellow, dashed: true, points: pointsFor(rows, "ambient_delta_c", (c) => celsiusDeltaToDisplay(c, unit)) },
    { label: "Wall grid avg delta", color: colors.green, dashed: false, points: pointsFor(rows, "grid_mean_delta_c", (c) => celsiusDeltaToDisplay(c, unit)) },
  ];

  const truncated = showTable && rows.length > tableMaxRows;
  const visibleRows = truncated ? rows.slice(0, tableMaxRows) : rows;
  const fmtAbs = (c: number | null) => (c === null ? "" : celsiusToDisplay(c, unit).toFixed(2));
  const fmtRowDelta = (c: number | null) => (c === null ? "" : celsiusDeltaToDisplay(c, unit).toFixed(2));

  return (
    <div className="ox-box-hardware-graph">
      {title && (
        <div className={textSize.sm} style={{ fontWeight: 600, marginBottom: 8 }}>
          {title}
        </div>
      )}
      <Cluster gap={5} align="baseline" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Cluster gap={5} align="baseline">
          <Stat label="Cycles" value={String(meta.cycleCount)} />
          <Stat label="Duration" value={fmtHours(meta.durationS)} />
          <Stat label="Peak ambient delta" value={fmtDelta(meta.peakAmbientDeltaC, unit)} />
          <Stat label="Peak wall grid delta" value={fmtDelta(meta.peakGridMeanDeltaC, unit)} />
        </Cluster>
        <UnitToggle unit={unit} onChange={setUnit} />
        {downloadUrl && (
          <Cluster gap={3}>
            <button
              type="button"
              className={button({ variant: "secondary", size: "compact" })}
              onClick={() => downloadFromUrl(downloadUrl(rawFileId), `${downloadName}.csv`)}
            >
              Download raw CSV
            </button>
            <button
              type="button"
              className={button({ variant: "secondary", size: "compact" })}
              disabled={!cleanedFileId}
              onClick={() => cleanedFileId && downloadFromUrl(downloadUrl(cleanedFileId), `${downloadName}.cleaned.csv`)}
            >
              Download cleaned CSV
            </button>
          </Cluster>
        )}
      </Cluster>

      <div className={sprinkles({ display: "flex", gap: 6, flexWrap: "wrap", mt: 5 })}>
        <MiniMultiLineChart title="Temperature vs. Time" yLabel={unitLabel} series={tempSeries} />
        <MiniMultiLineChart title={`Delta T vs. Time (outside \u2212 inside)`} yLabel={unitLabel} series={deltaSeries} zeroLine />
      </div>

      {showTable && (
        <div className={sprinkles({ mt: 5 })}>
          <div className="vault-csv-table-wrap">
            <table className="vault-csv-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Elapsed (s)</th>
                  <th>Inside ambient ({unitLabel})</th>
                  <th>Inside grid avg ({unitLabel})</th>
                  <th>Outside ambient ({unitLabel})</th>
                  <th>Outside grid avg ({unitLabel})</th>
                  <th>Ambient delta ({unitLabel})</th>
                  <th>Grid avg delta ({unitLabel})</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.timestamp}</td>
                    <td>{r.elapsed_s}</td>
                    <td>{fmtAbs(r.inside_ambient_c)}</td>
                    <td>{fmtAbs(r.inside_grid_mean_c)}</td>
                    <td>{fmtAbs(r.outside_ambient_c)}</td>
                    <td>{fmtAbs(r.outside_grid_mean_c)}</td>
                    <td>{fmtRowDelta(r.ambient_delta_c)}</td>
                    <td>{fmtRowDelta(r.grid_mean_delta_c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={textSize.xs} style={{ color: semanticColors.textSubtle, padding: "8px 2px" }}>
            {rows.length} cycle{rows.length === 1 ? "" : "s"} (cleaned)
            {truncated && `, showing the first ${tableMaxRows}. Download the cleaned CSV for the rest`}
          </div>
        </div>
      )}
    </div>
  );
}

type ChartPoint = { x: number; y: number };
type ChartSeries = { label: string; color: string; dashed: boolean; points: ChartPoint[] };

function pointsFor(
  rows: BoxHardwareCleanedRow[],
  key: keyof BoxHardwareCleanedRow,
  convert: (c: number) => number,
): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const r of rows) {
    const y = r[key];
    if (typeof y === "number") points.push({ x: r.elapsed_s, y: convert(y) });
  }
  return points;
}

type ChartBodyProps = {
  title: string;
  yLabel: string;
  series: ChartSeries[];
  zeroLine?: boolean;
  width: number;
  height: number;
  hoverPct: number | null;
  onHoverPct: (pct: number | null) => void;
};

/** A small, hand-rolled multi-series SVG line chart — no charting
 * dependency, same instinct as `LoadCellGraphCard.tsx`'s own
 * `MiniLineChart` (extended here to overlay several named series on one
 * axis, since a wall-temperature comparison is inherently "inside vs.
 * outside" rather than a single curve). Hover anywhere in the plot area
 * to see every series' nearest value at that elapsed time. An expand
 * button opens the exact same chart, bigger, in a `Modal` — sharing
 * `hoverPct` with the inline chart rather than tracking its own, so it
 * reads the same hovered values either way. */
function MiniMultiLineChart(props: Omit<ChartBodyProps, "width" | "height" | "hoverPct" | "onHoverPct">) {
  const { title } = props;
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  return (
    <div style={{ flex: "1 1 420px", minWidth: 300 }}>
      <Cluster gap={2} align="center" style={{ justifyContent: "space-between" }}>
        <div className={textSize.xs} style={{ fontWeight: 600, marginBottom: 4 }}>
          {title}
        </div>
        <CircleButton size={20} onClick={() => setEnlarged(true)} aria-label={`Enlarge ${title}`}>
          <ExpandIcon size={11} />
        </CircleButton>
      </Cluster>
      <ChartBody {...props} width={520} height={280} hoverPct={hoverPct} onHoverPct={setHoverPct} />
      {enlarged && (
        <Modal open onClose={() => setEnlarged(false)} title={title} maxWidth={960}>
          <ChartBody {...props} width={880} height={480} hoverPct={hoverPct} onHoverPct={setHoverPct} />
        </Modal>
      )}
    </div>
  );
}

function ChartBody({ title, yLabel, series, zeroLine = false, width: W, height: H, hoverPct, onHoverPct }: ChartBodyProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const PAD_L = 52;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 34;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const allPoints = series.flatMap((s) => s.points);
  const xMin = allPoints.length ? Math.min(...allPoints.map((p) => p.x)) : 0;
  const xMax = allPoints.length ? Math.max(...allPoints.map((p) => p.x)) : 1;
  const xSpan = xMax - xMin || 1;
  let yMin = allPoints.length ? Math.min(...allPoints.map((p) => p.y)) : 0;
  let yMax = allPoints.length ? Math.max(...allPoints.map((p) => p.y)) : 1;
  if (zeroLine) {
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
  }
  const yPad = (yMax - yMin) * 0.08 || 1;
  yMin -= yPad;
  yMax += yPad;
  const ySpan = yMax - yMin || 1;

  const xScale = (x: number) => PAD_L + ((x - xMin) / xSpan) * plotW;
  const yScale = (y: number) => PAD_T + plotH - ((y - yMin) / ySpan) * plotH;

  const pathFor = (points: ChartPoint[]) =>
    points.length ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ") : "";

  // Shared hover index into elapsed-time space: every series' own nearest
  // point to that x is drawn, so series with gaps (a side with no reading
  // that cycle) just skip their own marker rather than misaligning others.
  const xTicks = 5;
  const yTicks = 4;
  const hoverX = hoverPct !== null && allPoints.length ? xMin + (hoverPct / 100) * xSpan : null;

  const nearestIn = (points: ChartPoint[], x: number): ChartPoint | null => {
    if (points.length === 0) return null;
    let best = points[0];
    let bestD = Math.abs(points[0].x - x);
    for (const p of points) {
      const d = Math.abs(p.x - x);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  };

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={title}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = yMin + (i / yTicks) * ySpan;
          const y = yScale(v);
          return (
            <g key={`y${i}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={PAD_L - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="currentColor" opacity={0.6}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = xMin + (i / xTicks) * xSpan;
          const x = xScale(v);
          return (
            <text key={`x${i}`} x={x} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.6}>
              {fmtHours(v)}
            </text>
          );
        })}
        <text x={PAD_L + plotW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
          Elapsed
        </text>
        <text
          x={12}
          y={PAD_T + plotH / 2}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
          transform={`rotate(-90 12 ${PAD_T + plotH / 2})`}
        >
          {yLabel}
        </text>

        {zeroLine && <line x1={PAD_L} x2={W - PAD_R} y1={yScale(0)} y2={yScale(0)} stroke="currentColor" strokeOpacity={0.3} />}

        {series.map((s) => (
          <path key={s.label} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? "4 3" : undefined} />
        ))}

        {hoverX !== null && (
          <>
            <line x1={xScale(hoverX)} x2={xScale(hoverX)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" strokeOpacity={0.3} />
            {series.map((s) => {
              const p = nearestIn(s.points, hoverX);
              return p ? <circle key={s.label} cx={xScale(p.x)} cy={yScale(p.y)} r={3} fill={s.color} /> : null;
            })}
          </>
        )}

        <rect
          x={PAD_L}
          y={PAD_T}
          width={Math.max(plotW, 0)}
          height={Math.max(plotH, 0)}
          fill="transparent"
          onPointerMove={(e) => {
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const pct = Math.min(100, Math.max(0, ((px - PAD_L) / plotW) * 100));
            onHoverPct(pct);
          }}
          onPointerLeave={() => onHoverPct(null)}
        />
      </svg>
      <Cluster gap={4} style={{ flexWrap: "wrap" }}>
        {series.map((s) => (
          <span key={s.label} className={textSize.xs} style={{ color: semanticColors.textSubtle, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 10, height: 2, background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
            {s.label}
            {hoverX !== null && nearestIn(s.points, hoverX) ? `: ${nearestIn(s.points, hoverX)!.y.toFixed(1)}` : ""}
          </span>
        ))}
      </Cluster>
    </div>
  );
}
