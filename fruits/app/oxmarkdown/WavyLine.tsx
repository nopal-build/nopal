/**
 * DUPLICATED from webapp/app/oxmarkdown/WavyLine.tsx -- see
 * `websiteIcons.tsx`'s own header comment for why this whole directory is
 * duplicated. Not shared; keep both copies in sync by hand. The pure math
 * this leans on (`buildSplinePath`/`mapNormalizedPoint`) IS genuinely
 * shared, from `oxmarkdown-core` -- only this React wrapper is duplicated.
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
  buildSplinePath,
  mapNormalizedPoint,
  type LineCurveKind,
  type LinePoint,
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
  /** Normalized to a `0-100` (x) / `0-viewBoxHeight` (y) box — see
   * `oxmarkdown-core`'s `mapNormalizedPoint`. */
  points: LinePoint[];
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
  size,
  path,
  color,
  strokeWidth,
}: {
  size: { width: number; height: number } | null;
  path: string;
  color: string;
  strokeWidth: number;
}) {
  if (!size || !path) return null;
  return (
    <svg width={size.width} height={size.height} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

const WRAPPER_STYLE = { position: "absolute", inset: 0, pointerEvents: "none" } as const;

function WavyLinePoints({
  points,
  viewBoxHeight = 40,
  curve = "smooth",
  tension = 0.5,
  className,
  color = "currentColor",
  strokeWidth = 2,
}: WavyLinePointsProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [path, setPath] = useState("");

  // Re-keyed on the points/viewBoxHeight's own SERIALIZED value, not the
  // array reference -- a directive's attrs are re-parsed fresh on every
  // render, so a plain array-reference dependency would recompute (and
  // re-measure nothing new) on literally every render, harmlessly but
  // wastefully.
  const pointsKey = JSON.stringify(points);

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    const pixelPoints = points.map((p) => mapNormalizedPoint(p, viewBoxHeight, size.width, size.height));
    setPath(buildSplinePath(pixelPoints, curve, tension));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, pointsKey, viewBoxHeight, curve, tension]);

  return (
    <div ref={ref} className={className} style={WRAPPER_STYLE} aria-hidden="true">
      <LinePathSvg size={size} path={path} color={color} strokeWidth={strokeWidth} />
    </div>
  );
}

function WavyLineWaypoints({
  waypointIds,
  curve = "smooth",
  tension = 0.5,
  className,
  color = "currentColor",
  strokeWidth = 2,
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
    <div ref={ref} className={className} style={WRAPPER_STYLE} aria-hidden="true">
      <LinePathSvg size={size} path={path} color={color} strokeWidth={strokeWidth} />
    </div>
  );
}

export function WavyLine(props: WavyLineProps) {
  if (props.mode === "waypoints") return <WavyLineWaypoints {...props} />;
  return <WavyLinePoints {...props} />;
}
