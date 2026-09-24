/**
 * Pure math for the "wavy line" decoration shared by two otherwise very
 * different features:
 *   - `::line{points="..."}`, nested inside `:::section-title{...}` — a
 *     short, fixed, hand-authored squiggle local to one small component.
 *   - The (not yet built) page-spanning connector on the Home template,
 *     which will thread a curve through several `::stamp`/`::icon`/
 *     `::waypoint` elements' LIVE measured DOM positions instead of fixed
 *     coordinates.
 *
 * Both cases reduce to the exact same problem once you have a plain list
 * of `{x, y}` points in some shared pixel space: "build one smooth SVG
 * path through these points." That reduction is what lives here — zero
 * DOM/React dependency, so unlike the React side of this (`WavyLine.tsx`,
 * duplicated per app the same way `OxRenderer.tsx` is) this one file can
 * genuinely be shared rather than kept in sync by hand. Where the points
 * actually COME FROM (a fixed, author-normalized box vs. a `ResizeObserver`
 * + `getBoundingClientRect` measurement pass) is entirely the caller's
 * concern.
 */

export type LinePoint = { x: number; y: number };

export type LineCurveKind = "smooth" | "straight" | "bezier";

/** One coordinate (X or Y) of a `points="..."` pair, as parsed from the
 * directive's own text, BEFORE resolving it to an actual number:
 *   - `{kind: "delta", value}` — a plain number, e.g. `"58"` or `"-12"`.
 *     Means "relative to whatever the previous point resolved to on this
 *     axis," cumulative (see `resolveLinePoints`, below).
 *   - `{kind: "anchor", ref, offset}` — a reference letter (optionally
 *     followed by a number, default `0`), e.g. `"B1"`, `"c5"`, `"R"`.
 *     Means "pixel-referenceable, relative to the box's own known
 *     geometry" instead of relative to the previous point: `L`/`C`/`R`
 *     (left/center/right) for X, `T`/`C`/`B` (top/center/bottom) for Y —
 *     `C` is shared between axes, disambiguated by which slot (X or Y) it
 *     appears in. Case-insensitive. */
export type LineCoordinateToken =
  | { kind: "delta"; value: number }
  | { kind: "anchor"; ref: "L" | "C" | "R" | "T" | "B"; offset: number };

export type LinePointTokens = { x: LineCoordinateToken; y: LineCoordinateToken };

const X_REFS = new Set(["L", "C", "R"]);
const Y_REFS = new Set(["T", "C", "B"]);

/** Matches an optional single reference letter followed by an optional
 * signed (decimal) number -- at least one of the two must be present.
 * `"58"` -> letter absent, number `"58"`. `"B1"` -> letter `"B"`, number
 * `"1"`. `"c"` -> letter `"c"`, number absent (defaults to offset `0`). */
const COORDINATE_PATTERN = /^([A-Za-z])?(-?\d*\.?\d+)?$/;

function parseCoordinateToken(raw: string, axis: "x" | "y"): LineCoordinateToken | null {
  const match = COORDINATE_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, letterRaw, numberRaw] = match;
  if (letterRaw) {
    const ref = letterRaw.toUpperCase();
    const validRefs = axis === "x" ? X_REFS : Y_REFS;
    if (!validRefs.has(ref)) return null;
    const offset = numberRaw !== undefined ? Number(numberRaw) : 0;
    if (!Number.isFinite(offset)) return null;
    return { kind: "anchor", ref: ref as "L" | "C" | "R" | "T" | "B", offset };
  }
  if (numberRaw === undefined) return null;
  const value = Number(numberRaw);
  if (!Number.isFinite(value)) return null;
  return { kind: "delta", value };
}

/** Parses the directive's own `points="x,y x,y ..."` attribute string —
 * space-separated pairs, each pair comma-joined, each half of the pair
 * either a plain number (a delta) or a reference-letter + optional
 * number (an anchor) -- see `LineCoordinateToken`. Silently drops any
 * pair that doesn't parse cleanly, rather than throwing on a hand-typo'd
 * attribute. Returns raw TOKENS, not resolved numbers -- resolving an
 * anchor to an actual position needs to know the box's own height
 * (`viewBoxHeight`), which is `resolveLinePoints`'s job, below. */
export function parseLinePoints(raw: string | undefined): LinePointTokens[] {
  if (!raw) return [];
  const out: LinePointTokens[] = [];
  for (const pair of raw.trim().split(/\s+/)) {
    const [xRaw, yRaw] = pair.split(",");
    if (xRaw === undefined || yRaw === undefined) continue;
    const x = parseCoordinateToken(xRaw, "x");
    const y = parseCoordinateToken(yRaw, "y");
    if (!x || !y) continue;
    out.push({ x, y });
  }
  return out;
}

/** Resolves one anchor letter + offset to an absolute position along an
 * axis spanning `0..span` -- the SAME "inset" convention CSS's own
 * `top`/`right`/`bottom`/`left` properties use: `T`/`L` add AWAY from
 * that edge (offset grows downward/rightward), `B`/`R` subtract INWARD
 * from that edge (offset grows upward/leftward), and `C` (center) adds
 * in the ordinary positive-axis direction (rightward for X, downward
 * for Y). E.g. on a `0..100` X axis: `L0` -> 0, `R0` -> 100, `C5` -> 55. */
function resolveAnchor(ref: "L" | "C" | "R" | "T" | "B", offset: number, span: number): number {
  switch (ref) {
    case "L":
    case "T":
      return offset;
    case "R":
    case "B":
      return span - offset;
    case "C":
      return span / 2 + offset;
  }
}

/**
 * Resolves a parsed `points="..."` token list to actual `{x, y}` values,
 * normalized to a `0..100` (x) / `0..viewBoxHeight` (y) box -- "a line is
 * drawn from one end to the other": a cursor starts at `(0, 0)` (the
 * box's own top-left corner) and walks forward one point at a time. On
 * each axis, independently:
 *   - a `delta` token moves the cursor BY that amount from wherever it
 *     already was (cumulative) -- this is why point 1's plain numbers
 *     end up absolute with no special-casing needed: the cursor simply
 *     starts at 0, so "delta from 0" already equals "absolute position."
 *   - an `anchor` token instead SETS the cursor to that reference
 *     position (see `resolveAnchor`), ignoring wherever the cursor
 *     already was -- e.g. `"0,41 c,38"` resolves X for point 2 to the
 *     box's exact horizontal center regardless of point 1's X, while Y
 *     for point 2 still continues normally as `41 + 38`.
 * Anchors and deltas can mix freely, per-axis, at any point in the list
 * (including the first) -- letters make a coordinate "pixel-
 * referenceable, relative to the box's own known geometry" instead of
 * relative to whatever the previous point happened to be. */
export function resolveLinePoints(tokens: LinePointTokens[], viewBoxHeight: number): LinePoint[] {
  let cursorX = 0;
  let cursorY = 0;
  const resolved: LinePoint[] = [];
  for (const { x, y } of tokens) {
    cursorX = x.kind === "delta" ? cursorX + x.value : resolveAnchor(x.ref, x.offset, 100);
    cursorY = y.kind === "delta" ? cursorY + y.value : resolveAnchor(y.ref, y.offset, viewBoxHeight);
    resolved.push({ x: cursorX, y: cursorY });
  }
  return resolved;
}

/** Trims float noise to a couple of decimal places -- keeps the emitted
 * path string small and stable (no `12.000000000000002`-style jitter
 * between re-renders/resizes) without rounding hard enough to visibly
 * kink the curve. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Builds an SVG path `d` string through `points`, in whatever coordinate
 * space the caller already resolved them to (a normalized 0-100-ish box,
 * or real measured pixels -- this function doesn't care).
 *
 *   "straight" — a plain polyline between points, no smoothing. Mostly
 *     useful as a debugging/positioning aid while placing points, before
 *     switching to "smooth".
 *   "bezier"   — treats EXACTLY 4 points as classic cubic-Bezier anchor/
 *     control points (`M p0 C p1 p2 p3`) -- for precise SVG-style handles
 *     instead of a spline running through every point. Falls back to
 *     "smooth" for any other point count, rather than guessing which
 *     points were meant as handles.
 *   "smooth"   — the default (and bezier's fallback): a Catmull-Rom
 *     spline running through EVERY point, converted to a sequence of
 *     cubic Bezier segments. `tension` (0-1, default 0.5) scales how much
 *     each segment's control-point handles pull toward the curve's
 *     natural Catmull-Rom shape -- `0` collapses to straight lines between
 *     points, `1` is the full, standard Catmull-Rom curviness. This is
 *     the SAME "tension" convention charting libraries (e.g. Chart.js's
 *     line tension) already use, not a bespoke scale.
 */
export function buildSplinePath(
  points: LinePoint[],
  curve: LineCurveKind = "smooth",
  tension = 0.5,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return "";

  const [first, ...rest] = points;
  const moveTo = `M ${fmt(first.x)},${fmt(first.y)}`;

  if (curve === "straight") {
    return `${moveTo} ${rest.map((p) => `L ${fmt(p.x)},${fmt(p.y)}`).join(" ")}`;
  }

  if (curve === "bezier" && points.length === 4) {
    const [p0, c1, c2, p3] = points;
    return `M ${fmt(p0.x)},${fmt(p0.y)} C ${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(p3.x)},${fmt(p3.y)}`;
  }

  // "smooth" (and bezier's fallback for any point count other than 4).
  let d = moveTo;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const c1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const c2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const c2y = p2.y - ((p3.y - p1.y) * tension) / 6;
    d += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

/** Maps a point normalized to a `0..100` (x) / `0..viewBoxHeight` (y) box
 * into real pixel coordinates within a `width`x`height` px box -- the
 * "fixed, author-supplied points" case (`::line{points="..."}`). Kept as
 * its own small function (not inlined into the React side) so the mapping
 * itself stays testable without a DOM. */
export function mapNormalizedPoint(
  point: LinePoint,
  viewBoxHeight: number,
  width: number,
  height: number,
): LinePoint {
  return {
    x: (point.x / 100) * width,
    y: (point.y / viewBoxHeight) * height,
  };
}

/** The axis-aligned bounding box of a point list, as `{minX, minY, maxX,
 * maxY}` -- used to size the line's wrapper element to exactly fit its
 * (possibly negative-dipping) path rather than the whole containing box.
 * Returns all-zero for an empty list rather than `Infinity`/`-Infinity`,
 * so a caller can use it directly without a special empty-list check
 * first. */
export function boundingBox(points: LinePoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
