import type { MTFParams } from "./MTFGeo";
import { PIECE_COLORS } from "./MTFColors";

// ── Layout constants ─────────────────────────────────────────────────────────

const PAD_LEFT = 60;
const PAD_RIGHT = 140;
const PAD_TOP = 30;
const PAD_BOTTOM = 55;

// ── Piece geometry constants (inches) ────────────────────────────────────────

const BLOCK_FACE = 5.5; // cross-section height of horizontal blocks (Y)
const POST_DEPTH = 6.0; // total post depth in Z

// ── Piece colours ────────────────────────────────────────────────────────────

const C = {
  stud: PIECE_COLORS["Stud"],
  sillTenon: PIECE_COLORS["Sill Tenon"],
  midTenon: PIECE_COLORS["Mid Tenon"],
  topTenon: PIECE_COLORS["Top Tenon"],
  lowerBridging: PIECE_COLORS["Lower Bridging"],
  upperBridging: PIECE_COLORS["Upper Bridging"],
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtIn(inches: number): string {
  if (inches % 12 === 0) return `${inches / 12}′ (${inches}″)`;
  return `${inches}″`;
}

interface LabelEntry {
  name: string;
  dotX: number; // SVG x of the anchor dot (piece right edge)
  dotY: number; // SVG y of the anchor dot (piece centre Y, never de-collided)
  color: string;
  hidden: boolean;
  svgY: number; // label text Y — de-collided
}

/** Push overlapping labels down so no pair is closer than MIN_GAP px. */
function decollide<T extends { svgY: number }>(items: T[]): T[] {
  const MIN_GAP = 13;
  const sorted = [...items].sort((a, b) => a.svgY - b.svgY);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].svgY - sorted[i - 1].svgY < MIN_GAP) {
      sorted[i] = { ...sorted[i], svgY: sorted[i - 1].svgY + MIN_GAP };
    }
  }
  return sorted;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MTFElevationDiagram({
  params,
  diagramHeight = 420,
}: {
  params: MTFParams;
  diagramHeight?: number;
}) {
  const {
    studLength,
    topTenonLength,
    topTenonOverlap,
    midTenonLength,
    midTenonBottomFromGround,
    sillTenonLength,
    lowerBridgingLength,
    upperBridgingLength,
  } = params;

  // ── Y positions (all in inches) ──────────────────────────────────────────

  const sillY0 = 0;
  const sillY1 = BLOCK_FACE; // 5.5
  const sillCY = 2.75;

  const midY0 = midTenonBottomFromGround;
  const midY1 = midY0 + 5.5; // BLOCK_FACE = 5.5"
  const midCY = (midY0 + midY1) / 2;

  const topY0 = studLength - topTenonOverlap;
  const topY1 = topY0 + topTenonLength;

  const lbCY = (sillCY + midCY) / 2;
  const lbY0 = lbCY - lowerBridgingLength / 2;
  const lbY1 = lbCY + lowerBridgingLength / 2;

  const ubCY = (midCY + topY0) / 2;
  const ubY0 = ubCY - upperBridgingLength / 2;
  const ubY1 = ubCY + upperBridgingLength / 2;

  const totalH = Math.max(studLength, topY1);
  const maxHalfX = Math.max(sillTenonLength, midTenonLength) / 2;
  const SCALE = diagramHeight / totalH;

  // ── SVG dimensions ───────────────────────────────────────────────────────

  const svgH = PAD_TOP + totalH * SCALE + PAD_BOTTOM;
  const frontW = Math.max(260, PAD_LEFT + maxHalfX * 2 * SCALE + PAD_RIGHT);
  const sideW = PAD_LEFT + POST_DEPTH * SCALE + PAD_RIGHT;

  // ── Coordinate transforms ────────────────────────────────────────────────

  // Front elevation (XY plane, looking in –Z)
  const cx = (postX: number) => PAD_LEFT + (postX + maxHalfX) * SCALE;
  const cy = (postY: number) => PAD_TOP + (totalH - postY) * SCALE;

  // Side elevation (ZY plane, looking in +X)
  const sz = (postZ: number) => PAD_LEFT + postZ * SCALE;
  const sy = (postY: number) => PAD_TOP + (totalH - postY) * SCALE;

  // SVG <rect> props from post-space coords
  const fRect = (x0: number, x1: number, y0: number, y1: number) => ({
    x: cx(x0),
    y: cy(y1),
    width: Math.max(0, (x1 - x0) * SCALE),
    height: Math.max(0, (y1 - y0) * SCALE),
  });

  const sRect = (z0: number, z1: number, y0: number, y1: number) => ({
    x: sz(z0),
    y: sy(y1),
    width: Math.max(0, (z1 - z0) * SCALE),
    height: Math.max(0, (y1 - y0) * SCALE),
  });

  // ── Front elevation labels ───────────────────────────────────────────────

  const frontLabelAnchorX = cx(maxHalfX) + 15;

  const rawFrontLabels: LabelEntry[] = [
    {
      name: "Top Tenon",
      dotX: cx(2.75),
      dotY: cy((topY0 + topY1) / 2),
      color: C.topTenon,
      hidden: false,
      svgY: cy((topY0 + topY1) / 2),
    },
    {
      name: "Upper Bridging",
      dotX: cx(2.75),
      dotY: cy((ubY0 + ubY1) / 2),
      color: C.upperBridging,
      hidden: true,
      svgY: cy((ubY0 + ubY1) / 2),
    },
    {
      name: "Stud ×2",
      dotX: cx(2.75),
      dotY: cy((ubY0 + ubY1) / 2 + 10),
      color: C.stud,
      hidden: false,
      svgY: cy((ubY0 + ubY1) / 2 + 10),
    },
    {
      name: "Mid Tenon",
      dotX: cx(midTenonLength / 2),
      dotY: cy(midCY),
      color: C.midTenon,
      hidden: false,
      svgY: cy(midCY),
    },
    {
      name: "Lower Bridging",
      dotX: cx(2.75),
      dotY: cy((lbY0 + lbY1) / 2),
      color: C.lowerBridging,
      hidden: true,
      svgY: cy((lbY0 + lbY1) / 2),
    },
    {
      name: "Sill Tenon",
      dotX: cx(sillTenonLength / 2),
      dotY: cy(sillCY),
      color: C.sillTenon,
      hidden: false,
      svgY: cy(sillCY),
    },
  ];
  const frontLabels = decollide(rawFrontLabels);

  // ── Side elevation labels ────────────────────────────────────────────────

  const sideLabelAnchorX = sz(POST_DEPTH) + 15;

  const rawSideLabels: LabelEntry[] = [
    {
      name: "Top Tenon",
      dotX: sz(POST_DEPTH),
      dotY: sy((topY0 + topY1) / 2),
      color: C.topTenon,
      hidden: false,
      svgY: sy((topY0 + topY1) / 2),
    },
    {
      name: "Upper Bridging",
      dotX: sz(POST_DEPTH),
      dotY: sy((ubY0 + ubY1) / 2),
      color: C.upperBridging,
      hidden: false,
      svgY: sy((ubY0 + ubY1) / 2),
    },
    {
      name: "Stud",
      dotX: sz(POST_DEPTH),
      dotY: sy((ubY0 + ubY1) / 2 + 10),
      color: C.stud,
      hidden: false,
      svgY: sy((ubY0 + ubY1) / 2 + 10),
    },
    {
      name: "Mid Tenon",
      dotX: sz(POST_DEPTH),
      dotY: sy(midCY),
      color: C.midTenon,
      hidden: false,
      svgY: sy(midCY),
    },
    {
      name: "Lower Bridging",
      dotX: sz(POST_DEPTH),
      dotY: sy((lbY0 + lbY1) / 2),
      color: C.lowerBridging,
      hidden: false,
      svgY: sy((lbY0 + lbY1) / 2),
    },
    {
      name: "Sill Tenon",
      dotX: sz(POST_DEPTH),
      dotY: sy(sillCY),
      color: C.sillTenon,
      hidden: false,
      svgY: sy(sillCY),
    },
  ];
  const sideLabels = decollide(rawSideLabels);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col sm:flex-row gap-8 print:flex-row print:gap-4 items-start overflow-x-auto">
      {/* ── Front Elevation ──────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-40 text-center mb-2">
          Front Elevation
        </p>
        <svg
          width={frontW}
          height={svgH}
          viewBox={`0 0 ${frontW} ${svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block" }}
        >
          {/* 1 ── White background */}
          <rect x={0} y={0} width={frontW} height={svgH} fill="white" />

          {/* 2 ── Hidden / behind-stud rects (dashed, low-opacity) */}

          {/* Lower Bridging behind stud */}
          <rect
            {...fRect(-2.75, 2.75, lbY0, lbY1)}
            fill={C.lowerBridging}
            opacity={0.18}
            stroke={C.lowerBridging}
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {/* Upper Bridging behind stud */}
          <rect
            {...fRect(-2.75, 2.75, ubY0, ubY1)}
            fill={C.upperBridging}
            opacity={0.18}
            stroke={C.upperBridging}
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {/* Sill tenon inner section */}
          <rect
            {...fRect(-2.75, 2.75, sillY0, sillY1)}
            fill={C.sillTenon}
            opacity={0.18}
            stroke={C.sillTenon}
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {/* Mid tenon inner section */}
          <rect
            {...fRect(-2.75, 2.75, midY0, midY1)}
            fill={C.midTenon}
            opacity={0.18}
            stroke={C.midTenon}
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {/* Top tenon overlap inside stud */}
          {topTenonOverlap > 0 && (
            <rect
              {...fRect(-2.75, 2.75, topY0, studLength)}
              fill={C.topTenon}
              opacity={0.18}
              stroke={C.topTenon}
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          )}

          {/* 3 ── Sill tenon wings (protruding past stud on both sides) */}
          {sillTenonLength / 2 > 2.75 && (
            <>
              <rect
                {...fRect(-sillTenonLength / 2, -2.75, sillY0, sillY1)}
                fill={C.sillTenon}
                opacity={0.85}
              />
              <rect
                {...fRect(2.75, sillTenonLength / 2, sillY0, sillY1)}
                fill={C.sillTenon}
                opacity={0.85}
              />
            </>
          )}

          {/* 4 ── Mid tenon wings */}
          {midTenonLength / 2 > 2.75 && (
            <>
              <rect
                {...fRect(-midTenonLength / 2, -2.75, midY0, midY1)}
                fill={C.midTenon}
                opacity={0.85}
              />
              <rect
                {...fRect(2.75, midTenonLength / 2, midY0, midY1)}
                fill={C.midTenon}
                opacity={0.85}
              />
            </>
          )}

          {/* 5 ── Stud (solid fill + outline on top) */}
          <rect
            {...fRect(-2.75, 2.75, 0, studLength)}
            fill={C.stud}
            opacity={0.85}
          />
          <rect
            {...fRect(-2.75, 2.75, 0, studLength)}
            fill="none"
            stroke="#333"
            strokeWidth={1}
          />

          {/* 6 ── Top tenon above stud */}
          {topY1 > studLength && (
            <rect
              {...fRect(-2.75, 2.75, studLength, topY1)}
              fill={C.topTenon}
              opacity={0.85}
            />
          )}

          {/* Ground line */}
          <line
            x1={Math.max(0, cx(-maxHalfX - 5))}
            y1={cy(0)}
            x2={Math.min(frontW, cx(maxHalfX + 5))}
            y2={cy(0)}
            stroke="#bbb"
            strokeWidth={1}
            strokeDasharray="6 4"
          />

          {/* Stud-height dimension line (left side, x = PAD_LEFT − 35) */}
          {(() => {
            const dimX = PAD_LEFT - 35;
            const topSvg = cy(studLength);
            const botSvg = cy(0);
            const midSvg = (topSvg + botSvg) / 2;
            return (
              <g>
                <line
                  x1={dimX}
                  y1={topSvg}
                  x2={dimX}
                  y2={botSvg}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 4}
                  y1={botSvg}
                  x2={dimX + 4}
                  y2={botSvg}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 4}
                  y1={topSvg}
                  x2={dimX + 4}
                  y2={topSvg}
                  stroke="#666"
                  strokeWidth={1}
                />
                <text
                  x={dimX - 7}
                  y={midSvg}
                  transform={`rotate(-90,${dimX - 7},${midSvg})`}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  {fmtIn(studLength)}
                </text>
              </g>
            );
          })()}

          {/* Sill-tenon width dimension (bottom horizontal) */}
          {(() => {
            const dimY = cy(sillY0) + 20;
            const x0 = cx(-sillTenonLength / 2);
            const x1 = cx(sillTenonLength / 2);
            return (
              <g>
                <line
                  x1={x0}
                  y1={dimY}
                  x2={x1}
                  y2={dimY}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={x0}
                  y1={dimY - 4}
                  x2={x0}
                  y2={dimY + 4}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={x1}
                  y1={dimY - 4}
                  x2={x1}
                  y2={dimY + 4}
                  stroke="#666"
                  strokeWidth={1}
                />
                <text
                  x={(x0 + x1) / 2}
                  y={dimY + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#666"
                >
                  {sillTenonLength}″
                </text>
              </g>
            );
          })()}

          {/* Leader lines + labels */}
          {frontLabels.map((label) => (
            <g key={label.name}>
              {/* Dot at piece */}
              <circle
                cx={label.dotX}
                cy={label.dotY}
                r={2}
                fill={label.color}
              />
              {/* Leader line (dot → label) */}
              <line
                x1={label.dotX}
                y1={label.dotY}
                x2={frontLabelAnchorX}
                y2={label.svgY}
                stroke={label.color}
                strokeWidth={0.75}
                opacity={0.7}
              />
              {/* Label text */}
              <text
                x={frontLabelAnchorX + 5}
                y={label.svgY + 4}
                fontSize={10}
                fill={label.color}
              >
                {label.name}
              </text>
              {label.hidden && (
                <text
                  x={frontLabelAnchorX + 5}
                  y={label.svgY + 15}
                  fontSize={8}
                  fill={label.color}
                  opacity={0.55}
                >
                  (hidden)
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* ── Side Elevation ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-40 text-center mb-2">
          Side Elevation
        </p>
        <svg
          width={sideW}
          height={svgH}
          viewBox={`0 0 ${sideW} ${svgH}`}
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block" }}
        >
          {/* Background */}
          <rect x={0} y={0} width={sideW} height={svgH} fill="white" />

          {/* Front stud: z = [0, 1.5] */}
          <rect
            {...sRect(0, 1.5, 0, studLength)}
            fill={C.stud}
            opacity={0.85}
          />
          {/* Back stud: z = [4.5, 6] */}
          <rect
            {...sRect(4.5, 6, 0, studLength)}
            fill={C.stud}
            opacity={0.85}
          />

          {/* Sill tenon: z = [1.5, 4.5] */}
          <rect
            {...sRect(1.5, 4.5, sillY0, sillY1)}
            fill={C.sillTenon}
            opacity={0.85}
          />
          {/* Lower bridging */}
          <rect
            {...sRect(1.5, 4.5, lbY0, lbY1)}
            fill={C.lowerBridging}
            opacity={0.85}
          />
          {/* Mid tenon */}
          <rect
            {...sRect(1.5, 4.5, midY0, midY1)}
            fill={C.midTenon}
            opacity={0.85}
          />
          {/* Upper bridging */}
          <rect
            {...sRect(1.5, 4.5, ubY0, ubY1)}
            fill={C.upperBridging}
            opacity={0.85}
          />
          {/* Top tenon */}
          <rect
            {...sRect(1.5, 4.5, topY0, topY1)}
            fill={C.topTenon}
            opacity={0.85}
          />

          {/* Ground line */}
          <line
            x1={sz(0)}
            y1={sy(0)}
            x2={sz(POST_DEPTH)}
            y2={sy(0)}
            stroke="#bbb"
            strokeWidth={1}
            strokeDasharray="6 4"
          />

          {/* Lower-bridging length dimension (left side, x = PAD_LEFT − 20) */}
          {(() => {
            const dimX = PAD_LEFT - 20;
            const topSvg = sy(lbY1);
            const botSvg = sy(lbY0);
            const midSvg = (topSvg + botSvg) / 2;
            return (
              <g>
                <line
                  x1={dimX}
                  y1={topSvg}
                  x2={dimX}
                  y2={botSvg}
                  stroke={C.lowerBridging}
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 3}
                  y1={topSvg}
                  x2={dimX + 3}
                  y2={topSvg}
                  stroke={C.lowerBridging}
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 3}
                  y1={botSvg}
                  x2={dimX + 3}
                  y2={botSvg}
                  stroke={C.lowerBridging}
                  strokeWidth={1}
                />
                <text
                  x={dimX - 6}
                  y={midSvg}
                  transform={`rotate(-90,${dimX - 6},${midSvg})`}
                  textAnchor="middle"
                  fontSize={9}
                  fill={C.lowerBridging}
                >
                  {fmtIn(lowerBridgingLength)}
                </text>
              </g>
            );
          })()}

          {/* Upper-bridging length dimension (left side, x = PAD_LEFT − 20) */}
          {(() => {
            const dimX = PAD_LEFT - 20;
            const topSvg = sy(ubY1);
            const botSvg = sy(ubY0);
            const midSvg = (topSvg + botSvg) / 2;
            return (
              <g>
                <line
                  x1={dimX}
                  y1={topSvg}
                  x2={dimX}
                  y2={botSvg}
                  stroke={C.upperBridging}
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 3}
                  y1={topSvg}
                  x2={dimX + 3}
                  y2={topSvg}
                  stroke={C.upperBridging}
                  strokeWidth={1}
                />
                <line
                  x1={dimX - 3}
                  y1={botSvg}
                  x2={dimX + 3}
                  y2={botSvg}
                  stroke={C.upperBridging}
                  strokeWidth={1}
                />
                <text
                  x={dimX - 6}
                  y={midSvg}
                  transform={`rotate(-90,${dimX - 6},${midSvg})`}
                  textAnchor="middle"
                  fontSize={9}
                  fill={C.upperBridging}
                >
                  {fmtIn(upperBridgingLength)}
                </text>
              </g>
            );
          })()}

          {/* Top-tenon overlap dimension (left side, x = PAD_LEFT − 38) */}
          {topTenonOverlap > 0 &&
            (() => {
              const dimX = PAD_LEFT - 20;
              const topSvg = sy(studLength);
              const botSvg = sy(studLength - topTenonOverlap);
              const midSvg = (topSvg + botSvg) / 2;
              return (
                <g>
                  <line
                    x1={dimX}
                    y1={topSvg}
                    x2={dimX}
                    y2={botSvg}
                    stroke={C.topTenon}
                    strokeWidth={1}
                  />
                  <line
                    x1={dimX - 3}
                    y1={topSvg}
                    x2={dimX + 3}
                    y2={topSvg}
                    stroke={C.topTenon}
                    strokeWidth={1}
                  />
                  <line
                    x1={dimX - 3}
                    y1={botSvg}
                    x2={dimX + 3}
                    y2={botSvg}
                    stroke={C.topTenon}
                    strokeWidth={1}
                  />
                  <text
                    x={dimX - 6}
                    y={midSvg}
                    transform={`rotate(-90,${dimX - 6},${midSvg})`}
                    textAnchor="middle"
                    fontSize={9}
                    fill={C.topTenon}
                  >
                    {fmtIn(topTenonOverlap)} overlap
                  </text>
                </g>
              );
            })()}

          {/* Post-depth dimension (bottom) */}
          {(() => {
            const dimY = sy(0) + 22;
            const x0 = sz(0);
            const x1 = sz(6);
            return (
              <g>
                <line
                  x1={x0}
                  y1={dimY}
                  x2={x1}
                  y2={dimY}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={x0}
                  y1={dimY - 4}
                  x2={x0}
                  y2={dimY + 4}
                  stroke="#666"
                  strokeWidth={1}
                />
                <line
                  x1={x1}
                  y1={dimY - 4}
                  x2={x1}
                  y2={dimY + 4}
                  stroke="#666"
                  strokeWidth={1}
                />
                <text
                  x={(x0 + x1) / 2}
                  y={dimY + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#666"
                >
                  6″ deep
                </text>
              </g>
            );
          })()}

          {/* Leader lines + labels */}
          {sideLabels.map((label) => (
            <g key={label.name}>
              <circle
                cx={label.dotX}
                cy={label.dotY}
                r={2}
                fill={label.color}
              />
              <line
                x1={label.dotX}
                y1={label.dotY}
                x2={sideLabelAnchorX}
                y2={label.svgY}
                stroke={label.color}
                strokeWidth={0.75}
                opacity={0.7}
              />
              <text
                x={sideLabelAnchorX + 5}
                y={label.svgY + 4}
                fontSize={10}
                fill={label.color}
              >
                {label.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
