/**
 * DUPLICATED from webapp/app/oxmarkdown/WavyLine.tsx -- see
 * `websiteIcons.tsx`'s own header comment for why this whole directory is
 * duplicated. Not shared; keep both copies in sync by hand. The pure math
 * this leans on (`buildSplinePath`/`mapNormalizedPoint`/
 * `resolveLinePoints`/`boundingBox`) IS genuinely shared, from
 * `oxmarkdown-core` -- only this React wrapper is duplicated.
 *
 * The shared "wavy line" primitive — one rendering approach, two ways to
 * get its points:
 *   - `mode="points"` (default) — fixed points normalized to a `0-100`
 *     (x) / `0-viewBoxHeight` (y) box, mapped to real pixels against this
 *     component's OWN measured size on mount and on every real resize.
 *     Used by `::line{points="..."}` inside `:::section-title{...}`.
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
 * in real px while only horizontal spacing grows with width.
 *
 * Client-only by nature (real DOM measurement) — renders no path at all
 * until its first post-mount measurement, matching plain SSR-then-
 * hydrate behavior with no special-casing needed here.
 */
import { useEffect, useRef, useState } from "react";
import {
  boundingBox,
  buildSplinePath,
  mapNormalizedPoint,
  resolveLinePoints,
  type LineCurveKind,
  type LinePoint,
  type LinePointTokens,
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
  /** Parsed `points="..."` tokens (`oxmarkdown-core`'s `parseLinePoints`)
   * — "a line is drawn from one end to the other": a cursor starts at the
   * box's own top-left corner and walks forward, per-axis, per point.
   * A plain-number coordinate moves the cursor BY that amount from
   * wherever it already was (cumulative). A reference-letter coordinate
   * (`L`/`C`/`R` for x, `T`/`C`/`B` for y, e.g. `"B1"`) instead SETS the
   * cursor to that pixel-referenceable position within the box,
   * regardless of the running cursor — see `oxmarkdown-core`'s
   * `resolveLinePoints`. Normalized to a `0-100` (x) / `0-viewBoxHeight`
   * (y) box. */
  points: LinePointTokens[];
  viewBoxHeight?: number;
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
  viewBoxHeight = 40,
  curve = "smooth",
  tension = 0.5,
  className,
  color = "currentColor",
  strokeWidth = 1,
}: WavyLinePointsProps) {
  // This outer, `inset: 0` div exists ONLY to measure the container's
  // real pixel size (needed to convert normalized units to px) -- it's
  // not the visible line element anymore. The visible svg lives in a
  // separately positioned+sized child (`layout`, below), sized to
  // exactly fit the resolved path's own bounding box, not the whole
  // container.
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [layout, setLayout] = useState<PointsLayout | null>(null);

  // Re-keyed on the points/viewBoxHeight's own SERIALIZED value, not the
  // array reference -- a directive's attrs are re-parsed fresh on every
  // render, so a plain array-reference dependency would recompute (and
  // re-measure nothing new) on literally every render, harmlessly but
  // wastefully.
  const pointsKey = JSON.stringify(points);

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    const resolved = resolveLinePoints(points, viewBoxHeight);
    if (resolved.length < 2) {
      setLayout(null);
      return;
    }
    // Resolved points are already absolute within the box's own `0-100`/
    // `0-viewBoxHeight` normalized space (anchors resolve directly to a
    // position in that space; deltas resolve relative to a cursor that
    // itself starts at that space's own `(0,0)`) -- no separate "origin"
    // to fold in anymore, unlike the plain-delta-only version of this.
    const pixelPoints = resolved.map((p) => mapNormalizedPoint(p, viewBoxHeight, size.width, size.height));
    const box = boundingBox(pixelPoints);
    // The path can dip outside its own first point (negative deltas, or
    // an anchor placed "before" an earlier point) -- shift everything by
    // (-minX, -minY) so every coordinate fed to the SVG is >= 0, and
    // compensate by positioning the wrapper at that same (minX, minY)
    // (already absolute pixels within the container, so no extra origin
    // offset is needed here).
    const shifted = pixelPoints.map((p) => ({ x: p.x - box.minX, y: p.y - box.minY }));
    setLayout({
      path: buildSplinePath(shifted, curve, tension),
      left: box.minX,
      top: box.minY,
      width: Math.max(1, box.maxX - box.minX),
      height: Math.max(1, box.maxY - box.minY),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, pointsKey, viewBoxHeight, curve, tension]);

  return (
    <div ref={ref} style={SIZER_STYLE} aria-hidden="true">
      {layout && (
        <div
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
        </div>
      )}
    </div>
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
