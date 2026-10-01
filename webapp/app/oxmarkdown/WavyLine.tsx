/**
 * The shared "wavy line" primitive — one rendering approach, two ways to
 * get its points:
 *   - `mode="points"` (default) — fixed, LITERAL-PIXEL points (see
 *     `oxmarkdown-core/wavyLine.ts`'s own header for why they're real,
 *     stable pixels and not a normalized-then-rescaled box), resolved
 *     against this component's OWN measured size on mount and on every
 *     real resize (needed only to place any `L`/`C`/`R`/`T`/`C`/`B`
 *     ANCHOR coordinates against this component's real edges -- a plain
 *     delta coordinate never depends on the measured size at all). Used
 *     by `::line{points="..."}` inside `:::section-title{...}`.
 *   - `mode="waypoints"` — instead of fixed coordinates, a list of
 *     `data-waypoint-id` values to look up live in the DOM (elements
 *     `::stamp`/`::icon`/`::waypoint` can carry via their own `id` attr —
 *     see `websiteDirectives.tsx`), measured via `getBoundingClientRect`
 *     and converted to pixels relative to this component's own box. Not
 *     wired to a real directive yet — reserved for the Home template's
 *     page-spanning connector — but built now so both cases share the
 *     exact same measurement/recompute machinery and the exact same
 *     `buildSplinePath` call from `oxmarkdown-core`.
 *
 * Deliberately recomputes on a real, measured resize (`ResizeObserver`)
 * rather than relying on `preserveAspectRatio="none"` to passively
 * stretch one fixed path — that only ever scales both axes uniformly per
 * axis, with no way to hold e.g. stroke width or vertical amplitude fixed
 * in real px while only horizontal spacing grows with width. This is ALSO
 * why `::line{points="..."}`'s own plain deltas stay literal, stable
 * pixels rather than being rescaled by this same measurement -- letting a
 * `ResizeObserver`-driven stretch distort the shape's own proportions on
 * every resize is exactly the "funky at different container sizes"
 * problem this design deliberately avoids; ONLY an explicit anchor letter
 * (an author opting in to "track this real edge") reads the measured size
 * at all.
 *
 * Client-only by nature (real DOM measurement) — renders no path at all
 * until its first post-mount measurement, matching plain SSR-then-
 * hydrate behavior with no special-casing needed here.
 */
import { useEffect, useRef, useState } from "react";
import {
  boundingBox,
  buildMultiSplinePath,
  buildSplinePath,
  fitAndPositionPoints,
  resolveLinePoints,
  resolveLineSize,
  type LineCurveKind,
  type LinePoint,
  type LinePointsEntry,
  type LinePointTokens,
  type LineSizeSpec,
} from "oxmarkdown-core";

type WavyLineBaseProps = {
  curve?: LineCurveKind;
  tension?: number;
  className?: string;
  /** Stroke color — defaults to `currentColor` so it inherits whatever
   * text/accent color is already in scope (e.g. a section's own accent). */
  color?: string;
  strokeWidth?: number;
};

export type WavyLinePointsProps = WavyLineBaseProps & {
  mode?: "points";
  /** Parsed `points="..."` entries (`oxmarkdown-core`'s `parseLinePoints`)
   * — "a line is drawn from one end to the other": a cursor starts at this
   * component's own top-left corner and walks forward, per-axis, per
   * point. A plain-number coordinate moves the cursor BY that amount, in
   * LITERAL real pixels, from wherever it already was (cumulative) --
   * never rescaled by this component's own measured size. A reference-
   * letter coordinate (`L`/`C`/`R` for x, `T`/`C`/`B` for y, e.g. `"B1"`)
   instead SETS the cursor to a position relative to this component's
   * own REAL measured edge, regardless of the running cursor — see
   * `oxmarkdown-core`'s `resolveLinePoints` (and its file header) for why
   * only anchors, not deltas, depend on the measured size at all. A
   * literal `"|"` entry is a pen-up BREAK -- the next point starts a
   * brand-new, visually disconnected stroke (see `oxmarkdown-core`'s
   * `LinePointsEntry`/`buildMultiSplinePath`), matching what a real SVG
   * `M` (moveto) command means. */
  points: LinePointsEntry[];
  /** `::path{width="..." height="..." start="..."}`'s own knobs -- ALL
   * optional, and all `undefined` by default (`::line` never passes
   * these), in which case `points` renders at its own literal, unscaled
   * position exactly like `::line` always does. See `oxmarkdown-core`'s
   * `fitAndPositionPoints` for the full "decoupling shape from size/
   * position" reasoning -- this component just resolves `%` specs
   * against its own real measured size (`resolveLineSize`) and the
   * `start` anchor against that same real size (`resolveLinePoints`,
   * given a single-token list) before handing everything to that
   * function. */
  targetWidth?: LineSizeSpec;
  targetHeight?: LineSizeSpec;
  start?: LinePointTokens;
};

export type WavyLineWaypointsProps = WavyLineBaseProps & {
  mode: "waypoints";
  /** `data-waypoint-id` values to look up live. */
  waypointIds: string[];
};

export type WavyLineProps = WavyLinePointsProps | WavyLineWaypointsProps;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function LinePathSvg({
  width,
  height,
  path,
  color,
  strokeWidth,
}: {
  width: number;
  height: number;
  path: string;
  color: string;
  strokeWidth: number;
}) {
  if (!path) return null;
  return (
    // `overflow: visible` -- a stroke's own width pokes strokeWidth/2
    // beyond the path's bounding box on every side, and that box IS this
    // svg's exact width/height (see `layout` below), so clipping would
    // shave off the outer edge of the line otherwise.
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

const SIZER_STYLE = { position: "absolute", inset: 0, pointerEvents: "none" } as const;

type PointsLayout = { path: string; left: number; top: number; width: number; height: number };

function WavyLinePoints({
  points,
  targetWidth,
  targetHeight,
  start,
  curve = "smooth",
  tension = 0.5,
  className,
  color = "currentColor",
  strokeWidth = 1,
}: WavyLinePointsProps) {
  // This outer, `inset: 0` wrapper exists ONLY to measure the container's
  // real pixel size (needed to resolve any anchor letters against this
  // component's own real edges -- a plain delta never needs this) -- it's
  // not the visible line element anymore. The visible svg lives in a
  // separately positioned+sized child (`layout`, below), sized to
  // exactly fit the resolved path's own bounding box, not the whole
  // container. A `<span>`, deliberately NOT a `<div>` -- `::line`/
  // `::path` only ever render this at block level, but `:line-word{...}`
  // (`websiteDirectives.tsx`) renders it INLINE, nested inside a `<p>`'s
  // own phrasing content, where a `<div>` is invalid HTML (confirmed via a
  // real repro: browsers silently "fix up" the malformed nesting during
  // SSR's raw HTML parse, which then disagrees with React's own hydration
  // expectations, throwing a real hydration-mismatch error). `position:
  // absolute`/`relative` below "blockify" a `<span>` to the exact same
  // effective layout behavior as a `<div>` regardless (CSS's own
  // positioned-element blockification rule), so this is a pure HTML-
  // validity fix with zero visual difference for the existing block-level
  // callers.
  const { ref, size } = useElementSize<HTMLSpanElement>();
  const [layout, setLayout] = useState<PointsLayout | null>(null);

  // Re-keyed on the points'/start's own SERIALIZED value, not the array/
  // object reference -- a directive's attrs are re-parsed fresh on every
  // render, so a plain reference dependency would recompute (and
  // re-measure nothing new) on literally every render, harmlessly but
  // wastefully.
  const pointsKey = JSON.stringify(points);
  const startKey = JSON.stringify(start);

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    // Already real pixel points, grouped into SUBPATHS (a `"break"` entry
    // starts a new one) -- literal deltas resolved directly, any anchor
    // letters resolved against this component's own real measured edges
    // (see `resolveLinePoints`'s own header for why this is no longer a
    // normalize-then-rescale step). No separate "origin" to fold in --
    // deltas resolve relative to a cursor that itself starts at this
    // component's own real `(0,0)` top-left corner, and keeps running
    // continuously across a break (only whether a segment gets DRAWN
    // changes).
    let subpaths = resolveLinePoints(points, size.width, size.height);
    const totalPoints = subpaths.reduce((n, group) => n + group.length, 0);
    if (totalPoints < 2) {
      setLayout(null);
      return;
    }
    // `::path{width=... height=... start=...}`'s own decoupled shape/size/
    // position knobs -- all `undefined` for a plain `::line`, in which
    // case this is a complete no-op (see `fitAndPositionPoints`'s own
    // header). `%` specs and the `start` anchor both resolve against this
    // component's OWN real measured size, same as any other anchor here.
    // `start` is always exactly ONE point (never a break), so `[0][0]`
    // reaches into the single resolved subpath's own single point.
    const targetWidthPx = resolveLineSize(targetWidth, size.width);
    const targetHeightPx = resolveLineSize(targetHeight, size.height);
    const startPoint = start ? resolveLinePoints([start], size.width, size.height)[0]?.[0] : undefined;
    subpaths = fitAndPositionPoints(subpaths, targetWidthPx, targetHeightPx, startPoint);
    const box = boundingBox(subpaths.flat());
    // The path can dip outside its own first point (negative deltas, or
    // an anchor placed "before" an earlier point) -- shift everything by
    // (-minX, -minY) so every coordinate fed to the SVG is >= 0, and
    // compensate by positioning the wrapper at that same (minX, minY)
    // (already absolute pixels within the container, so no extra origin
    // offset is needed here). Applied per-subpath, preserving the grouping
    // `buildMultiSplinePath` needs to draw each stroke separately.
    const shifted = subpaths.map((group) => group.map((p) => ({ x: p.x - box.minX, y: p.y - box.minY })));
    setLayout({
      path: buildMultiSplinePath(shifted, curve, tension),
      left: box.minX,
      top: box.minY,
      width: Math.max(1, box.maxX - box.minX),
      height: Math.max(1, box.maxY - box.minY),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, pointsKey, startKey, targetWidth?.kind, targetWidth?.value, targetHeight?.kind, targetHeight?.value, curve, tension]);

  return (
    <span ref={ref} style={SIZER_STYLE} aria-hidden="true">
      {layout && (
        <span
          className={className}
          style={{
            position: "absolute",
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
            pointerEvents: "none",
          }}
        >
          <LinePathSvg width={layout.width} height={layout.height} path={layout.path} color={color} strokeWidth={strokeWidth} />
        </span>
      )}
    </span>
  );
}

function WavyLineWaypoints({
  waypointIds,
  curve = "smooth",
  tension = 0.5,
  className,
  color = "currentColor",
  strokeWidth = 1,
}: WavyLineWaypointsProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [path, setPath] = useState("");
  const idsKey = waypointIds.join(",");

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    const wrapperRect = ref.current?.getBoundingClientRect();
    if (!wrapperRect) return;
    const pixelPoints: LinePoint[] = [];
    for (const id of waypointIds) {
      const el = document.querySelector(`[data-waypoint-id="${id}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      pixelPoints.push({
        x: rect.left + rect.width / 2 - wrapperRect.left,
        y: rect.top + rect.height / 2 - wrapperRect.top,
      });
    }
    setPath(buildSplinePath(pixelPoints, curve, tension));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, idsKey, curve, tension]);

  return (
    <div ref={ref} className={className} style={SIZER_STYLE} aria-hidden="true">
      {size && <LinePathSvg width={size.width} height={size.height} path={path} color={color} strokeWidth={strokeWidth} />}
    </div>
  );
}

export function WavyLine(props: WavyLineProps) {
  if (props.mode === "waypoints") return <WavyLineWaypoints {...props} />;
  return <WavyLinePoints {...props} />;
}
