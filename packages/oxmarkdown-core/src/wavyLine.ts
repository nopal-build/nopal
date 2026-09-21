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

/** Parses the directive's own `points="x,y x,y ..."` attribute string —
 * space-separated pairs, each pair comma-joined. Silently drops any pair
 * that doesn't parse to two finite numbers, rather than throwing on a
 * hand-typo'd attribute. */
export function parseLinePoints(raw: string | undefined): LinePoint[] {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    })
    .filter((p): p is LinePoint => Number.isFinite(p.x) && Number.isFinite(p.y));
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
