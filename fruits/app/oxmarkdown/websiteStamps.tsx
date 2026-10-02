/**
 * DUPLICATED from webapp/app/oxmarkdown/websiteStamps.tsx -- see
 * `websiteIcons.tsx`'s own header comment here for why this whole
 * directory is duplicated. Not shared; keep both copies in sync by hand.
 *
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

/** Every registered `::stamp{name="..."}` name -- also drives the Stamp
 * Tracing Paper's own `name` dropdown (`/maker/stamps/scratch`). Add a new
 * stamp by adding one entry to `WEBSITE_STAMPS` above; this picks it up
 * automatically. */
export const WEBSITE_STAMP_NAMES = Object.keys(WEBSITE_STAMPS);

export function WebsiteStamp({
  name,
  rotate = 0,
  float = "inline",
  waypointId,
  forcedScheme,
}: {
  name: string;
  /** Degrees — matches the mockups' slightly-tilted stamp cards. The
   * `quail` stamp is already drawn pre-rotated in its own artwork; this is
   * for the others / an additional tweak on top. */
  rotate?: number;
  float?: "left" | "right" | "inline";
  waypointId?: string;
  /** Forces which asset of the light/dark pair renders, bypassing the
   * `<picture>`/`<source media="...">` selection below entirely -- for the
   * Vault website editor's / `/maker/stamps/scratch` guide's own preview
   * toggle (`.website-preview-force-{light,dark}`). That toggle is a pure
   * CSS trick (an ancestor class + higher-specificity overrides), and
   * `<source media="(prefers-color-scheme: dark)">` is NOT a CSS rule at
   * all -- it's resolved by the browser's own media-query engine against
   * the ACTUAL OS/browser scheme at parse time, completely outside the
   * page's CSS cascade. No selector, however specific, can override which
   * `<source>` a `<picture>` picked -- so previewing the opposite scheme
   * needs this explicit prop instead, which swaps the rendered `<img>`
   * directly in JS/markup rather than relying on the browser to re-decide.
   * Leave undefined for the real public `/v2` page -- that's the one place
   * this SHOULD keep following the visitor's actual OS setting. */
  forcedScheme?: "light" | "dark";
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

  if (forcedScheme) {
    // Same TWO-element contract as the `<picture>` case below (an outer
    // sizing wrapper + an inner filling `<img>`), NOT one element wearing
    // both classes -- REAL BUG found here: `.ox-content img { max-width:
    // 100% }` (oxmarkdown.css) is a descendant selector (one class + one
    // element, more specific than `.website-stamp`'s own plain class), so
    // it silently wins over `.website-stamp`'s `max-width: 132px` on any
    // element that's BOTH an `<img>` AND carries `.website-stamp` directly
    // -- blowing the stamp up to full width. In the `<picture>` case that
    // global reset only ever lands on the INNER `.website-stamp-img`,
    // which is harmless (the outer `<picture>` -- not an `<img>` tag, so
    // the reset can't touch it -- is what actually does the 132px
    // capping). Keeping that same split here, with a plain `<span>`
    // standing in for `<picture>` (no `<source>` needed once the asset's
    // already resolved), avoids the collision the exact same way.
    return (
      <span
        className={`website-stamp ${floatClass}`}
        style={style}
        data-waypoint-id={waypointId || undefined}
      >
        <img src={asset[forcedScheme]} alt="" className="website-stamp-img" />
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
