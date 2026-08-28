import { PIECE_COLORS } from "./MTFColors";
import { MTFElevationDiagram } from "./MTFElevationDiagram";
import type { MTFParams } from "./MTFGeo";

// ── Types ─────────────────────────────────────────────────────────────────────

type Measurement = { size: number; unit: string };

type Board = {
  stock: Measurement;
  cuts: (Measurement & { label?: string })[];
  offCutMM: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInches(m: Measurement): number {
  const f: Record<string, number> = {
    in: 1,
    ft: 12,
    mm: 1 / 25.4,
    cm: 1 / 2.54,
    m: 39.3701,
  };
  return m.size * (f[m.unit] ?? 1);
}

function fmtIn(inches: number): string {
  if (inches % 12 === 0) return `${inches / 12}′ (${inches}″)`;
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  if (ft > 0 && rem > 0) return `${ft}′ ${rem}″`;
  if (ft > 0) return `${ft}′`;
  return `${inches}″`;
}

// ── Board Layout SVG ──────────────────────────────────────────────────────────

function BoardLayoutSVG({
  boards,
  isPaired,
}: {
  boards: Board[];
  isPaired: boolean;
}) {
  if (boards.length === 0) {
    return <p style={{ fontSize: 9, opacity: 0.5, margin: 0 }}>No boards.</p>;
  }

  const BAR_H = 18;
  const GAP = 5;
  const LPAD = 60; // left label area
  const RPAD = 44; // right (waste % + ×2 badge)
  const BAR_W = 440; // inner bar width
  const SVG_W = LPAD + BAR_W + RPAD;
  const SVG_H = boards.length * (BAR_H + GAP) + GAP;

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      style={{ display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {boards.map((board, i) => {
        const stockIn = toInches(board.stock);
        const offCutIn = board.offCutMM / 25.4;
        const y = GAP + i * (BAR_H + GAP);

        // Pre-compute cut segments
        let xCursor = LPAD;
        const segs = board.cuts.map((cut) => {
          const cutIn = toInches(cut as Measurement);
          const w = Math.max(0, (cutIn / stockIn) * BAR_W);
          const x = xCursor;
          xCursor += w;
          return { cut, w, x, cutIn, pct: (cutIn / stockIn) * 100 };
        });

        const offW = Math.max(0, (offCutIn / stockIn) * BAR_W);
        const wasteStr = ((offCutIn / stockIn) * 100).toFixed(1) + "%";

        return (
          <g key={i}>
            {/* Left label: index + stock size */}
            <text
              x={LPAD - 4}
              y={y + BAR_H * 0.72}
              textAnchor="end"
              fontSize={8}
              fill="#444"
              fontFamily="monospace"
            >
              #{i + 1} {board.stock.size}
              {board.stock.unit}
            </text>

            {/* Cut segments */}
            {segs.map(({ cut, w, x, pct }, ci) => (
              <g key={ci}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={BAR_H}
                  fill={PIECE_COLORS[cut.label ?? ""] ?? "#94a3b8"}
                />
                {/* Separator */}
                {ci > 0 && (
                  <line
                    x1={x}
                    y1={y}
                    x2={x}
                    y2={y + BAR_H}
                    stroke="rgba(0,0,0,0.25)"
                    strokeWidth={0.75}
                  />
                )}
                {/* Label inside segment if wide enough */}
                {pct > 8 && (
                  <text
                    x={x + w / 2}
                    y={y + BAR_H * 0.72}
                    textAnchor="middle"
                    fontSize={7}
                    fill="white"
                    fontFamily="system-ui, sans-serif"
                    fontWeight="600"
                    style={{ pointerEvents: "none" }}
                  >
                    {cut.label}
                  </text>
                )}
              </g>
            ))}

            {/* Off-cut (grey) */}
            {offW > 0 && (
              <rect
                x={xCursor}
                y={y}
                width={offW}
                height={BAR_H}
                fill="#d1d5db"
              />
            )}

            {/* Right: ×2 badge + waste % */}
            <text
              x={LPAD + BAR_W + 3}
              y={y + BAR_H * 0.72}
              fontSize={8}
              fill="#888"
              fontFamily="monospace"
            >
              {isPaired ? "×2 " : ""}
              {wasteStr}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Spec Table ────────────────────────────────────────────────────────────────

function SpecTable({ params }: { params: MTFParams }) {
  const items = [
    {
      label: "Stud",
      value: `2× 2×6 @ ${fmtIn(params.studLength)} — 1.5″ × 5.5″ actual`,
    },
    {
      label: "Sill Tenon",
      value: `${params.sillTenonLength}″ horizontal · at base (0″)`,
    },
    {
      label: "Mid Tenon",
      value: `${params.midTenonLength}″ horizontal · centred at ${fmtIn(params.studLength / 2)}`,
    },
    {
      label: "Top Tenon",
      value: `${params.topTenonLength}″ vertical · inserts ${params.topTenonOverlap}″ below stud top`,
    },
    {
      label: "Lower Bridging",
      value: `${params.lowerBridgingLength}″ vertical`,
    },
    {
      label: "Upper Bridging",
      value: `${params.upperBridgingLength}″ vertical`,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "2pt 12pt",
      }}
    >
      {items.map(({ label, value }) => (
        <div key={label}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 8,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {label}:{" "}
          </span>
          <span style={{ fontSize: 8.5, fontFamily: "monospace" }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4pt 12pt" }}>
      {Object.entries(PIECE_COLORS).map(([label, color]) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              background: color,
              borderRadius: 2,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 8 }}>{label}</span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div
          style={{
            width: 10,
            height: 10,
            background: "#d1d5db",
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 8 }}>Off-cut</span>
      </div>
    </div>
  );
}

// ── Section heading helper ────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "#1e3a5f",
        margin: "0 0 4pt 0",
        borderBottom: "0.5pt solid #1e3a5f",
        paddingBottom: "2pt",
      }}
    >
      {children}
    </p>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MTFPrintLayoutProps {
  params: MTFParams;
  postCount: number;
  cutPieces: Array<{
    label: string;
    length: number;
    count: number;
    isPaired: boolean;
  }>;
  studBoards: Board[];
  pairedBoards: Board[];
  combinedStockCounts: Record<string, number>;
  availableStock: Array<{ size: number; unit: string }>;
  totalPhysicalBoards: number;
  totalOffCutIn: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function MTFPrintLayout({
  params,
  postCount,
  cutPieces,
  studBoards,
  pairedBoards,
  combinedStockCounts,
  availableStock,
  totalPhysicalBoards,
  totalOffCutIn,
}: MTFPrintLayoutProps) {
  const NAVY = "#1e3a5f";

  // Inline style constants
  const dividerLine = { borderTop: `0.75pt solid ${NAVY}` } as const;
  const sectionPad = { padding: "0.1in 0.18in" } as const;

  return (
    <>
      <style>{`@media print { @page { size: 11in 17in portrait; } }`}</style>
      {/* Portrait shell — the browser prints this as-is */}
      <div
        className="hidden print:block"
        style={{ width: "11in", height: "17in", overflow: "hidden" }}
      >
        {/* Landscape content rotated to fill the portrait page.
            rotate(-90deg) translate(-17in,0) with transform-origin:top-left maps
            landscape corner (xl,yl) → portrait (yl, 17-xl), so 17×11 fills 11×17. */}
        <div
          style={{
            position: "relative",
            width: "17in",
            height: "11in",
            padding: "0.25in",
            transform: "rotate(-90deg) translate(-17in, 0)",
            transformOrigin: "top left",
            background: "white",
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            color: NAVY,
            boxSizing: "border-box",
            fontSize: 10,
          }}
        >
          {/* ── Content frame ──────────────────────────────────────────────────── */}
          <div
            style={{
              minHeight: "calc(11in - 0.5in)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* ── Title block ──────────────────────────────────────────────────── */}
            <div
              style={{
                background: NAVY,
                color: "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.12in 0.18in",
                gap: "0.2in",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: "0.06em",
                  }}
                >
                  MTF POST — CONSTRUCTION LAYOUT
                </div>
                <div
                  style={{
                    fontSize: 9,
                    marginTop: 2,
                    opacity: 0.75,
                    fontFamily: "monospace",
                  }}
                >
                  Modified Timber Frame · 2×6 lumber throughout
                </div>
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontFamily: "monospace",
                  fontSize: 10,
                }}
              >
                <div>STUD: {fmtIn(params.studLength)}</div>
                <div>POSTS: {postCount}</div>
                <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2 }}>
                  SCALE: N.T.S.
                </div>
              </div>
            </div>

            {/* ── Main body ────────────────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                flex: 1,
                borderTop: `0.75pt solid ${NAVY}`,
              }}
            >
              {/* Left column — elevation diagrams */}
              <div
                style={{
                  width: "35%",
                  borderRight: `0.75pt solid ${NAVY}`,
                  display: "flex",
                  flexDirection: "column",
                  ...sectionPad,
                }}
              >
                <SectionHead>Elevation Views</SectionHead>
                <MTFElevationDiagram params={params} diagramHeight={300} />
              </div>

              {/* Right column — board cut layout */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  ...sectionPad,
                }}
              >
                <SectionHead>
                  Board Cut Layout — {postCount} Post
                  {postCount !== 1 ? "s" : ""} · ⅛″ Kerf
                </SectionHead>

                {/* Pairing note */}
                <p style={{ fontSize: 8, margin: "0 0 6pt 0", opacity: 0.7 }}>
                  Rows marked ×2 represent two boards glued face-to-face; one
                  cut layout serves both.
                </p>

                {/* Color legend for bars */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "2pt 10pt",
                    marginBottom: "6pt",
                  }}
                >
                  {Object.entries(PIECE_COLORS).map(([label, color]) => (
                    <div
                      key={label}
                      style={{ display: "flex", alignItems: "center", gap: 3 }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          background: color,
                          borderRadius: 1.5,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 7 }}>{label}</span>
                    </div>
                  ))}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        background: "#d1d5db",
                        borderRadius: 1.5,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 7 }}>Off-cut</span>
                  </div>
                </div>

                {/* Stud boards */}
                <p
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "2pt 0",
                    opacity: 0.7,
                  }}
                >
                  Stud Boards (individual)
                </p>
                <BoardLayoutSVG boards={studBoards} isPaired={false} />

                {/* Paired boards */}
                <p
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "8pt 0 2pt 0",
                    opacity: 0.7,
                  }}
                >
                  Tenon &amp; Bridging (glued pairs)
                </p>
                <BoardLayoutSVG boards={pairedBoards} isPaired={true} />

                {/* Material summary */}
                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: "0.08in",
                    ...dividerLine,
                  }}
                >
                  <p
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      margin: "4pt 0 4pt 0",
                    }}
                  >
                    Stock Required — 2×6
                  </p>
                  <div
                    style={{ display: "flex", gap: "0.12in", flexWrap: "wrap" }}
                  >
                    {availableStock.map((s) => {
                      const key = `${s.size}${s.unit}`;
                      const cnt = combinedStockCounts[key] ?? 0;
                      return (
                        <div
                          key={key}
                          style={{
                            textAlign: "center",
                            padding: "3pt 8pt",
                            border: `0.75pt solid ${cnt > 0 ? "#10b981" : "#ccc"}`,
                            borderRadius: 3,
                            opacity: cnt > 0 ? 1 : 0.35,
                            minWidth: "0.5in",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 700,
                              fontFamily: "monospace",
                              lineHeight: 1,
                            }}
                          >
                            {cnt}
                          </div>
                          <div style={{ fontSize: 7, marginTop: 1 }}>
                            × {s.size}′ 2×6
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p
                    style={{
                      fontSize: 8,
                      margin: "4pt 0 0 0",
                      opacity: 0.65,
                      fontFamily: "monospace",
                    }}
                  >
                    {totalPhysicalBoards} board
                    {totalPhysicalBoards !== 1 ? "s" : ""} total (
                    {studBoards.length} stud{studBoards.length !== 1 ? "s" : ""}{" "}
                    + {pairedBoards.length * 2} paired) · ~
                    {totalOffCutIn.toFixed(1)}″ combined off-cuts
                  </p>
                </div>
              </div>
            </div>
            {/* end main body */}

            {/* ── Cut list table ────────────────────────────────────────────────── */}
            <div style={{ ...dividerLine, ...sectionPad }}>
              <SectionHead>Cuts Per Post</SectionHead>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 8.5,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `0.75pt solid ${NAVY}` }}>
                    {[
                      "Piece",
                      "Length",
                      "Qty / post",
                      `Total (${postCount} post${postCount !== 1 ? "s" : ""})`,
                      "Method",
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "2pt 6pt 2pt 0",
                          fontWeight: 700,
                          fontSize: 8,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cutPieces.map(({ label, length, count, isPaired }) => (
                    <tr
                      key={label}
                      style={{ borderBottom: "0.5pt solid #ddd" }}
                    >
                      <td style={{ padding: "2pt 6pt 2pt 0" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              background: PIECE_COLORS[label] ?? "#94a3b8",
                              borderRadius: 1.5,
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          {label}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "2pt 6pt 2pt 0",
                          fontFamily: "monospace",
                        }}
                      >
                        {length}″
                      </td>
                      <td
                        style={{
                          padding: "2pt 6pt 2pt 0",
                          fontFamily: "monospace",
                        }}
                      >
                        {count}
                      </td>
                      <td
                        style={{
                          padding: "2pt 6pt 2pt 0",
                          fontFamily: "monospace",
                          fontWeight: 700,
                        }}
                      >
                        {count * postCount}
                      </td>
                      <td
                        style={{
                          padding: "2pt 0 2pt 0",
                          fontSize: 7.5,
                          opacity: 0.7,
                        }}
                      >
                        {isPaired ? "glued pair" : "individual"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Post specification ────────────────────────────────────────────── */}
            <div style={{ ...dividerLine, ...sectionPad }}>
              <SectionHead>Post Specification</SectionHead>
              <SpecTable params={params} />
            </div>

            {/* ── Footer ───────────────────────────────────────────────────────── */}
            <div
              style={{
                ...dividerLine,
                padding: "0.06in 0.18in",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f0f4f8",
                fontSize: 8,
                fontFamily: "monospace",
              }}
            >
              <span>Nopal Tools · tools.nopal.app/tools/mtf</span>
              <span>SCALE: N.T.S. · SHEET 1 OF 1</span>
            </div>
          </div>
          {/* end content frame */}

          {/* ── Logo watermark ─────────────────────────────────────────────────── */}
          {/* No own rotation needed — the page's -90° transform makes this          */}
          {/* horizontal-in-landscape logo appear vertical (running up) in portrait. */}
          <div
            style={{
              position: "absolute",
              bottom: "0.3in",
              right: "0.15in",
              pointerEvents: "none",
            }}
          >
            <svg
              viewBox="0 0 388 169"
              xmlns="http://www.w3.org/2000/svg"
              style={{
                width: "1.5in",
                height: "auto",
                display: "block",
                opacity: 0.4,
              }}
            >
              <g
                fill="#3F2B46"
                stroke="black"
                strokeWidth="8"
                paintOrder="stroke fill"
              >
                <path d="M341.525 112.294V128.316H387.588V112.294H374.07V0.141602H341.525V16.1634H357.547V112.294H341.525Z" />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M342.02 112.295V128.316H312.98V116.801C307.973 120.305 293.654 129.318 280.436 129.318C263.913 129.318 254.4 117.301 254.4 102.281C254.4 87.2604 263.913 73.2413 284.441 73.2413C299.462 73.2413 309.976 79.2495 311.979 81.2522V66.2318C310.977 61.5587 306.371 52.2127 291.952 52.2127C277.532 52.2127 273.426 59.2222 271.924 62.2263L255.902 57.7202C258.907 51.0444 270.622 37.6929 293.454 37.6929C316.285 37.6929 325.664 51.712 327.5 59.2222V112.295H342.02ZM311.682 98.562C311.625 102.266 306.511 108.3 293.218 111.145C282.988 113.335 271.436 113.674 271.603 102.776C271.77 91.8787 279.299 86.5064 291.103 87.956C302.908 89.4057 311.739 94.8582 311.682 98.562Z"
                />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M148.627 168.371V152.35H164.649V55.2171H149.628V40.1967H181.672V53.2144C185.511 47.8738 196.993 39.1953 212.214 39.1953C231.24 39.1953 255.272 51.2117 255.272 83.756C255.272 116.3 231.74 130.32 212.214 130.32C196.592 130.32 185.344 121.641 181.672 117.302V152.35H197.694V168.371H148.627ZM209.711 115.299C225.472 115.299 238.25 101.625 238.25 84.7571C238.25 67.8894 225.472 54.2155 209.711 54.2155C193.949 54.2155 181.172 67.8894 181.172 84.7571C181.172 101.625 193.949 115.299 209.711 115.299Z"
                />
                <path d="M131.464 128.857C119.316 128.213 113.78 124.166 113.565 121.341C113.332 118.267 120.128 112.468 130.39 109.689C139.394 107.251 147.353 112.402 149.614 119.605C151.874 126.808 140.812 129.353 131.464 128.857Z" />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M120.336 107.288C139.14 107.288 154.383 92.045 154.383 73.2417C154.383 54.4384 139.14 39.1953 120.336 39.1953C101.533 39.1953 86.29 54.4384 86.29 73.2417C86.29 92.045 101.533 107.288 120.336 107.288ZM120.337 91.2657C130.292 91.2657 138.361 83.1958 138.361 73.2411C138.361 63.2864 130.292 55.2165 120.337 55.2165C110.382 55.2165 102.312 63.2864 102.312 73.2411C102.312 83.1958 110.382 91.2657 120.337 91.2657Z"
                />
                <path d="M0.544922 112.294V128.316H47.1084V112.294H32.5886V65.7309C34.5913 63.2275 47.1084 55.2166 58.1234 55.2166C66.9354 55.2166 68.6377 61.2247 68.6377 65.7309L69.1384 128.316H100.681V112.294H84.6596V56.2179C84.6596 49.7091 77.1493 38.1934 62.6295 38.1934C51.0137 38.1934 37.4285 47.2056 32.5886 50.7104V40.1961H0.544922V55.2166H15.0647V112.294H0.544922Z" />
              </g>
            </svg>
          </div>
        </div>
        {/* end rotation wrapper */}
      </div>
    </>
  );
}
