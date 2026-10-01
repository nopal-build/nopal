/**
 * Converts real SVG geometry (a pasted `<path d="...">`, `<polyline
 * points="...">`/`<polygon points="...">`, or a bare "x,y x,y ..." list)
 * into `::line{points="..."}`'s own LITERAL-PIXEL coordinate vocabulary
 * (`wavyLine.ts` -- see its own header for why those coordinates are real,
 * stable pixels rather than a normalized-then-rescaled box) -- the
 * practical way to trace a hand-drawn squiggle from Figma/Illustrator/a
 * scanned sketch instead of hand-guessing anchor/delta numbers. Zero DOM/
 * React dependency, same as `wavyLine.ts` itself -- markup is parsed with
 * plain regex/string scanning, not `DOMParser`, so this works in any JS
 * environment (a test file, a server-side script, ...), not just a
 * browser. The React side (`/maker/stamps/scratch`'s "SVG → Line Points"
 * tool) is the only current consumer, but the conversion math itself has
 * no UI concerns baked in.
 *
 * Three steps, each its own exported function so they're independently
 * testable and reusable -- all three work on `LinePoint[][]` (one array
 * per SUBPATH, not one flat list; see `wavyLine.ts`'s own `"break"`/
 * `LinePointsEntry` design) end to end, so a source `<path>` with several
 * `M`-started, visually disconnected strokes (a branching illustration, a
 * signature, ...) round-trips into a real multi-stroke `points="..."`
 * instead of one bogus continuous curve joining every piece together:
 *   1. `extractSvgGeometry` -- pasted markup → raw `{x, y}` subpaths in
 *      the SOURCE's own coordinate space, plus that space's width/height.
 *   2. `fitSvgPointsToLineBox` -- raw subpaths → absolute subpaths scaled
 *      + placed within a literal PIXEL target box the caller picks (the
 *      shape's real, final on-screen size), anchored via the SAME
 *      `L`/`C`/`R`/`T`/`C`/`B` + offset vocabulary `::line{points="..."}`/
 *      `::icon{position="..."}` already use (`resolveAnchor`, below).
 *   3. `formatLinePointsAttr` -- absolute subpaths → the literal
 *      `points="..."` attribute string (with a real `|` between subpaths),
 *      ready to paste into a real `::line{...}`/`::path{...}` directive.
 */
import { resolveAnchor, type LinePoint } from "./wavyLine";

// ── Step 1: parsing raw SVG geometry ────────────────────────────────────────

/** How many straight-line samples approximate one curve segment (C/S/Q/T) --
 * high enough that the resulting polyline reads as smooth once `::line`'s
 * own Catmull-Rom spline (`buildSplinePath`) runs through it, low enough
 * that a hand-drawn squiggle doesn't produce an absurdly long `points="..."`
 * string. Not user-configurable -- this is an internal approximation detail,
 * not a real knob anyone needs to tune by hand. */
const CURVE_SAMPLES = 10;

/** Numbers in path data can run together with no separator between a
 * command letter and a number, between two numbers (a bare `-` or a second
 * `.` starts a new number), or be comma/whitespace-separated -- this
 * tokenizer handles all three per the real SVG path grammar, rather than a
 * naive `.split(/[\s,]+/)` (which silently mis-parses e.g. "M1-2" or
 * "M1.5.5" as one number each instead of two). */
function tokenizePathData(d: string): (string | number)[] {
  const COMMAND_CHARS = "MmLlHhVvCcSsQqTtZz";
  const tokens: (string | number)[] = [];
  let i = 0;
  const n = d.length;
  const NUMBER_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/;
  while (i < n) {
    const ch = d[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
      i++;
      continue;
    }
    if (COMMAND_CHARS.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    const match = NUMBER_RE.exec(d.slice(i));
    if (match) {
      tokens.push(Number.parseFloat(match[0]));
      i += match[0].length;
      continue;
    }
    // Unrecognized character (most likely an unsupported command like `A`/
    // `a` for elliptical arcs -- see this file's header) -- stop consuming
    // rather than looping forever or silently corrupting the rest.
    break;
  }
  return tokens;
}

/** Argument count each command consumes, per the SVG path spec -- `Z`/`z`
 * (closepath) takes none. Elliptical arcs (`A`/`a`) are deliberately NOT
 * supported: correctly converting one to a sampled polyline needs real
 * ellipse math (not just a formula substitution the way cubic/quadratic
 * bezier sampling is), and the actual target use case here -- a hand-drawn
 * decorative squiggle traced in a design tool -- essentially never produces
 * one. `parseSvgPathData` simply stops at the first `A`/`a`/unrecognized
 * token it sees, returning whatever points came before it rather than
 * guessing. */
const COMMAND_ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

function sampleCubicBezier(p0: LinePoint, p1: LinePoint, p2: LinePoint, p3: LinePoint, out: LinePoint[]) {
  for (let s = 1; s <= CURVE_SAMPLES; s++) {
    const t = s / CURVE_SAMPLES;
    const mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

function sampleQuadraticBezier(p0: LinePoint, p1: LinePoint, p2: LinePoint, out: LinePoint[]) {
  for (let s = 1; s <= CURVE_SAMPLES; s++) {
    const t = s / CURVE_SAMPLES;
    const mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
}

/** Parses an SVG `<path d="...">` attribute's own mini-language into a list
 * of SUBPATHS (`LinePoint[][]`, one array per `M`-started stroke -- see
 * `oxmarkdown-core`'s `wavyLine.ts` header for the `"|"`/`LinePointsEntry`
 * pen-up design this directly feeds) -- every straight segment (`M`/`L`/
 * `H`/`V`) contributes its own endpoint directly; every curve segment
 * (`C`/`S`/`Q`/`T`) contributes `CURVE_SAMPLES` evenly-spaced points along
 * the real bezier curve, not just its endpoints (a `::line{...}`/
 * `::path{...}` `points="..."` list is itself just a sequence of points
 * `buildSplinePath` re-smooths with its OWN Catmull-Rom spline -- sampling
 * densely enough here is what lets that re-smoothing reproduce the
 * original curve's actual shape instead of a blocky straight-line
 * approximation of it). A NEW `M` starts a brand-new subpath ONLY when the
 * current one already has points in it -- the very FIRST `M` in a `d`
 * attribute just seeds the first (and often only) subpath, it doesn't
 * open an empty one before it. `S`/`T` (smooth curve continuations)
 * correctly reflect the previous segment's own control point per spec,
 * but only when the previous segment was the same curve family (a bare
 * `cur` point otherwise, per spec) -- `prevCurveFamily` tracks that,
 * reset at each new subpath (a fresh `M` never inherits a smooth-curve
 * continuation from a DIFFERENT, disconnected stroke). Absolute and
 * relative (lowercase) command variants are both supported; an implicit
 * repeated command (extra coordinate pairs after `L`/`M`/etc. with no new
 * command letter) is handled per spec too (a repeated bare `M` becomes an
 * implicit `L`, staying in the SAME subpath -- only a real `M`/`m`
 * command letter ever starts a new one). */
export function parseSvgPathData(d: string): LinePoint[][] {
  const tokens = tokenizePathData(d);
  const subpaths: LinePoint[][] = [];
  let current: LinePoint[] = [];
  let cur: LinePoint = { x: 0, y: 0 };
  let subpathStart: LinePoint = { x: 0, y: 0 };
  let prevControl: LinePoint | null = null;
  let prevCurveFamily: "cubic" | "quadratic" | null = null;
  let command: string | null = null;
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok === "string") {
      command = tok;
      i++;
    } else if (command) {
      // Implicit repeat: extra numbers after the LAST real command letter,
      // with `M`/`m` repeating as `L`/`l` per spec (every command AFTER an
      // `M`'s first coordinate pair is an implicit lineto, not another
      // moveto).
      if (command === "M") command = "L";
      else if (command === "m") command = "l";
    } else {
      break; // malformed: numbers with no command at all yet
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;
    const arity = COMMAND_ARITY[upper];
    if (arity === undefined) break; // unsupported command (e.g. `A`/`a`) -- stop here, see header

    if (upper === "Z") {
      current.push(subpathStart);
      cur = subpathStart;
      prevControl = null;
      prevCurveFamily = null;
      continue;
    }

    const args = tokens.slice(i, i + arity);
    if (args.length < arity || args.some((a) => typeof a !== "number")) break; // malformed
    i += arity;
    const nums = args as number[];

    switch (upper) {
      case "M": {
        const p = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        if (current.length > 0) {
          subpaths.push(current);
          current = [];
        }
        current.push(p);
        cur = p;
        subpathStart = p;
        prevControl = null;
        prevCurveFamily = null;
        break;
      }
      case "L": {
        const p = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        current.push(p);
        cur = p;
        prevControl = null;
        prevCurveFamily = null;
        break;
      }
      case "H": {
        const p = { x: relative ? cur.x + nums[0] : nums[0], y: cur.y };
        current.push(p);
        cur = p;
        prevControl = null;
        prevCurveFamily = null;
        break;
      }
      case "V": {
        const p = { x: cur.x, y: relative ? cur.y + nums[0] : nums[0] };
        current.push(p);
        cur = p;
        prevControl = null;
        prevCurveFamily = null;
        break;
      }
      case "C": {
        const c1 = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        const c2 = relative ? { x: cur.x + nums[2], y: cur.y + nums[3] } : { x: nums[2], y: nums[3] };
        const p3 = relative ? { x: cur.x + nums[4], y: cur.y + nums[5] } : { x: nums[4], y: nums[5] };
        sampleCubicBezier(cur, c1, c2, p3, current);
        cur = p3;
        prevControl = c2;
        prevCurveFamily = "cubic";
        break;
      }
      case "S": {
        const c1: LinePoint = prevCurveFamily === "cubic" && prevControl ? { x: 2 * cur.x - prevControl.x, y: 2 * cur.y - prevControl.y } : cur;
        const c2 = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        const p3 = relative ? { x: cur.x + nums[2], y: cur.y + nums[3] } : { x: nums[2], y: nums[3] };
        sampleCubicBezier(cur, c1, c2, p3, current);
        cur = p3;
        prevControl = c2;
        prevCurveFamily = "cubic";
        break;
      }
      case "Q": {
        const c1 = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        const p2 = relative ? { x: cur.x + nums[2], y: cur.y + nums[3] } : { x: nums[2], y: nums[3] };
        sampleQuadraticBezier(cur, c1, p2, current);
        cur = p2;
        prevControl = c1;
        prevCurveFamily = "quadratic";
        break;
      }
      case "T": {
        const c1: LinePoint = prevCurveFamily === "quadratic" && prevControl ? { x: 2 * cur.x - prevControl.x, y: 2 * cur.y - prevControl.y } : cur;
        const p2 = relative ? { x: cur.x + nums[0], y: cur.y + nums[1] } : { x: nums[0], y: nums[1] };
        sampleQuadraticBezier(cur, c1, p2, current);
        cur = p2;
        prevControl = c1;
        prevCurveFamily = "quadratic";
        break;
      }
    }
  }

  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

/** Parses a `<polyline points="...">`/`<polygon points="...">` attribute --
 * a much simpler grammar than a full path: just a flat list of numbers,
 * comma AND/OR whitespace separated, taken two at a time. Also doubles as
 * the fallback for a bare pasted "x,y x,y ..." list with no surrounding SVG
 * tag at all (see `extractSvgGeometry`). */
export function parseSvgPointsAttr(raw: string): LinePoint[] {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const points: LinePoint[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

export type SvgShapeKind = "path" | "polyline" | "polygon";

export interface ExtractedSvgGeometry {
  /** One array per SUBPATH -- a `<polyline>`/`<polygon>`/bare point list is
   * always exactly one; a `<path>` can be many (one per `M` command --
   * see `parseSvgPathData`). Preserved as separate groups all the way
   * through so a multi-subpath source can round-trip into a real pen-up
   * `"|"` in the emitted `points="..."` (`formatLinePointsAttr`), instead
   * of flattening every disconnected stroke into one bogus continuous
   * curve. */
  points: LinePoint[][];
  kind: SvgShapeKind;
  /** The source coordinate space's own width/height -- from the `<svg>`'s
   * `viewBox` if present, else its `width`/`height` attributes, else the
   * parsed points' own bounding box as a last resort (a shape with no
   * declared space of its own is presumably already sized close to how it
   * should look, so its own content extent is the most reasonable guess). */
  width: number;
  height: number;
}

function extractTagAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return match ? match[1] : null;
}

/** Extracts the FIRST recognized shape from pasted markup -- a whole
 * `<svg>...</svg>`, a bare `<path>`/`<polyline>`/`<polygon>` element, or (if
 * none of those tags are found at all) a plain "x,y x,y ..." point list
 * typed/pasted with no markup whatsoever, so this tool also works as a
 * quick manual point-list normalizer, not just an SVG importer. A `<path>`
 * with multiple `M` commands comes back as multiple SUBPATHS (see
 * `ExtractedSvgGeometry.points`) -- a `<polyline>`/`<polygon>`/bare list is
 * always exactly one. Returns `null` if nothing usable was found (an
 * empty/unparseable paste, or a shape whose own path/points data produced
 * zero points). */
export function extractSvgGeometry(markup: string): ExtractedSvgGeometry | null {
  const pathMatch = /<path\b[^>]*\bd\s*=\s*"([^"]*)"[^>]*\/?>/i.exec(markup);
  const polylineMatch = /<polyline\b[^>]*\bpoints\s*=\s*"([^"]*)"[^>]*\/?>/i.exec(markup);
  const polygonMatch = /<polygon\b[^>]*\bpoints\s*=\s*"([^"]*)"[^>]*\/?>/i.exec(markup);

  let points: LinePoint[][] = [];
  let kind: SvgShapeKind = "path";
  if (pathMatch) {
    points = parseSvgPathData(pathMatch[1]);
    kind = "path";
  } else if (polylineMatch) {
    points = [parseSvgPointsAttr(polylineMatch[1])];
    kind = "polyline";
  } else if (polygonMatch) {
    points = [parseSvgPointsAttr(polygonMatch[1])];
    kind = "polygon";
  } else {
    points = [parseSvgPointsAttr(markup)];
    kind = "polyline";
  }
  const flatPoints = points.flat();
  if (flatPoints.length === 0) return null;

  let width: number | null = null;
  let height: number | null = null;
  const svgTagMatch = /<svg\b[^>]*>/i.exec(markup);
  if (svgTagMatch) {
    const viewBox = extractTagAttr(svgTagMatch[0], "viewBox");
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        width = parts[2];
        height = parts[3];
      }
    }
    if (width == null) {
      const w = extractTagAttr(svgTagMatch[0], "width");
      const h = extractTagAttr(svgTagMatch[0], "height");
      const wNum = w ? Number.parseFloat(w) : NaN;
      const hNum = h ? Number.parseFloat(h) : NaN;
      if (Number.isFinite(wNum) && Number.isFinite(hNum)) {
        width = wNum;
        height = hNum;
      }
    }
  }
  if (width == null || height == null) {
    const box = boundingBoxOf(flatPoints);
    width = Math.max(1, box.maxX - box.minX);
    height = Math.max(1, box.maxY - box.minY);
  }

  return { points, kind, width, height };
}

function boundingBoxOf(points: LinePoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
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

/** Reverses a traced shape's own DRAWING direction -- swaps which end is
 * "first" and which is "last," for both the shape's own subpath ORDER
 * (the last-drawn stroke becomes the first) and each subpath's own
 * internal point order (each stroke now runs backwards). The visual
 * SHAPE this produces is pixel-for-pixel IDENTICAL either way -- this
 * only changes which point ends up as `points="..."`'s own first entry
 * (and therefore which point `referenceIndex`/an anchor/`::path{start=
 * ...}` treats as "the start"), and which direction a stroke-drawing
 * animation (CSS `stroke-dashoffset`) would appear to travel in. Useful
 * when a traced SVG was authored in the opposite direction from how you
 * actually want it to animate/anchor, without needing to re-trace or
 * re-export it from the original design tool. */
export function reverseSvgGeometry(subpaths: LinePoint[][]): LinePoint[][] {
  return [...subpaths].reverse().map((group) => [...group].reverse());
}

// ── Step 2: fitting raw points into a literal PIXEL target box ─────────────

export type LineAnchorX = { ref: "L" | "C" | "R"; offset: number };
export type LineAnchorY = { ref: "T" | "C" | "B"; offset: number };

export interface FitSvgPointsOptions {
  /** The literal pixel width/height to scale the traced shape into --
   * unlike an earlier version of this tool (which targeted a fixed,
   * normalized `0-100`/`0-40` box that got stretched again at RENDER time
   * to whatever container `::line{...}` ended up in), these numbers now
   * end up being the shape's REAL, stable on-screen pixel size wherever
   * it's placed (see `wavyLine.ts`'s own header for why `::line`'s plain
   * deltas are literal px, never rescaled). Pick whatever pixel dimensions
   * the traced squiggle should actually render at -- there's no longer a
   * "box" concept baked into the directive itself to match. */
  targetWidth: number;
  targetHeight: number;
  /** Which point of the SOURCE shape anchors the placement -- an index
   * into the parsed points array (0 = the shape's own first/starting
   * point, the natural choice for "this is where the line starts"), or
   * `"bounding-box"` to anchor the shape's own top-left bounding-box
   * corner instead (useful when the first drawn point isn't a meaningful
   * "corner" of the shape, e.g. a closed loop). */
  referenceIndex: number | "bounding-box";
  anchorX: LineAnchorX;
  anchorY: LineAnchorY;
  /** "fit" scales uniformly (preserving the source's own aspect ratio) so
   * the shape's longer axis exactly fills the target box, the same idea as
   * CSS `object-fit: contain`. "stretch" scales x/y independently to fill
   * the FULL `targetWidth`x`targetHeight` box regardless of the source's
   * own proportions -- useful for a shape that's meant to span a specific
   * pixel width/height exactly (e.g. tracing a squiggle meant to run a
   * section's full width), at the cost of possibly distorting it. */
  scaleMode: "fit" | "stretch";
}

/** Scales + translates raw SOURCE-space points into a literal
 * `targetWidth`x`targetHeight` PIXEL box, anchored via the SAME
 * `L`/`C`/`R`/`T`/`C`/`B` + offset vocabulary the rest of OxMarkdown's line/
 * icon positioning already uses (`resolveAnchor`, `wavyLine.ts`) -- "this
 * point of my traced shape should land at anchor X,Y" is the practical
 * mental model requested for this tool, rather than hand-computing a raw
 * translation. Returns ABSOLUTE points in the target box's own pixel
 * coordinate space (NOT yet re-expressed as deltas -- see
 * `formatLinePointsAttr` for that last step). Note that an ANCHORED first
 * point (`formatLinePointsAttr`'s own `firstPointAnchor`) gets RE-resolved
 * again at real render time against whatever container `::line{...}`
 * actually ends up in (`wavyLine.ts`'s `resolveLinePoints`) -- the anchor
 * placement computed here only needs to produce a sensible, correctly-
 * proportioned RELATIVE layout for every point after the first, not
 * predict the exact final on-screen position. */
export function fitSvgPointsToLineBox(subpaths: LinePoint[][], sourceWidth: number, sourceHeight: number, opts: FitSvgPointsOptions): LinePoint[][] {
  const flatPoints = subpaths.flat();
  if (flatPoints.length === 0) return [];
  const { targetWidth, targetHeight } = opts;

  let scaleX: number;
  let scaleY: number;
  if (opts.scaleMode === "stretch") {
    scaleX = sourceWidth === 0 ? 1 : targetWidth / sourceWidth;
    scaleY = sourceHeight === 0 ? 1 : targetHeight / sourceHeight;
  } else {
    const sx = sourceWidth === 0 ? Number.POSITIVE_INFINITY : targetWidth / sourceWidth;
    const sy = sourceHeight === 0 ? Number.POSITIVE_INFINITY : targetHeight / sourceHeight;
    const uniform = Math.min(sx, sy);
    scaleX = uniform;
    scaleY = uniform;
  }

  const scaled = subpaths.map((group) => group.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })));
  const scaledFlat = scaled.flat();

  // `referenceIndex` is a FLAT index across every subpath concatenated in
  // order -- `0` is still "the shape's own first drawn point" even for a
  // multi-subpath source, since `.flat()` preserves subpath order.
  const ref =
    opts.referenceIndex === "bounding-box"
      ? (() => {
          const box = boundingBoxOf(scaledFlat);
          return { x: box.minX, y: box.minY };
        })()
      : (scaledFlat[opts.referenceIndex] ?? scaledFlat[0]);

  const targetX = resolveAnchor(opts.anchorX.ref, opts.anchorX.offset, targetWidth);
  const targetY = resolveAnchor(opts.anchorY.ref, opts.anchorY.offset, targetHeight);
  const dx = targetX - ref.x;
  const dy = targetY - ref.y;

  return scaled.map((group) => group.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

// ── Step 3: serializing back to `points="..."` ──────────────────────────────

function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Converts a list of ABSOLUTE SUBPATHS (already fit into the target box by
 * `fitSvgPointsToLineBox`) into the literal `points="..."` attribute string
 * `::line{...}`/`::path{...}` expects -- a cursor starts at `(0, 0)` and
 * each point is written as a plain DELTA from wherever the cursor already
 * is (matching `resolveLinePoints`'s own cumulative-cursor model exactly,
 * including that the cursor does NOT reset at a subpath boundary), so this
 * is the precise inverse of that function. Between two subpaths, a literal
 * `|` (pen-up BREAK -- see `wavyLine.ts`'s `LinePointsEntry`) is emitted
 * instead of a coordinate pair -- a multi-`M` source SVG round-trips into
 * a real multi-stroke `points="..."`, not one bogus continuous curve
 * connecting every disconnected piece. The very FIRST point overall may
 * instead be written as a real `L`/`C`/`R`,`T`/`C`/`B` ANCHOR token
 * (`firstPointAnchor`) -- since the whole point of this tool is "anchor
 * the shape to a position," keeping that anchor visible and hand-editable
 * in the resulting markdown (rather than baking it into an opaque plain
 * number) is what actually fulfills that ask; every point after it stays
 * a plain delta regardless, same as any hand-authored `points="..."`
 * already does. */
export function formatLinePointsAttr(subpaths: LinePoint[][], firstPointAnchor?: { x: LineAnchorX; y: LineAnchorY }): string {
  const nonEmptyGroups = subpaths.filter((g) => g.length > 0);
  if (nonEmptyGroups.length === 0) return "";
  const tokens: string[] = [];
  let cursor: LinePoint = { x: 0, y: 0 };
  let isFirstPointOverall = true;
  nonEmptyGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0) tokens.push("|");
    group.forEach((p) => {
      if (isFirstPointOverall && firstPointAnchor) {
        tokens.push(`${firstPointAnchor.x.ref}${formatNumber(firstPointAnchor.x.offset)},${firstPointAnchor.y.ref}${formatNumber(firstPointAnchor.y.offset)}`);
      } else {
        tokens.push(`${formatNumber(p.x - cursor.x)},${formatNumber(p.y - cursor.y)}`);
      }
      cursor = p;
      isFirstPointOverall = false;
    });
  });
  return tokens.join(" ");
}
