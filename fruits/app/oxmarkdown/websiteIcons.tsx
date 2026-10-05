/**
 * DUPLICATED from webapp/app/oxmarkdown/websiteIcons.tsx -- needed here too
 * so the Stamps guide's `scratch` playground (`/maker/stamps/scratch`) can
 * render the real `/v2` website directives against fruits' own (full)
 * `OxRenderer`. Not shared; keep both copies in sync by hand -- same
 * webapp/fruits duplication convention `OxRenderer.tsx`/`oxmarkdown.css`
 * already use, just in the other direction (this one originated in
 * webapp, not fruits).
 *
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
import { resolveLinePoints, type LinePointTokens } from "oxmarkdown-core";
import { useElementSize } from "./WavyLine";
import "../styles/website.css";

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
 * (`/maker/stamps/scratch`), so that list can never drift out of sync with
 * what's actually registered here. Add a new icon by adding one entry to
 * `WEBSITE_ICON_FILES` (a real asset) or `WEBSITE_ICON_PLACEHOLDERS` (an
 * inline-drawn stand-in) above -- both lists below pick it up
 * automatically, nothing else needs to change. */
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
 * Client-only by nature (real DOM measurement) -- renders nothing at all
 * until its first post-mount measurement, same convention `WavyLine`'s
 * own `mode="points"` already uses, for the same reason (no special-
 * casing needed for SSR-then-hydrate; a flash from unpositioned to
 * positioned would be strictly worse than a brief absence). */
function PositionedWebsiteIcon({ position, children }: { position: LinePointTokens; children: ReactNode }) {
  const { ref, size } = useElementSize<HTMLSpanElement>();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  // Re-keyed on `position`'s own SERIALIZED value, not the object
  // reference -- `websiteDirectives.tsx` re-parses `attrs.position` fresh
  // on every render, so a plain reference dependency would recompute
  // (and re-measure nothing new) on literally every render, harmlessly
  // but wastefully -- same convention `WavyLine`'s own `pointsKey` uses.
  const positionKey = JSON.stringify(position);

  useEffect(() => {
    if (!size || size.width === 0 || size.height === 0) return;
    const resolved = resolveLinePoints([position], size.width, size.height)[0]?.[0];
    if (resolved) setPoint(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, positionKey]);

  return (
    <span ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
      {point && (
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
        <span style={{ position: "absolute", left: point.x, top: point.y, width: "max-content" }}>{children}</span>
      )}
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
