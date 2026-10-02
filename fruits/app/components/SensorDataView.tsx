// The project page's "Sensor Data" tab (`newspaper.$folderId.tsx`) — load-
// cell test results only, see `loadCellSensorData.server.ts` for why this
// is deliberately narrow rather than a generic "any sync-api analysis"
// view. A list of runs; picking one shows an interactive chart (hover for
// exact values) with the same cleaned rows in a table below, plus raw/
// cleaned CSV downloads.
import { Link, useSearchParams } from "react-router";
import { useMemo, useRef, useState } from "react";
import type {
  LoadCellCleanedMeta,
  LoadCellCleanedRow,
  SensorDataRunSummary,
  SensorDataTab,
} from "robustness-core/data/loadCellSensorData.server";
import { Chip } from "stamps/Chip";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors, colors } from "stamps/tokens";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import "../styles/vault.css";

const RUN_PARAM = "run";
const TABLE_MAX_ROWS = 500;

async function downloadVaultFile(fileId: string, filename: string) {
  const res = await fetch(`/api/vault/download/${fileId}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    window.alert(data?.error ?? `Download failed (${res.status})`);
    return;
  }
  const a = document.createElement("a");
  a.download = filename;
  let objectUrl: string | null = null;
  if (data.url) {
    a.href = data.url;
  } else if (data.content !== undefined) {
    const blob = new Blob([data.content], { type: data.contentType || "text/csv" });
    objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
  } else {
    return;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

export function SensorDataView({ data }: { projectFolderId: string; data: SensorDataTab }) {
  const [params] = useSearchParams();

  const hrefFor = (runName: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "sensorData");
    next.set(RUN_PARAM, runName);
    return `?${next.toString()}`;
  };

  if (data.runs.length === 0) {
    return (
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        No load-cell test runs yet.
      </p>
    );
  }

  const selectedRun = data.selected ? data.runs.find((r) => r.name === data.selected!.name) : undefined;

  return (
    <Stack gap={6}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 2 })}>
        {data.runs.map((run) => (
          <Link key={run.name} to={hrefFor(run.name)} preventScrollReset style={{ textDecoration: "none" }}>
            <Chip active={data.selected?.name === run.name}>{run.title}</Chip>
          </Link>
        ))}
      </div>

      {data.selected && selectedRun ? (
        <SensorDataRunView run={selectedRun} selected={data.selected} />
      ) : (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Pick a run above.
        </p>
      )}
    </Stack>
  );
}

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

function SensorDataRunView({
  run,
  selected,
}: {
  run: SensorDataRunSummary;
  selected: { name: string; rows: LoadCellCleanedRow[]; meta: LoadCellCleanedMeta };
}) {
  const { rows, meta } = selected;
  const timeSeries = useMemo(() => rows.map((r) => ({ x: r.elapsed_s, y: r.force_lbs })), [rows]);
  const displacementSeries = useMemo(
    () => rows.filter((r) => r.is_checkpoint).map((r) => ({ x: r.displacement_in, y: r.force_lbs })),
    [rows],
  );

  const truncated = rows.length > TABLE_MAX_ROWS;
  const visibleRows = truncated ? rows.slice(0, TABLE_MAX_ROWS) : rows;

  return (
    <Stack gap={5}>
      <Cluster gap={5} align="baseline" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Cluster gap={5} align="baseline">
          <Stat label="Peak force" value={`${meta.peakForceLbs.toFixed(1)} lbs`} />
          <Stat label="At displacement" value={`${meta.peakDisplacementIn.toFixed(3)} in`} />
          <Stat label="Max displacement" value={`${meta.maxDisplacementIn.toFixed(3)} in`} />
          <Stat label="Duration" value={`${meta.durationS.toFixed(1)} s`} />
        </Cluster>
        <Cluster gap={3}>
          <button
            type="button"
            className={button({ variant: "secondary", size: "compact" })}
            onClick={() => downloadVaultFile(run.rawFileId, `${run.name}.csv`)}
          >
            Download raw CSV
          </button>
          <button
            type="button"
            className={button({ variant: "secondary", size: "compact" })}
            disabled={!run.cleanedFileId}
            onClick={() => run.cleanedFileId && downloadVaultFile(run.cleanedFileId, `${run.name}.cleaned.csv`)}
          >
            Download cleaned CSV
          </button>
        </Cluster>
      </Cluster>

      <div className={sprinkles({ display: "flex", gap: 6, flexWrap: "wrap" })}>
        <MiniLineChart title="Force vs. Time" xLabel="Elapsed (s)" yLabel="Force (lbs)" points={timeSeries} color={colors.purple} />
        <MiniLineChart
          title="Force vs. Displacement"
          xLabel="Displacement (in)"
          yLabel="Force (lbs)"
          points={displacementSeries}
          color={colors.red}
          markers
        />
      </div>

      <div>
        <div className="vault-csv-table-wrap">
          <table className="vault-csv-table">
            <thead>
              <tr>
                <th>Elapsed (s)</th>
                <th>Checkpoint</th>
                <th>Force (lbs)</th>
                <th>Raw (mV/V)</th>
                <th>Displacement (in)</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.elapsed_s}</td>
                  <td>{r.is_checkpoint ? "✓" : ""}</td>
                  <td>{r.force_lbs}</td>
                  <td>{r.raw_mv_v}</td>
                  <td>{r.displacement_in}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={textSize.xs} style={{ color: semanticColors.textSubtle, padding: "8px 2px" }}>
          {rows.length} row{rows.length === 1 ? "" : "s"} (cleaned)
          {truncated && `, showing the first ${TABLE_MAX_ROWS}. Download the cleaned CSV for the rest`}
        </div>
      </div>
    </Stack>
  );
}

type ChartPoint = { x: number; y: number };

/** A small, hand-rolled SVG line chart — no charting dependency (same
 * instinct as `SlopeGauge`'s own hand-rolled SVG dial). Hover anywhere in
 * the plot area to see the nearest point's exact values. */
function MiniLineChart({
  title,
  xLabel,
  yLabel,
  points,
  color,
  markers = false,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
  color: string;
  markers?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 520;
  const H = 280;
  const PAD_L = 52;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 34;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xMin = points.length ? Math.min(...points.map((p) => p.x)) : 0;
  const xMax = points.length ? Math.max(...points.map((p) => p.x)) : 1;
  const yMax = points.length ? Math.max(...points.map((p) => p.y)) * 1.08 || 1 : 1;
  const xSpan = xMax - xMin || 1;

  const xScale = (x: number) => PAD_L + ((x - xMin) / xSpan) * plotW;
  const yScale = (y: number) => PAD_T + plotH - (y / yMax) * plotH;

  const path = points.length
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ")
    : "";

  const yTicks = 4;
  const xTicks = 5;
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div style={{ flex: "1 1 420px", minWidth: 300 }}>
      <div className={textSize.xs} style={{ fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (i / yTicks) * yMax;
          const y = yScale(v);
          return (
            <g key={`y${i}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={PAD_L - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="currentColor" opacity={0.6}>
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = xMin + (i / xTicks) * xSpan;
          const x = xScale(v);
          return (
            <text key={`x${i}`} x={x} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.6}>
              {v.toFixed(xSpan > 10 ? 0 : 2)}
            </text>
          );
        })}
        <text x={PAD_L + plotW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
          {xLabel}
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

        <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
        {markers &&
          points.map((p, i) => <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={3} fill={color} />)}

        {hovered && (
          <>
            <line
              x1={xScale(hovered.x)}
              x2={xScale(hovered.x)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
            <circle cx={xScale(hovered.x)} cy={yScale(hovered.y)} r={4} fill={color} />
          </>
        )}

        <rect
          x={PAD_L}
          y={PAD_T}
          width={Math.max(plotW, 0)}
          height={Math.max(plotH, 0)}
          fill="transparent"
          onPointerMove={(e) => {
            if (!svgRef.current || points.length === 0) return;
            const rect = svgRef.current.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const dataX = xMin + ((px - PAD_L) / plotW) * xSpan;
            let nearest = 0;
            let best = Infinity;
            for (let i = 0; i < points.length; i++) {
              const d = Math.abs(points[i].x - dataX);
              if (d < best) {
                best = d;
                nearest = i;
              }
            }
            setHoverIdx(nearest);
          }}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>
      <div className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
        {hovered
          ? `${xLabel.replace(/\s*\(.*\)/, "")} ${hovered.x.toFixed(3)} · ${yLabel.replace(/\s*\(.*\)/, "")} ${hovered.y.toFixed(1)}`
          : "Hover the chart for exact values."}
      </div>
    </div>
  );
}
