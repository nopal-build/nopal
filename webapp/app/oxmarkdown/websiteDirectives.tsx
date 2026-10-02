/**
 * `/v2` website-page-only directives, registered via `OxRenderer`'s
 * existing caller-supplied `DirectiveRegistry` mechanism
 * (`directiveRegistry.ts`) — none of these need raw mdast children (unlike
 * `:::grid`/`:::gallery`), so they're plain registry entries scoped to
 * `WebsitePageView`, not new `OxRenderer` core built-ins. Nothing about
 * the shared dot-grid `oxmarkdown.css` identity changes; these only apply
 * where a caller explicitly passes this registry in.
 *
 * STATIC-rendering only, same deliberate scope Grid/Gallery/`::daily-log`'s
 * siblings already established — no Editing-mode preview yet (the Vault's
 * `WebsitePageEditor` doesn't register these), which is an accepted,
 * explicitly deferred follow-up, not an oversight.
 *
 * GOTCHA when hand-authoring pages: a container directive's closing fence
 * must be AT LEAST as long as its own opening fence, and (confirmed by a
 * real parse test against `parseOxDocument`, not just spec-reading) a
 * `:::section{...}` that nests MORE THAN ONE sibling container directive
 * at the same 3-colon length (two `:::pricing-card{...}` blocks, a
 * `:::toggle{...}` alongside anything else, or more than one
 * `:::section-title{...}`) breaks: the FIRST nested container's own
 * closing `:::` also incorrectly closes the outer section, silently
 * popping every later "nested" block up to the top level instead. A
 * single nested container is fine at matching length, but the safe,
 * ALWAYS-correct rule is: `:::section{...}` should open with FOUR colons
 * (`::::section{...}`) whenever its body contains any `:::pricing-card`/
 * `:::toggle`/`:::section-title`/other container directive, so its own
 * closing fence can never be ambiguous with a 3-colon one nested inside
 * it. Leaf directives (`::stamp`, `::icon`, `::button`, `::badge`,
 * `::waypoint`, `::line`, `::daily-log`) never open a fence at all, so
 * they never trigger this.
 *
 * Directive vocabulary (first functional pass):
 *   :::section{bg="mint|white" list="timeline" margin="N"}
 *     — full-bleed colored band; body renders through the ordinary
 *     pipeline. `list` swaps in a NAMED bullet style for the body's own
 *     lists (a small dot + connecting line for `"timeline"` today) -- a
 *     whole pre-designed look, not a raw color, same "named vocabulary"
 *     spirit `bg` itself already has. `margin` adds extra top/bottom
 *     breathing room around the section, as a MULTIPLE of the shared
 *     `--ox-grid` unit (41px today) rather than a raw pixel count --
 *     `margin="2"` means `2 * 41px` = `82px` (see `parseSectionMarginStyle`,
 *     below, for why that stays token-driven instead of a hardcoded
 *     number); negative values pull an adjacent section closer instead.
 *     Deliberately a themeable-area directive, not a fully bespoke-per-
 *     section one: bg/list/margin are the handful of knobs worth
 *     exposing, not every possible CSS property. Heading COLOR is
 *     deliberately NOT one of them -- a section's own headings just read
 *     the ordinary default text color; reach for `:::section-
 *     title{color="..."}` (below) instead when a heading specifically
 *     needs to stand out.
 *   ::stamp{name="coffee|mtn|nopal|quail" rotate="deg" float="left|right|inline" id="..."}
 *     — a complete, pre-designed postage-stamp graphic (see
 *     `websiteStamps.tsx`); `id` doubles as a waypoint.
 *   ::icon{name="..." size="sm|md|lg" id="..." position="x,y"} — a bare
 *     named illustration, for inline glyphs or standalone floating
 *     shapes. `position` is optional -- omit it and the icon renders
 *     inline exactly as it always has; give it an `"x,y"` pair (its OWN
 *     normalized-percentage coordinate system -- see `parseIconPosition`'s
 *     own comment for why this is deliberately DIFFERENT from
 *     `::line{points="..."}`'s literal-pixel one below -- anchors and
 *     deltas both work) to absolutely position it INSTEAD, relative to
 *     whatever element it's rendered inside (today: `.website-section-
 *     inner`, for `:::section{...}` -- see `parseIconPosition`'s own
 *     comment for why other containers need the same `position:
 *     relative` treatment before this works inside THEM too).
 *   ::waypoint{id="..."} — an invisible anchor for the (future) wavy
 *     connector overlay to measure; renders nothing visible on its own.
 *   :::section-title{icon="..." color="red|green|purple"} — an icon + a
 *     real heading + (usually) a `::line{...}` composed together as one
 *     titled-header unit; see `website.css`'s `.website-section-title` for
 *     the layout. The heading stays real markdown inside it, so an
 *     unaware renderer just shows a plain heading, no visible artifact.
 *     `color` recolors JUST the heading text (same named-color vocabulary
 *     `::line{color="..."}` below also reads, via the same
 *     `data-website-color`-attribute-selector technique) — it does NOT
 *     also recolor a `::line{...}` nested alongside it; that's `::line`'s
 *     own, independent `color` attribute (below), since a bare `::line`
 *     needs to work with no `:::section-title` around it at all.
 *   ::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}
 *     — the shared wavy-line primitive (`WavyLine.tsx` +
 *     `oxmarkdown-core`'s `buildSplinePath`/`resolveLinePoints`),
 *     fixed-points mode: "a line is drawn from one end to the other" — a
 *     cursor starts at the line's own top-left corner and walks forward,
 *     per-axis, per point, in LITERAL PIXELS (see `oxmarkdown-core`'s
 *     `wavyLine.ts` header for why -- a REVERSED design from an earlier
 *     normalized-then-rescaled-to-container version, which made the same
 *     numbers look different, often distorted, depending on the
 *     container they rendered inside). EACH half of a pair is
 *     independently either:
 *       - a plain number — a DELTA: moves the cursor BY that amount, in
 *         real px, from wherever it already was (cumulative) -- NEVER
 *         rescaled by the container's own size.
 *       - a reference letter + optional number (default offset `0`) —
 *         an ANCHOR, referenced to the container's own REAL measured
 *         edge instead of the previous point (this IS container-size-
 *         dependent, on purpose -- that's what "anchor to an edge"
 *         means): `L`/`C`/`R` (left/center/right) for x, `T`/`C`/`B`
 *         (top/center/bottom) for y. Case-insensitive. Same "inset"
 *         convention as CSS's own `top`/`right`/`bottom`/`left`: `T`/`L`
 *         add AWAY from that edge, `B`/`R` subtract INWARD from that
 *         edge, `C` adds in the ordinary positive-axis direction -- the
 *         offset itself is a literal pixel inset, not a percentage of
 *         the container. E.g. `R0` = exactly the right edge, `B10` = 10
 *         real px up from the bottom, `C5` = 5 real px past center.
 *     Anchors and deltas mix freely, per-axis, at any point (including
 *     the first) — e.g. `points="L0,B10 C5,B40 R0,B0"` is three fully-
 *     anchored points (bottom-left, up near center, exactly bottom-
 *     right); `points="0,T0 c,38"` anchors point 2's x to dead-center
 *     while its y still continues normally as a delta (`0 + 38` real px
 *     down). Pure-delta strings like `points="3,10 58,-8 100,10"` behave
 *     exactly as before — the cursor simply starts at `(0,0)`, so point
 *     1's plain numbers already come out absolute with no special-casing
 *     needed. A literal, standalone `|` is a pen-up BREAK -- the next
 *     point starts a brand-new, visually DISCONNECTED stroke, the same
 *     thing a real SVG `M` (moveto) command means: no line/curve segment
 *     connects the point before a `|` to the point after it. The cursor
 *     does NOT reset at a break (matching SVG's own relative `m dx,dy`)
 *     -- a delta/anchor right after one resolves exactly like it always
 *     would; only whether a segment gets DRAWN changes. E.g.
 *     `points="0,0 40,0 | 0,0 0,40"` draws two separate strokes -- a
 *     horizontal line, then (pen lifted, cursor still at `40,0`) a
 *     vertical one starting from there. Built for tracing real, organic
 *     multi-subpath artwork (a branching illustration, a signature, a
 *     multi-stroke logo, ...) where flattening every subpath into one
 *     continuous curve would draw bogus connecting segments straight
 *     across what should be real gaps -- see `oxmarkdown-core`'s
 *     `wavyLine.ts` header and `buildMultiSplinePath`. The line's own
 *     element is sized to exactly fit the resulting (possibly
 *     multi-stroke) path's bounding box (not the whole containing box),
 *     recomputed on every resize ONLY to re-resolve any anchor letters
 *     against the container's new real size -- plain deltas never
 *     change. `color` (same named vocabulary as
 *     `accent`/`section-title`'s `color`) sets the stroke directly via
 *     `WavyLine`'s own `color` prop — omit it and the line just inherits
 *     whatever `currentColor` resolves to (`WavyLine`'s default). The
 *     SAME primitive's `waypoints` mode (measuring live
 *     `data-waypoint-id` positions instead of fixed points, all
 *     absolute — anchor/delta semantics don't apply there) is built in
 *     `WavyLine.tsx` but not wired to a directive yet — reserved for the
 *     Home template's page-spanning connector.
 *   ::path{points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}
 *     — the SAME wavy-line primitive as `::line` above, `points` parsed
 *     with the EXACT SAME delta/anchor grammar, but DECOUPLES the traced
 *     shape's own natural proportions from how big it renders and where
 *     it sits, which `::line` bakes directly into the points themselves
 *     instead. Built for tracing a real, complex SVG shape (see the
 *     "SVG → Points" Scratchpad tool) once, then resizing/repositioning
 *     it freely without re-baking any numbers:
 *       - `width`/`height` (optional, independent of each other) — a
 *         plain number is literal px; a trailing `%` is a percentage of
 *         `::path`'s own real measured container size, resolved fresh on
 *         every real resize (so a `%` value stays genuinely responsive,
 *         unlike anything `::line` can express). ALWAYS a uniform scale
 *         -- the shape's own natural proportions are never independently
 *         stretched per axis. Giving only ONE axis scales the shape so
 *         THAT axis matches the target, with the other following
 *         proportionally; giving BOTH fits inside whichever constrains
 *         more (`object-fit: contain`). Omit both entirely and `points`
 *         renders at its own literal, unscaled size -- identical to
 *         `::line`.
 *       - `start="x,y"` (optional) — the SAME anchor/delta vocabulary as
 *         a single `points="..."` pair, positioning the (possibly-scaled)
 *         shape's own bounding-box top-left corner. Omit it and the shape
 *         renders at wherever its own resolved `points` naturally placed
 *         it (scaling aside).
 *     `points`/`curve`/`tension`/`color` all behave exactly as they do on
 *     `::line` -- see that entry above for the full grammar. See
 *     `oxmarkdown-core`'s `fitAndPositionPoints` for the underlying math.
 *   :line-word{text="..." points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}
 *     — a TEXT directive (single colon, inline -- sits mid-sentence in
 *     ordinary prose, e.g. `Take the early :line-word{text="waterproof
 *     jacket" points="..."}.`, the SAME tier as the built-in `:ref{...}`
 *     citation mark in `OxRenderer.tsx`/`refDirective.ts`) -- NOT a leaf/
 *     container directive, so it never opens a fence and never needs its
 *     own line. Wraps `text` in an inline-block, `position: relative` span
 *     and draws the SAME `WavyLine` primitive as `::line`/`::path` behind
 *     it (`z-index: -1`, `website.css`) -- a hand-drawn squiggle/circle
 *     decorating ONE word or short phrase, sized to that word's own real
 *     rendered box. `points`/`width`/`height`/`start`/`curve`/`tension`/
 *     `color` all behave EXACTLY like `::path{...}` above (same optional
 *     decoupled-scale/position knobs, same grammar) -- see that entry for
 *     the full details; the only new attribute is `text`, the literal
 *     word/phrase to render (a plain attribute, not bracket-label content,
 *     matching how `::button{text="..."}`/`::badge{text="..."}` already
 *     do it elsewhere in this same registry). Renders nothing at all if
 *     either `text` or a usable `points` is missing.
 *   :::pricing-card{name="..." price="..." cta="..." cta-href="..." cta-variant="primary|purple|secondary|yellow|outline"} —
 *     body is an ordinary bullet list of features; `cta-variant` -- see
 *     `::button`'s own entry below -- defaults to `primary`.
 *   ::button{text="..." href="..." variant="primary|purple|secondary|yellow|outline"} —
 *     a standalone CTA link, styled with `stamps/button.css`'s own
 *     `button({ variant })` recipe (the site's ordinary buttons elsewhere
 *     in the app) rather than a bespoke website-only look. `variant`
 *     (default `primary`) picks any of the recipe's own variants —
 *     `purple`/`outline` don't bake in their own padding/display (see
 *     `button.css.ts`'s own comments), so this directive supplies the
 *     same fallback values the Stamps guide's own specimen page already
 *     demonstrates for both, rather than rendering an incomplete-looking
 *     button. The pricing card's own `cta`/`cta-href` render through the
 *     exact same recipe.
 *   ::badge{text="..." variant="neutral|success|warning|danger"} — a
 *     status pill, reusing `stamps/Badge` (same component the "Draft"
 *     preview banner already uses) rather than a bespoke style.
 *   ::daily-log{date="YYYY-MM-DD" project="..."} — a curated, static embed
 *     of one real daily-log Card, resolved server-side (see
 *     `robustness-core/data/website.server.ts`'s
 *     `resolveWebsiteDailyLogEntries`) since it needs real vault/DB access
 *     `OxRenderer` never has on its own.
 */
import type { CSSProperties } from "react";
import type { DirectiveRegistry } from "./directiveRegistry";
import { WebsiteIcon } from "./websiteIcons";
import { WebsiteStamp } from "./websiteStamps";
import { WavyLine } from "./WavyLine";
import OxRenderer from "../components/OxRenderer";
import { Badge } from "stamps/Badge";
import { button as stampsButton } from "stamps/button.css";
import { parseLinePoints, resolveNormalizedLinePoint, type LineCurveKind, type LineSizeSpec } from "oxmarkdown-core";
// No `import "../styles/website.css"` here (unlike fruits' copy) --
// this registry is ONLY ever built by `WebsitePageView`, which is ONLY
// ever reached under `/v2/*` -- see `websiteIcons.tsx`'s own comment for
// why that makes this redundant, and a real repro'd source of an EXTRA
// jump on top of the one this whole change is meant to fix.

const LINE_CURVE_KINDS = ["smooth", "straight", "bezier"] as const;

const WEBSITE_BUTTON_VARIANTS = ["primary", "purple", "secondary", "yellow", "outline"] as const;
type WebsiteButtonVariant = (typeof WEBSITE_BUTTON_VARIANTS)[number];
function toWebsiteButtonVariant(v: string | undefined): WebsiteButtonVariant {
  return (WEBSITE_BUTTON_VARIANTS as readonly string[]).includes(v ?? "")
    ? (v as WebsiteButtonVariant)
    : "primary";
}

/** `purple`/`outline` deliberately don't bake in their own padding/display
 * (see `stamps/button.css.ts`'s own comments -- `purple` is `primary`
 * minus the padding, `outline` brings both display and padding itself) --
 * a plain markdown attribute has no way to supply arbitrary CSS, so a page
 * author picking either still gets a complete-looking button here,
 * matching the exact fallback values the Stamps guide's own specimen page
 * (`maker_.stamps.tsx`'s `BUTTON_VARIANTS`) already demonstrates for both. */
const WEBSITE_BUTTON_VARIANT_STYLE: Partial<Record<WebsiteButtonVariant, CSSProperties>> = {
  purple: { padding: "8px 20px" },
  outline: { padding: "8px 16px", display: "inline-flex" },
};
function toLineCurveKind(v: string | undefined): LineCurveKind {
  return (LINE_CURVE_KINDS as readonly string[]).includes(v ?? "") ? (v as LineCurveKind) : "smooth";
}

const SIZE_ATTR_PATTERN = /^(-?\d*\.?\d+)(%)?$/;

/** `::path{width="..."}`/`::path{height="..."}` -- a plain number is
 * literal px, a trailing `%` is a percentage of `::path`'s own real
 * measured container size (`WavyLine.tsx`'s `resolveLineSize` resolves
 * the actual number against that real size, on every resize). Returns
 * `undefined` for an absent/unparseable attribute -- `::path` with no
 * `width`/`height` given at all renders `points` at its own literal,
 * unscaled size, identical to `::line` (see `oxmarkdown-core`'s
 * `fitAndPositionPoints`). */
function parseSizeAttr(raw: string | undefined): LineSizeSpec | undefined {
  if (!raw) return undefined;
  const match = SIZE_ATTR_PATTERN.exec(raw.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2] ? { kind: "percent", value } : { kind: "px", value };
}

/** Same named-color vocabulary `:::section-title{color="..."}` already
 * uses -- shared here so `::line{color="..."}` resolves to the exact
 * same CSS variable a `color="..."` there would (that one goes through
 * CSS attribute selectors instead -- see `website.css` -- since it
 * targets a heading already rendered as `children`, not a prop this
 * registry can pass directly). `red`/`green` read the SAME scheme-aware
 * `--website-accent-*` tokens `:::section-title{color="..."}` reads
 * (website.css) -- a line drawn alongside a green/red heading should
 * recolor right along with it in dark mode, not go stale. `purple`
 * stays a literal, scheme-invariant token (no dark-mode counterpart
 * exists for it, by design -- see website.css). */
const ACCENT_COLOR_VARS: Record<string, string> = {
  red: "var(--website-accent-red)",
  green: "var(--website-accent-green)",
  purple: "var(--purple)",
};
function toAccentColorVar(name: string | undefined): string | undefined {
  return name ? ACCENT_COLOR_VARS[name] : undefined;
}

/** `::icon{position="x,y"}` -- reuses `::line{points="x,y x,y ..."}`'s
 * PARSING grammar (`parseLinePoints`, `oxmarkdown-core`'s `wavyLine.ts`:
 * each half a plain delta number or an `L`/`C`/`R` (x) / `T`/`C`/`B` (y)
 * anchor letter) but DELIBERATELY NOT its resolved coordinate SYSTEM --
 * `::line{...}`'s points are literal, stable pixels (see `wavyLine.ts`'s
 * own header for why), while this resolves against a fixed nominal
 * `0-100` (x) / `0-40` (y) box instead (`resolveNormalizedLinePoint`),
 * turned directly into a plain CSS PERCENTAGE. A single point's "delta"
 * already resolves as absolute (the cursor starts at `(0, 0)`), so
 * anchors and deltas both work here exactly like they do in a real
 * multi-point `points="..."` list.
 *
 * Unlike `::line{...}` (which needs a real DOM measurement to resolve
 * literal pixels against the container's real edges), positioning
 * exactly ONE element can just use plain CSS `left`/`top` PERCENTAGES on
 * an absolutely-positioned box -- the browser already resolves those
 * against the nearest POSITIONED ancestor's own measured size on every
 * layout/resize, for free, with no `ResizeObserver`/`getBoundingClientRect`
 * measurement dance the way `WavyLine.tsx` needs. That positioned
 * ancestor is whatever element the `::icon{...}` happens to render
 * inside -- today that's `.website-section-inner` (website.css), for
 * the first real use inside `:::section{...}`. Placing one inside some
 * OTHER container needs that container to be `position: relative` too,
 * the same way, before this has any visible effect there. Placing a
 * SINGLE point has no "shape" for x/y to distort by scaling independently
 * with the container the way a multi-point line would, so there's no
 * "funky at different sizes" problem here to fix the same way `::line`
 * needed -- percentage placement is the right, simpler choice for this
 * directive specifically, not a lingering inconsistency.
 *
 * Represents the icon's TOP-LEFT corner, not its center (simplest to
 * reason about, and consistent with what `left`/`top` mean everywhere
 * else in CSS) -- nudge `x`/`y` by roughly half the icon's own rendered
 * size for a visually "centered on this point" placement instead.
 * Returns `undefined` for an absent/unparseable `position` -- the caller
 * then renders exactly as it always did (ordinary inline flow), matching
 * `::icon{...}`'s own "no position given = unchanged" contract. A bare
 * `|` (pen-up BREAK -- see `oxmarkdown-core`'s `LinePointsEntry`) makes
 * no sense for a SINGLE point, so it's rejected the same as any other
 * unparseable input. */
const ICON_POSITION_VIEWBOX_HEIGHT = 40;
function parseIconPosition(raw: string | undefined): CSSProperties | undefined {
  const tokens = parseLinePoints(raw);
  if (tokens.length !== 1 || tokens[0] === "break") return undefined;
  const point = resolveNormalizedLinePoint(tokens[0], ICON_POSITION_VIEWBOX_HEIGHT);
  return { position: "absolute", left: `${point.x}%`, top: `${(point.y / ICON_POSITION_VIEWBOX_HEIGHT) * 100}%` };
}

/** `:::section{margin="N"}` -- `N` MULTIPLIES the shared `--ox-grid`
 * token (oxmarkdown.css, 41px today -- the same single-source-of-truth
 * vertical-rhythm unit every other spacing decision across OxMarkdown
 * already derives from) to get a real `margin-top`/`margin-bottom` in
 * px, e.g. `margin="2"` -> `2 * 41px` = `82px`. Reads the token via a
 * plain CSS `calc()` in an inline style rather than computing a literal
 * pixel number here in JS, so a section's own margin stays correct even
 * if `--ox-grid` itself is ever retuned (a caller-supplied `oxmarkdown/
 * theme.ts` override, or a future grid-size change) -- matches this
 * whole codebase's own standing preference for reading a shared token
 * over hardcoding its current value. Applies to BOTH top and bottom
 * symmetrically (a single knob for "extra breathing room around this
 * section," not independent per-side control) -- negative numbers work
 * fine too (pulls an adjacent section closer, even overlapping, via
 * ordinary CSS margin math). Returns `undefined` for an absent/
 * unparseable `margin` -- the caller then renders with its own ordinary
 * default spacing, unchanged. */
function parseSectionMarginStyle(raw: string | undefined): CSSProperties | undefined {
  const multiplier = Number(raw);
  if (!Number.isFinite(multiplier)) return undefined;
  const margin = `calc(${multiplier} * var(--ox-grid, 41px))`;
  return { marginTop: margin, marginBottom: margin };
}

const BADGE_VARIANTS = ["neutral", "success", "warning", "danger"] as const;
type BadgeVariant = (typeof BADGE_VARIANTS)[number];
function toBadgeVariant(v: string | undefined): BadgeVariant {
  return (BADGE_VARIANTS as readonly string[]).includes(v ?? "") ? (v as BadgeVariant) : "neutral";
}

export type WebsiteDailyLogEntry = {
  projectName: string;
  date: string;
  content: string;
};

/** Same key format used on both the resolving (server) and rendering
 * (here) sides — keep in sync by hand with `website.server.ts`'s
 * `resolveWebsiteDailyLogEntries` (same webapp/robustness-core split
 * convention the rest of OxMarkdown's directive rendering already
 * follows). Lowercases the project name so a page author's exact
 * capitalization in `project="..."` doesn't have to match the vault
 * folder's own capitalization exactly. */
export function dailyLogEntryKey(date: string, project: string): string {
  return `${date}::${project.trim().toLowerCase()}`;
}

const SECTION_BG_CLASS: Record<string, string> = {
  mint: "website-bg-mint",
  white: "website-bg-white",
};

export function buildWebsiteDirectiveRegistry(opts: {
  dailyLogEntries: Record<string, WebsiteDailyLogEntry>;
  /** Forces `::stamp{...}`'s light/dark asset pick, bypassing its own
   * `<picture>`/`<source media="...">` OS-driven selection -- see
   * `WebsiteStamp`'s own `forcedScheme` comment (`websiteStamps.tsx`) for
   * why that needs an explicit override instead of a CSS trick. Always
   * undefined here (webapp has no preview toggle) -- kept for parity
   * with fruits' copy since this function's shape is meant to stay
   * identical. */
  forcedScheme?: "light" | "dark";
}): DirectiveRegistry {
  return {
    section({ attrs, children }) {
      const bgClass = SECTION_BG_CLASS[attrs.bg ?? ""] ?? "";
      return (
        <section
          className={`website-section ${bgClass}`}
          data-website-list={attrs.list || undefined}
          style={parseSectionMarginStyle(attrs.margin)}
        >
          <div className="website-section-inner">{children}</div>
        </section>
      );
    },

    stamp({ attrs }) {
      const rotate = Number(attrs.rotate);
      const float = attrs.float === "left" || attrs.float === "right" ? attrs.float : "inline";
      return (
        <WebsiteStamp
          name={attrs.name ?? ""}
          rotate={Number.isFinite(rotate) ? rotate : 0}
          float={float}
          waypointId={attrs.id}
          forcedScheme={opts.forcedScheme}
        />
      );
    },

    icon({ attrs }) {
      const size = attrs.size === "sm" || attrs.size === "lg" ? attrs.size : "md";
      return (
        <WebsiteIcon
          name={attrs.name ?? ""}
          size={size}
          waypointId={attrs.id}
          positionStyle={parseIconPosition(attrs.position)}
        />
      );
    },

    waypoint({ attrs }) {
      // Invisible anchor — the (not-yet-built) wavy connector overlay
      // measures this element's live position via `data-waypoint-id`, the
      // same attribute `::stamp`/`::icon` can also carry. Renders nothing
      // visible on its own.
      return <span className="website-waypoint" aria-hidden="true" data-waypoint-id={attrs.id || undefined} />;
    },

    "section-title"({ attrs, children }) {
      return (
        <div className="website-section-title" data-website-color={attrs.color || undefined}>
          {attrs.icon && <WebsiteIcon name={attrs.icon} size="md" />}
          {children}
        </div>
      );
    },

    line({ attrs }) {
      const points = parseLinePoints(attrs.points);
      if (points.length < 2) return null;
      const tension = attrs.tension ? Number(attrs.tension) : undefined;
      return (
        <WavyLine
          mode="points"
          points={points}
          curve={toLineCurveKind(attrs.curve)}
          tension={Number.isFinite(tension) ? tension : undefined}
          color={toAccentColorVar(attrs.color)}
          className="website-line"
        />
      );
    },

    path({ attrs }) {
      const points = parseLinePoints(attrs.points);
      if (points.length < 2) return null;
      const tension = attrs.tension ? Number(attrs.tension) : undefined;
      // `start` is always exactly ONE point -- a bare `|` (pen-up BREAK)
      // makes no sense there, so it's rejected the same as any other
      // unparseable value.
      const startToken = parseLinePoints(attrs.start)[0];
      const start = startToken && startToken !== "break" ? startToken : undefined;
      return (
        <WavyLine
          mode="points"
          points={points}
          targetWidth={parseSizeAttr(attrs.width)}
          targetHeight={parseSizeAttr(attrs.height)}
          start={start}
          curve={toLineCurveKind(attrs.curve)}
          tension={Number.isFinite(tension) ? tension : undefined}
          color={toAccentColorVar(attrs.color)}
          className="website-path"
        />
      );
    },

    "line-word"({ attrs }) {
      const points = parseLinePoints(attrs.points);
      if (points.length < 2 || !attrs.text) return null;
      const tension = attrs.tension ? Number(attrs.tension) : undefined;
      const startToken = parseLinePoints(attrs.start)[0];
      const start = startToken && startToken !== "break" ? startToken : undefined;
      return (
        // `zIndex: 0` (NOT just `position: relative`) is load-bearing --
        // it's what makes THIS span its own stacking context. Without it,
        // `.website-line-word`'s own `z-index: -1` (see `website.css`) has
        // no local context to sink behind and instead escapes all the way
        // up to the nearest ANCESTOR that does establish one -- which for
        // an inline word sitting mid-paragraph is arbitrarily far up the
        // tree, painting the line below that far-away ancestor's own
        // opaque background (i.e. fully invisible) rather than just
        // behind this word's own text. Confirmed by direct pixel sampling:
        // the DOM/layout was already 100% correct (real path `d`, real
        // position, real resolved stroke color) but literally zero pixels
        // painted on screen until this was added.
        <span style={{ position: "relative", zIndex: 0, display: "inline-block" }}>
          {attrs.text}
          <WavyLine
            mode="points"
            points={points}
            targetWidth={parseSizeAttr(attrs.width)}
            targetHeight={parseSizeAttr(attrs.height)}
            start={start}
            curve={toLineCurveKind(attrs.curve)}
            tension={Number.isFinite(tension) ? tension : undefined}
            color={toAccentColorVar(attrs.color)}
            className="website-line-word"
          />
        </span>
      );
    },

    "pricing-card"({ attrs, children }) {
      const ctaVariant = toWebsiteButtonVariant(attrs["cta-variant"]);
      return (
        <div className="website-pricing-card">
          <div className="website-pricing-card-header">
            <span className="website-pricing-card-name">{attrs.name}</span>
            {attrs.price && <span className="website-pricing-card-price">{attrs.price}</span>}
          </div>
          <div className="website-pricing-card-body">{children}</div>
          {attrs.cta && attrs["cta-href"] && (
            <a
              className={`${stampsButton({ variant: ctaVariant })} website-button-link website-pricing-card-cta`}
              href={attrs["cta-href"]}
              style={{ textDecoration: "none", ...WEBSITE_BUTTON_VARIANT_STYLE[ctaVariant] }}
            >
              {attrs.cta}
            </a>
          )}
        </div>
      );
    },

    button({ attrs }) {
      if (!attrs.text || !attrs.href) return null;
      const variant = toWebsiteButtonVariant(attrs.variant);
      // `stamps/button.css`'s own recipe -- see this file's header comment
      // for why the `::button` directive uses the site's ordinary button
      // look instead of a bespoke one. `textDecoration: "none"` inline --
      // the recipe is applied polymorphically to `<button>`/`<a>`/`<Link>`
      // across the app and never bakes in an anchor-specific reset itself
      // (same convention `v2.tsx`'s own nav `<Link>` already uses).
      // `website-button-link` -- see `oxmarkdown.css`'s own `.ox-content a`
      // rule (and `website.css`'s comment on this class) for why a plain
      // recipe class alone isn't enough on an `<a>` here: a REAL BUG, not
      // just belt-and-suspenders (confirmed via a real render, not just
      // CSS-reading) -- `.ox-content a`'s own `color` rule is MORE specific
      // than the recipe's own plain class and was winning the cascade
      // regardless of variant.
      return (
        <a
          className={`${stampsButton({ variant })} website-button-link`}
          href={attrs.href}
          style={{ textDecoration: "none", ...WEBSITE_BUTTON_VARIANT_STYLE[variant] }}
        >
          {attrs.text}
        </a>
      );
    },

    badge({ attrs }) {
      if (!attrs.text) return null;
      return <Badge variant={toBadgeVariant(attrs.variant)}>{attrs.text}</Badge>;
    },

    "daily-log"({ attrs }) {
      const date = attrs.date;
      const project = attrs.project;
      if (!date || !project) return null;
      const entry = opts.dailyLogEntries[dailyLogEntryKey(date, project)];
      // Unresolved (typo'd date/project, or that day never got a Card for
      // that project) renders nothing — same fail-soft convention
      // `::gallery{folder="..."}` already uses for an unresolved folder.
      if (!entry) return null;
      return (
        <div className="website-daily-log-embed">
          <div className="website-daily-log-embed-header">
            <span className="website-daily-log-embed-project">{entry.projectName}</span>
            <span className="website-daily-log-embed-date">{entry.date}</span>
          </div>
          <OxRenderer markdown={entry.content} />
        </div>
      );
    },
  };
}
