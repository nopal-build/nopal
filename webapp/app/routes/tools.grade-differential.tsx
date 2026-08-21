import { useState, useCallback, useMemo, useRef } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Breadcrumb } from "../components/Breadcrumb";
import { NumberInput } from "../components/NumberInput";
import { surfaceBase } from "stamps/surface.css";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

// ── Types ────────────────────────────────────────────────────────────────────

interface Layer {
  id: string;
  name: string;
  color: string;
  points: Record<string, number>; // "col,row" → elevation in feet
}

interface VolumeResult {
  cutCF: number;
  fillCF: number;
  netCF: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LAYER_COLORS = [
  "#3f2b46", // purple
  "#5da06d", // green
  "#a63b31", // red
  "#7f5b8b", // purple-light
  "#2563eb", // blue
  "#d97706", // amber
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

const ptKey = (col: number, row: number) => `${col},${row}`;

/**
 * Inverse-distance weighting interpolation (power = 2).
 * Returns null when no control points exist.
 */
function idw(
  points: Record<string, number>,
  col: number,
  row: number
): number | null {
  const explicit = points[ptKey(col, row)];
  if (explicit !== undefined) return explicit;

  const entries = Object.entries(points);
  if (entries.length === 0) return null;

  let wSum = 0;
  let wTot = 0;
  for (const [key, elev] of entries) {
    const [pc, pr] = key.split(",").map(Number);
    const d2 = (col - pc) ** 2 + (row - pr) ** 2;
    if (d2 === 0) return elev;
    const w = 1 / d2;
    wSum += elev * w;
    wTot += w;
  }
  return wTot > 0 ? wSum / wTot : null;
}

/** Map a normalised value [0,1] through a blue → cyan → green → yellow → red ramp. */
function elevColor(t: number): string {
  // clamp
  const s = Math.max(0, Math.min(1, t));
  // hue: 240 (blue) → 0 (red)
  const hue = Math.round(240 - s * 240);
  const sat = 80;
  const light = 40 + s * 10;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function fmtElev(v: number) {
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

// ── Component ─────────────────────────────────────────────────────────────────

export const meta: MetaFunction = () => [
  { title: "Grade Differential | Nopal Tools" },
  {
    name: "description",
    content:
      "Set elevations across a grid, build grade layers, and calculate cut/fill volumes between surfaces.",
  },
];

export default function GradeDifferential() {
  // Grid settings — persisted across page loads
  const [gridCols, setGridCols] = useLocalStorage("gd:gridCols", 10);
  const [gridRows, setGridRows] = useLocalStorage("gd:gridRows", 10);
  const [cellSize, setCellSize] = useLocalStorage("gd:cellSize", 4); // feet

  // Layers — persisted across page loads
  const [layers, setLayers] = useLocalStorage<Layer[]>("gd:layers", [
    { id: "1", name: "Existing Grade", color: LAYER_COLORS[0], points: {} },
  ]);
  const [activeLayerId, setActiveLayerId] = useLocalStorage(
    "gd:activeLayerId",
    "1"
  );

  // Selected point state — ephemeral, not persisted
  const [selPt, setSelPt] = useState<{ col: number; row: number } | null>(null);
  const [elevInput, setElevInput] = useState("");
  const elevInputRef = useRef<HTMLInputElement>(null);

  // Volume calc — layer selections persisted, result is ephemeral
  const [vol1Id, setVol1Id] = useLocalStorage("gd:vol1Id", "");
  const [vol2Id, setVol2Id] = useLocalStorage("gd:vol2Id", "");
  const [volResult, setVolResult] = useState<VolumeResult | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];

  const elevRange = useMemo(() => {
    const all = Object.values(activeLayer.points);
    if (all.length === 0) return { min: 0, max: 1 };
    const mn = Math.min(...all);
    const mx = Math.max(...all);
    return mn === mx ? { min: mn - 1, max: mx + 1 } : { min: mn, max: mx };
  }, [activeLayer.points]);

  const hasPoints = Object.keys(activeLayer.points).length > 0;

  const totalArea = gridCols * cellSize * gridRows * cellSize; // sq ft

  // ── Layer actions ──────────────────────────────────────────────────────────

  const renameLayer = useCallback((id: string, name: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }, []);

  const addLayer = useCallback(() => {
    setLayers((prev) => {
      const id = String(Date.now());
      const color = LAYER_COLORS[prev.length % LAYER_COLORS.length];
      const next: Layer = {
        id,
        name: `Layer ${prev.length + 1}`,
        color,
        points: {},
      };
      setActiveLayerId(id);
      return [...prev, next];
    });
  }, []);

  const deleteLayer = useCallback(
    (id: string) => {
      if (layers.length === 1) return;
      setLayers((prev) => {
        const next = prev.filter((l) => l.id !== id);
        if (activeLayerId === id) setActiveLayerId(next[0].id);
        return next;
      });
    },
    [layers.length, activeLayerId]
  );

  const duplicateLayer = useCallback((id: string) => {
    setLayers((prev) => {
      const src = prev.find((l) => l.id === id);
      if (!src) return prev;
      const newId = String(Date.now());
      const color = LAYER_COLORS[prev.length % LAYER_COLORS.length];
      const copy: Layer = {
        id: newId,
        name: `${src.name} (copy)`,
        color,
        points: { ...src.points },
      };
      setActiveLayerId(newId);
      return [...prev, copy];
    });
  }, []);

  // ── Point actions ──────────────────────────────────────────────────────────

  const setPointElev = useCallback(
    (layerId: string, col: number, row: number, elev: number | null) => {
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id !== layerId) return l;
          const next = { ...l.points };
          if (elev === null) delete next[ptKey(col, row)];
          else next[ptKey(col, row)] = elev;
          return { ...l, points: next };
        })
      );
      setVolResult(null); // invalidate cached result
    },
    []
  );

  const clearLayer = useCallback((layerId: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === layerId ? { ...l, points: {} } : l))
    );
    setVolResult(null);
  }, []);

  // ── Grid interaction ───────────────────────────────────────────────────────

  const handlePointClick = useCallback(
    (col: number, row: number) => {
      if (selPt?.col === col && selPt?.row === row) {
        setSelPt(null);
        return;
      }
      setSelPt({ col, row });
      const existing = activeLayer.points[ptKey(col, row)];
      setElevInput(existing !== undefined ? fmtElev(existing) : "");
      requestAnimationFrame(() => {
        elevInputRef.current?.focus();
        elevInputRef.current?.select();
      });
    },
    [selPt, activeLayer.points]
  );

  const commitElev = useCallback(
    (andClose = false) => {
      if (!selPt) return;
      const val = parseFloat(elevInput);
      if (!isNaN(val)) {
        setPointElev(activeLayerId, selPt.col, selPt.row, val);
      }
      if (andClose) setSelPt(null);
    },
    [selPt, elevInput, activeLayerId, setPointElev]
  );

  // ── Volume calculation ─────────────────────────────────────────────────────

  const calculateVolume = useCallback(() => {
    const l1 = layers.find((l) => l.id === vol1Id);
    const l2 = layers.find((l) => l.id === vol2Id);
    if (!l1 || !l2 || vol1Id === vol2Id) return;

    const cellArea = cellSize * cellSize;
    let cutCF = 0;
    let fillCF = 0;

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const corners: [number, number][] = [
          [c, r],
          [c + 1, r],
          [c, r + 1],
          [c + 1, r + 1],
        ];
        let sumDiff = 0;
        for (const [cc, rr] of corners) {
          const e1 = idw(l1.points, cc, rr) ?? 0;
          const e2 = idw(l2.points, cc, rr) ?? 0;
          sumDiff += e1 - e2;
        }
        const avgDiff = sumDiff / 4;
        const vol = Math.abs(avgDiff) * cellArea;
        if (avgDiff > 0) cutCF += vol;
        else if (avgDiff < 0) fillCF += vol;
      }
    }

    setVolResult({ cutCF, fillCF, netCF: cutCF - fillCF });
  }, [layers, vol1Id, vol2Id, gridCols, gridRows, cellSize]);

  // ── SVG layout ─────────────────────────────────────────────────────────────

  const PT_SPACING = 52;
  const PADDING = 44;
  const svgW = gridCols * PT_SPACING + PADDING * 2;
  const svgH = gridRows * PT_SPACING + PADDING * 2;
  const px = (col: number) => col * PT_SPACING + PADDING;
  const py = (row: number) => row * PT_SPACING + PADDING;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* Hero */}
      <div className="scene1">
        <div className="simple-container p-4">
          <Breadcrumb>
            <Link to="/tools">All Tools</Link>
          </Breadcrumb>
          <h1 className="text-4xl font-bold mt-8">
            Grade Differential{" "}
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                background: "var(--green)",
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 9999,
                verticalAlign: "middle",
              }}
            >
              In Development
            </span>
          </h1>
          <p className="mt-4 mb-8 text-lg">
            Set elevations at grid points, build multiple grade layers, and
            calculate cut&nbsp;&amp;&nbsp;fill volumes between any two surfaces.
          </p>
        </div>

        {/* Tool body — wider than simple-container */}
        <div className="container mx-auto px-4 pb-16">
          <div className="flex gap-6 items-start flex-wrap xl:flex-nowrap">
            {/* ── Left sidebar ─────────────────────────────────────────────── */}
            <div className="w-full xl:w-64 flex-shrink-0 space-y-4">
              {/* Grid settings */}
              <section className={`${surfaceBase} p-4`}>
                <h3 className="font-semibold text-base mb-3">Grid Settings</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm mb-1 opacity-70">
                      Cell Size (ft)
                    </label>
                    <NumberInput
                      value={cellSize}
                      onChange={(v) => {
                        setCellSize(v);
                        setVolResult(null);
                      }}
                      min={1}
                      max={200}
                      step={1}
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 opacity-70">
                      Columns
                    </label>
                    <NumberInput
                      value={gridCols}
                      onChange={(v) => {
                        setGridCols(v);
                        setVolResult(null);
                      }}
                      min={2}
                      max={40}
                      step={1}
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 opacity-70">
                      Rows
                    </label>
                    <NumberInput
                      value={gridRows}
                      onChange={(v) => {
                        setGridRows(v);
                        setVolResult(null);
                      }}
                      min={2}
                      max={40}
                      step={1}
                    />
                  </div>
                  <div className="text-xs opacity-50 leading-relaxed pt-1 border-t border-gray-100 dark:border-[var(--dark-midground)]">
                    {(gridCols * cellSize).toLocaleString()}′ ×{" "}
                    {(gridRows * cellSize).toLocaleString()}′
                    <br />
                    {(totalArea / 43560).toFixed(3)} ac /{" "}
                    {totalArea.toLocaleString()} ft²
                  </div>
                </div>
              </section>

              {/* Layers */}
              <section className={`${surfaceBase} p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-base">Layers</h3>
                  <button
                    onClick={addLayer}
                    className="text-xs px-2.5 py-1 rounded border border-[var(--purple-light)] dark:border-[var(--moon)] text-[var(--purple-light)] dark:text-[var(--moon)] hover:bg-[var(--purple-light)] hover:text-white transition-colors"
                  >
                    + Add
                  </button>
                </div>

                <div className="space-y-1">
                  {layers.map((layer) => {
                    const isActive = layer.id === activeLayerId;
                    const ptCount = Object.keys(layer.points).length;
                    return (
                      <div
                        key={layer.id}
                        onClick={() => setActiveLayerId(layer.id)}
                        className={`group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors ${
                          isActive
                            ? "bg-[var(--farground)] dark:bg-[var(--dark-farground)]"
                            : "hover:bg-gray-50 dark:hover:bg-[var(--dark-farground)]"
                        }`}
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-[var(--purple)]"
                          style={{ backgroundColor: layer.color }}
                        />
                        <input
                          className="flex-1 min-w-0 bg-transparent text-sm font-medium focus:outline-none cursor-pointer focus:cursor-text"
                          value={layer.name}
                          onChange={(e) =>
                            renameLayer(layer.id, e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-xs opacity-40 flex-shrink-0">
                          {ptCount}
                        </span>

                        {/* Layer actions (visible on hover) */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Duplicate layer"
                            className="text-xs opacity-60 hover:opacity-100 px-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateLayer(layer.id);
                            }}
                          >
                            ⎘
                          </button>
                          {layers.length > 1 && (
                            <button
                              title="Delete layer"
                              className="text-xs opacity-60 hover:opacity-100 hover:text-red-500 px-0.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteLayer(layer.id);
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Clear active layer */}
                {hasPoints && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Clear all points from "${activeLayer.name}"?`
                        )
                      )
                        clearLayer(activeLayerId);
                    }}
                    className="mt-3 text-xs opacity-50 hover:opacity-100 hover:text-red-500 transition-opacity"
                  >
                    Clear active layer…
                  </button>
                )}
              </section>

              {/* Volume calculator */}
              {layers.length >= 2 && (
                <section className={`${surfaceBase} p-4`}>
                  <h3 className="font-semibold text-base mb-1">
                    Volume Differential
                  </h3>
                  <p className="text-xs opacity-50 mb-3 leading-snug">
                    Select two layers to compute cut &amp; fill between their
                    surfaces.
                  </p>

                  <div className="space-y-2 mb-3">
                    <div>
                      <label className="block text-xs opacity-60 mb-1">
                        Layer 1 (from)
                      </label>
                      <select
                        className="w-full text-sm px-2 py-1.5 border border-gray-300 dark:border-[var(--dark-midground)] rounded bg-white dark:bg-[var(--purple)] focus:outline-none focus:ring-2 focus:ring-[var(--green)]"
                        value={vol1Id}
                        onChange={(e) => {
                          setVol1Id(e.target.value);
                          setVolResult(null);
                        }}
                      >
                        <option value="">Select…</option>
                        {layers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs opacity-60 mb-1">
                        Layer 2 (to)
                      </label>
                      <select
                        className="w-full text-sm px-2 py-1.5 border border-gray-300 dark:border-[var(--dark-midground)] rounded bg-white dark:bg-[var(--purple)] focus:outline-none focus:ring-2 focus:ring-[var(--green)]"
                        value={vol2Id}
                        onChange={(e) => {
                          setVol2Id(e.target.value);
                          setVolResult(null);
                        }}
                      >
                        <option value="">Select…</option>
                        {layers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={calculateVolume}
                    disabled={!vol1Id || !vol2Id || vol1Id === vol2Id}
                    className="btn-secondary "
                  >
                    Calculate
                  </button>

                  {volResult && (
                    <div className="mt-4 space-y-2 text-sm">
                      <Row
                        label="Cut"
                        cf={volResult.cutCF}
                        className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
                      />
                      <Row
                        label="Fill"
                        cf={volResult.fillCF}
                        className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                      />
                      <div className={`flex justify-between items-center px-2 py-2 ${surfaceBase}`}>
                        <span className="font-semibold">Net</span>
                        <span
                          className={
                            volResult.netCF > 0
                              ? "text-red-600 dark:text-red-400"
                              : volResult.netCF < 0
                              ? "text-blue-600 dark:text-blue-400"
                              : "opacity-60"
                          }
                        >
                          {Math.abs(volResult.netCF / 27).toFixed(1)} cy{" "}
                          {volResult.netCF > 0
                            ? "cut"
                            : volResult.netCF < 0
                            ? "fill"
                            : "balanced"}
                        </span>
                      </div>
                      <p className="text-xs opacity-40 text-center">
                        1 cy = 27 cf
                      </p>
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* ── Main grid area ────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-3 min-h-[42px]">
                {/* Active layer badge */}
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: activeLayer.color }}
                  />
                  <span>{activeLayer.name}</span>
                  <span className="opacity-40 font-normal">
                    — click a point to set its elevation
                  </span>
                </div>

                {/* Point editor (appears when a point is selected) */}
                {selPt && (
                  <div className="flex items-center gap-2 ml-auto px-3 py-1.5 border border-gray-300 dark:border-[var(--dark-midground)] rounded-lg bg-white dark:bg-[var(--dark-farground)] shadow-sm">
                    <span className="text-xs opacity-50 font-mono">
                      ({selPt.col}, {selPt.row})
                    </span>
                    <input
                      ref={elevInputRef}
                      type="number"
                      step="0.1"
                      className="w-20 text-sm bg-transparent focus:outline-none text-center border-b border-gray-300 dark:border-[var(--dark-midground)] py-0.5"
                      placeholder="elev."
                      value={elevInput}
                      onChange={(e) => setElevInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitElev(true);
                        if (e.key === "Escape") setSelPt(null);
                      }}
                    />
                    <span className="text-xs opacity-50">ft</span>
                    <button
                      onClick={() => commitElev(true)}
                      className="text-xs px-2 py-0.5 rounded bg-[var(--green)] text-white hover:opacity-90"
                    >
                      Set
                    </button>
                    <button
                      onClick={() => {
                        setPointElev(activeLayerId, selPt.col, selPt.row, null);
                        setElevInput("");
                        setSelPt(null);
                      }}
                      className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-[var(--dark-midground)] hover:bg-gray-50 dark:hover:bg-[var(--dark-midground)]"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setSelPt(null)}
                      className="text-xs opacity-40 hover:opacity-80 ml-1"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Grid SVG */}
              <div className={`overflow-auto ${surfaceBase}`}>
                <svg
                  width={svgW}
                  height={svgH}
                  style={{ display: "block", minWidth: svgW }}
                >
                  {/* ── Background cell fills (elevation heat map) ── */}
                  {hasPoints &&
                    Array.from({ length: gridRows }, (_, r) =>
                      Array.from({ length: gridCols }, (_, c) => {
                        // Use the average of the four corner elevations for the cell color
                        const corners: [number, number][] = [
                          [c, r],
                          [c + 1, r],
                          [c, r + 1],
                          [c + 1, r + 1],
                        ];
                        const elevs = corners.map(
                          ([cc, rr]) => idw(activeLayer.points, cc, rr) ?? null
                        );
                        const valid = elevs.filter(
                          (e) => e !== null
                        ) as number[];
                        if (valid.length === 0) return null;
                        const avg =
                          valid.reduce((a, b) => a + b, 0) / valid.length;
                        const t =
                          elevRange.max > elevRange.min
                            ? (avg - elevRange.min) /
                              (elevRange.max - elevRange.min)
                            : 0.5;
                        return (
                          <rect
                            key={`cell-${c}-${r}`}
                            x={px(c)}
                            y={py(r)}
                            width={PT_SPACING}
                            height={PT_SPACING}
                            fill={elevColor(t)}
                            opacity={0.15}
                          />
                        );
                      })
                    )}

                  {/* ── Grid lines ── */}
                  {Array.from({ length: gridCols + 1 }, (_, c) => (
                    <line
                      key={`vc${c}`}
                      x1={px(c)}
                      y1={py(0)}
                      x2={px(c)}
                      y2={py(gridRows)}
                      stroke="#d1d5db"
                      strokeWidth={1}
                    />
                  ))}
                  {Array.from({ length: gridRows + 1 }, (_, r) => (
                    <line
                      key={`hr${r}`}
                      x1={px(0)}
                      y1={py(r)}
                      x2={px(gridCols)}
                      y2={py(r)}
                      stroke="#d1d5db"
                      strokeWidth={1}
                    />
                  ))}

                  {/* ── Axis labels ── */}
                  {Array.from({ length: gridCols + 1 }, (_, c) => (
                    <text
                      key={`lc${c}`}
                      x={px(c)}
                      y={py(gridRows) + 18}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#9ca3af"
                    >
                      {c * cellSize}′
                    </text>
                  ))}
                  {Array.from({ length: gridRows + 1 }, (_, r) => (
                    <text
                      key={`lr${r}`}
                      x={px(0) - 8}
                      y={py(r) + 3.5}
                      textAnchor="end"
                      fontSize={9}
                      fill="#9ca3af"
                    >
                      {r * cellSize}′
                    </text>
                  ))}

                  {/* ── Points ── */}
                  {Array.from({ length: gridRows + 1 }, (_, r) =>
                    Array.from({ length: gridCols + 1 }, (_, c) => {
                      const explicit = activeLayer.points[ptKey(c, r)];
                      const isSet = explicit !== undefined;
                      const interpElev = isSet
                        ? explicit
                        : hasPoints
                        ? idw(activeLayer.points, c, r)
                        : null;
                      const isSelected = selPt?.col === c && selPt?.row === r;

                      const t =
                        interpElev !== null
                          ? elevRange.max > elevRange.min
                            ? (interpElev - elevRange.min) /
                              (elevRange.max - elevRange.min)
                            : 0.5
                          : null;

                      const dotColor = t !== null ? elevColor(t) : "#e5e7eb";
                      const dotR = isSet ? 7 : isSelected ? 5 : 4;

                      return (
                        <g
                          key={`pt${c}-${r}`}
                          onClick={() => handlePointClick(c, r)}
                          style={{ cursor: "pointer" }}
                        >
                          {/* Large transparent hit area */}
                          <circle
                            cx={px(c)}
                            cy={py(r)}
                            r={18}
                            fill="transparent"
                          />

                          {/* Selection ring */}
                          {isSelected && (
                            <circle
                              cx={px(c)}
                              cy={py(r)}
                              r={dotR + 5}
                              fill="none"
                              stroke={activeLayer.color}
                              strokeWidth={2}
                              opacity={0.8}
                            />
                          )}

                          {/* Main dot */}
                          <circle
                            cx={px(c)}
                            cy={py(r)}
                            r={dotR}
                            fill={dotColor}
                            stroke="white"
                            strokeWidth={isSet ? 1.5 : 1}
                          />

                          {/* Elevation label — only for explicitly set points */}
                          {isSet && (
                            <text
                              x={px(c)}
                              y={py(r) - dotR - 4}
                              textAnchor="middle"
                              fontSize={10}
                              fontWeight="700"
                              fill={dotColor}
                              stroke="white"
                              strokeWidth={3}
                              paintOrder="stroke"
                            >
                              {fmtElev(explicit)}′
                            </text>
                          )}
                        </g>
                      );
                    })
                  )}
                </svg>
              </div>

              {/* ── Legend + color scale ── */}
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs opacity-60">
                <div className="flex items-center gap-1.5">
                  <svg width="14" height="14" style={{ display: "block" }}>
                    <circle
                      cx="7"
                      cy="7"
                      r="5"
                      fill="#5da06d"
                      stroke="white"
                      strokeWidth="1.5"
                    />
                  </svg>
                  <span>Explicit elevation (larger dot)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg width="14" height="14" style={{ display: "block" }}>
                    <circle
                      cx="7"
                      cy="7"
                      r="3"
                      fill="#e5e7eb"
                      stroke="white"
                      strokeWidth="1"
                    />
                  </svg>
                  <span>No data set</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Gradient swatch */}
                  <svg width="60" height="10" style={{ display: "block" }}>
                    <defs>
                      <linearGradient
                        id="elev-grad"
                        x1="0"
                        x2="1"
                        y1="0"
                        y2="0"
                      >
                        <stop offset="0%" stopColor="hsl(240,80%,45%)" />
                        <stop offset="50%" stopColor="hsl(120,80%,40%)" />
                        <stop offset="100%" stopColor="hsl(0,80%,45%)" />
                      </linearGradient>
                    </defs>
                    <rect
                      x="0"
                      y="1"
                      width="60"
                      height="8"
                      rx="4"
                      fill="url(#elev-grad)"
                    />
                  </svg>
                  <span>Low → High elevation</span>
                </div>
              </div>

              {/* ── Dimension note ── */}
              <p className="mt-2 text-xs opacity-40">
                Grid: {gridCols} × {gridRows} cells at {cellSize}′ each —{" "}
                {(gridCols + 1) * (gridRows + 1)} intersection points
              </p>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}

// ── Row helper for volume results ─────────────────────────────────────────────

function Row({
  label,
  cf,
  className,
}: {
  label: string;
  cf: number;
  className: string;
}) {
  const cy = cf / 27;
  return (
    <div
      className={`flex justify-between items-center px-2 py-2 rounded ${className}`}
    >
      <span className="font-semibold">{label}</span>
      <span className="text-right tabular-nums">
        {cy.toFixed(1)} cy
        <span className="opacity-60 ml-1.5 text-xs">({cf.toFixed(0)} cf)</span>
      </span>
    </div>
  );
}
