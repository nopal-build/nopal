/**
 * A small, named registry of illustrations used by the `/v2` website
 * templates' `::icon{name="..."}` directive — small inline glyphs or
 * standalone decorative marks, as opposed to `::stamp{name="..."}`'s
 * complete postage-stamp graphics (see `websiteStamps.tsx`).
 *
 * Two tiers, checked in order:
 *   1. `WEBSITE_ICON_FILES` — real, already-designed SVGs served from
 *      `public/guides/` (e.g. `sun-home`, the small sun/roof mark used
 *      near the bottom of every page). Preferred whenever a name is
 *      registered here.
 *   2. `WEBSITE_ICON_PLACEHOLDERS` — plain inline-drawn shapes standing in
 *      for anything not designed yet.
 * A name in neither falls back to a visible, labeled dashed placeholder,
 * so referencing an icon ahead of the real asset landing never breaks the
 * page, it just looks obviously unfinished.
 */
import { useEffect, useState, type CSSProperties, type FC, type ReactNode } from "react";
import { adjustForElementSize, resolveLinePoints, type LinePointTokens } from "oxmarkdown-core";
import { useElementSize } from "./WavyLine";
// No `import "../styles/website.css"` here (unlike fruits' copy) --
// this module is ONLY ever reached via `WebsitePageView`, which is ONLY
// ever reached under `/v2/*` -- `routes/v2.tsx`'s own `links()` already
// guarantees `website.css` is loaded (as a real render-blocking `<link>`,
// not a JS-injected dev-mode `<style>` tag) before this ever renders. A
// second, redundant plain import here doesn't just duplicate bytes -- it
// re-introduces a SECOND, later-arriving copy of the same rules via
// Vite's dev-mode CSS-injection path, competing with the first and
// producing an extra flash/jump right after the blocking `<link>` had
// already settled (found via a real repro: sampling a live
// `:::section-title{...}` heading's position every 50ms after
// navigation showed a clean single jump with only the `?url` link, and
// an extra SECOND jump once this import was still also present).

type IconComponent = FC<{ className?: string }>;

const PlaceholderCircle: IconComponent = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const PlaceholderArrow: IconComponent = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 20V4M12 4L5 11M12 4l7 7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PlaceholderBlob: IconComponent = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

/** Real, already-designed assets under `webapp/public/guides/` — add a new
 * file and one entry here; nothing else needs to change. */
const WEBSITE_ICON_FILES: Record<string, string> = {
  "sun-home": "/guides/sun-home.svg",
  "mountaineer-coffee": "/guides/mountaineer-coffee.svg",
};

/** Inline placeholders for anything not designed yet. */
const WEBSITE_ICON_PLACEHOLDERS: Record<string, IconComponent> = {
  circle: PlaceholderCircle,
  arrow: PlaceholderArrow,
  blob: PlaceholderBlob,
};

/** Every registered `::icon{name="..."}` name, grouped by tier -- also
 * drives the Icon Tracing Paper's own `name` dropdown
 * (`/maker/stamps/scratch`, fruits-only), so that list can never drift out
 * of sync with what's actually registered here. Add a new icon by adding
 * one entry to `WEBSITE_ICON_FILES` (a real asset) or
 * `WEBSITE_ICON_PLACEHOLDERS` (an inline-drawn stand-in) above -- both
 * lists below pick it up automatically, nothing else needs to change. */
export const WEBSITE_ICON_FILE_NAMES = Object.keys(WEBSITE_ICON_FILES);
export const WEBSITE_ICON_PLACEHOLDER_NAMES = Object.keys(WEBSITE_ICON_PLACEHOLDERS);

const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 20, md: 32, lg: 64 };

type WebsiteIconProps = {
  name: string;
  /** `"sm"`/`"md"`/`"lg"` resolve to the fixed presets above; a plain
   * NUMBER is a literal pixel width instead -- see `websiteDirectives.tsx`'s
   * `parseIconSize` for the `::icon{size="..."}` string -> this parsing. */
  size?: "sm" | "md" | "lg" | number;
  className?: string;
  /** Set when this icon should also be reachable by the (future) wavy
   * connector overlay — rendered as a plain `data-waypoint-id` attribute
   * so that piece of template UI can find it later with no changes needed
   * here. See `websiteDirectives.tsx`'s `waypoint` entry for the
   * standalone-marker sibling of this. */
  waypointId?: string;
  /** `::icon{position="x,y"}`'s own parsed single point (see
   * `websiteDirectives.tsx`'s `parseIconPosition`), or `undefined` for an
   * icon with no `position` at all. Resolved against this icon's OWN
   * real measured container size -- the EXACT SAME anchor-letter
   * (`L`/`C`/`R`/`T`/`C`/`B`) + plain-literal-pixel-delta system
   * `::line{points="..."}`/`::path{points="..."}` already use
   * (`oxmarkdown-core`'s `resolveLinePoints`), not a separate normalized/
   * percentage one -- see `PositionedWebsiteIcon` below for why this
   * used to be different and isn't anymore. */
  position?: LinePointTokens;
};

/** The actual glyph -- unaware of `position` entirely; either rendered
 * directly inline (`WebsiteIcon`, below, when there's no `position`) or
 * wrapped by `PositionedWebsiteIcon` (below) when there is one. */
function WebsiteIconGlyph({ name, size = "md", className, waypointId }: Omit<WebsiteIconProps, "position">) {
  const px = typeof size === "number" ? size : SIZE_PX[size];

  const fileSrc = WEBSITE_ICON_FILES[name];
  if (fileSrc) {
    // A real file's own aspect ratio may not be square (e.g. `sun-home`)
    // -- only constrain width, let height follow naturally rather than
    // forcing a square box that would distort it.
    return (
      <img
        src={fileSrc}
        alt=""
        className={`website-icon website-icon-file ${className ?? ""}`}
        style={{ width: px, height: "auto" }}
        data-waypoint-id={waypointId || undefined}
      />
    );
  }

  const style: CSSProperties = { width: px, height: px };
  const Placeholder = WEBSITE_ICON_PLACEHOLDERS[name];
  if (Placeholder) {
    return (
      <span className={`website-icon ${className ?? ""}`} style={style} data-waypoint-id={waypointId || undefined}>
        <Placeholder className="website-icon-svg" />
      </span>
    );
  }

  return (
    <span
      className={`website-icon website-icon-placeholder ${className ?? ""}`}
      style={{ ...style, fontSize: Math.max(8, px / 4) }}
      title={`icon "${name}" not registered yet`}
      data-waypoint-id={waypointId || undefined}
    >
      {name.slice(0, 2) || "?"}
    </span>
  );
}

/** `::icon{position="x,y"}` -- absolutely positions `children` (a single
 * `WebsiteIconGlyph`) against THIS component's own real measured
 * container size, via the SAME `ResizeObserver`-driven measuring hook
 * (`useElementSize`) and real-pixel-anchor math (`resolveLinePoints`)
 * `WavyLine.tsx`'s `::line`/`::path` support already uses -- a single
 * point has no multi-point "shape" for a container resize to distort the
 * way a wavy line's would, but it has the EXACT SAME "the same authored
 * number means a different real distance in every differently-sized
 * container" problem a normalized/percentage box has, which is why this
 * went through the same literal-pixel fix `::line` already got instead of
 * keeping its own separate, percentage-based system (a real, reported
 * confusion: `R10` reading like "10px from the right", matching `::line`'s
 * own convention, when it actually meant "10% of a fixed nominal box").
 *
 * ALSO measures the icon glyph's OWN rendered size (`elementRef`/
 * `elementSize`, below) -- not just the container -- and runs the result
 * through `adjustForElementSize` (`oxmarkdown-core`): an `R`/`B`/`C`
 * anchor describes WHICH EDGE of the icon itself should land at that
 * container edge (its right/bottom edge, or its center), not just its
 * top-left corner the way a bare `resolveLinePoints` call alone would
 * always place it (a real, reported gap: `R0,T0` used to put the icon's
 * top-LEFT corner at the container's top-right corner, always overflowing
 * further right, instead of flush against it).
 *
 * Client-only by nature (real DOM measurement) -- renders nothing VISIBLE
 * at all until its first post-mount measurement, same convention
 * `WavyLine`'s own `mode="points"` already uses, for the same reason (no
 * special-casing needed for SSR-then-hydrate; a flash from unpositioned to
 * positioned would be strictly worse than a brief absence) -- see the
 * `visibility: "hidden"` comment below for why the glyph is still always
 * MOUNTED (just not painted) rather than conditionally rendered. */
function PositionedWebsiteIcon({ position, children }: { position: LinePointTokens; children: ReactNode }) {
  const { ref: containerRef, size: containerSize } = useElementSize<HTMLSpanElement>();
  const { ref: elementRef, size: elementSize } = useElementSize<HTMLSpanElement>();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  // Re-keyed on `position`'s own SERIALIZED value, not the object
  // reference -- `websiteDirectives.tsx` re-parses `attrs.position` fresh
  // on every render, so a plain reference dependency would recompute
  // (and re-measure nothing new) on literally every render, harmlessly
  // but wastefully -- same convention `WavyLine`'s own `pointsKey` uses.
  const positionKey = JSON.stringify(position);

  useEffect(() => {
    if (!containerSize || containerSize.width === 0 || containerSize.height === 0) return;
    if (!elementSize || elementSize.width === 0 || elementSize.height === 0) return;
    const resolved = resolveLinePoints([position], containerSize.width, containerSize.height)[0]?.[0];
    if (!resolved) return;
    setPoint(adjustForElementSize(position, resolved, elementSize.width, elementSize.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize, elementSize, positionKey]);

  return (
    <span ref={containerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
      {/* ALWAYS mounted (not `{point && (...)}` like before this needed to
          also measure ITSELF) -- `elementRef` needs it in the DOM to
          report a real size at all, which `point` now depends on.
          `visibility: "hidden"` (NOT `display: none`) until `point` is
          known -- hidden elements still get an accurate `ResizeObserver`
          size, so this measures correctly with no flash: nothing PAINTS
          at the wrong (unadjusted) spot first, same "nothing visible
          until the first real measurement resolves" contract as before. */}
      <span
        ref={elementRef}
        style={{
          position: "absolute",
          left: point?.x ?? 0,
          top: point?.y ?? 0,
          // `width: "max-content"` -- WITHOUT this, a `position: absolute` span
          // with `left` set but no explicit width shrinks its own
          // shrink-to-fit available width to `(container width - left)`
          // (ordinary CSS absolute-positioning behavior), which starves any
          // `max-width: 100%` img inside it (`.ox-content img`, oxmarkdown.css)
          // down to whatever sliver of space is left -- a real, reproduced
          // bug: an icon anchored close to its container's right edge
          // (`R10`) rendered at ~10px wide instead of its real `size` once
          // this positioning switched from percentage- to real-pixel-based,
          // landing genuinely near that edge for the first time.
          width: "max-content",
          // `display: "flex"` -- the SAME inherited-`line-height`-strut bug
          // found (and fixed) on `::badge{position=...}`'s own identical
          // wrapper (`websiteBadge.tsx`'s `PositionedWebsiteBadge`): a plain
          // `position: absolute` span with no `display` set still sizes its
          // own auto height via ordinary INLINE line-box math, which
          // factors in this span's own INHERITED `line-height` (`.ox-content
          // { line-height: 1.2 }`) as an invisible "strut" regardless of the
          // icon's own real size -- a flex formatting context has no line
          // boxes/struts at all, so this span's own height becomes exactly
          // its single child's real height, nothing inherited.
          display: "flex",
          visibility: point ? "visible" : "hidden",
        }}
      >
        {children}
      </span>
    </span>
  );
}

export function WebsiteIcon({ position, ...glyphProps }: WebsiteIconProps) {
  if (position) {
    return (
      <PositionedWebsiteIcon position={position}>
        <WebsiteIconGlyph {...glyphProps} />
      </PositionedWebsiteIcon>
    );
  }
  return <WebsiteIconGlyph {...glyphProps} />;
}
