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
 * actually COME FROM (a fixed, author-supplied `points="..."` list vs. a
 * `ResizeObserver` + `getBoundingClientRect` measurement pass) is entirely
 * the caller's concern.
 *
 * `::line{points="..."}`'s own coordinates are LITERAL PIXELS, deliberately
 * NOT normalized/rescaled to whatever container they end up rendering
 * inside — a REVERSED decision from an earlier version of this file, which
 * normalized every point to a fixed nominal `0-100` (x) / `0-40` (y) box
 * and stretched that box independently per axis to fit whatever real size
 * `WavyLine.tsx`'s `ResizeObserver` measured. That stretching is exactly
 * what made the SAME `points="..."` recipe look different (and often
 * visibly distorted — x and y scaling by two unrelated ratios) depending
 * on the container it happened to render inside, the opposite of what a
 * hand-authored squiggle recipe should do. Plain DELTA coordinates
 * (`LineCoordinateToken`'s `{kind: "delta"}`) are now literal px, full
 * stop — `resolveLinePoints` below never rescales them by anything.
 * ANCHOR coordinates (`{kind: "anchor"}`, an `L`/`C`/`R`/`T`/`C`/`B`
 * reference letter) are the one deliberate exception: an anchor's whole
 * point is "hug this real edge of whatever container I end up in," so
 * those (and ONLY those) resolve against the container's real measured
 * width/height, via `resolveAnchor` below — an anchor's own OFFSET is
 * still a literal pixel inset from that edge, not a percentage of it.
 *
 * `::icon{position="x,y"}` (`websiteDirectives.tsx`'s `parseIconPosition`)
 * is the one remaining consumer of the OLD normalized-box design
 * (`resolveNormalizedLinePoint`, below) — placing a single point has no
 * "shape" for independent x/y scaling to distort, so a plain CSS
 * percentage (needing zero JS/DOM measurement at all) is still the right,
 * simpler choice there, not a bug to fix the same way. The two directives'
 * coordinate systems are DELIBERATELY different now — don't assume
 * `::line`'s literal-pixel design applies there too.
 *
 * `points="..."` can ALSO contain a literal, standalone `|` -- a pen-up
 * BREAK (`LinePointsEntry`), matching what a real SVG `M` (moveto)
 * command means: the next point starts a brand-new, visually
 * DISCONNECTED stroke, with no line/curve segment drawn across the gap.
 * This is why `resolveLinePoints` returns `LinePoint[][]` (one array per
 * stroke) rather than one flat list, and `buildMultiSplinePath` (not
 * `buildSplinePath` directly) is what actually draws a multi-stroke
 * `points="..."` value -- built for tracing real, organic multi-subpath
 * artwork (a branching plant illustration, a signature, ...) where
 * flattening every subpath into one continuous curve would draw bogus
 * connecting segments straight across what should be real gaps.
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

/** One entry in a FULL parsed `points="..."` sequence -- either a real
 * coordinate pair (`LinePointTokens`) or a literal, standalone `|` in the
 * attribute text, meaning "lift the pen here": the next point starts a
 * brand-new, visually DISCONNECTED stroke, the same thing a real SVG `M`
 * (moveto) command means -- no line/curve segment connects the point
 * before a `|` to the point after it. Deliberately a bare STRING (not an
 * object needing its own `kind` discriminant) -- `LinePointTokens` is
 * always an object, so `typeof entry === "string"` already distinguishes
 * the two with no shape changes needed to the existing type. The
 * cursor's own running position is NOT reset by a break (matching SVG's
 * own relative `m dx,dy` semantics) -- see `resolveLinePoints`, below,
 * for exactly what does and doesn't change. */
export type LinePointsEntry = LinePointTokens | "break";

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
 * number (an anchor) -- see `LineCoordinateToken`. A standalone `|` token
 * (see `LinePointsEntry`) is a pen-up BREAK, not a coordinate pair.
 * Silently drops any pair that doesn't parse cleanly, rather than
 * throwing on a hand-typo'd attribute. Returns raw ENTRIES, not resolved
 * numbers -- resolving an anchor to an actual position needs to know the
 * container's real width/height, which is `resolveLinePoints`'s job,
 * below. */
export function parseLinePoints(raw: string | undefined): LinePointsEntry[] {
  if (!raw) return [];
  const out: LinePointsEntry[] = [];
  for (const pair of raw.trim().split(/\s+/)) {
    if (pair === "|") {
      out.push("break");
      continue;
    }
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
 * for Y). E.g. on a `0..100`-wide span: `L0` -> 0, `R0` -> 100, `C5` -> 55.
 * `span` is whatever real unit the CALLER is working in -- `resolveLinePoints`
 * below passes the container's own REAL measured pixel width/height
 * (`::line{points=...}`'s literal-pixel design, see this file's header),
 * while `resolveNormalizedLinePoint` passes a fixed nominal `100`/`refHeight`
 * for `::icon{position=...}`'s plain-CSS-percentage design instead -- this
 * one formula doesn't care which, and is exported (not just used
 * internally below) so `svgToLinePoints.ts` can resolve the SAME anchor
 * vocabulary for ITS own "where should this imported shape land"
 * placement, without a second, potentially-drifting copy of it. */
export function resolveAnchor(ref: "L" | "C" | "R" | "T" | "B", offset: number, span: number): number {
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
 * Resolves a parsed `points="..."` entry list to actual `{x, y}` values, in
 * REAL PIXELS against the container's own real measured `width`/`height`
 * (see this file's header for why this is literal pixels, not a
 * normalized-then-rescaled box) -- "a line is drawn from one end to the
 * other": a cursor starts at `(0, 0)` (the container's own top-left
 * corner) and walks forward one point at a time. On each axis,
 * independently:
 *   - a `delta` token moves the cursor BY that amount, LITERALLY, in real
 *     pixels -- NEVER rescaled by `width`/`height` -- from wherever it
 *     already was (cumulative). This is why point 1's plain numbers end up
 *     absolute with no special-casing needed: the cursor simply starts at
 *     0, so "delta from 0" already equals "absolute position."
 *   - an `anchor` token instead SETS the cursor to a position relative to
 *     the container's own real edge (`resolveAnchor`, passed `width` for
 *     an x anchor or `height` for a y anchor), ignoring wherever the
 *     cursor already was -- e.g. `"0,T0 c,38"` resolves X for point 2 to
 *     the container's exact horizontal center regardless of point 1's X,
 *     while Y for point 2 still continues normally as `0 + 38` real px
 *     down from the top anchor point 1 set.
 * Anchors and deltas can mix freely, per-axis, at any point in the list
 * (including the first) -- letters make a coordinate "pixel-
 * referenceable, relative to the container's own real edges" instead of
 * relative to whatever the previous point happened to be; everything else
 * is a plain, stable pixel offset that means the exact same thing no
 * matter how big or small the container turns out to be.
 *
 * Returns an ARRAY OF SUBPATHS (`LinePoint[][]`), not one flat list -- a
 * `"break"` entry (see `LinePointsEntry`) starts a new inner array, so
 * `buildMultiSplinePath` can later draw each one as its own disconnected
 * stroke (a real pen-up, no connecting segment) instead of one continuous
 * curve running straight across what should be a gap. A break does NOT
 * reset the cursor -- a delta or anchor immediately after one resolves
 * exactly like it always would; only whether a segment gets DRAWN
 * changes. Empty groups (e.g. two breaks in a row, or a trailing break)
 * are dropped, never returned as an empty inner array. */
export function resolveLinePoints(entries: LinePointsEntry[], width: number, height: number): LinePoint[][] {
  let cursorX = 0;
  let cursorY = 0;
  const groups: LinePoint[][] = [[]];
  for (const entry of entries) {
    if (entry === "break") {
      if (groups[groups.length - 1].length > 0) groups.push([]);
      continue;
    }
    const { x, y } = entry;
    cursorX = x.kind === "delta" ? cursorX + x.value : resolveAnchor(x.ref, x.offset, width);
    cursorY = y.kind === "delta" ? cursorY + y.value : resolveAnchor(y.ref, y.offset, height);
    groups[groups.length - 1].push({ x: cursorX, y: cursorY });
  }
  return groups.filter((g) => g.length > 0);
}

/** Resolves a SINGLE `points="..."`-style x/y token pair to a plain
 * PERCENTAGE-ready position on a fixed nominal `0-100` (x) / `0-refHeight`
 * (y) box -- the OLD normalized-box design this file's header describes,
 * kept ONLY for `::icon{position="..."}` (`websiteDirectives.tsx`'s
 * `parseIconPosition`), which wants a plain CSS `left`/`top` PERCENTAGE
 * with zero JS/DOM measurement, not a real pixel value. Deliberately kept
 * as its own separate function rather than a `resolveLinePoints` variant
 * with a different span argument -- the two directives' coordinate
 * systems mean genuinely different things now (see header), and a shared
 * function name with silently-different unit semantics depending on the
 * caller would be exactly the kind of trap worth avoiding. Only resolves
 * ONE pair (not a cumulative list) since an icon position is always a
 * single point -- its own "delta" already resolves as absolute, since
 * there's no earlier point for it to be relative to. */
export function resolveNormalizedLinePoint(token: LinePointTokens, refHeight: number): LinePoint {
  const x = token.x.kind === "delta" ? token.x.value : resolveAnchor(token.x.ref, token.x.offset, 100);
  const y = token.y.kind === "delta" ? token.y.value : resolveAnchor(token.y.ref, token.y.offset, refHeight);
  return { x, y };
}

/** Trims float noise to a couple of decimal places -- keeps the emitted
 * path string small and stable (no `12.000000000000002`-style jitter
 * between re-renders/resizes) without rounding hard enough to visibly
 * kink the curve. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Which parameterization `buildSplinePath`'s "smooth" Catmull-Rom spline
 * uses to space out its own internal knot values -- `0.5` is
 * "centripetal" (Yuksel, Schaefer & Keyser 2011, "Parameterization and
 * Applications of Catmull-Rom Curves"), REVERSED from an earlier version
 * of this file that used plain UNIFORM parameterization (equivalent to
 * `0` here: every point spaced exactly 1 knot-unit apart, regardless of
 * how far apart it actually was). Uniform parameterization is the exact
 * mechanism behind a real, reported artifact: a segment's own tangent
 * handle length was computed from `(nextPoint - prevPoint)`, in real
 * coordinate units, with NO regard for how far apart THOSE neighbors
 * actually were -- so a short segment sitting between two far-apart
 * neighbors got a disproportionately long handle relative to its own
 * length (reading as the curve visibly "speeding up"/bulging through
 * it), and the reverse for a long segment between close-together
 * neighbors. This is textbook, well-documented behavior for uniform
 * Catmull-Rom, not specific to this codebase -- centripetal
 * parameterization (scaling each knot's spacing by the ACTUAL chord
 * distance to that point, raised to this exponent) is the standard,
 * widely-adopted fix, and is additionally PROVEN (in the paper above) to
 * never produce a cusp or self-intersecting loop for ANY input point
 * configuration, unlike uniform (`0`) or chordal (`1`) parameterization
 * -- not just "usually smoother in practice." */
const CENTRIPETAL_ALPHA = 0.5;

/** Reflects `far` through `near` -- produces a point the SAME distance
 * from `near` as `far` is, on the opposite side (`near`'s own coordinates
 * plus `near - far`). Used ONLY to synthesize a phantom neighbor at each
 * end of an open (non-looping) point list, so the very first/last REAL
 * point still gets a sensible tangent that continues the curve's own
 * trajectory -- an earlier version of this file instead just reused the
 * endpoint ITSELF as its own phantom neighbor, which happens to still
 * work for uniform parameterization (a zero-length "neighbor gap" is
 * harmless when nothing is ever divided by it) but would divide by zero
 * under centripetal parameterization, which needs every neighbor gap's
 * own real, nonzero chord distance. */
function mirrorPoint(near: LinePoint, far: LinePoint): LinePoint {
  return { x: 2 * near.x - far.x, y: 2 * near.y - far.y };
}

/** Chord (straight-line) distance between two points, floored to a tiny
 * epsilon -- two literally-coincident points (easy to end up with by
 * accident in a hand-typed `points="..."`, or a delta of `0,0`) would
 * otherwise make the centripetal knot-spacing below divide by zero. */
function chordDistance(a: LinePoint, b: LinePoint): number {
  return Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-6);
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
 *   "smooth"   — the default (and bezier's fallback): a CENTRIPETAL
 *     Catmull-Rom spline (see `CENTRIPETAL_ALPHA`'s own comment for why
 *     centripetal specifically, not the plain/uniform version an earlier
 *     iteration of this file used) running through EVERY point, converted
 *     to a sequence of cubic Bezier segments. `tension` (0-1, default
 *     0.5) scales how much each segment's control-point handles pull
 *     toward the curve's natural Catmull-Rom shape -- `0` collapses to
 *     straight lines between points, `1` is the full, standard Catmull-
 *     Rom curviness. This is the SAME "tension" convention charting
 *     libraries (e.g. Chart.js's line tension) already use, not a
 *     bespoke scale, and is UNRELATED to the uniform-vs-centripetal
 *     choice above -- `tension` controls how curvy the line looks at any
 *     given point spacing; centripetal parameterization controls whether
 *     that curviness reacts sensibly to UNEVEN point spacing in the
 *     first place.
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

  // "smooth" (and bezier's fallback for any point count other than 4) --
  // centripetal Catmull-Rom, converted segment-by-segment to a cubic
  // Bezier via the standard non-uniform-knot finite-difference tangent
  // formula (Barry & Goldman 1988; see e.g. Yuksel et al. 2011 §3 for the
  // same derivation in modern notation). `p0`/`p3` are the segment's
  // OUTER neighbors (the previous/next point in the list, or a mirrored
  // phantom at either open end of the list -- see `mirrorPoint`).
  let d = moveTo;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? mirrorPoint(points[i], points[i + 1]);
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? mirrorPoint(points[i + 1], points[i]);

    const t0 = 0;
    const t1 = t0 + chordDistance(p0, p1) ** CENTRIPETAL_ALPHA;
    const t2 = t1 + chordDistance(p1, p2) ** CENTRIPETAL_ALPHA;
    const t3 = t2 + chordDistance(p2, p3) ** CENTRIPETAL_ALPHA;

    // Non-uniform-knot Catmull-Rom tangents at p1 and p2 (the segment's
    // own two REAL endpoints) -- each `mN` is already the derivative over
    // this segment's own full [t1, t2] parameter span, which is exactly
    // why dividing by 3 (not 6, unlike the old uniform version) converts
    // it directly to a cubic Bezier control-point offset below.
    const m1x = (t2 - t1) * ((p1.x - p0.x) / (t1 - t0) - (p2.x - p0.x) / (t2 - t0) + (p2.x - p1.x) / (t2 - t1));
    const m1y = (t2 - t1) * ((p1.y - p0.y) / (t1 - t0) - (p2.y - p0.y) / (t2 - t0) + (p2.y - p1.y) / (t2 - t1));
    const m2x = (t2 - t1) * ((p2.x - p1.x) / (t2 - t1) - (p3.x - p1.x) / (t3 - t1) + (p3.x - p2.x) / (t3 - t2));
    const m2y = (t2 - t1) * ((p2.y - p1.y) / (t2 - t1) - (p3.y - p1.y) / (t3 - t1) + (p3.y - p2.y) / (t3 - t2));

    const c1x = p1.x + (tension * m1x) / 3;
    const c1y = p1.y + (tension * m1y) / 3;
    const c2x = p2.x - (tension * m2x) / 3;
    const c2y = p2.y - (tension * m2y) / 3;
    d += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

/** `buildSplinePath`, run once per SUBPATH (see `resolveLinePoints`'s own
 * `LinePoint[][]` return -- a `"break"` entry in `points="..."` starts a
 * new one) and concatenated into ONE SVG `d` string -- exactly what a
 * real multi-`M` SVG path already looks like. No changes needed to
 * `buildSplinePath` itself: each call already begins with its own fresh
 * `M`, and Catmull-Rom tangents are computed ONLY from neighbors within
 * that same call's own point list, so there's no tangent "bleed" across a
 * break -- two disconnected strokes stay exactly that, disconnected, both
 * geometrically (a real pen-up, no connecting segment) and in how their
 * own curviness is computed (neither stroke's shape is influenced by the
 * other's neighboring points at all). Empty/single-point groups
 * (`buildSplinePath` returns `""` for those) are dropped rather than
 * leaving a stray double space in the joined result. */
export function buildMultiSplinePath(subpaths: LinePoint[][], curve: LineCurveKind = "smooth", tension = 0.5): string {
  return subpaths
    .map((points) => buildSplinePath(points, curve, tension))
    .filter(Boolean)
    .join(" ");
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

/** `::path{width="..."}`/`::path{height="..."}`'s own parsed attribute
 * value, BEFORE resolving it to a real pixel number -- a plain number
 * means literal px (matches every other size in this codebase); a
 * trailing `%` means a percentage of `WavyLine`'s own measured container
 * size, resolved fresh on every real resize (see `resolveLineSize`,
 * below) the exact same way an anchor coordinate already does. */
export type LineSizeSpec = { kind: "px"; value: number } | { kind: "percent"; value: number };

/** Resolves a `LineSizeSpec` to a real pixel number against the
 * container's own real measured size on the relevant axis -- `undefined`
 * in, `undefined` out (no size attribute given at all is a real, common
 * case: `::path` renders at its own literal, unscaled point size then,
 * exactly like `::line` always does). */
export function resolveLineSize(spec: LineSizeSpec | undefined, containerSize: number): number | undefined {
  if (!spec) return undefined;
  return spec.kind === "px" ? spec.value : (spec.value / 100) * containerSize;
}

/**
 * `::path{width="..." height="..." start="..."}`'s own math -- decouples a
 * traced shape's own NATURAL proportions (`points`, resolved the SAME way
 * `::line` resolves its own -- see `resolveLinePoints`) from how big it
 * should actually render and where it should sit, which `::line` bakes
 * directly into the points themselves instead. Two independent steps:
 *
 *   1. UNIFORM scale-to-fit (never an independent per-axis stretch, so
 *      the shape's own natural proportions are always preserved) against
 *      whichever of `targetWidth`/`targetHeight` are given, in real px
 *      (see `resolveLineSize` for how a `%` attribute gets here) --
 *      "target," not exact: passing only ONE axis scales the shape
 *      uniformly so THAT axis matches, with the other following
 *      proportionally; passing BOTH fits inside whichever constrains more
 *      (the same `object-fit: contain` idea `svgToLinePoints.ts`'s own
 *      "fit" scale mode uses, at AUTHORING time, for a related but
 *      different job -- this one runs at RENDER time, every real resize,
 *      against `%` targets that can genuinely change). Passing NEITHER
 *      leaves `points` completely unscaled (`scale` reduces to exactly
 *      `1`) -- `::path` with no `width`/`height` at all renders at the
 *      same literal, unscaled pixel size `::line` always does.
 *   2. Optional repositioning so the (possibly-scaled) shape's own
 *      bounding-box top-left corner lands exactly at `start` (an already-
 *      resolved single `{x, y}` pixel position -- see `resolveLinePoints`
 *      given a single-entry list, exactly how `start="..."` gets
 *      resolved). Omitting `start` leaves the shape at wherever its own
 *      resolved `points` naturally placed it, unscaled step aside --
 *      `::line`'s own existing behavior.
 *
 * Operates on `LinePoint[][]` (subpaths -- see `resolveLinePoints`'s own
 * `"break"` handling), not a flat list -- the scale factor and the
 * `start` offset are both computed from the shape's own bounding box
 * across ALL subpaths together (a multi-stroke shape scales/moves as ONE
 * rigid whole, exactly as you'd expect), then applied identically to
 * every point in every subpath, so the grouping itself passes through
 * completely unchanged. */
export function fitAndPositionPoints(
  subpaths: LinePoint[][],
  targetWidth: number | undefined,
  targetHeight: number | undefined,
  start: LinePoint | undefined,
): LinePoint[][] {
  const flatPoints = subpaths.flat();
  if (flatPoints.length === 0) return subpaths;
  const box = boundingBox(flatPoints);
  const naturalWidth = Math.max(box.maxX - box.minX, 1e-6);
  const naturalHeight = Math.max(box.maxY - box.minY, 1e-6);

  const scale =
    targetWidth === undefined && targetHeight === undefined
      ? 1
      : Math.min(
          targetWidth === undefined ? Number.POSITIVE_INFINITY : targetWidth / naturalWidth,
          targetHeight === undefined ? Number.POSITIVE_INFINITY : targetHeight / naturalHeight,
        );

  const scaled = subpaths.map((group) =>
    group.map((p) => ({
      x: box.minX + (p.x - box.minX) * scale,
      y: box.minY + (p.y - box.minY) * scale,
    })),
  );
  if (!start) return scaled;

  const scaledBox = boundingBox(scaled.flat());
  const dx = start.x - scaledBox.minX;
  const dy = start.y - scaledBox.minY;
  return scaled.map((group) => group.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}
