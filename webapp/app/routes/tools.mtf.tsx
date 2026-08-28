import { useState, useMemo } from "react";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Breadcrumb } from "../components/Breadcrumb";
import { VisualPreviewer } from "../features/ViewFinder/VisualPreviewer";
import {
  buildMTFPostGeometry,
  DEFAULT_MTF_PARAMS,
} from "../features/ViewFinder/MTFGeo";
import type { MTFParams } from "../features/ViewFinder/MTFGeo";
import { MTFElevationDiagram } from "../features/ViewFinder/MTFElevationDiagram";
import { PIECE_COLORS } from "../features/ViewFinder/MTFColors";
import { MTFPrintLayout } from "../features/ViewFinder/MTFPrintLayout";
import CutStockOptimizer from "../calculators/CutStockOptimizer";
import { NumberInput } from "../components/NumberInput";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "MTF | Nopal Tools" },
  {
    name: "description",
    content: "Tool helping understand MTF",
  },
];

// ── Constants ────────────────────────────────────────────────────────────────

const NEW_STOCK = [
  { size: 8, unit: "ft" as const },
  { size: 10, unit: "ft" as const },
  { size: 12, unit: "ft" as const },
  { size: 16, unit: "ft" as const },
];

const KERF = { size: 0.125, unit: "in" as const }; // 1/8" blade kerf

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format an inch value as "X″" or "X′ (Y″)" when evenly divisible by 12. */
function fmtIn(inches: number): string {
  if (inches % 12 === 0) return `${inches / 12}′ (${inches}″)`;
  return `${inches}″`;
}

/** Group an array of Measurements by their "sizeunit" key and count occurrences. */
function countByKey(
  items: { size: number; unit: string }[],
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, m) => {
    const key = `${m.size}${m.unit}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

/** Convert any Measurement to inches. */
function toInches(m: { size: number; unit: string }): number {
  const factors: Record<string, number> = {
    in: 1,
    ft: 12,
    mm: 1 / 25.4,
    cm: 1 / 2.54,
    m: 39.3701,
  };
  return m.size * (factors[m.unit] ?? 1);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MTFCalc() {
  // ── Dimension state (all in inches) ──────────────────────────────────────
  const [studLength, setStudLength] = useState(DEFAULT_MTF_PARAMS.studLength);
  const [sillTenonLength, setSillTenonLength] = useState(
    DEFAULT_MTF_PARAMS.sillTenonLength,
  );
  const [midTenonLength, setMidTenonLength] = useState(
    DEFAULT_MTF_PARAMS.midTenonLength,
  );
  const [midTenonBottomFromGround, setMidTenonBottomFromGround] = useState(
    DEFAULT_MTF_PARAMS.midTenonBottomFromGround,
  );
  const [topTenonLength, setTopTenonLength] = useState(
    DEFAULT_MTF_PARAMS.topTenonLength,
  );
  const [topTenonOverlap, setTopTenonOverlap] = useState(
    DEFAULT_MTF_PARAMS.topTenonOverlap,
  );
  const [lowerBridgingLength, setLowerBridgingLength] = useState(
    DEFAULT_MTF_PARAMS.lowerBridgingLength,
  );
  const [upperBridgingLength, setUpperBridgingLength] = useState(
    DEFAULT_MTF_PARAMS.upperBridgingLength,
  );

  // ── Takeoff state ─────────────────────────────────────────────────────────
  const [postCount, setPostCount] = useState(1);

  // ── Available stock state ─────────────────────────────────────────────────
  type StockUnit = "in" | "ft" | "mm" | "cm" | "m";
  const [availableStock, setAvailableStock] =
    useState<{ size: number; unit: StockUnit }[]>(NEW_STOCK);
  const [addSize, setAddSize] = useState(14);
  const [addUnit, setAddUnit] = useState<StockUnit>("ft");

  // ── Geometry (rebuilds only when dimensions change) ───────────────────────
  const params: MTFParams = useMemo(
    () => ({
      studLength,
      sillTenonLength,
      midTenonLength,
      midTenonBottomFromGround,
      topTenonLength,
      topTenonOverlap,
      lowerBridgingLength,
      upperBridgingLength,
    }),
    [
      studLength,
      sillTenonLength,
      midTenonLength,
      midTenonBottomFromGround,
      topTenonLength,
      topTenonOverlap,
      lowerBridgingLength,
      upperBridgingLength,
    ],
  );

  const geo = useMemo(() => buildMTFPostGeometry(params), [params]);

  // ── Cuts per post ─────────────────────────────────────────────────────────
  //
  // isPaired = false → cut from individual boards (studs)
  // isPaired = true  → boards are glued face-to-face BEFORE cutting, so each
  //                    physical saw-pass through the 2-ply blank yields both
  //                    pieces simultaneously.  The optimizer therefore works
  //                    on 1 cut per piece per post (count 2 comes for free),
  //                    and each "board" in the result represents 2 physicals.
  const cutPieces = useMemo(
    () => [
      { label: "Stud", length: studLength, count: 2, isPaired: false },
      {
        label: "Sill Tenon",
        length: sillTenonLength,
        count: 2,
        isPaired: true,
      },
      { label: "Mid Tenon", length: midTenonLength, count: 2, isPaired: true },
      { label: "Top Tenon", length: topTenonLength, count: 2, isPaired: true },
      {
        label: "Lower Bridging",
        length: lowerBridgingLength,
        count: 2,
        isPaired: true,
      },
      {
        label: "Upper Bridging",
        length: upperBridgingLength,
        count: 2,
        isPaired: true,
      },
    ],
    [
      studLength,
      sillTenonLength,
      midTenonLength,
      topTenonLength,
      lowerBridgingLength,
      upperBridgingLength,
    ],
  );

  // ── Stud optimizer — individual boards ───────────────────────────────────
  const studOptimizer = useMemo(() => {
    const cuts = cutPieces
      .filter((p) => !p.isPaired)
      .flatMap(({ label, length, count }) =>
        Array.from({ length: count * postCount }, () => ({
          size: length,
          unit: "in" as const,
          label,
        })),
      );

    const result = CutStockOptimizer({
      cuts,
      kerf: KERF,
      newStock: availableStock,
      onHandStock: [],
    });

    const stockCounts = countByKey(result.usedStock);
    const nonZeroOffCuts = result.offCuts.filter((o) => toInches(o) > 0);
    const totalOffCutIn = nonZeroOffCuts.reduce(
      (sum, m) => sum + toInches(m),
      0,
    );

    return { ...result, stockCounts, nonZeroOffCuts, totalOffCutIn };
  }, [cutPieces, postCount, availableStock]);

  // ── Paired optimizer — tenons + bridging from glued board pairs ───────────
  //
  // We feed 1 cut per piece per post (not 2) because both boards in the glued
  // pair are sawn at the same time, so one optimizer "slot" already accounts
  // for both physical boards.  Each board that comes out of this optimizer
  // represents TWO physical 2×6s that will be glued and cut together.
  const pairedOptimizer = useMemo(() => {
    const cuts = cutPieces
      .filter((p) => p.isPaired)
      .flatMap(({ label, length }) =>
        Array.from({ length: postCount }, () => ({
          size: length,
          unit: "in" as const,
          label,
        })),
      );

    const result = CutStockOptimizer({
      cuts,
      kerf: KERF,
      newStock: availableStock,
      onHandStock: [],
    });

    const stockCounts = countByKey(result.usedStock);
    const nonZeroOffCuts = result.offCuts.filter((o) => toInches(o) > 0);
    const totalOffCutIn = nonZeroOffCuts.reduce(
      (sum, m) => sum + toInches(m),
      0,
    );

    return { ...result, stockCounts, nonZeroOffCuts, totalOffCutIn };
  }, [cutPieces, postCount, availableStock]);

  // ── Combined stock counts ─────────────────────────────────────────────────
  // Paired boards × 2 because each optimizer "board" = 2 physical boards.
  const combinedStockCounts = useMemo(() => {
    const counts: Record<string, number> = { ...studOptimizer.stockCounts };
    for (const [key, cnt] of Object.entries(pairedOptimizer.stockCounts)) {
      counts[key] = (counts[key] ?? 0) + cnt * 2;
    }
    return counts;
  }, [studOptimizer.stockCounts, pairedOptimizer.stockCounts]);

  const totalPhysicalBoards =
    studOptimizer.boards.length + pairedOptimizer.boards.length * 2;

  const totalOffCutIn =
    studOptimizer.totalOffCutIn + pairedOptimizer.totalOffCutIn * 2;

  // ── Board-layout visualization ────────────────────────────────────────────
  /**
   * Renders one physical board (or one board of a pair) as a proportional
   * horizontal bar.  Each cut gets a colour-coded segment; the off-cut tail
   * is shown in grey.  Pass isPair=true to show the "×2 boards" badge.
   */
  /** Groups consecutive boards with identical layout into {board, start, count} tuples. */
  function groupBoards<
    T extends {
      stock: { size: number; unit: string };
      cuts: { size: number; unit: string; label?: string }[];
      offCutMM: number;
    },
  >(boards: T[]): { board: T; start: number; count: number }[] {
    const groups: { board: T; start: number; count: number }[] = [];
    for (let i = 0; i < boards.length; i++) {
      const board = boards[i];
      const key = JSON.stringify({
        stock: board.stock,
        cuts: board.cuts,
        offCutMM: board.offCutMM,
      });
      if (groups.length > 0) {
        const last = groups[groups.length - 1];
        const lastKey = JSON.stringify({
          stock: last.board.stock,
          cuts: last.board.cuts,
          offCutMM: last.board.offCutMM,
        });
        if (key === lastKey) {
          last.count++;
          continue;
        }
      }
      groups.push({ board, start: i, count: 1 });
    }
    return groups;
  }

  function BoardBar({
    board,
    startIndex,
    count,
    isPair = false,
  }: {
    board: {
      stock: { size: number; unit: string };
      cuts: { size: number; unit: string; label?: string }[];
      offCutMM: number;
    };
    startIndex: number;
    count: number;
    isPair?: boolean;
  }) {
    const stockIn = toInches(board.stock as { size: number; unit: string });
    const offCutIn = board.offCutMM / 25.4;
    const usedIn = stockIn - offCutIn;
    const wastePercent = ((offCutIn / stockIn) * 100).toFixed(1);
    const rangeLabel = `${count}x`;

    return (
      <div className="flex items-center gap-3">
        {/* Board label */}
        <div className="shrink-0 text-right" style={{ width: "2.5rem" }}>
          <span className="text-xs font-mono opacity-40">{rangeLabel}</span>
        </div>
        <div className="shrink-0" style={{ width: "2.5rem" }}>
          <span className="text-xs opacity-50">
            {board.stock.size}
            {board.stock.unit}
          </span>
        </div>

        {/* Bar */}
        <div className="flex-1 flex rounded overflow-hidden h-7 text-xs font-medium">
          {board.cuts.map((cut, ci) => {
            const cutIn = toInches(cut as { size: number; unit: string });
            const pct = (cutIn / stockIn) * 100;
            const color = PIECE_COLORS[cut.label ?? ""] ?? "#94a3b8";
            const showLabel = pct > 8;
            return (
              <div
                key={ci}
                style={{ width: `${pct}%`, backgroundColor: color }}
                className="flex items-center justify-center text-white overflow-hidden whitespace-nowrap border-r border-black/20 last:border-r-0"
                title={`${cut.label ?? "Cut"}: ${cutIn}″`}
              >
                {showLabel && (
                  <span
                    className="px-1 truncate leading-none"
                    style={{ fontSize: "0.65rem", color: "white" }}
                  >
                    {cut.label}
                  </span>
                )}
              </div>
            );
          })}
          {offCutIn > 0 && (
            <div
              style={{ width: `${(offCutIn / stockIn) * 100}%` }}
              className="flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 overflow-hidden whitespace-nowrap"
              title={`Off-cut: ${offCutIn.toFixed(2)}″`}
            >
              {(offCutIn / stockIn) * 100 > 5 && (
                <span className="px-1 truncate" style={{ fontSize: "0.65rem" }}>
                  {offCutIn.toFixed(1)}″
                </span>
              )}
            </div>
          )}
        </div>

        {/* Pair badge or waste % */}
        <div
          className="shrink-0 flex items-center justify-end gap-2"
          style={{ width: "5rem" }}
        >
          {isPair && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium leading-none">
              ×2
            </span>
          )}
          <span
            className={`text-xs tabular-nums ${
              parseFloat(wastePercent) > 20
                ? "text-orange-500 dark:text-orange-400"
                : "opacity-40"
            }`}
          >
            {wastePercent}%
          </span>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      {/* ── Print page CSS ──────────────────────────────────────────────── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page { size: 11in 17in; margin: 0; }
          .page-wrapper > .header { display: none !important; }
          footer { display: none !important; }
        }
      `,
        }}
      />

      {/* ── Screen content (hidden when printing) ────────────────────── */}
      <div className="scene1 print:hidden">
        <div className="simple-container p-4">
          <Breadcrumb>
            <Link to="/tools">All Tools</Link>
          </Breadcrumb>

          <div className="flex items-center justify-between mt-8 mb-2">
            <h1 className="text-4xl font-bold">MTF</h1>
            <button
              onClick={() => window.print()}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium flex items-center gap-1.5"
            >
              <span>🖨</span> Print
            </button>
          </div>

          {/* ── Dimension Controls ──────────────────────────────────────────── */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Post Dimensions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-5">
              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Stud Length (in)
                </label>
                <NumberInput
                  value={studLength}
                  onChange={setStudLength}
                  min={24}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Sill Tenon (in)
                </label>
                <NumberInput
                  value={sillTenonLength}
                  onChange={setSillTenonLength}
                  min={1}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Mid Tenon (in)
                </label>
                <NumberInput
                  value={midTenonLength}
                  onChange={setMidTenonLength}
                  min={1}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Mid Tenon from Ground (in)
                </label>
                <NumberInput
                  value={midTenonBottomFromGround}
                  onChange={setMidTenonBottomFromGround}
                  min={0}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Top Tenon (in)
                </label>
                <NumberInput
                  value={topTenonLength}
                  onChange={setTopTenonLength}
                  min={1}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Top Tenon Overlap (in)
                </label>
                <NumberInput
                  value={topTenonOverlap}
                  onChange={setTopTenonOverlap}
                  min={0}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Lower Bridging (in)
                </label>
                <NumberInput
                  value={lowerBridgingLength}
                  onChange={setLowerBridgingLength}
                  min={1}
                  step={0.5}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 opacity-70">
                  Upper Bridging (in)
                </label>
                <NumberInput
                  value={upperBridgingLength}
                  onChange={setUpperBridgingLength}
                  min={1}
                  step={0.5}
                />
              </div>
            </div>
          </section>

          {/* ── 3-D Preview ─────────────────────────────────────────────────── */}
          <VisualPreviewer geometry={geo} />

          {/* ── Post Spec Summary ───────────────────────────────────────────── */}
          <div className="mt-10 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Stud"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle cx="7" cy="7" r="2.5" fill={PIECE_COLORS["Stud"]} />
                </svg>
                Studs
              </p>
              <p className="opacity-70">
                2× 2×6 @ {fmtIn(studLength)} — 1.5″ × 5.5″ actual
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke="#9ca3af"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle cx="7" cy="7" r="2.5" fill="#9ca3af" />
                </svg>
                Tenon / Bridging block
              </p>
              <p className="opacity-70">
                2× 2×6 laminated — 3″ × 5.5″ cross-section
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Top Tenon"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2.5"
                    fill={PIECE_COLORS["Top Tenon"]}
                  />
                </svg>
                Top Tenon
              </p>
              <p className="opacity-70">
                {topTenonLength}″ vertical · inserts {topTenonOverlap}″ below
                stud top
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Upper Bridging"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2.5"
                    fill={PIECE_COLORS["Upper Bridging"]}
                  />
                </svg>
                Upper Bridging
              </p>
              <p className="opacity-70">
                {upperBridgingLength}″ vertical · centred between mid &amp; top
                tenons
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Mid Tenon"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2.5"
                    fill={PIECE_COLORS["Mid Tenon"]}
                  />
                </svg>
                Mid Tenon
              </p>
              <p className="opacity-70">
                {midTenonLength}″ horizontal · bottom at{" "}
                {fmtIn(midTenonBottomFromGround)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Lower Bridging"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2.5"
                    fill={PIECE_COLORS["Lower Bridging"]}
                  />
                </svg>
                Lower Bridging
              </p>
              <p className="opacity-70">
                {lowerBridgingLength}″ vertical · centred between sill &amp; mid
                tenons
              </p>
            </div>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 sm:col-span-2">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M 2 11 C 4 8 10 6 12 3"
                    stroke={PIECE_COLORS["Sill Tenon"]}
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2.5"
                    fill={PIECE_COLORS["Sill Tenon"]}
                  />
                </svg>
                Sill Tenon
              </p>
              <p className="opacity-70">
                {sillTenonLength}″ horizontal · at base (0″)
              </p>
            </div>
          </div>

          <MTFElevationDiagram params={params} />

          {/* ── Takeoffs ────────────────────────────────────────────────────── */}
          <section className="mt-10 mb-12">
            <h2 className="text-lg font-semibold mb-4">Takeoffs</h2>

            {/* Post count */}
            <div className="flex items-center gap-4 mb-8">
              <label className="text-sm font-medium opacity-70 whitespace-nowrap">
                Number of Posts
              </label>
              <NumberInput
                value={postCount}
                onChange={setPostCount}
                min={1}
                step={1}
                className="w-44"
              />
            </div>

            {/* Cuts per post table */}
            <h3 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-3">
              Cuts per Post
            </h3>

            {/* Pairing callout */}
            <div className="mb-4 flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
              <span className="mt-0.5 shrink-0">💡</span>
              <span>
                <strong>Board pairing:</strong> Tenons and bridging are cut from
                boards that have been glued face-to-face first. One saw-pass
                through the 2-ply blank yields both pieces at once, so the cut
                layout below optimises <em>pairs</em> of boards — each row
                marked <span className="font-semibold">×2</span> represents two
                physical boards glued together.
              </span>
            </div>

            <div className="overflow-x-auto mb-8">
              <table className="text-sm w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left pb-2 font-medium opacity-60 pr-6">
                      Piece
                    </th>
                    <th className="text-right pb-2 font-medium opacity-60 pr-6">
                      Length
                    </th>
                    <th className="text-right pb-2 font-medium opacity-60 pr-6">
                      Qty / post
                    </th>
                    <th className="text-right pb-2 font-medium opacity-60 pr-6">
                      Total ({postCount} {postCount === 1 ? "post" : "posts"})
                    </th>
                    <th className="text-right pb-2 font-medium opacity-60">
                      Method
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cutPieces.map(({ label, length, count, isPaired }) => (
                    <tr
                      key={label}
                      className="border-b border-gray-100 dark:border-gray-800/60"
                    >
                      <td className="py-2 pr-6">{label}</td>
                      <td className="py-2 pr-6 text-right tabular-nums">
                        {length}″
                      </td>
                      <td className="py-2 pr-6 text-right tabular-nums">
                        {count}
                      </td>
                      <td className="py-2 pr-6 text-right tabular-nums font-medium">
                        {count * postCount}
                      </td>
                      <td className="py-2 text-right">
                        {isPaired ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                            glued pair
                          </span>
                        ) : (
                          <span className="text-xs opacity-35">individual</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="pt-3 pr-6">Total pieces</td>
                    <td />
                    <td className="pt-3 pr-6 text-right tabular-nums">
                      {cutPieces.reduce((s, p) => s + p.count, 0)}
                    </td>
                    <td className="pt-3 pr-6 text-right tabular-nums">
                      {cutPieces.reduce((s, p) => s + p.count, 0) * postCount}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Board Layout ────────────────────────────────────────────── */}
            <h3 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-4">
              Board Layout
            </h3>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 mb-5">
              {Object.entries(PIECE_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs opacity-60">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm shrink-0 bg-gray-300 dark:bg-gray-600" />
                <span className="text-xs opacity-60">Off-cut</span>
              </div>
            </div>

            {/* ── Stud boards (individual) */}
            <p className="text-xs font-semibold opacity-40 mb-2 mt-1 uppercase tracking-widest">
              Stud boards — individual
            </p>
            {studOptimizer.boards.length > 0 ? (
              <div className="space-y-1.5 mb-6">
                {groupBoards(studOptimizer.boards).map((g) => (
                  <BoardBar
                    key={g.start}
                    board={g.board}
                    startIndex={g.start}
                    count={g.count}
                    isPair={false}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm opacity-40 mb-6">No stud boards.</p>
            )}

            {/* ── Tenon + bridging board pairs */}
            <p className="text-xs font-semibold opacity-40 mb-1 mt-4 uppercase tracking-widest">
              Tenon &amp; bridging — glued board pairs
            </p>
            <p className="text-xs opacity-40 mb-3">
              Each row represents two boards glued face-to-face. One layout
              serves both boards in the pair.
            </p>
            {pairedOptimizer.boards.length > 0 ? (
              <div className="space-y-1.5 mb-8">
                {groupBoards(pairedOptimizer.boards).map((g) => (
                  <BoardBar
                    key={g.start}
                    board={g.board}
                    startIndex={g.start}
                    count={g.count}
                    isPair={true}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm opacity-40 mb-8">No paired boards.</p>
            )}

            {/* ── Stock Required (editable) ────────────────────────────────── */}
            <h3 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-3">
              Stock Required — 2×6 (⅛″ kerf)
            </h3>
            <div className="flex flex-wrap gap-3 mb-3">
              {availableStock.map((s, i) => {
                const key = `${s.size}${s.unit}`;
                const count = combinedStockCounts[key] ?? 0;
                return (
                  <div
                    key={`${key}-${i}`}
                    className={`relative p-4 rounded-lg text-center min-w-[5.5rem] transition-opacity ${
                      count > 0
                        ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 opacity-40"
                    }`}
                  >
                    <button
                      onClick={() =>
                        setAvailableStock((prev) =>
                          prev.filter((_, j) => j !== i),
                        )
                      }
                      disabled={availableStock.length === 1}
                      className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full text-xs opacity-30 hover:opacity-80 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:cursor-not-allowed transition-opacity leading-none"
                      aria-label={`Remove ${s.size}${s.unit}`}
                    >
                      ×
                    </button>
                    <p className="text-3xl font-bold tabular-nums">{count}</p>
                    <p className="text-sm mt-0.5 opacity-70">
                      {s.size}
                      {s.unit}&nbsp;2×6
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <NumberInput
                value={addSize}
                onChange={setAddSize}
                min={1}
                step={1}
                className="w-40"
              />
              <select
                value={addUnit}
                onChange={(e) => setAddUnit(e.target.value as StockUnit)}
                className="text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5"
                style={{ color: "var(--purple)" }}
              >
                <option value="ft">ft</option>
                <option value="in">in</option>
              </select>
              <button
                onClick={() => {
                  const key = `${addSize}${addUnit}`;
                  if (
                    !availableStock.some((s) => `${s.size}${s.unit}` === key)
                  ) {
                    setAvailableStock((prev) =>
                      [...prev, { size: addSize, unit: addUnit }].sort(
                        (a, b) => toInches(a) - toInches(b),
                      ),
                    );
                  }
                }}
                className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                + Add
              </button>
            </div>

            <div className="text-sm opacity-60 space-y-1">
              <p>
                {totalPhysicalBoards} board
                {totalPhysicalBoards !== 1 ? "s" : ""} total (
                {studOptimizer.boards.length} stud
                {studOptimizer.boards.length !== 1 ? "s" : ""} +{" "}
                {pairedOptimizer.boards.length * 2} paired) · ~
                {totalOffCutIn.toFixed(1)}″ combined off-cuts
              </p>

              {/* Off-cut details */}
              {(studOptimizer.nonZeroOffCuts.length > 0 ||
                pairedOptimizer.nonZeroOffCuts.length > 0) && (
                <details className="mt-1 group">
                  <summary className="cursor-pointer select-none w-fit hover:opacity-80 transition-opacity list-none flex items-center gap-1.5">
                    <span className="text-xs transition-transform group-open:rotate-90 inline-block">
                      ▶
                    </span>
                    <span>
                      {studOptimizer.nonZeroOffCuts.length +
                        pairedOptimizer.nonZeroOffCuts.length}{" "}
                      off-cut
                      {studOptimizer.nonZeroOffCuts.length +
                        pairedOptimizer.nonZeroOffCuts.length !==
                      1
                        ? "s"
                        : ""}
                    </span>
                  </summary>
                  <ul className="mt-2 ml-4 space-y-0.5 tabular-nums font-mono text-xs">
                    {[
                      ...studOptimizer.nonZeroOffCuts.map((o) => ({
                        m: o,
                        tag: "",
                      })),
                      ...pairedOptimizer.nonZeroOffCuts.map((o) => ({
                        m: o,
                        tag: "×2",
                      })),
                    ]
                      .sort((a, b) => toInches(b.m) - toInches(a.m))
                      .map(({ m, tag }, i) => {
                        const inches = toInches(m);
                        const feet = Math.floor(inches / 12);
                        const remainIn = inches - feet * 12;
                        const label =
                          feet > 0
                            ? `${feet}′ ${remainIn > 0 ? remainIn.toFixed(2) + "″" : ""}`.trim()
                            : `${inches.toFixed(2)}″`;
                        return (
                          <li key={i} className="flex items-center gap-2">
                            <span className="opacity-40 w-5 text-right">
                              {i + 1}.
                            </span>
                            <span>{label}</span>
                            {tag && (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                {tag}
                              </span>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </details>
              )}

              {(studOptimizer.missingStock.length > 0 ||
                pairedOptimizer.missingStock.length > 0) && (
                <p className="text-red-500 dark:text-red-400 font-medium">
                  ⚠{" "}
                  {studOptimizer.missingStock.length +
                    pairedOptimizer.missingStock.length}{" "}
                  cut
                  {studOptimizer.missingStock.length +
                    pairedOptimizer.missingStock.length !==
                  1
                    ? "s"
                    : ""}{" "}
                  could not be fulfilled — check that no single piece exceeds
                  16′ (192″).
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="print:hidden">
        <Footer />
      </div>

      {/* ── Print layout (11×17 blueprint, shown only when printing) ──── */}
      <MTFPrintLayout
        params={params}
        postCount={postCount}
        cutPieces={cutPieces}
        studBoards={studOptimizer.boards}
        pairedBoards={pairedOptimizer.boards}
        combinedStockCounts={combinedStockCounts}
        availableStock={availableStock}
        totalPhysicalBoards={totalPhysicalBoards}
        totalOffCutIn={totalOffCutIn}
      />
    </Layout>
  );
}
