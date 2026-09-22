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
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useRouteError, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { DrawerContent } from "stamps/DrawerContent";
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
        fixed-points mode. "A line is drawn from one end to the other": a
        cursor starts at the box's own top-left corner (normalized to a{" "}
        <code>0-100</code> (x) / <code>0-40</code> (y) box) and walks
        forward, per-axis, per point. Each half of a pair is either a plain
        number (a DELTA -- moves the cursor by that amount, cumulative) or a
        reference letter plus optional offset (an ANCHOR, pixel-
        referenceable to the box's own geometry instead of the previous
        point): <code>L</code>/<code>C</code>/<code>R</code> for x,{" "}
        <code>T</code>/<code>C</code>/<code>B</code> for y (same CSS-inset
        convention as <code>top</code>/<code>right</code>/<code>bottom</code>/
        <code>left</code> -- <code>T</code>/<code>L</code> add away from that
        edge, <code>B</code>/<code>R</code> subtract inward from it,{" "}
        <code>C</code> adds past center). Anchors and deltas mix freely, per
        axis, at any point -- pure-delta strings behave exactly as before
        since the cursor simply starts at (0,0). Sized to exactly fit the
        resulting path's own bounding box, recomputed to real pixels on
        every real resize (<code>ResizeObserver</code>, not a passive{" "}
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
    markdown: '::line{points="L0,B1 C5,B4 R0,B0" curve="smooth" tension="0.4" color="green"}',
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
::line{points="L1,B0 R16,B4 R0,B0" curve="smooth" tension="0.4" color="green"}
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

/** Shared "jump into Focus mode on this entry" control -- used by each
 * `EntryListRow` (List mode); the drawer's own nav buttons
 * (`ScratchNav`) call the exact same `onFocus` callback from
 * `StampsScratch`, just via a different control. */
function FocusButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 3, py: 2 })}`}
      style={{
        border: `1px solid ${semanticColors.textBrand}`,
        borderRadius: 6,
        background: "none",
        cursor: "pointer",
        color: semanticColors.textBrand,
      }}
    >
      Focus →
    </button>
  );
}

/** One `Rendered (static)` preview box, shared by both `FocusedEntryView`
 * and `EntryListRow` -- only the surrounding layout (dominant vs. a small
 * fixed-size thumbnail) differs between the two, not this box's own
 * styling rules. */
function PreviewBox({
  entry,
  markdown,
  minHeight,
  previewScheme,
}: {
  entry: ScratchEntry;
  markdown: string;
  minHeight: number;
  /** Forces this box's own `--website-accent-*`/`--website-bg-page`
   * tokens (website.css) to a specific scheme via a plain descendant
   * custom-property override (`.website-preview-force-{light,dark}`),
   * regardless of the browser's actual `prefers-color-scheme` -- lets
   * the guide's own toggle preview either one on demand. */
  previewScheme: "light" | "dark";
}) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return (
    <div
      className={previewScheme === "dark" ? "website-preview-force-dark" : "website-preview-force-light"}
      style={{
        border: `1px solid ${semanticColors.surfaceBorder}`,
        borderRadius: 6,
        padding: entry.fullBleed ? 0 : 16,
        // The `/v2` site's own resting background (`website.css`) --
        // without this, the box just showed the SCRATCH PAD's own card
        // background through (transparent here), which never changed
        // with `previewScheme` at all even though the token driving it
        // already did (nothing was actually painting with it).
        background: "var(--website-bg-page)",
        // `visible`, NOT `hidden` -- a `::line{points="..."}` whose
        // cumulative deltas add up to more than one `viewBoxHeight` (or
        // `width` for x) will render TALLER/WIDER than this box, by
        // design (that's the caller's own `viewBoxHeight` tuning to do,
        // not a bug here) -- clipping it away silently would make the
        // mechanism look broken instead of just untuned, defeating the
        // whole point of a scratchpad meant to make that gap visible.
        overflow: "visible",
        // `position: relative` -- required as the positioned ancestor for
        // any directive whose own layout is `position: absolute` (e.g. a
        // bare `::line{...}` with no `:::section-title{...}` around it
        // to supply one itself). `minHeight` -- an absolutely-positioned
        // child contributes zero to this box's own auto height, so that
        // same bare `::line{...}` case needs the box to reserve height
        // by hand; it also doubles here as "how dominant should this
        // preview look" (large in Focus mode, a small thumbnail in List
        // mode) -- see each caller's own `minHeight` value.
        position: "relative",
        minHeight,
      }}
    >
      <OxRenderer markdown={markdown} directives={registry} className="ox-no-dots" />
    </div>
  );
}

/** List mode's compact row -- a small, read-only preview thumbnail next
 * to this entry's directive signature, its OWN pristine markdown (never
 * edited; that only happens in Focus mode's separate copy), its note,
 * and a button to jump into Focus mode on it. No local edit state at all
 * here, unlike `FocusedEntryView` -- nothing in this row is editable. */
function EntryListRow({
  entry,
  onFocus,
  previewScheme,
}: {
  entry: ScratchEntry;
  onFocus: () => void;
  previewScheme: "light" | "dark";
}) {
  return (
    <div
      className={sprinkles({ display: "flex", gap: 4 })}
      style={{
        border: `1px solid ${semanticColors.surfaceBorder}`,
        borderRadius: 8,
        padding: 16,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "0 0 260px", minWidth: 0 }}>
        <ColumnLabel>Render</ColumnLabel>
        {/* `maxHeight` + `overflow: auto`, NOT `alignItems: stretch` on the
            row -- a wide/tall real example (e.g. `:::section{...}`'s own
            mint box, full of wrapped paragraph/list text) would otherwise
            balloon this thumbnail's natural content height, which (via
            `stretch`) would then balloon the WHOLE row to match, including
            its sibling text column. Capping height here keeps every row a
            predictable, scannable size regardless of how tall any one
            example's real render happens to be. */}
        <div style={{ maxHeight: 220, overflow: "auto" }}>
          <PreviewBox entry={entry} markdown={entry.markdown} minHeight={entry.previewMinHeight ?? 120} previewScheme={previewScheme} />
        </div>
      </div>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <code className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
          {entry.directive}
        </code>
        <div className={sprinkles({ mt: 2, mb: 2 })}>
          <ColumnLabel>Markdown example (not editable)</ColumnLabel>
          <pre
            className={`${textSize.xs} ${sprinkles({ p: 2, fontFamily: "mono" })}`}
            style={{
              background: semanticColors.surfaceInset,
              borderRadius: 6,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {entry.markdown}
          </pre>
        </div>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, lineHeight: 1.5 }}>
          {entry.note}
        </p>
        <div className={sprinkles({ mt: 3 })}>
          <FocusButton onClick={onFocus} />
        </div>
      </div>
    </div>
  );
}

/** Focus mode's single, dominant view of one entry -- the whole reason
 * "Focus" exists: the rendered static output gets as much width AND
 * height as possible, with the editable markdown source + this entry's
 * own directive signature/note demoted to a narrow sidebar underneath
 * each other, not competing for space with the render. */
function FocusedEntryView({ entry, previewScheme }: { entry: ScratchEntry; previewScheme: "light" | "dark" }) {
  // Local edit state -- `StampsScratch` mounts this with `key={entry.id}`,
  // so switching to a DIFFERENT focused entry always starts a fresh
  // `useState(entry.markdown)` instead of carrying over stale edits from
  // whatever was focused before.
  const [markdown, setMarkdown] = useState(entry.markdown);
  const isDirty = markdown !== entry.markdown;

  // Auto-grows the textarea to EXACTLY fit its own content -- including
  // wrapped lines, which a naive `rows={markdown.split("\n").length}`
  // undercounts the moment any single line wraps in this narrow sidebar
  // column (a real bug: a long `:::section-title{...}` attribute line
  // was getting cut off with an internal scrollbar). Re-measuring the
  // browser's own `scrollHeight` (not a guessed chars-per-row heuristic)
  // is exact regardless of font/width, and re-runs on every edit AND on
  // this component's initial mount alike, so a freshly-focused entry
  // always starts already sized to fit its own starting content, no
  // scrollbar needed. Reset height to "auto" first so shrinking (fewer
  // lines after an edit, or hitting "Reset") is measured correctly too --
  // `scrollHeight` alone never shrinks below whatever height was already
  // set.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [markdown]);

  return (
    <div className={sprinkles({ display: "flex", gap: 5, flexWrap: "wrap" })} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 480px", minWidth: 0 }}>
        <ColumnLabel>Rendered (static)</ColumnLabel>
        <PreviewBox entry={entry} markdown={markdown} minHeight={Math.max(entry.previewMinHeight ?? 0, 480)} previewScheme={previewScheme} />
      </div>
      <div style={{ flex: "0 1 340px", minWidth: 280 }}>
        <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <ColumnLabel>Markdown source</ColumnLabel>
          {isDirty && (
            <button
              type="button"
              onClick={() => setMarkdown(entry.markdown)}
              className={`${textSize.xs} ${sprinkles({ fontFamily: "mono", mb: 2 })}`}
              style={{ background: "none", border: "none", cursor: "pointer", color: semanticColors.textBrand, textDecoration: "underline" }}
            >
              Reset
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          spellCheck={false}
          rows={3}
          className={`${textSize.sm} ${sprinkles({ p: 3, fontFamily: "mono" })}`}
          style={{
            display: "block",
            width: "100%",
            background: semanticColors.surfaceInset,
            color: "inherit",
            border: `1px solid ${isDirty ? semanticColors.textBrand : "transparent"}`,
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            margin: 0,
            resize: "vertical",
            // The `useEffect` above keeps `height` exactly matched to
            // `scrollHeight` on every render, so there's normally nothing
            // TO scroll -- `auto` (not `hidden`) is still the right
            // fallback for the one brief pre-hydration paint (`rows={3}`,
            // above) and for a user manually dragging the `resize`
            // handle smaller than the content needs.
            overflow: "auto",
          }}
        />
        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Example info</ColumnLabel>
          <code className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
            {entry.directive}
          </code>
          <p className={`${textSize.sm} ${sprinkles({ mt: 1 })}`} style={{ color: semanticColors.textSubtle, lineHeight: 1.5 }}>
            {entry.note}
          </p>
        </div>
      </div>
    </div>
  );
}

type ViewMode = "focus" | "list";
/** Which scheme the "Rendered (static)" preview boxes should show,
 * regardless of the browser's own OS-level `prefers-color-scheme` --
 * see `PreviewBox`/`website.css`'s `.website-preview-force-{light,dark}`. */
type PreviewScheme = "light" | "dark";

/** A generic two-(or-more)-option pill toggle -- shared by the Focus/List
 * mode switch and the Light/Dark preview-scheme switch, so both read as
 * the exact same control instead of two subtly-different-looking ones. */
function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
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
            background: value === opt.value ? semanticColors.textBrand : "transparent",
            color: value === opt.value ? "white" : semanticColors.textSubtle,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "focus", label: "Focus" },
  { value: "list", label: "List" },
];
const PREVIEW_SCHEME_OPTIONS: { value: PreviewScheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Pin whichever entry is actively being iterated on here -- set to `null`
// to fall back to the "newest entry is focused by default" convention
// (the last item in `ENTRIES`) instead.
const DEFAULT_FOCUS_ID: string | null = "section-title";

export default function StampsScratch() {
  const [focusedId, setFocusedId] = useState(DEFAULT_FOCUS_ID ?? ENTRIES[ENTRIES.length - 1].id);
  // "focus": the content area shows ONLY the focused entry, dominant --
  // the default. "list": a compact, read-only row per entry, for browsing
  // the whole vocabulary at a glance.
  const [viewMode, setViewMode] = useState<ViewMode>("focus");
  // Independent of `viewMode` -- which scheme every "Rendered (static)"
  // preview box shows, regardless of the browser's own OS-level
  // `prefers-color-scheme`. Fixed at "light" by default (deterministic,
  // not environment-dependent) rather than trying to detect/mirror
  // whatever the browser already happens to be in.
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>("light");

  const focusedEntry = ENTRIES.find((e) => e.id === focusedId) ?? ENTRIES[0];

  // Jumping to a specific entry -- via the drawer, or a List row's own
  // "Focus" button -- always means "show me THIS one, dominant," so both
  // paths set the mode along with the id rather than leaving `viewMode`
  // wherever it happened to be.
  function focusOn(id: string) {
    setFocusedId(id);
    setViewMode("focus");
  }

  // Switching the focused entry (or back into Focus mode) should land at
  // the top of the content area -- `AppLayout`'s own `<main>` scrolls
  // independently (see `visual-check.ts`'s own note on this same quirk),
  // so plain `window.scrollTo` doesn't reach it.
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [focusedId, viewMode]);

  return (
    <AppLayout>
      <DrawerContent drawer={<ScratchNav focusedId={focusedId} onFocus={focusOn} />} title="Examples">
        <CenterContent maxWidth={viewMode === "focus" ? 1400 : 1100}>
          <div className={sprinkles({ mb: 6 })}>
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
                {viewMode === "focus" ? formatEntryLabel(focusedEntry.id) : "Examples"}
              </h1>
              <div className={sprinkles({ display: "flex", gap: 2 })}>
                <SegmentedToggle value={previewScheme} onChange={setPreviewScheme} options={PREVIEW_SCHEME_OPTIONS} />
                <SegmentedToggle value={viewMode} onChange={setViewMode} options={VIEW_MODE_OPTIONS} />
              </div>
            </div>
            {viewMode === "list" && (
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: 640, lineHeight: 1.5 }}>
                One row per <code>/v2</code> website directive (see{" "}
                <code>oxmarkdown/websiteDirectives.tsx</code>) — a compact,
                read-only preview of each, so the gap between "what this
                currently produces" and "what the design actually wants" is
                easy to scan at a glance. Static only, no editor — none of
                these have an Editing-mode rendering yet. Pick one to open it
                in <code>Focus</code>, where its markdown source is actually
                editable.
              </p>
            )}
          </div>

          {viewMode === "focus" ? (
            <FocusedEntryView key={focusedEntry.id} entry={focusedEntry} previewScheme={previewScheme} />
          ) : (
            <Stack gap={4}>
              {ENTRIES.map((entry) => (
                <EntryListRow key={entry.id} entry={entry} onFocus={() => focusOn(entry.id)} previewScheme={previewScheme} />
              ))}
            </Stack>
          )}
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
