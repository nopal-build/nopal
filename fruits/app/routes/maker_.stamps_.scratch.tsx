// app/routes/maker_.stamps_.scratch.tsx
//
// A working scratch pad for the `/v2` website directives
// (`oxmarkdown/websiteDirectives.tsx`) — reachable from the Stamps guide
// (`/maker/stamps`), not nested under it (same "escape nesting at both
// `maker_` and `stamps_`" convention as `maker_.stamps_.oxmarkdown.tsx`).
// Admin/Super gated, same as the rest of `/maker`.
//
// Purpose: one row per directive, plain markdown source on the left,
// static rendering on the right — so the visual gap between "what the
// directive currently produces" and "what the design actually wants"
// is easy to see side by side while that design gets worked out. Static
// only (no editor) — these directives have no Editing-mode rendering yet
// (see `websiteDirectives.tsx`'s own header), so a live editor here would
// just show the generic "Unknown block" placeholder anyway.
//
// Convention for future edits: add a new `ENTRIES` item whenever a new
// website directive is added, or extend an existing one when its render
// implementation changes — keep this in sync with the real
// `buildWebsiteDirectiveRegistry` vocabulary, don't let it drift into its
// own separate list.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useRouteError, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { DrawerContent } from "stamps/DrawerContent";
import { Grid } from "stamps/Grid";
import { Stack } from "stamps/Stack";
import { ErrorPanel } from "stamps/ErrorPanel";
import { link } from "stamps/link.css";
import { navLink } from "stamps/navLink.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import "../styles/scratch.css";

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireMakerAccess(request);
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <CenterContent maxWidth={480}>
          <ErrorPanel
            status={403}
            title="Access Denied"
            message="The Stamps guide is only available to Admin and Super accounts."
            action={
              <Link to="/maker" className={`${link} ${textSize.sm}`}>
                ← Back to Maker
              </Link>
            }
          />
        </CenterContent>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <CenterContent maxWidth={480}>
        <ErrorPanel
          title="Something went wrong"
          message={
            isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred."
          }
          action={
            <Link to="/maker" className={`${link} ${textSize.sm}`}>
              ← Back to Maker
            </Link>
          }
        />
      </CenterContent>
    </AppLayout>
  );
}

// ─── Entries ────────────────────────────────────────────────────────────────

type ScratchEntry = {
  id: string;
  /** The directive name(s) this entry demonstrates. */
  directive: string;
  /** One line on what it's for / how it's currently implemented — the
   * "current implementation" half of the design-vs-directive comparison. */
  note: ReactNode;
  markdown: string;
  /** Sections/pricing-cards render their own full-bleed background and
   * padding — let that reach the preview box's own edge instead of
   * double-padding it. Everything else gets the box's normal padding. */
  fullBleed?: boolean;
  /** A directive whose own layout is `position: absolute` inside its
   * nearest positioned ancestor (`::line{...}` on its own, without a
   * `:::section-title{...}` around it to supply real height) needs the
   * preview box itself to reserve some height to draw into -- an
   * absolutely-positioned element contributes zero to its parent's own
   * auto height. */
  previewMinHeight?: number;
};

const ENTRIES: ScratchEntry[] = [
  {
    id: "section",
    directive: ':::section{bg="..." accent="..."}',
    note: (
      <>
        Container. <code>bg</code> picks a full-bleed background class
        (<code>cream</code>/<code>peach</code>/<code>mint</code>/<code>lavender</code>,
        each aliasing an existing palette token — see{" "}
        <code>website.css</code>); <code>accent</code> optionally recolors
        headings inside it (<code>red</code>/<code>green</code>/<code>purple</code>)
        via a <code>data-website-accent</code> attribute. Body renders through the
        ordinary OxRenderer pipeline — nothing section-specific about the
        heading/paragraph/list styling itself.
      </>
    ),
    fullBleed: true,
    markdown: `:::section{bg="mint" accent="green"}
## At a Cost

- We favored synthetic materials for their higher performance metrics.
- The risks increased and the improvements diminished.
:::`,
  },
  {
    id: "stamp",
    directive: '::stamp{name="..." rotate="deg" float="left|right|inline" id="..."}',
    note: (
      <>
        Leaf. Renders one of the complete, pre-designed postage-stamp SVGs
        (<code>coffee</code>/<code>mtn</code>/<code>nopal</code>/<code>quail</code>,
        each with a light/dark pair swapped via <code>prefers-color-scheme</code>{" "}
        — see <code>websiteStamps.tsx</code>). An unregistered name shows a
        dashed "stamp: name" placeholder instead of vanishing. <code>id</code>{" "}
        also doubles as a waypoint for the (not-yet-built) wavy connector.
      </>
    ),
    markdown: '::stamp{name="quail" rotate="-6" float="inline"}',
  },
  {
    id: "stamp-missing",
    directive: "::stamp{...} — unregistered name",
    note: "Same directive, a name with no matching asset yet — the fallback placeholder.",
    markdown: '::stamp{name="climber"}',
  },
  {
    id: "icon",
    directive: '::icon{name="..." size="sm|md|lg" id="..."}',
    note: (
      <>
        Leaf. Checks real file-based assets first (only <code>sun-home</code>{" "}
        today), then a small set of inline-drawn placeholder shapes
        (<code>circle</code>/<code>arrow</code>/<code>blob</code>), then falls
        back to a labeled dashed circle for anything else — see{" "}
        <code>websiteIcons.tsx</code>. Meant for small inline glyphs or
        standalone floating shapes, distinct from <code>::stamp</code>'s
        full postage-stamp graphics.
      </>
    ),
    markdown: '::icon{name="sun-home" size="lg"}',
  },
  {
    id: "icon-placeholder",
    directive: "::icon{...} — placeholder shape",
    note: "A registered placeholder name (no real asset yet) vs. a totally unregistered one, side by side. (Leaf directives need their own line each -- two on the same line don't both parse.)",
    markdown: '::icon{name="arrow"}\n::icon{name="totally-made-up"}',
  },
  {
    id: "waypoint",
    directive: '::waypoint{id="..."}',
    note: (
      <>
        Leaf, invisible on purpose — a zero-size anchor
        (<code>data-waypoint-id</code>) for the not-yet-built wavy connector
        overlay to measure. Nothing to see here today (that's the point);
        included so the directive's own markup is visible in the DOM. Needs
        its own line, same as any leaf directive — embedded mid-sentence it
        doesn't parse as a directive at all, just literal text.
      </>
    ),
    markdown: 'Some text before.\n\n::waypoint{id="p1"}\n\nAnd after.',
  },
  {
    id: "line",
    directive: '::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}',
    note: (
      <>
        Leaf. The shared wavy-line primitive (<code>WavyLine.tsx</code> +{" "}
        <code>oxmarkdown-core</code>'s <code>buildSplinePath</code>) in its
        fixed-points mode. <code>points</code> are normalized to a{" "}
        <code>0-100</code> (x) / <code>0-40</code> (y) box local to whatever
        it's nested inside, recomputed to real pixels on every real resize
        (<code>ResizeObserver</code>, not a passive{" "}
        <code>preserveAspectRatio</code> stretch). <code>color</code> sets
        the stroke directly via <code>WavyLine</code>'s own <code>color</code>{" "}
        prop; omit it and the line inherits <code>currentColor</code> instead.
        Needs a positioned ancestor with real height to draw into -- this
        row's own preview box supplies that;{" "}
        <code>:::section-title{'{'}...{'}'}</code> supplies it for the case
        below.
      </>
    ),
    previewMinHeight: 100,
    markdown: '::line{points="0,32 22,6 58,18 100,12" curve="smooth" tension="0.4" color="green"}',
  },
  {
    id: "section-title",
    directive: ':::section-title{icon="..." color="red|green|purple"}',
    note: (
      <>
        Container. An icon + a real heading + (usually) a <code>::line{'{'}...{'}'}</code>{" "}
        composed as one titled-header unit -- see <code>website.css</code>'s{" "}
        <code>.website-section-title</code>. The heading stays real markdown
        inside it, so an unaware renderer just shows a plain heading, no
        visible artifact. <code>color</code> recolors JUST the heading text
        (same named-color vocabulary as <code>:::section</code>'s{" "}
        <code>accent</code>) -- it does NOT also recolor a nested{" "}
        <code>::line{'{'}...{'}'}</code>, which needs its own, independent{" "}
        <code>color</code> attribute since it has to work standalone too.
        First real case: Terrain's "At a Cost" heading.
      </>
    ),
    fullBleed: true,
    markdown: `:::section-title{icon="mountaineer-coffee" color="green"}
::line{points="0,32 22,6 58,18 100,12" curve="smooth" tension="0.4" color="green"}
## At a Cost
:::`,
  },
  {
    id: "pricing-card",
    directive: ':::pricing-card{name="..." price="..." cta="..." cta-href="..."}',
    note: (
      <>
        Container. Header row (name + price) + body (ordinary children,
        typically a bullet list) + an optional CTA rendered through the same
        <code>.website-button</code> style as a standalone <code>::button</code>.
      </>
    ),
    markdown: `:::pricing-card{name="Light-Guide" price="$1,499/mo" cta="Meet with a Guide" cta-href="#"}
- Everything in Self-Guide and...
- Three 90 minute meetings
- One report
:::`,
  },
  {
    id: "button",
    directive: '::button{text="..." href="..."}',
    note: "Leaf. A standalone CTA pill link — same visual class the pricing card's own cta uses.",
    markdown: '::button{text="Meet with a Guide" href="#"}',
  },
  {
    id: "badge",
    directive: '::badge{text="..." variant="neutral|success|warning|danger"}',
    note: (
      <>
        Leaf. Renders <code>stamps/Badge</code> directly — the same
        component the "Draft" preview banner already uses — rather than a
        bespoke pill style.
      </>
    ),
    markdown: '::badge{text="Coming Soon" variant="danger"}',
  },
  {
    id: "daily-log",
    directive: '::daily-log{date="YYYY-MM-DD" project="..."}',
    note: (
      <>
        Leaf. Resolved server-side (<code>website.server.ts</code>'s{" "}
        <code>resolveWebsiteDailyLogEntries</code>) against the website
        owner's own Daily Log Cards — needs real vault/DB access this
        static playground doesn't have, so it renders nothing here (same
        fail-soft behavior an unresolved reference gets on the real site).
      </>
    ),
    markdown: '::daily-log{date="2026-08-26" project="Crouch Casita"}',
  },
  {
    id: "toggle",
    directive: ':::toggle{collapsed="true"} (not new — the existing built-in, reused for FAQ)',
    note: (
      <>
        Not a website-specific directive — the pre-existing Notion-style
        Toggle List, reused as-is for the Guides page's FAQ. Included here
        since it's part of the same content vocabulary these pages compose
        with.
      </>
    ),
    markdown: `:::toggle
Can I change between plans?

Yes, at the end of each contract.
:::`,
  },
];

// ─── Layout ─────────────────────────────────────────────────────────────────

/** `"section-title"` -> `"Section title"` -- just for the drawer nav label;
 * the full `entry.directive` signature is still shown in the main content. */
function formatEntryLabel(id: string): string {
  const words = id.split("-");
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}

const drawerNavLinkClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

function ScratchNav({
  focusedId,
  onFocus,
}: {
  focusedId: string;
  onFocus: (id: string) => void;
}) {
  return (
    <Stack gap={1}>
      <div
        className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
        style={{ color: semanticColors.textSubtle }}
      >
        Examples
      </div>
      {ENTRIES.map((entry) => {
        const isFocused = entry.id === focusedId;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onFocus(entry.id)}
            // Deliberately NOT `navLink`'s own `active` variant -- that
            // one hardcodes dark purple text on the assumption of a light
            // pill background (`navActiveBg`), which these buttons don't
            // have (`background: none` below). `scratch-focus-accent`
            // (scratch.css) gives the SAME purple-in-light/white-in-dark
            // treatment the focused entry's own border/label use, so both
            // stay consistent and legible in dark mode.
            className={`${navLink({ context: "drawer" })} ${drawerNavLinkClass} ${isFocused ? "scratch-focus-accent" : ""}`}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: isFocused ? 700 : undefined,
            }}
          >
            {formatEntryLabel(entry.id)}
          </button>
        );
      })}
    </Stack>
  );
}

function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", mb: 2 })}`}
      style={{ color: semanticColors.textSubtle, textTransform: "uppercase", letterSpacing: "0.05em" }}
    >
      {children}
    </div>
  );
}

function Entry({ entry, focused }: { entry: ScratchEntry; focused: boolean }) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return (
    <div
      id={`entry-${entry.id}`}
      // `scratch-focus-accent` (scratch.css) sets `color` per color scheme
      // (dark plum in light mode, plain white in dark mode -- `--purple`
      // alone reads as still-purple, not white, against this app's dark
      // surface). The border then just inherits it via `currentColor`
      // instead of duplicating the same light/dark logic a second time.
      className={`${sprinkles({ p: 5 })} ${focused ? "scratch-focus-accent" : ""}`}
      style={{
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: focused ? "currentColor" : semanticColors.surfaceBorder,
        borderRadius: 8,
      }}
    >
      <div className={sprinkles({ mb: 3 })}>
        {focused && (
          <div
            className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", mb: 1 })}`}
            style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
          >
            ↑ Focused
          </div>
        )}
        <code className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
          {entry.directive}
        </code>
        <p className={`${textSize.sm} ${sprinkles({ mt: 1 })}`} style={{ color: semanticColors.textSubtle, lineHeight: 1.5 }}>
          {entry.note}
        </p>
      </div>
      <Grid gap={4} minColumnWidth={320}>
        <div>
          <ColumnLabel>Markdown source</ColumnLabel>
          <pre
            className={`${textSize.sm} ${sprinkles({ p: 3, fontFamily: "mono" })}`}
            style={{
              background: semanticColors.surfaceInset,
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              margin: 0,
              overflowX: "auto",
            }}
          >
            {entry.markdown}
          </pre>
        </div>
        <div>
          <ColumnLabel>Rendered (static)</ColumnLabel>
          <div
            style={{
              border: `1px solid ${semanticColors.surfaceBorder}`,
              borderRadius: 6,
              padding: entry.fullBleed ? 0 : 16,
              overflow: "hidden",
              // `position: relative` -- required as the positioned
              // ancestor for any directive whose own layout is
              // `position: absolute` (e.g. a bare `::line{...}` with no
              // `:::section-title{...}` around it to supply one itself).
              // `minHeight` -- an absolutely-positioned child contributes
              // zero to this box's own auto height, so that same bare
              // `::line{...}` case needs the box to reserve height by hand.
              position: "relative",
              minHeight: entry.previewMinHeight,
            }}
          >
            <OxRenderer markdown={entry.markdown} directives={registry} />
          </div>
        </div>
      </Grid>
    </div>
  );
}

type ViewMode = "focus" | "all";

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options: { value: ViewMode; label: string }[] = [
    { value: "focus", label: "Focus" },
    { value: "all", label: "See all" },
  ];
  return (
    <div
      className={sprinkles({ display: "inline-flex" })}
      style={{ border: `1px solid ${semanticColors.surfaceBorder}`, borderRadius: 6, overflow: "hidden" }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 3, py: 2 })}`}
          style={{
            border: "none",
            cursor: "pointer",
            background: mode === opt.value ? semanticColors.textBrand : "transparent",
            color: mode === opt.value ? "white" : semanticColors.textSubtle,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Pin whichever entry is actively being iterated on here -- set to `null`
// to fall back to the "newest entry is focused by default" convention
// (the last item in `ENTRIES`) instead.
const DEFAULT_FOCUS_ID: string | null = "section-title";

export default function StampsScratch() {
  const [focusedId, setFocusedId] = useState(DEFAULT_FOCUS_ID ?? ENTRIES[ENTRIES.length - 1].id);
  // "focus": the content area shows ONLY the focused entry -- the default,
  // since a full list is exactly what this option exists to get away from.
  // "all": the old behavior, full list with the focused one pulled to top.
  const [viewMode, setViewMode] = useState<ViewMode>("focus");

  // In "all" mode the focused entry moves to the TOP of the list, with
  // everything else keeping its original relative order behind it. In
  // "focus" mode it's the ONLY entry shown at all.
  const visibleEntries = useMemo(() => {
    const focused = ENTRIES.find((e) => e.id === focusedId);
    if (viewMode === "focus") return focused ? [focused] : [];
    const rest = ENTRIES.filter((e) => e.id !== focusedId);
    return focused ? [focused, ...rest] : ENTRIES;
  }, [focusedId, viewMode]);

  // Reordering/switching modes alone doesn't guarantee the newly-topmost
  // entry is actually in view if the page was scrolled elsewhere --
  // `AppLayout`'s own `<main>` scrolls independently (see
  // `visual-check.ts`'s own note on this), so `scrollIntoView` on the
  // entry itself (not `window`) is what actually works here.
  useEffect(() => {
    document.getElementById(`entry-${focusedId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusedId, viewMode]);

  return (
    <AppLayout>
      <DrawerContent drawer={<ScratchNav focusedId={focusedId} onFocus={setFocusedId} />} title="Examples">
        <CenterContent maxWidth={1100}>
          <div className={sprinkles({ mb: 8 })}>
            <Link
              to="/maker/stamps"
              className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
              style={{ color: semanticColors.textSubtle, textDecoration: "none" }}
            >
              ← Stamps
            </Link>
            <div
              className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 3, mt: 2, mb: 2 })}
            >
              <h1
                className={`${textSize.xl} ${sprinkles({ fontWeight: "bold" })}`}
                style={{ color: semanticColors.textPrimary }}
              >
                Scratch
              </h1>
              <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            </div>
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: 640, lineHeight: 1.5 }}>
              One row per <code>/v2</code> website directive (see{" "}
              <code>oxmarkdown/websiteDirectives.tsx</code>) — plain markdown source
              on the left, a real static rendering on the right, so the gap between
              "what this currently produces" and "what the design actually wants"
              is easy to see side by side while that design gets worked out. Static
              only, no editor — none of these have an Editing-mode rendering yet.
              Pick an example from the drawer to focus it — <code>Focus</code> shows
              just that one, <code>See all</code> shows the full list with it pulled
              to the top.
            </p>
          </div>

          <Stack gap={6}>
            {visibleEntries.map((entry) => (
              <Entry key={entry.id} entry={entry} focused={viewMode === "all" && entry.id === focusedId} />
            ))}
          </Stack>
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
