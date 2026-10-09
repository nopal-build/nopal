/**
 * DUPLICATED from fruits/app/oxmarkdown/websiteBadge.tsx -- see
 * `websiteIcons.tsx`'s own header comment here for why this whole
 * directory is duplicated. Not shared; keep both copies in sync by hand.
 *
 * `::badge{text="..." variant="..." position="..." height="..."}` --
 * wraps `stamps/Badge` with the SAME optional absolute-positioning
 * capability `websiteIcons.tsx`'s `WebsiteIcon`/`PositionedWebsiteIcon`
 * already has -- deliberately mirrors that component as its own copy
 * (see the "Box Directive + Pricing Card UI Fix" garden seed's own
 * research for why: the exact literal-pixel anchor/delta grammar,
 * resolved against THIS component's own real measured container size,
 * needs a `position: relative` ancestor -- a `:::box{...}`/
 * `:::section{...}` body -- to have any visible effect at all).
 *
 * `height`, new here (not on `::icon`) -- see that garden seed's resolved
 * question 3: `::icon{position=...}` anchors by the element's own
 * top-left corner, not its center ("simplest to reason about" -- that
 * file's own comment), so centering a badge over a box's corner needs
 * the AUTHOR to hand-compute the offset (e.g. `position="R10,T-10"
 * height="20"` roughly centers a 20px-tall badge 10px in from the right
 * edge: `T-10` is half of `20`). `height` SETS the badge's own real
 * rendered CSS height (not just a documented hint an author promises
 * matches reality) so that hand math stays trustworthy instead of
 * silently drifting from whatever the badge actually renders at.
 */
import { useEffect, useState, type ReactNode } from "react";
import { resolveLinePoints, type LinePointTokens } from "oxmarkdown-core";
import { Badge } from "stamps/Badge";
import { badge as badgeRecipe } from "stamps/badge.css";
import { useElementSize } from "./WavyLine";

const BADGE_VARIANTS = ["neutral", "success", "warning", "danger"] as const;
type BadgeVariant = (typeof BADGE_VARIANTS)[number];

type WebsiteBadgeProps = {
  text: string;
  variant: BadgeVariant;
  /** `::badge{position="x,y"}`'s own parsed single point -- see
   * `websiteDirectives.tsx`'s `parseIconPosition` (the SAME parser,
   * reused as-is for `badge` too -- identical grammar, identical
   * single-point shape). `undefined` for a badge with no `position` at
   * all -- renders exactly as it always has, inline in ordinary flow. */
  position?: LinePointTokens;
  /** `::badge{height="20"}`'s own parsed literal pixel height (see
   * `websiteDirectives.tsx`'s `parseBadgeHeight`). Only meaningful
   * alongside `position` -- a plain inline badge keeps its own natural
   * height either way, but this still applies if given regardless. */
  height?: number;
};

/** Mirrors `websiteIcons.tsx`'s `PositionedWebsiteIcon` directly -- same
 * `useElementSize` + `resolveLinePoints` real-measured-anchor mechanism,
 * same client-only "renders nothing at all until the first real
 * measurement" contract (no SSR-then-hydrate flash, same reasoning as
 * that component's own header). Kept as its own copy here rather than a
 * shared import -- a single point still needs the exact same real-pixel-
 * anchor treatment `::line`/`::path`/`::icon` already went through, and
 * this codebase's own established convention duplicates this kind of
 * small, directive-specific wiring rather than sharing it (see
 * `websiteIcons.tsx`/`websiteDirectives.tsx`'s own fruits/webapp
 * duplication header comments for the broader pattern this follows). */
function PositionedWebsiteBadge({ position, children }: { position: LinePointTokens; children: ReactNode }) {
  const { ref, size } = useElementSize<HTMLSpanElement>();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  // Re-keyed on `position`'s own SERIALIZED value, not the object
  // reference -- `websiteDirectives.tsx` re-parses `attrs.position` fresh
  // on every render, so a plain reference dependency would recompute (and
  // re-measure nothing new) on literally every render -- harmless but
  // wasteful, same convention `PositionedWebsiteIcon` already uses.
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
        <span
          style={{
            position: "absolute",
            left: point.x,
            top: point.y,
            // `width: "max-content"` -- same fix `PositionedWebsiteIcon`
            // needed: without it, a `position: absolute` span with `left`
            // set but no explicit width shrinks its own available width
            // down to `(container width - left)`, which can starve the
            // badge's own text close to its container's right edge.
            width: "max-content",
            // `display: "flex"` -- a THIRD real bug, found by the human
            // one level up from the pill itself: a plain `position:
            // absolute` span (no `display` set) blockifies but still
            // sizes its own auto height via ordinary INLINE line-box
            // math -- which factors in this span's own INHERITED
            // `line-height` (`.ox-content { line-height: 1.2 }`) as an
            // invisible "strut", even though its only real content is one
            // atomic `inline-flex` badge. Confirmed via DevTools: this
            // wrapper rendered ~23px tall (the inherited line-height's
            // own computed value) regardless of the badge's own real
            // height, and the badge's default baseline `vertical-align`
            // then sat it somewhere INSIDE that taller box, not flush
            // with this span's own `top` -- throwing off any hand-
            // computed centering offset by the difference between the
            // two. A flex formatting context has no line boxes/struts at
            // all -- this span's own height becomes exactly its single
            // child's real height, nothing inherited, nothing extra.
            display: "flex",
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** The actual pill -- unaware of `position` entirely; either rendered
 * directly inline (`WebsiteBadge`, below, when there's no `position`) or
 * wrapped by `PositionedWebsiteBadge` (above) when there is one. */
function WebsiteBadgeGlyph({ text, variant, height }: Omit<WebsiteBadgeProps, "position">) {
  if (height === undefined) return <Badge variant={variant}>{text}</Badge>;
  // `height` SETS the pill's own REAL rendered box height -- rendered
  // directly with the SAME `badge({variant})` recipe class `Badge`
  // itself uses (bypassing that component only because it has no
  // `style` prop to override through, confirmed by reading it directly
  // -- `Badge.tsx` takes `variant`/`children`/`className`, nothing
  // else). TWO real, found-during-review bugs this replaces:
  //   1. Wrapping `<Badge>` in an `inline-flex` container with a `height`
  //      only centers the CHILD within that box -- it never shrinks
  //      `Badge`'s own intrinsic size (its `padding: 2px 8px` +
  //      `line-height: 1rem` already renders ~20px tall on its own), so
  //      the wrapper's height was a silent no-op the moment the badge was
  //      already that size or larger.
  //   2. Setting `lineHeight` equal to `height` on an `inline-block`
  //      element does NOT vertically center its text -- that's simply
  //      not what `line-height` does on a non-replaced inline-level
  //      element (it sets the MINIMUM line-box height; content still
  //      flows from the top, so any leftover space (whenever the box's
  //      explicit `height` doesn't exactly match the line's own natural
  //      height) sits entirely BELOW the text, not split symmetrically --
  //      confirmed by a real repro: the text visibly stayed fixed while
  //      only the background box's height changed as `height` varied).
  //      `display: inline-flex` + `alignItems: "center"` is the standard,
  //      font-metric-independent fix -- a flex container vertically
  //      centers bare text content in an anonymous flex item regardless
  //      of `height`, with no line-height arithmetic to get wrong.
  // Vertical padding is zeroed (the recipe's own `2px 8px` would
  // otherwise inflate the real rendered height past what's requested,
  // keeping only the horizontal `8px`) -- `boxSizing: "border-box"` makes
  // `height` the TOTAL box height including the `neutral` variant's own
  // 1px border, not just its content box, so the number given is the
  // number you actually get.
  return (
    <span
      className={badgeRecipe({ variant })}
      style={{ height, display: "inline-flex", alignItems: "center", padding: "0 8px", boxSizing: "border-box" }}
    >
      {text}
    </span>
  );
}

export function WebsiteBadge({ position, ...glyphProps }: WebsiteBadgeProps) {
  if (position) {
    return (
      <PositionedWebsiteBadge position={position}>
        <WebsiteBadgeGlyph {...glyphProps} />
      </PositionedWebsiteBadge>
    );
  }
  return <WebsiteBadgeGlyph {...glyphProps} />;
}

export function toBadgeVariant(v: string | undefined): BadgeVariant {
  return (BADGE_VARIANTS as readonly string[]).includes(v ?? "") ? (v as BadgeVariant) : "neutral";
}
