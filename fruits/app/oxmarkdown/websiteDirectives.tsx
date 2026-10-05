/**
 * DUPLICATED from webapp/app/oxmarkdown/websiteDirectives.tsx -- see
 * `websiteIcons.tsx`'s own header comment here for why this whole
 * directory is duplicated. Not shared; keep both copies in sync by hand.
 * First real consumer here: the Stamps guide's `scratch` playground
 * (`/maker/stamps/scratch`, `routes/maker_.stamps_.scratch.tsx`).
 *
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
 * `::waypoint`, `::line`, `::path`, `::trail`, `::daily-log`) never open a
 * fence at all, so they never trigger this.
 *
 * Directive vocabulary (first functional pass):
 *   :::section{surface="..." palette="..." list="timeline" margin="N"}
 *     — full-bleed colored band; body renders through the ordinary
 *     pipeline. `surface`/`palette` resolve against the page's own
 *     `::swatch`/`::palette` registry (`oxmarkdown-core`'s
 *     `resolveSwatchRole` — see the "Oxmarkdown Colors" garden seed) --
 *     an OPEN vocabulary the page/theme author defines, not a closed
 *     `mint`/`white` enum anymore (that enum, and the `bg=` spelling, are
 *     retired — a real migration, not a silent compatibility shim; see
 *     the garden seed's round 11). Leaving `surface`/`palette` both unset
 *     shows the page's own resting background through instead, reading
 *     as blended-in/invisible rather than a distinct band. `list` swaps
 *     in a NAMED bullet style for the body's own lists (a small dot +
 *     connecting line for `"timeline"` today) -- a whole pre-designed
 *     look, not a raw color. `margin` adds extra top/bottom breathing
 *     room around the section, as a MULTIPLE of the shared `--ox-grid`
 *     unit (41px today) rather than a raw pixel count -- `margin="2"`
 *     means `2 * 41px` = `82px` (see `parseSectionMarginStyle`, below,
 *     for why that stays token-driven instead of a hardcoded number);
 *     negative values pull an adjacent section closer instead.
 *     Deliberately a themeable-area directive, not a fully bespoke-per-
 *     section one: surface/palette/list/margin are the handful of knobs
 *     worth exposing, not every possible CSS property. Heading COLOR is
 *     deliberately NOT one of them -- a section's own headings just read
 *     the ordinary default text color; reach for `:::section-
 *     title{color="..."}` (below) instead when a heading specifically
 *     needs to stand out.
 *   ::stamp{name="coffee|mtn|nopal|quail" rotate="deg" float="left|right|inline" id="..."}
 *     — a complete, pre-designed postage-stamp graphic (see
 *     `websiteStamps.tsx`); `id` doubles as a waypoint.
 *   ::icon{name="..." size="sm|md|lg|#" id="..." position="x,y"} — a bare
 *     named illustration, for inline glyphs or standalone floating
 *     shapes. `size` is one of the three named presets OR a literal pixel
 *     width (see `parseIconSize`'s own comment, below). `position` is
 *     optional -- omit it and the icon renders
 *     inline exactly as it always has; give it an `"x,y"` pair (the SAME
 *     literal-pixel, real-measured-anchor coordinate system
 *     `::line{points="..."}`/`::path{points="..."}` use below -- see
 *     `parseIconPosition`'s own comment for the full story -- anchors and
 *     deltas both work) to absolutely position it INSTEAD, relative to
 *     whatever element it's rendered inside (today: `.website-section-
 *     inner`, for `:::section{...}` -- see `PositionedWebsiteIcon`
 *     (`websiteIcons.tsx`) for why other containers need the same
 *     `position: relative` treatment before this works inside THEM too).
 *   ::waypoint{id="..."} — an invisible anchor for `::trail{waypoints="..."}`
 *     (below) to measure; renders nothing visible on its own. Only needed
 *     when nothing else is already at the spot a trail should pass through
 *     -- `::stamp{id="..."}`/`::icon{id="..."}` already double as waypoints
 *     via their own `id`, no separate `::waypoint` needed alongside one of
 *     those.
 *   :::section-title{icon="..." color="..." h-color="..." palette="..."}
 *     — an icon + a real heading + (usually) a `::line{...}` composed
 *     together as one titled-header unit; see `website.css`'s
 *     `.website-section-title` for the layout. The heading stays real
 *     markdown inside it, so an unaware renderer just shows a plain
 *     heading, no visible artifact. `color` is a BASE text color that
 *     reaches everything inside (ordinary CSS inheritance); `h-color`,
 *     when given, is a MORE SPECIFIC override that wins only for heading
 *     tags — the same "ancestor value vs. a more specific descendant
 *     rule" relationship CSS's own cascade already has, not two
 *     unrelated color slots (see the "Oxmarkdown Colors" garden seed,
 *     round 13). Both resolve against the page's own `::swatch`/
 *     `::palette` registry, same open vocabulary as `:::section{surface=
 *     "..."}` above — `::line{color="..."}` below reads the exact SAME
 *     registry/role now too, so a themed heading and a themed line drawn
 *     alongside it can share one real swatch name and stay in sync (the
 *     OLD `data-website-color`-attribute-selector technique, and the
 *     hardcoded `red`/`green`/`purple` enum both directives used to share,
 *     are retired — see the garden seed's round 14). `color`/`h-color`
 *     do NOT also recolor a `::line{...}` nested alongside it; that's
 *     `::line`'s own, independent `color` attribute (below), since a
 *     bare `::line` needs to work with no `:::section-title` around it
 *     at all — give it the SAME swatch name to make them match on purpose.
 *   ::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}
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
 *     change. `color`/`palette` resolve against the page's own
 *     `::swatch`/`::palette` registry (round 8's cascade,
 *     `oxmarkdown-core`'s `resolveSwatchRole`) — the SAME registry/role
 *     `:::section-title{color="..."}`/`{h-color="..."}` above reads, so a
 *     themed heading and a themed line drawn alongside it can share one
 *     real swatch name and stay in sync on purpose (give both the SAME
 *     name). Resolves to a plain CSS value, set directly via `WavyLine`'s
 *     own `color` prop — omit `color`/leave it unresolved and the line
 *     just inherits whatever `currentColor` resolves to (`WavyLine`'s
 *     default). The SAME primitive's `waypoints` mode (measuring live
 *     `data-waypoint-id` positions instead of fixed points, all
 *     absolute — anchor/delta semantics don't apply there) is what
 *     `::trail{waypoints="..."}` (below) uses instead of fixed `points`.
 *   ::path{points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}
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
 *     `points`/`curve`/`tension`/`color`/`palette` all behave exactly as
 *     they do on `::line` -- see that entry above for the full grammar.
 *     See `oxmarkdown-core`'s `fitAndPositionPoints` for the underlying
 *     math.
 *   :line-word{text="..." points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}
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
 *     `color`/`palette` all behave EXACTLY like `::path{...}` above (same
 *     optional decoupled-scale/position knobs, same grammar) -- see that
 *     entry for the full details; the only new attribute is `text`, the
 *     literal word/phrase to render (a plain attribute, not bracket-label
 *     content, matching how `::button{text="..."}`/`::badge{text="..."}`
 *     already do it elsewhere in this same registry). Renders nothing at
 *     all if either `text` or a usable `points` is missing.
 *   ::trail{waypoints="p1, p2, p3" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}
 *     — the SAME wavy-line primitive as `::line`/`::path` above, but its
 *     points come from LIVE DOM MEASUREMENT instead of any fixed
 *     coordinates: `waypoints` is a comma-separated list of ids, each
 *     referring to some OTHER element's own `data-waypoint-id` elsewhere
 *     on the same page -- a bare `::waypoint{id="..."}` anchor, or `id`
 *     on a `::stamp{...}`/`::icon{...}` (which already carry
 *     `data-waypoint-id` for free -- no separate `::waypoint` needed
 *     alongside one of those). Connects them, IN THE ORDER LISTED, through
 *     each one's own live center point (`getBoundingClientRect`),
 *     re-measured on every real resize -- genuinely different from
 *     `::line`/`::path`'s fixed points, which never look at the DOM at
 *     all. No anchor/delta grammar here (there's nothing to anchor
 *     against but the waypoints themselves); `curve`/`tension`/`color`
 *     behave exactly as they do on `::line` above. Needs at least two
 *     resolvable ids to draw anything; an id with no matching element on
 *     the page is silently skipped, same "missing asset doesn't break the
 *     page" spirit `::icon`'s unregistered-name fallback has, though here
 *     it just means one fewer point rather than a visible placeholder.
 *     Like `::icon{position="..."}`, needs a `position: relative`
 *     ancestor spanning every waypoint it connects to have any visible
 *     effect -- `:::section{...}`'s own body (`.website-section-inner`)
 *     already is, for its first real use; a trail meant to span MULTIPLE
 *     sections needs its own wrapping container with that same treatment,
 *     not yet added anywhere since nothing has needed it yet.
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
 *   ::include-ox{file="./relative/path.md"} — inlines another file's own
 *     markdown, rendered through this SAME directive registry (so a
 *     nav-styled link, an icon, even a nested `::include-ox`, all work
 *     inside the included file exactly like they would inline in the
 *     including page). `file` is resolved RELATIVE TO THE INCLUDING
 *     PAGE'S OWN FOLDER (`./`/`../` supported, clamped so it can never
 *     walk above the website project's own root) — resolved server-side
 *     (see `robustness-core/data/website.server.ts`'s
 *     `resolveWebsiteIncludes`), since it needs real vault/DB access
 *     `OxRenderer` never has on its own -- UNLIKE `::daily-log{...}`
 *     above (which really does always render nothing in the Vault's own
 *     live preview, a real, accepted, explicitly deferred gap), this one
 *     DOES resolve live in the Vault's `WebsitePageSplitEditor` preview
 *     too, against whatever's currently TYPED, not just what's saved --
 *     see `vault.tsx`'s own `resolveIncludes` (debounced POST to
 *     `/api/vault/website/:folderId/resolve-includes`, which just calls
 *     this same `resolveWebsiteIncludes` server-side). A LEAF
 *     directive (`::`, two colons, no children) despite the author-
 *     facing name reading like it might wrap content — it never has any
 *     of its own; the included file supplies everything. Lets an author
 *     hand-write one shared `_footer.md` and include it at the bottom of
 *     every page that wants one, rather than one fixed, settings-driven
 *     footer shape auto-rendered on every page (the OLD
 *     `WebsiteSettings.footer`, removed entirely in favor of this).
 */
import type { CSSProperties } from "react";
import type { DirectiveRegistry } from "./directiveRegistry";
import { WebsiteIcon } from "./websiteIcons";
import { WebsiteStamp } from "./websiteStamps";
import { WavyLine } from "./WavyLine";
import OxRenderer from "../components/OxRenderer";
import { Badge } from "stamps/Badge";
import { button as stampsButton } from "stamps/button.css";
import { parseLinePoints, type LineCurveKind, type LinePointTokens, type LineSizeSpec } from "oxmarkdown-core";
import "../styles/website.css";

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

// `ACCENT_COLOR_VARS`/`toAccentColorVar` (the hardcoded `red`/`green`/
// `purple` -> `--website-accent-*`/`--purple` lookup every color-reading
// directive here used to share) is RETIRED -- round 14 of the "Oxmarkdown
// Colors" garden seed. `color=`/`palette=` on every directive below now
// resolve through the same open, page-defined `::swatch`/`::palette`
// registry instead (`resolveSwatchRole`, supplied on `DirectiveRenderProps`
// -- see `OxRenderer.tsx`'s `boundResolveSwatchRole`), so a themed heading
// and a themed line drawn alongside it share one real swatch name instead
// of two independently-hardcoded enums that happened to agree.

/** `::trail{waypoints="p1, p2, p3"}` -- splits on commas and trims each
 * id, so both `"p1,p2,p3"` and `"p1, p2, p3"` work; drops any empty
 * entries (a stray leading/trailing/doubled comma). Each id refers to a
 * `data-waypoint-id` value some OTHER element in the page already carries
 * -- `::waypoint{id="..."}` itself (an invisible anchor with no other
 * purpose), or `id` on `::stamp{...}`/`::icon{...}` (which double as
 * waypoints for free, no separate `::waypoint` needed alongside one of
 * those). Order matters -- the trail connects them in the order listed
 * here, not document/DOM order. */
function parseWaypointIds(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** `::icon{position="x,y"}` -- reuses `::line{points="x,y x,y ..."}`'s
 * PARSING grammar (`parseLinePoints`, `oxmarkdown-core`'s `wavyLine.ts`:
 * each half a plain delta number or an `L`/`C`/`R` (x) / `T`/`C`/`B` (y)
 * anchor letter) AND, now, its resolved coordinate SYSTEM too -- literal,
 * stable PIXELS, resolved against `WebsiteIcon`'s own REAL measured
 * container size (`websiteIcons.tsx`'s `PositionedWebsiteIcon`), exactly
 * like `::line{points="..."}`/`::path{points="..."}` already resolve
 * every point they're given. This file only parses+validates down to a
 * single token here; `WebsiteIcon` does the actual real-pixel resolution
 * itself (it's the one with a DOM node to measure).
 *
 * USED TO resolve against a fixed nominal `0-100` (x) / `0-40` (y) box
 * instead, turned directly into a plain CSS percentage -- the reasoning
 * at the time was that a SINGLE point has no multi-point "shape" for x/y
 * to distort by scaling independently the way a multi-point line would,
 * so there seemed to be no "funky at different sizes" problem to fix the
 * same way `::line` needed. That missed a real, reported confusion: a
 * percentage-based single point still means "the same authored number is
 * a different real distance in every differently-sized container" --
 * NOT shape distortion, but the exact same "the numbers don't mean what
 * they look like they mean" problem in spirit, and genuinely confusing
 * for an author who'd already learned `::line`'s own literal-pixel
 * convention and reasonably expected `::icon{position="R10,T0"}` to mean
 * the same thing `::line{points="R10,T0"}` would.
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
function parseIconPosition(raw: string | undefined): LinePointTokens | undefined {
  const tokens = parseLinePoints(raw);
  if (tokens.length !== 1 || tokens[0] === "break") return undefined;
  return tokens[0];
}

/** `::icon{size="sm|md|lg|#"}` -- `sm`/`md`/`lg` are the named presets
 * (`websiteIcons.tsx`'s `SIZE_PX`); anything else that parses as a plain
 * finite number is a literal pixel width instead, same "named preset OR a
 * raw pixel number" shape `:::section{margin="N"}` and `::path{width="..."}`
 * already use elsewhere in this file. Falls back to `"md"` for anything
 * else (missing, empty, or unparseable). */
function parseIconSize(raw: string | undefined): "sm" | "md" | "lg" | number {
  if (raw === "sm" || raw === "lg") return raw;
  const px = Number(raw);
  if (raw && Number.isFinite(px)) return px;
  return "md";
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

// `SECTION_BG_CLASS` (the hardcoded `mint`/`white` -> precompiled
// className lookup `:::section{bg="..."}` used to read) is RETIRED --
// round 14 of the "Oxmarkdown Colors" garden seed. `surface=`/`palette=`
// now resolve through the page's own open `::swatch`/`::palette`
// registry instead (see the `section` registry entry below).

export function buildWebsiteDirectiveRegistry(opts: {
  dailyLogEntries: Record<string, WebsiteDailyLogEntry>;
  /** Resolved `::include-ox{file="..."}` references -- see
   * `website.server.ts`'s `resolveWebsiteIncludes`. Keyed by the literal
   * `file="..."` attribute string (not an absolute path), each value the
   * included file's own already-frontmatter-stripped markdown body.
   * `WebsitePageSplitEditor` (`vault.tsx`) resolves this live, against
   * the CURRENTLY-typed body, via a debounced call to
   * `/api/vault/website/:folderId/resolve-includes` -- every other
   * caller here (the `/maker/stamps/scratch` guide, `SyncApiRunEditor`)
   * just leaves it `{}` (defaulted below), same fail-soft rendering
   * `::include-ox{...}` always has for an unresolved reference. */
  includes?: Record<string, string>;
  /** Forces `::stamp{...}`'s light/dark asset pick, bypassing its own
   * `<picture>`/`<source media="...">` OS-driven selection -- see
   * `WebsiteStamp`'s own `forcedScheme` comment (`websiteStamps.tsx`) for
   * why that needs an explicit override instead of a CSS trick. Passed
   * by the Vault website editor's / `/maker/stamps/scratch` guide's own
   * preview toggle; leave undefined for the real public `/v2` page. */
  forcedScheme?: "light" | "dark";
}): DirectiveRegistry {
  const includes = opts.includes ?? {};
  // Real cycle detection -- `chain` is every `file` already an ancestor
  // of this exact render (currently in the middle of being rendered,
  // however many hops up); see webapp's identical copy of this file for
  // the full reasoning (why a MUTUAL two-file cycle happens to be
  // harmless today without this, why a direct self-reference genuinely
  // isn't, and why this is scoped to one render branch rather than one
  // Set shared across the whole page).
  function includeOxHandler(chain: readonly string[]) {
    return ({ attrs }: { attrs: Record<string, string> }) => {
      const file = attrs.file;
      if (!file) return null;
      if (chain.includes(file)) return null;
      const content = includes[file];
      // Unresolved (bad/missing relative path, the referenced file no
      // longer exists, or -- always true in the Vault preview here, see
      // this file's own header comment -- `includes` was never given a
      // real resolved map) renders nothing -- same fail-soft convention
      // `::daily-log{...}`/`::gallery{folder="..."}` already use.
      if (!content) return null;
      // `directives={...}` -- THIS SAME registry, recursively, except
      // `include-ox` itself is swapped for a fresh handler carrying the
      // EXTENDED chain -- see webapp's identical copy for the full
      // reasoning.
      return (
        <OxRenderer
          markdown={content}
          directives={{ ...registry, "include-ox": includeOxHandler([...chain, file]) }}
          className="ox-no-heading-marks ox-no-dots website-page-ox"
        />
      );
    };
  }

  // Named (not an inline `return { ... }`) so `includeOxHandler`, above
  // (only ever INVOKED later at render time), can close over this SAME
  // object to spread into each nested call's own registry.
  const registry: DirectiveRegistry = {
    section({ attrs, children, resolveSwatchRole }) {
      const surface = resolveSwatchRole({ role: "surface", explicit: attrs.surface, palette: attrs.palette });
      return (
        <section
          className="website-section"
          data-website-list={attrs.list || undefined}
          style={{ ...parseSectionMarginStyle(attrs.margin), background: surface }}
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
      const size = parseIconSize(attrs.size);
      return (
        <WebsiteIcon
          name={attrs.name ?? ""}
          size={size}
          waypointId={attrs.id}
          position={parseIconPosition(attrs.position)}
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

    "section-title"({ attrs, children, resolveSwatchRole }) {
      // `color` is a BASE text color (ordinary CSS inheritance reaches
      // everything inside, including the heading); `h-color`, when given,
      // is a MORE SPECIFIC override that wins only for heading tags -- see
      // the private `--website-section-title-h-color` custom property +
      // `website.css`'s own `:is(h1, ..., h6)` rule reading it (round 13 of
      // the "Oxmarkdown Colors" garden seed). Falls back to `color`'s own
      // resolved value when `h-color` isn't given, so a bare `color="..."`
      // alone still reaches the heading too, matching today's real default.
      const color = resolveSwatchRole({ role: "color", explicit: attrs.color, palette: attrs.palette });
      const hColor = resolveSwatchRole({ role: "color", explicit: attrs["h-color"], palette: attrs.palette });
      return (
        <div
          className="website-section-title"
          style={{ color, "--website-section-title-h-color": hColor ?? color } as CSSProperties}
        >
          {attrs.icon && <WebsiteIcon name={attrs.icon} size="md" />}
          {children}
        </div>
      );
    },

    line({ attrs, resolveSwatchRole }) {
      const points = parseLinePoints(attrs.points);
      if (points.length < 2) return null;
      const tension = attrs.tension ? Number(attrs.tension) : undefined;
      return (
        <WavyLine
          mode="points"
          points={points}
          curve={toLineCurveKind(attrs.curve)}
          tension={Number.isFinite(tension) ? tension : undefined}
          color={resolveSwatchRole({ role: "color", explicit: attrs.color, palette: attrs.palette })}
          className="website-line"
        />
      );
    },

    path({ attrs, resolveSwatchRole }) {
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
          color={resolveSwatchRole({ role: "color", explicit: attrs.color, palette: attrs.palette })}
          className="website-path"
        />
      );
    },

    "line-word"({ attrs, resolveSwatchRole }) {
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
            color={resolveSwatchRole({ role: "color", explicit: attrs.color, palette: attrs.palette })}
            className="website-line-word"
          />
        </span>
      );
    },

    trail({ attrs, resolveSwatchRole }) {
      const waypointIds = parseWaypointIds(attrs.waypoints);
      if (waypointIds.length < 2) return null;
      const tension = attrs.tension ? Number(attrs.tension) : undefined;
      return (
        <WavyLine
          mode="waypoints"
          waypointIds={waypointIds}
          curve={toLineCurveKind(attrs.curve)}
          tension={Number.isFinite(tension) ? tension : undefined}
          color={resolveSwatchRole({ role: "color", explicit: attrs.color, palette: attrs.palette })}
          className="website-trail"
        />
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

    "include-ox": includeOxHandler([]),
  };
  return registry;
}
