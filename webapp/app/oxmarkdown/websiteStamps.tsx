/**
 * `::stamp{name="..."}` illustrations — unlike `::icon{...}` (small, often
 * inline-drawn placeholder glyphs, see `websiteIcons.tsx`), a stamp is a
 * complete, hand-designed postage-stamp graphic (perforated edge, frame,
 * price glyph, and artwork all baked into ONE SVG file per name) supplied
 * as real static assets under `public/guides/` — nothing here composes a
 * frame around it. Each stamp ships as a LIGHT/DARK pair with matching
 * colors from the app's existing palette (see `root.css`'s
 * `--surface-night-*`/`--plum-*`), swapped via `prefers-color-scheme`
 * through a plain `<picture>` — no JS, consistent with the rest of the
 * app's dark-mode convention (no in-app toggle).
 */
import type { CSSProperties } from "react";
import "../styles/website.css";

/** Registered stamp illustrations, by name — referenced from markdown as
 * `::stamp{name="mtn"}`. Add a new pair of files under
 * `webapp/public/guides/` and one entry here; nothing else needs to
 * change. */
const WEBSITE_STAMPS: Record<string, { light: string; dark: string }> = {
  coffee: { light: "/guides/stamp-coffee.svg", dark: "/guides/stamp-coffee-dark.svg" },
  mtn: { light: "/guides/stamp-mtn.svg", dark: "/guides/stamp-mtn-dark.svg" },
  nopal: { light: "/guides/stamp-nopal.svg", dark: "/guides/stamp-nopal-dark.svg" },
  quail: { light: "/guides/stamp-quail.svg", dark: "/guides/stamp-quail-dark.svg" },
};

export function WebsiteStamp({
  name,
  rotate = 0,
  float = "inline",
  waypointId,
}: {
  name: string;
  /** Degrees — matches the mockups' slightly-tilted stamp cards. The
   * `quail` stamp is already drawn pre-rotated in its own artwork; this is
   * for the others / an additional tweak on top. */
  rotate?: number;
  float?: "left" | "right" | "inline";
  waypointId?: string;
}) {
  const asset = WEBSITE_STAMPS[name];
  const style = { "--stamp-rotate": `${rotate}deg` } as CSSProperties;
  const floatClass = `website-stamp-float-${float}`;

  if (!asset) {
    // Not-yet-supplied stamp -- a visible, labeled placeholder rather than
    // silently rendering nothing, same convention `WebsiteIcon` uses.
    return (
      <span
        className={`website-stamp-missing ${floatClass}`}
        style={style}
        title={`stamp "${name}" not registered yet`}
        data-waypoint-id={waypointId || undefined}
      >
        stamp: {name || "?"}
      </span>
    );
  }

  return (
    <picture
      className={`website-stamp ${floatClass}`}
      style={style}
      data-waypoint-id={waypointId || undefined}
    >
      <source srcSet={asset.dark} media="(prefers-color-scheme: dark)" />
      <img src={asset.light} alt="" className="website-stamp-img" />
    </picture>
  );
}
