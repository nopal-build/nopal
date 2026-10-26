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
 * templates' `::icon{name="..." primaryColor="..." secondaryColor="..."}`
 * directive — small inline glyphs or standalone decorative marks, as
 * opposed to `::stamp{name="..."}`'s complete postage-stamp graphics (see
 * `websiteStamps.tsx`).
 *
 * Three tiers, checked in order, grouped by how much of the
 * `primaryColor`/`secondaryColor` palette/swatch system (below) they
 * accept:
 *   1. `WEBSITE_ICON_FILES` — NO COLOR. Real, already-designed, already
 *      multi-toned SVGs served as a static file from `public/guides/`
 *      (today: just `sun-home`). Rendered via a plain `<img src>` --
 *      genuinely un-colorable (an `<img>`-embedded SVG never responds to
 *      CSS `color`/`fill`/`stroke` at all) -- `primaryColor`/
 *      `secondaryColor` are silently ignored for anything registered
 *      here.
 *   2. `ONE_COLOR_ICONS` — ONE COLOR. Inline-drawn (JSX, not a static
 *      file), every colored part sharing the SAME `color` prop, which
 *      `primaryColor` (if given) overrides -- `secondaryColor` has no
 *      effect here. Each entry owns its own `defaultColor`, used whenever
 *      `primaryColor` is omitted, so authoring `::icon{name="arrow"}`
 *      with zero color attributes keeps working exactly as before.
 *   3. `TWO_COLOR_ICONS` — TWO COLORS. Inline-drawn, with a `primary` AND
 *      a `secondary` prop, independently overridden by `primaryColor`/
 *      `secondaryColor` and independently defaulted
 *      (`defaultPrimary`/`defaultSecondary`) when omitted.
 * A name in none of the three falls back to a visible, labeled dashed
 * placeholder, so referencing an icon ahead of the real asset/design
 * landing never breaks the page, it just looks obviously unfinished.
 *
 * `primaryColor`/`secondaryColor` are resolved by the CALLER
 * (`websiteDirectives.tsx`'s `icon` registry entry) through the page's own
 * `::swatch`/`::palette` registry (`resolveSwatchRole`, role `"color"`) --
 * the SAME open palette/swatch vocabulary `:::section{surface="..."}`/
 * `::line{color="..."}` etc. already use elsewhere in this directive set
 * -- before ever reaching this file; by the time `WebsiteIcon` sees them
 * they're already a plain, final CSS color value (or `undefined`, meaning
 * "use this icon's own default").
 */
import { useEffect, useState, type CSSProperties, type FC, type ReactNode } from "react";
import { adjustForElementSize, resolveLinePoints, type LinePointTokens } from "oxmarkdown-core";
import { useElementSize } from "./WavyLine";
import "../styles/website.css";

type OneColorIconComponent = FC<{ className?: string; color: string }>;
type TwoColorIconComponent = FC<{ className?: string; primary: string; secondary: string }>;

const ArrowIcon: OneColorIconComponent = ({ className, color }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 20V4M12 4L5 11M12 4l7 7"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CircleIcon: OneColorIconComponent = ({ className, color }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8" fill={color} />
  </svg>
);

const MountaineerCoffeeIcon: OneColorIconComponent = ({ className, color }) => (
  <svg className={className} width="32" height="70" viewBox="0 0 32 70" fill="none" aria-hidden="true">
    <path
      d="M8.47707 18.1707C8.47707 18.1707 0.500001 20.6951 0.500001 25.3232C0.500001 31.0716 8.04483 37.945 8.04483 37.945C12.5155 36.5426 18.9421 35.4208 18.9421 38.7866C18.9421 42.1525 16.4273 58.4206 13.9126 66.5548M13.9126 66.5548H10.9787C11.9567 60.6646 13.9126 48.6317 13.9126 47.622M13.9126 66.5548C13.9126 66.5548 16.9698 65.8976 18.1038 66.5548C19.2378 67.212 18.9421 69.5 18.9421 69.5C18.9421 69.5 16.6433 69.5 15.1703 69.5M13.9126 66.5548C13.9126 66.5548 16.8468 67.3964 15.1703 69.5M8.04483 37.945C6.78784 34.1586 6.78784 27.8476 6.78784 22.7988C6.78784 20.9837 7.41177 19.362 8.47707 18.1707M8.04483 69.5C8.04483 69.5 12.3876 69.5 15.1703 69.5M10.9787 16.4879C10.9787 16.4879 8.88249 9.89913 8.88249 5.54884C8.88249 2.60369 11.0966 0.513123 13.9126 0.500036C18.4721 0.478847 19.7791 9.75619 18.9415 12.2805M8.47707 18.1707C9.15012 17.4181 9.99934 16.8372 10.9787 16.4879C12.2076 16.0496 13.4827 16.0974 14.6606 16.4879M16.369 24.7234C19.3214 24.4298 19.4355 23.5 19.4925 22.1543C19.4525 21.9485 19.4089 21.7427 19.3616 21.5367C18.8399 19.266 16.9307 17.2405 14.6606 16.4879M19.3616 21.5367C19.3616 21.5367 28.5802 24.9626 31.0961 19.8536C33.6119 14.7447 23.5524 13.1219 23.5524 13.1219M18.9415 12.2805C18.1038 14.8049 16.45 12.1127 15.1703 13.122C13.754 14.2391 14.6606 16.4879 14.6606 16.4879M23.5524 13.1219L24.3907 15.6463L21.0377 16.9085L18.9415 12.2805L22.7142 10.5975L23.5524 13.1219Z"
      stroke={color}
    />
  </svg>
);

/** Two-tone quail — a hand-traced illustration whose shading already only
 * ever used two real colors (`#EDE4DA`, the body/eye; `#E5D6C5`, the
 * shadow/accent shapes), so it maps cleanly onto `primary`/`secondary`
 * with no redesign. */
const QuailWalkingIcon: TwoColorIconComponent = ({ className, primary, secondary }) => (
  <svg className={className} viewBox="0 0 99 65" fill="none" aria-hidden="true">
    <path
      d="M17.7922 39.481C9.85268 44.6465 0 52.4904 0 52.4904L5.73943 50.0033L0.765257 54.2122L10.9049 48.8554C10.9049 48.8554 18.1982 47.1873 22.9577 46.9423C25.2707 46.8232 26.5895 47.224 28.8884 46.9423C30.8672 46.6998 31.88 46.0032 33.8626 45.7944C35.5715 45.6144 38.2628 45.7944 38.2628 45.7944C38.2628 45.7944 35.0105 54.1166 33.8626 54.7861C32.84 55.006 31.1842 54.7861 31.1842 54.7861L32.5234 56.1253V58.4211C32.5234 58.4211 32.1868 60.2219 32.5234 61.2908C33.0956 63.1077 34.3703 63.8866 36.1584 64.5432C37.8802 64.5432 39.656 63.7494 41.8978 63.9692C43.0352 64.0807 44.3849 64.3519 44.3849 64.3519C44.3849 64.3519 43.8253 62.8213 42.6631 62.8213C41.8978 62.8213 37.5932 63.1083 36.1584 62.4387C35.0564 61.2352 35.1018 60.0503 35.0105 58.4211C34.8048 54.7515 39.2194 50.0033 39.2194 50.0033C39.2194 50.0033 41.4298 49.5545 42.6631 48.8554C44.1804 47.9953 44.2751 46.3875 45.9154 45.7944C47.3206 45.2863 49.7417 45.7944 49.7417 45.7944L53.4245 45.1726L57.1073 44.5508L58.3508 47.5162C58.3508 47.5162 58.8333 46.1176 60.0727 46.9423C62.1328 48.3131 61.5526 50.4605 63.1337 52.4904C63.8042 53.3513 69.734 56.7949 71.3602 58.4211C71.2906 59.6004 70.4036 61.2908 70.4036 61.2908L73.082 59.9516C73.082 59.9516 74.6566 60.9045 75.7604 61.2908C77.7463 61.9858 81.1172 61.8648 81.1172 61.8648C81.1172 61.8648 84.6115 61.6885 86.6653 61.2908C86.6653 59.9516 89.9177 60.2386 89.9177 60.2386C89.9177 60.2386 87.9785 59.4264 86.6653 59.1864C85.9957 59.064 82.4934 60.4454 79.5867 60.1429C78.071 59.9852 77.5086 60.1722 75.5691 59.1864C72.7418 57.7493 68.8322 54.3352 68.1078 52.873C67.3835 51.4108 67.5244 50.3193 66.96 48.8554C66.3705 47.3265 66.0444 47.2209 65.2381 45.7944C63.7464 43.1551 63.612 40.4376 64.7598 38.0462C66.2904 36.6113 68.7924 34.6245 70.9776 31.2545C72.4042 29.0544 74.2304 23.6205 75.7604 18.6278C76.3077 16.8419 76.016 15.5576 77.0996 14.0362C77.5765 13.3666 82.839 11.3578 85.3261 11.3578C85.8044 11.9318 88.1958 12.3144 88.1958 12.3144C88.1958 12.3144 88.1958 9.06206 86.6653 9.06206C86.7356 7.92379 86.6015 7.08515 88.1958 6.57498C89.7901 6.06481 93.3231 5.50362 94.7005 7.34023C96.4223 9.636 93.9353 10.9752 95.6571 11.9318C97.3789 12.8883 98.5268 10.9752 98.9094 8.48812C99.2155 6.49845 95.7209 4.98069 93.9353 4.47052C92.1497 3.96035 88.9611 4.47052 88.9611 4.47052C88.9611 4.47052 88.1339 3.2061 87.4306 2.55738C85.9807 1.22001 84.7491 0.945136 82.839 0.452924C79.1315 -0.502471 76.7117 0.166436 73.082 1.40949C68.5534 2.96043 65.7164 5.33144 62.9424 8.48812C62.438 9.06206 58.9346 9.8975 56.4377 10.9752C55.9314 11.1937 51.4599 14.5089 45.9154 18.1933C40.9843 21.47 35.2045 24.9187 30.6103 28.5761C25.6777 32.5028 23.1594 35.9891 17.7922 39.481Z"
      fill={primary}
    />
    <path
      d="M98.9091 8.48794C99.2152 6.49827 95.7205 4.98051 93.9349 4.47034C91.9582 3.90557 88.5784 4.18338 87.6215 5.13996C87.239 5.90522 88.1955 6.5748 88.1955 6.5748C88.1955 6.5748 92.9783 5.04429 94.7002 7.34006C96.422 9.63583 93.9349 10.975 95.6567 11.9316C97.3786 12.8882 98.5264 10.975 98.9091 8.48794Z"
      fill={secondary}
    />
    <path
      d="M51.8477 18.5321C51.8477 18.5321 55.8146 17.1602 57.5871 18.5321C58.8953 19.5446 59.4046 22.3584 59.4046 22.3584C59.4046 22.3584 61.4286 25.4361 61.3177 27.6195C61.2033 29.8719 60.1572 31.0346 58.735 32.785C56.2479 35.846 51.8477 43.0674 45.9169 46.0813C44.67 46.715 44.7743 47.5572 43.7168 48.4727C42.7064 49.3475 41.984 50.1523 40.6558 50.0033C39.1333 49.8324 38.8751 48.3956 37.8817 47.2292C36.5687 45.6874 36.1599 45.6987 33.6728 46.0813C33.6728 46.0813 29.7922 47.3685 27.1681 47.2292C25.9903 47.1667 25.1849 47.1573 24.0115 47.0379C19.6937 46.5983 13.3935 49.238 13.3935 49.238L11.2891 48.4727L29.7509 37.7591C29.7509 37.7591 27.1988 40.5894 28.316 41.8724C28.8541 42.4903 29.4315 42.5463 30.2292 42.7333C32.4144 43.2456 33.7715 42.0945 35.6816 40.9158C38.3828 39.249 43.6222 34.8155 44.8647 32.0197C45.6205 30.3191 42.4346 30.4176 46.9692 26.376L51.8477 18.5321Z"
      fill={secondary}
    />
    <path
      d="M74.5156 16.045L76.1418 16.7146C76.1418 16.7146 76.4083 15.5207 77.0984 14.8014C77.6078 14.2705 78.4376 13.4622 78.4376 13.4622C78.4376 13.4622 81.282 11.9646 83.3161 11.7404C84.1701 11.6463 84.7651 11.1318 85.5162 11.5491C86.3771 12.0274 88.3859 12.5057 88.3859 12.5057C88.3859 12.5057 88.3819 11.1809 88.0989 10.4012C87.8126 9.61209 86.951 8.58373 86.951 8.58373L88.5772 6.47928L87.9076 5.80968L78.9159 5.52271L80.3507 7.43585C80.3507 7.43585 77.8548 9.35405 76.7157 10.9752C75.4749 12.7411 74.5156 16.045 74.5156 16.045Z"
      fill={secondary}
    />
    <ellipse cx="82.1694" cy="7.53177" rx="1.05223" ry="0.956571" fill={primary} />
  </svg>
);

/** Real, already-designed, already multi-toned assets under
 * `webapp/public/guides/` — add a new file and one entry here; nothing
 * else needs to change. NO-COLOR tier; `primaryColor`/`secondaryColor`
 * have no effect on anything registered here (see this file's header). */
const WEBSITE_ICON_FILES: Record<string, string> = {
  "sun-home": "/guides/sun-home.svg",
};

interface OneColorIconDef {
  /** Used whenever `::icon{...}` gives no `primaryColor` at all -- keeps
   * every already-authored `::icon{name="..."}` with zero color
   * attributes rendering exactly as it did before this feature existed.
   * `"currentColor"` for the plain inline-glyph shapes (`arrow`/`circle`)
   * lets them keep inheriting `.website-icon`'s own `color: var(--purple)`
   * (website.css) by default, same as today; a literal hex for
   * `mountaineer-coffee` preserves ITS current look instead, since it used
   * to be a static, never-recolorable file (an `<img>`-embedded SVG never
   * responds to `currentColor`) -- `"currentColor"` would have been a
   * silent behavior change for it specifically. */
  defaultColor: string;
  Component: OneColorIconComponent;
}

/** ONE-COLOR tier -- inline-drawn shapes accepting a single `primaryColor`
 * override (`secondaryColor` has no effect on anything registered here). */
const ONE_COLOR_ICONS: Record<string, OneColorIconDef> = {
  "mountaineer-coffee": { defaultColor: "#5DA06D", Component: MountaineerCoffeeIcon },
  circle: { defaultColor: "currentColor", Component: CircleIcon },
  arrow: { defaultColor: "currentColor", Component: ArrowIcon },
};

interface TwoColorIconDef {
  defaultPrimary: string;
  defaultSecondary: string;
  Component: TwoColorIconComponent;
}

/** TWO-COLOR tier -- inline-drawn shapes accepting BOTH a `primaryColor`
 * and a `secondaryColor` override, independently defaulted. */
const TWO_COLOR_ICONS: Record<string, TwoColorIconDef> = {
  "quail-walking": { defaultPrimary: "#EDE4DA", defaultSecondary: "#E5D6C5", Component: QuailWalkingIcon },
};

/** Every registered `::icon{name="..."}` name, grouped by tier -- also
 * drives the Icon Tracing Paper's own `name` dropdown
 * (`/maker/stamps/scratch`, fruits-only), so that list can never drift out
 * of sync with what's actually registered here. Add a new icon by adding
 * one entry to `WEBSITE_ICON_FILES` (a real, pre-colored asset, no
 * `primaryColor`/`secondaryColor` support), `ONE_COLOR_ICONS` (inline,
 * `primaryColor` only), or `TWO_COLOR_ICONS` (inline, both) above -- all
 * three lists below pick it up automatically, nothing else needs to
 * change. */
export const WEBSITE_ICON_FILE_NAMES = Object.keys(WEBSITE_ICON_FILES);
export const WEBSITE_ICON_ONE_COLOR_NAMES = Object.keys(ONE_COLOR_ICONS);
export const WEBSITE_ICON_TWO_COLOR_NAMES = Object.keys(TWO_COLOR_ICONS);

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
  /** `::icon{primaryColor="..."}`, already resolved to a plain final CSS
   * color value (or `undefined`) by the caller -- see this file's header.
   * Ignored by `WEBSITE_ICON_FILES` entries; the sole color knob for
   * `ONE_COLOR_ICONS`; the first of two for `TWO_COLOR_ICONS`. */
  primaryColor?: string;
  /** `::icon{secondaryColor="..."}`, same already-resolved shape as
   * `primaryColor` above. Only has any effect on `TWO_COLOR_ICONS`
   * entries. */
  secondaryColor?: string;
};

/** The actual glyph -- unaware of `position` entirely; either rendered
 * directly inline (`WebsiteIcon`, below, when there's no `position`) or
 * wrapped by `PositionedWebsiteIcon` (below) when there is one. */
function WebsiteIconGlyph({
  name,
  size = "md",
  className,
  waypointId,
  primaryColor,
  secondaryColor,
}: Omit<WebsiteIconProps, "position">) {
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

  const oneColor = ONE_COLOR_ICONS[name];
  if (oneColor) {
    return (
      <span className={`website-icon ${className ?? ""}`} style={style} data-waypoint-id={waypointId || undefined}>
        <oneColor.Component className="website-icon-svg" color={primaryColor ?? oneColor.defaultColor} />
      </span>
    );
  }

  const twoColor = TWO_COLOR_ICONS[name];
  if (twoColor) {
    return (
      <span className={`website-icon ${className ?? ""}`} style={style} data-waypoint-id={waypointId || undefined}>
        <twoColor.Component
          className="website-icon-svg"
          primary={primaryColor ?? twoColor.defaultPrimary}
          secondary={secondaryColor ?? twoColor.defaultSecondary}
        />
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
