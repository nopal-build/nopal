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
 *   :::section{bg="cream|peach|mint|lavender" accent="red|green|purple" list="timeline"}
 *     — full-bleed colored band; body renders through the ordinary
 *     pipeline. `accent` recolors headings (named-color vocabulary, same
 *     as `:::section-title`/`::line`); `list` swaps in a NAMED bullet
 *     style for the body's own lists (a small dot + connecting line for
 *     `"timeline"` today) -- a whole pre-designed look, not a raw color,
 *     same "named vocabulary" spirit `bg` itself already has. Both
 *     optional/independent of each other. Deliberately a themeable-area
 *     directive, not a fully bespoke-per-section one: bg/accent/list are
 *     the handful of knobs worth exposing, not every possible CSS
 *     property.
 *   ::stamp{name="coffee|mtn|nopal|quail" rotate="deg" float="left|right|inline" id="..."}
 *     — a complete, pre-designed postage-stamp graphic (see
 *     `websiteStamps.tsx`); `id` doubles as a waypoint.
 *   ::icon{name="..." size="sm|md|lg" id="..."} — a bare named
 *     illustration, for inline glyphs or standalone floating shapes.
 *   ::waypoint{id="..."} — an invisible anchor for the (future) wavy
 *     connector overlay to measure; renders nothing visible on its own.
 *   :::section-title{icon="..." color="red|green|purple"} — an icon + a
 *     real heading + (usually) a `::line{...}` composed together as one
 *     titled-header unit; see `website.css`'s `.website-section-title` for
 *     the layout. The heading stays real markdown inside it, so an
 *     unaware renderer just shows a plain heading, no visible artifact.
 *     `color` recolors JUST the heading text (same named-color vocabulary
 *     as `:::section{accent="..."}`, via the same
 *     `data-website-color`-attribute-selector technique) — it does NOT
 *     also recolor a `::line{...}` nested alongside it; that's `::line`'s
 *     own, independent `color` attribute (below), since a bare `::line`
 *     needs to work with no `:::section-title` around it at all.
 *   ::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}
 *     — the shared wavy-line primitive (`WavyLine.tsx` +
 *     `oxmarkdown-core`'s `buildSplinePath`/`resolveLinePoints`),
 *     fixed-points mode: "a line is drawn from one end to the other" — a
 *     cursor starts at the box's own top-left corner (normalized to a
 *     `0-100` (x) / `0-40` (y) box local to whatever `::line` is nested
 *     inside) and walks forward, per-axis, per point. EACH half of a
 *     pair is independently either:
 *       - a plain number — a DELTA: moves the cursor BY that amount from
 *         wherever it already was (cumulative), same as before.
 *       - a reference letter + optional number (default offset `0`) —
 *         an ANCHOR, pixel-referenceable to the box's own known geometry
 *         instead of the previous point: `L`/`C`/`R` (left/center/right)
 *         for x, `T`/`C`/`B` (top/center/bottom) for y. Case-insensitive.
 *         Same "inset" convention as CSS's own `top`/`right`/`bottom`/
 *         `left`: `T`/`L` add AWAY from that edge, `B`/`R` subtract
 *         INWARD from that edge, `C` adds in the ordinary positive-axis
 *         direction. E.g. `R0` = exactly the right edge, `B1` = 1 unit
 *         up from the bottom, `C5` = 5 past center.
 *     Anchors and deltas mix freely, per-axis, at any point (including
 *     the first) — e.g. `points="L0,B1 C5,B4 R0,B0"` is three fully-
 *     anchored points (bottom-left, up near center, exactly bottom-
 *     right); `points="0,41 c,38"` anchors point 2's x to dead-center
 *     while its y still continues normally as a delta (`41 + 38`). Pure-
 *     delta strings like `points="3,42 58,35 100,42"` behave exactly as
 *     before — the cursor simply starts at `(0,0)`, so point 1's plain
 *     numbers already come out absolute with no special-casing needed.
 *     The line's own element is sized to exactly fit the resulting
 *     path's bounding box (not the whole containing box), recomputed to
 *     real pixels on every resize (not just stretched via
 *     `preserveAspectRatio`). `color` (same named vocabulary as
 *     `accent`/`section-title`'s `color`) sets the stroke directly via
 *     `WavyLine`'s own `color` prop — omit it and the line just inherits
 *     whatever `currentColor` resolves to (`WavyLine`'s default). The
 *     SAME primitive's `waypoints` mode (measuring live
 *     `data-waypoint-id` positions instead of fixed points, all
 *     absolute — anchor/delta semantics don't apply there) is built in
 *     `WavyLine.tsx` but not wired to a directive yet — reserved for the
 *     Home template's page-spanning connector.
 *   :::pricing-card{name="..." price="..." cta="..." cta-href="..."} —
 *     body is an ordinary bullet list of features.
 *   ::button{text="..." href="..."} — a standalone CTA pill link (the
 *     pricing card's own `cta`/`cta-href` render through the same
 *     `.website-button` style).
 *   ::badge{text="..." variant="neutral|success|warning|danger"} — a
 *     status pill, reusing `stamps/Badge` (same component the "Draft"
 *     preview banner already uses) rather than a bespoke style.
 *   ::daily-log{date="YYYY-MM-DD" project="..."} — a curated, static embed
 *     of one real daily-log Card, resolved server-side (see
 *     `robustness-core/data/website.server.ts`'s
 *     `resolveWebsiteDailyLogEntries`) since it needs real vault/DB access
 *     `OxRenderer` never has on its own.
 */
import type { DirectiveRegistry } from "./directiveRegistry";
import { WebsiteIcon } from "./websiteIcons";
import { WebsiteStamp } from "./websiteStamps";
import { WavyLine } from "./WavyLine";
import OxRenderer from "../components/OxRenderer";
import { Badge } from "stamps/Badge";
import { parseLinePoints, type LineCurveKind } from "oxmarkdown-core";
import "../styles/website.css";

const LINE_CURVE_KINDS = ["smooth", "straight", "bezier"] as const;
function toLineCurveKind(v: string | undefined): LineCurveKind {
  return (LINE_CURVE_KINDS as readonly string[]).includes(v ?? "") ? (v as LineCurveKind) : "smooth";
}

/** Same named-color vocabulary `:::section{accent="..."}` already uses --
 * shared here so `::line{color="..."}` resolves to the exact same CSS
 * variable a `color="..."` on `:::section-title{...}` would (that one
 * goes through CSS attribute selectors instead -- see `website.css` --
 * since it targets a heading already rendered as `children`, not a prop
 * this registry can pass directly). `red`/`green` read the SAME scheme-
 * aware `--website-accent-*` tokens `:::section-title{color="..."}`
 * reads (website.css) -- a line drawn alongside a green/red heading
 * should recolor right along with it in dark mode, not go stale.
 * `purple` stays a literal, scheme-invariant token (no dark-mode
 * counterpart exists for it, by design -- see website.css). */
const ACCENT_COLOR_VARS: Record<string, string> = {
  red: "var(--website-accent-red)",
  green: "var(--website-accent-green)",
  purple: "var(--purple)",
};
function toAccentColorVar(name: string | undefined): string | undefined {
  return name ? ACCENT_COLOR_VARS[name] : undefined;
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
  cream: "website-bg-cream",
  peach: "website-bg-peach",
  mint: "website-bg-mint",
  lavender: "website-bg-lavender",
};

export function buildWebsiteDirectiveRegistry(opts: {
  dailyLogEntries: Record<string, WebsiteDailyLogEntry>;
}): DirectiveRegistry {
  return {
    section({ attrs, children }) {
      const bgClass = SECTION_BG_CLASS[attrs.bg ?? ""] ?? "";
      return (
        <section
          className={`website-section ${bgClass}`}
          data-website-accent={attrs.accent || undefined}
          data-website-list={attrs.list || undefined}
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
        />
      );
    },

    icon({ attrs }) {
      const size = attrs.size === "sm" || attrs.size === "lg" ? attrs.size : "md";
      return <WebsiteIcon name={attrs.name ?? ""} size={size} waypointId={attrs.id} />;
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

    "pricing-card"({ attrs, children }) {
      return (
        <div className="website-pricing-card">
          <div className="website-pricing-card-header">
            <span className="website-pricing-card-name">{attrs.name}</span>
            {attrs.price && <span className="website-pricing-card-price">{attrs.price}</span>}
          </div>
          <div className="website-pricing-card-body">{children}</div>
          {attrs.cta && attrs["cta-href"] && (
            <a className="website-button website-pricing-card-cta" href={attrs["cta-href"]}>
              {attrs.cta}
            </a>
          )}
        </div>
      );
    },

    button({ attrs }) {
      if (!attrs.text || !attrs.href) return null;
      return (
        <a className="website-button" href={attrs.href}>
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
