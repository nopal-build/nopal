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
import type { CSSProperties, FC } from "react";
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
};

/** Inline placeholders for anything not designed yet. */
const WEBSITE_ICON_PLACEHOLDERS: Record<string, IconComponent> = {
  circle: PlaceholderCircle,
  arrow: PlaceholderArrow,
  blob: PlaceholderBlob,
};

const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 20, md: 32, lg: 64 };

export function WebsiteIcon({
  name,
  size = "md",
  className,
  /** Set when this icon should also be reachable by the (future) wavy
   * connector overlay — rendered as a plain `data-waypoint-id` attribute
   * so that piece of template UI can find it later with no changes needed
   * here. See `websiteDirectives.tsx`'s `waypoint` entry for the
   * standalone-marker sibling of this. */
  waypointId,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  waypointId?: string;
}) {
  const px = SIZE_PX[size];

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
