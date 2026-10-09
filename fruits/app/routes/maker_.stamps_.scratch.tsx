// app/routes/maker_.stamps_.scratch.tsx
//
// The `/v2` website directives' playground -- reachable from the Stamps
// guide (`/maker/stamps`), not nested under it (same "escape nesting at
// both `maker_` and `stamps_`" convention as `maker_.stamps_.oxmarkdown.tsx`).
// Admin/Super gated, same as the rest of `/maker`.
//
// Three kinds of thing live here, each with a distinct role:
//   - Tracing Papers (`TRACING_PAPERS`, below) -- ONE fixed, read-only
//     example per real `/v2` directive (see `websiteDirectives.tsx`),
//     code-defined and never persisted. Each one's own attributes get a
//     real input/dropdown that live-rebuilds the markdown fed to its
//     preview -- a second, more guided way to explore what a directive can
//     do, alongside just reading its markdown. Never editable/deletable --
//     they're the fixed reference, not a canvas. "Use as new Scratch"
//     seeds a brand new Scratch from whatever a Tracing Paper's CURRENT
//     attribute values currently produce.
//   - Scratches -- fully user-generated, DB-backed (see
//     `websiteScratches.server.ts`), freely editable/deletable, with no
//     code-defined counterpart at all. Every Scratch belongs to EXACTLY
//     ONE Pad, always -- there's no "ungrouped" state; it's created
//     inside a Pad, can be moved to a different one, and is deleted
//     alongside its Pad if that Pad itself is deleted.
//   - Pads -- an ORDERED group of Scratch ids it OWNS (see
//     `websiteScratchPads.server.ts`), previewed together as one combined
//     document. See `action`'s own doc comment for exactly how the
//     one-pad-per-scratch invariant is enforced.
//
// Convention for future edits: add a new `TRACING_PAPERS` item whenever a
// new website directive is added, or extend an existing one's own
// `attributes`/`buildMarkdown` when its render implementation changes --
// keep this in sync with the real `buildWebsiteDirectiveRegistry`
// vocabulary, don't let it drift into its own separate list.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, redirect, useFetcher, useLoaderData, useRouteError, useSearchParams, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  getWebsiteScratchOverrides,
  saveWebsiteScratchOverride,
  revertWebsiteScratchOverride,
  type WebsiteScratchOverrideFields,
} from "robustness-core/data/websiteScratches.server";
import {
  getWebsiteScratchPads,
  createWebsiteScratchPad,
  saveWebsiteScratchPad,
  deleteWebsiteScratchPad,
  type WebsiteScratchPadFields,
} from "robustness-core/data/websiteScratchPads.server";
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
import { WEBSITE_ICON_FILE_NAMES, WEBSITE_ICON_PLACEHOLDER_NAMES } from "../oxmarkdown/websiteIcons";
import { WEBSITE_STAMP_NAMES } from "../oxmarkdown/websiteStamps";
import {
  extractSvgGeometry,
  fitSvgPointsToLineBox,
  formatLinePointsAttr,
  reverseSvgGeometry,
  type LineAnchorX,
  type LineAnchorY,
} from "oxmarkdown-core";
import "../styles/scratch.css";
import { navFor } from "../data/nav.server";

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export const meta: MetaFunction = () => [{ title: "O.No · M.S.Scratch Pad" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireMakerAccess(request);
  // The rest of what the nav reads (home tab, Vault, Maker), as every app page.
  const nav = await navFor(user._id);
  const overrides = await getWebsiteScratchOverrides();
  const pads = await getWebsiteScratchPads();
  return { user, ...nav, overrides, pads };
}

/** Create/save/delete a Scratch, or create/save/delete a Pad -- DB-backed
 * (see `websiteScratches.server.ts`/`websiteScratchPads.server.ts`) so
 * both persist across reloads/deploys/environments, not just this one dev
 * process. Gated the same as the rest of this page (Admin/Super), not
 * additionally restricted to development -- writing a DB row is safe to
 * allow anywhere. Tracing Papers have NO action of their own here at all --
 * they're fixed/code-defined, never persisted; "Use as new Scratch" just
 * calls this same `create` intent with the paper's current markdown as the
 * seed (and a target `padId`, same as every other way to create one).
 *
 * Every Scratch belongs to EXACTLY ONE Pad, always -- never zero (there's
 * no more "ungrouped" Scratches list), never more than one (no shared
 * membership). This action is where that invariant actually lives:
 *   - `create` REQUIRES a `padId` and appends the new scratch to it
 *     atomically -- a Scratch is never even momentarily ownerless.
 *   - `delete-pad` cascades: every Scratch the Pad owns is deleted too,
 *     rather than left ownerless.
 *   - `delete` (a Scratch) also removes it from whichever Pad owned it.
 *   - `move-scratch` is how a Scratch changes owners -- removes it from
 *     its old Pad(s) and appends it to the new one, in one call, so
 *     there's never a moment where it belongs to zero OR two Pads. */
export async function action({ request }: ActionFunctionArgs) {
  await requireMakerAccess(request);
  const body = (await request.json()) as {
    intent?: string;
    entryId?: string;
    name?: string;
    directive?: string;
    note?: string;
    markdown?: string;
    padId?: string;
    scratchIds?: string[];
  };

  if (body.intent === "create") {
    if (!body.padId) {
      return data({ ok: false, error: "Every scratch must be created inside a pad" }, { status: 400 });
    }
    const pads = await getWebsiteScratchPads();
    const pad = pads.find((p) => p.id === body.padId);
    if (!pad) {
      return data({ ok: false, error: "Unknown pad" }, { status: 400 });
    }
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await saveWebsiteScratchOverride(id, {
      name: typeof body.name === "string" && body.name.trim() ? body.name : "New scratch",
      directive: typeof body.directive === "string" ? body.directive : "",
      note: typeof body.note === "string" ? body.note : "",
      markdown: typeof body.markdown === "string" ? body.markdown : "",
    });
    await saveWebsiteScratchPad(pad.id, { name: pad.name, scratchIds: [...pad.scratchIds, id] });
    return { ok: true, id };
  }

  if (body.intent === "create-pad") {
    const id = await createWebsiteScratchPad();
    return { ok: true, id };
  }

  if (body.intent === "save-pad") {
    if (!body.padId) {
      return data({ ok: false, error: "Missing padId" }, { status: 400 });
    }
    const fields: WebsiteScratchPadFields = {
      name: typeof body.name === "string" ? body.name : "Untitled pad",
      scratchIds: Array.isArray(body.scratchIds) ? body.scratchIds.filter((x) => typeof x === "string") : [],
    };
    await saveWebsiteScratchPad(body.padId, fields);
    return { ok: true };
  }

  if (body.intent === "delete-pad") {
    if (!body.padId) {
      return data({ ok: false, error: "Missing padId" }, { status: 400 });
    }
    const pads = await getWebsiteScratchPads();
    const pad = pads.find((p) => p.id === body.padId);
    // Every scratch belongs to EXACTLY one pad -- deleting the pad has to
    // take its own scratches with it, or they'd be left with no owner at
    // all (the one state this whole model exists to rule out).
    if (pad) {
      await Promise.all(pad.scratchIds.map((scratchId) => revertWebsiteScratchOverride(scratchId)));
    }
    await deleteWebsiteScratchPad(body.padId);
    return { ok: true };
  }

  if (body.intent === "move-scratch") {
    const scratchId = body.entryId;
    const toPadId = body.padId;
    if (!scratchId || !toPadId) {
      return data({ ok: false, error: "Missing entryId/padId" }, { status: 400 });
    }
    const pads = await getWebsiteScratchPads();
    const toPad = pads.find((p) => p.id === toPadId);
    if (!toPad) {
      return data({ ok: false, error: "Unknown pad" }, { status: 400 });
    }
    await Promise.all(
      pads
        .filter((p) => p.id !== toPadId && p.scratchIds.includes(scratchId))
        .map((p) => saveWebsiteScratchPad(p.id, { name: p.name, scratchIds: p.scratchIds.filter((id) => id !== scratchId) })),
    );
    if (!toPad.scratchIds.includes(scratchId)) {
      await saveWebsiteScratchPad(toPad.id, { name: toPad.name, scratchIds: [...toPad.scratchIds, scratchId] });
    }
    return { ok: true };
  }

  const entryId = body.entryId;
  if (!entryId) {
    return data({ ok: false, error: "Missing entryId" }, { status: 400 });
  }

  if (body.intent === "delete") {
    const pads = await getWebsiteScratchPads();
    await Promise.all(
      pads
        .filter((p) => p.scratchIds.includes(entryId))
        .map((p) => saveWebsiteScratchPad(p.id, { name: p.name, scratchIds: p.scratchIds.filter((id) => id !== entryId) })),
    );
    await revertWebsiteScratchOverride(entryId);
    return { ok: true };
  }

  const fields: WebsiteScratchOverrideFields = {
    name: typeof body.name === "string" ? body.name : "",
    directive: typeof body.directive === "string" ? body.directive : "",
    note: typeof body.note === "string" ? body.note : "",
    markdown: typeof body.markdown === "string" ? body.markdown : "",
  };
  await saveWebsiteScratchOverride(entryId, fields);
  return { ok: true };
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

// ─── Tracing Papers ─────────────────────────────────────────────────────────

type TracingPaperSelectOption = { value: string; label?: string; group?: string };

type TracingPaperAttribute =
  | { key: string; label: string; kind: "text"; default: string; placeholder?: string }
  | { key: string; label: string; kind: "select"; default: string; options: TracingPaperSelectOption[] };

type TracingPaper = {
  id: string;
  /** Display name -- fixed, shown in the drawer nav and as the Focus-mode
   * heading. Unlike a Scratch's own `name`, never editable. */
  name: string;
  /** The directive signature this paper demonstrates. */
  directive: string;
  /** What it's for / how it's currently implemented -- markdown, rendered
   * through OxRenderer (`InfoText`) same as the live preview itself. */
  note: string;
  /** Sections render their own full-bleed background and padding -- let
   * that reach the preview box's own edge instead of double-padding it.
   * Everything else (including `:::box{...}`, which carries its own real
   * margin by design -- see the garden seed's resolved question 5) gets
   * the preview box's normal padding. */
  fullBleed?: boolean;
  /** A directive whose own layout is `position: absolute` (`::line{...}`
   * on its own, with no `:::section-title{...}` around it to supply real
   * height) needs the preview box itself to reserve some height to draw
   * into -- an absolutely-positioned element contributes zero to its
   * parent's own auto height. */
  previewMinHeight?: number;
  /** Every tunable attribute this paper exposes as a real input/dropdown
   * -- empty for a paper whose whole point is comparing two FIXED
   * variations (e.g. a registered vs. unregistered name) rather than
   * tuning one directive occurrence. */
  attributes: TracingPaperAttribute[];
  /** Rebuilds this paper's markdown from its current attribute VALUES
   * (keyed by each attribute's own `key`) -- called on every render with
   * whatever's currently in the Focus view's local state, so the preview
   * always reflects live edits, never a stale snapshot. */
  buildMarkdown: (values: Record<string, string>) => string;
};

const ACCENT_COLOR_OPTIONS: TracingPaperSelectOption[] = [
  { value: "", label: "(none)" },
  { value: "red" },
  { value: "green" },
  { value: "purple" },
];

/** Demo-only `::swatch{...}` definitions this guide itself prepends
 * ahead of any paper that reads `color=`/`palette=` -- NOT a built-in
 * default vocabulary (there isn't one anymore, by design -- round 11 of
 * the "Oxmarkdown Colors" garden seed). This is the exact same thing any
 * real implementer does for their own page (a shared `_theme.md`, say),
 * just inlined here so `ACCENT_COLOR_OPTIONS`' dropdown values above
 * continue to resolve to a real, visible color instead of nothing. */
const DEMO_COLOR_SWATCHES = `::swatch{role="color" name="red" light="var(--red)" dark="var(--red-light)"}
::swatch{role="color" name="green" light="var(--green)" dark="var(--green-light)"}
::swatch{role="color" name="purple" light="var(--purple)" dark="var(--purple)"}
`;

/** Same idea as `DEMO_COLOR_SWATCHES`, for the Section paper's `surface=`
 * dropdown below -- `mint`/`white` match this directive's own OLD,
 * now-retired `bg=` enum exactly (identical real values -- see
 * `website.css`'s own "RETIRED" comment for the history), so the demo
 * looks identical to before despite the underlying mechanism changing
 * entirely underneath it. */
const DEMO_SURFACE_SWATCHES = `::swatch{role="surface" name="mint" light="var(--cactus-100)" dark="var(--cactus-800)"}
::swatch{role="surface" name="white" light="var(--white)" dark="var(--purple-light)"}
`;

/** Same idea again, for the Box paper's `border=` dropdown -- a SEPARATE
 * role namespace from `DEMO_SURFACE_SWATCHES` above (a swatch is keyed by
 * `(role, name)` together, so reusing plain color names like `green`/
 * `purple` under `role="border"` here doesn't collide with anything). */
const DEMO_BOX_BORDER_SWATCHES = `::swatch{role="border" name="green" light="var(--green)" dark="var(--green-light)"}
::swatch{role="border" name="purple" light="var(--purple)" dark="var(--purple)"}
`;

/** Every registered `::icon{name="..."}`/`:::section-title{icon="..."}`
 * name, grouped into a "Files" and a "Placeholders" `<optgroup>` -- see
 * `websiteIcons.tsx`'s own `WEBSITE_ICON_FILE_NAMES`/
 * `WEBSITE_ICON_PLACEHOLDER_NAMES`, which this can never drift out of sync
 * with (it's built FROM them, not a separately hand-kept copy). */
const ICON_NAME_OPTIONS: TracingPaperSelectOption[] = [
  ...WEBSITE_ICON_FILE_NAMES.map((name) => ({ value: name, group: "Files" })),
  ...WEBSITE_ICON_PLACEHOLDER_NAMES.map((name) => ({ value: name, group: "Placeholders" })),
];

const STAMP_NAME_OPTIONS: TracingPaperSelectOption[] = WEBSITE_STAMP_NAMES.map((name) => ({ value: name }));

const TRACING_PAPERS: TracingPaper[] = [
  {
    id: "section",
    name: "Section",
    directive: ':::section{surface="..." palette="..." list="timeline" margin="N"}',
    note: "Container -- a themeable area, not a fully bespoke one: a handful of independent knobs, not complete control over every style. `surface`/`palette` resolve against the page's own `::swatch`/`::palette` registry — an OPEN vocabulary the page/theme author defines (see the \"Oxmarkdown Colors\" garden seed), not a fixed `mint`/`white` enum anymore. THIS demo prepends two small `::swatch{role=\"surface\" ...}` definitions (`mint`/`white`, matching the old enum's own real values) ahead of the directive below, purely so the dropdown continues to show something real -- a real page does the exact same thing in its own shared theme file (e.g. `_theme.md`). Leaving `surface`/`palette` both unset shows the page's own resting background through instead, reading as blended-in/invisible rather than a distinct band. `list` optionally swaps in a NAMED bullet style for the body's own lists (`timeline` today — a small dot + connecting line, not just a tint); `margin` adds extra top/bottom breathing room around the section as a MULTIPLE of the shared `--ox-grid` unit (41px today), e.g. `margin=\"2\"` = `82px` -- negative numbers pull an adjacent section closer instead. Body renders through the ordinary OxRenderer pipeline otherwise — nothing else section-specific about the heading/paragraph/list styling itself, including heading COLOR: a section's own headings just read the ordinary default text color -- reach for the Section title paper (below) instead when a heading specifically needs to stand out.",
    fullBleed: true,
    attributes: [
      {
        key: "surface",
        label: "surface",
        kind: "select",
        default: "mint",
        options: [{ value: "", label: "(none, transparent)" }, { value: "mint" }, { value: "white" }],
      },
      {
        key: "list",
        label: "list",
        kind: "select",
        default: "timeline",
        options: [{ value: "", label: "(default dash)" }, { value: "timeline", label: "timeline" }],
      },
      { key: "margin", label: "margin (x grid unit)", kind: "text", default: "", placeholder: "e.g. 2" },
    ],
    buildMarkdown: (v) => {
      const attrs = [v.surface && `surface="${v.surface}"`, v.list && `list="${v.list}"`, v.margin && `margin="${v.margin}"`].filter(Boolean).join(" ");
      return `${DEMO_SURFACE_SWATCHES}:::section{${attrs}}
## At a Cost

- We favored synthetic materials for their higher performance metrics.
- The risks increased and the improvements diminished.
:::`;
    },
  },
  {
    id: "stamp",
    name: "Stamp",
    directive: '::stamp{name="..." rotate="deg" float="left|right|inline" id="..."}',
    note: "Leaf. Renders one of the complete, pre-designed postage-stamp SVGs (`coffee`/`mtn`/`nopal`/`quail`, each with a light/dark pair swapped via `prefers-color-scheme` — see `websiteStamps.tsx`). An unregistered name shows a dashed \"stamp: name\" placeholder instead of vanishing — see the Stamp missing paper. `id` also doubles as a waypoint for the (not-yet-built) wavy connector.",
    attributes: [
      { key: "name", label: "name", kind: "select", default: "quail", options: STAMP_NAME_OPTIONS },
      { key: "rotate", label: "rotate (degrees)", kind: "text", default: "-6" },
      {
        key: "float",
        label: "float",
        kind: "select",
        default: "inline",
        options: [{ value: "left" }, { value: "right" }, { value: "inline" }],
      },
    ],
    buildMarkdown: (v) => `::stamp{name="${v.name}" rotate="${v.rotate}" float="${v.float}"}`,
  },
  {
    id: "stamp-missing",
    name: "Stamp missing",
    directive: "::stamp{...} — unregistered name",
    note: "Same directive, any name with no matching asset — the fallback placeholder. Try typing one of `coffee`/`mtn`/`nopal`/`quail` to see it resolve to the real artwork instead.",
    attributes: [{ key: "name", label: "name", kind: "text", default: "climber", placeholder: "any name" }],
    buildMarkdown: (v) => `::stamp{name="${v.name}"}`,
  },
  {
    id: "icon",
    name: "Icon",
    directive: '::icon{name="..." size="sm|md|lg|#" id="..." position="x,y"}',
    note: 'Leaf. Checks real file-based assets first (**Files**, below), then a small set of inline-drawn placeholder shapes (**Placeholders**), then falls back to a labeled dashed circle for any other name — see `websiteIcons.tsx`. Meant for small inline glyphs or standalone floating shapes, distinct from `::stamp`\'s full postage-stamp graphics.\n\n**Adding a new icon:** drop a new SVG under `public/guides/`, then add one `{name: path}` entry to `WEBSITE_ICON_FILES` in `websiteIcons.tsx` (both the `webapp` and `fruits` copies — see its own header comment) — it appears in the `name` dropdown above automatically, nothing else needs to change.\n\n**`size`:** `sm`/`md`/`lg` are named presets (20px/32px/64px); any other plain number is a literal pixel width instead — try `48` here.\n\n**`position="x,y"` (optional):** absolutely positions the icon instead of leaving it inline -- the SAME literal-pixel, real-measured-container-edge anchor system `::line{points="..."}`/`::path{points="..."}` use below (see the Line paper\'s own note for the full grammar): a plain number is a pixel DELTA from `(0, 0)`, a reference letter (`L`/`C`/`R` for x, `T`/`C`/`B` for y) plus optional offset is an ANCHOR resolved against this icon\'s own real measured container size on every resize (`ResizeObserver`), not a fixed nominal box. An anchor is also EDGE/CENTER-AWARE of the ICON\'s own real measured size -- `R4,T4` tucks the icon\'s own top-RIGHT corner 4px in from a section\'s top-right corner (not its top-left corner sitting there and overflowing further right), and `C0,C0` centers the icon exactly, no hand math needed. Only has a visible effect when its container is `position: relative` -- `:::section{...}`\'s own body (`.website-section-inner`) already is, for its first real use.',
    attributes: [
      { key: "name", label: "name", kind: "select", default: "sun-home", options: ICON_NAME_OPTIONS },
      { key: "size", label: "size (sm|md|lg|#)", kind: "text", default: "lg", placeholder: "e.g. lg or 48" },
      { key: "position", label: "position (x,y)", kind: "text", default: "", placeholder: "e.g. R4,T4" },
    ],
    buildMarkdown: (v) => `::icon{name="${v.name}" size="${v.size}"${v.position ? ` position="${v.position}"` : ""}}`,
  },
  {
    id: "icon-placeholder",
    name: "Icon placeholder",
    directive: "::icon{...} — placeholder shape vs. unregistered name",
    note: "A registered placeholder shape (no real asset yet, but still recognized) vs. a totally unregistered one, side by side. (Leaf directives need their own line each — two on the same line don't both parse.)",
    attributes: [
      { key: "placeholderName", label: "left icon (placeholder shape)", kind: "select", default: "arrow", options: WEBSITE_ICON_PLACEHOLDER_NAMES.map((n) => ({ value: n })) },
      { key: "unknownName", label: "right icon (any name)", kind: "text", default: "totally-made-up" },
    ],
    buildMarkdown: (v) => `::icon{name="${v.placeholderName}"}\n::icon{name="${v.unknownName}"}`,
  },
  {
    id: "waypoint",
    name: "Waypoint",
    directive: '::waypoint{id="..."}',
    note: "Leaf, invisible on purpose — a zero-size anchor (`data-waypoint-id`) for `::trail{waypoints=\"...\"}` (see the Trail paper, next) to measure. Nothing to see here today (that's the point); included so the directive's own markup is visible in the DOM. Needs its own line, same as any leaf directive — embedded mid-sentence it doesn't parse as a directive at all, just literal text. Only needed when nothing else is already sitting at the spot a trail should pass through — `::stamp{id=\"...\"}`/`::icon{id=\"...\"}` already carry `data-waypoint-id` via their own `id`, no separate `::waypoint` needed alongside one of those (see the Trail paper's own demo, which uses `::icon{id=\"...\"}` for exactly this reason).",
    attributes: [{ key: "id", label: "id", kind: "text", default: "p1" }],
    buildMarkdown: (v) => `::waypoint{id="${v.id}"}\n\nAnd after.`,
  },
  {
    id: "trail",
    name: "Trail",
    directive: '::trail{waypoints="p1, p2, p3" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}',
    previewMinHeight: 160,
    note: 'Leaf. The SAME wavy-line primitive as `::line`/`::path`, but its points come from LIVE DOM MEASUREMENT instead of any fixed coordinates: `waypoints` is a comma-separated list of ids, each referring to some OTHER element\'s own `data-waypoint-id` elsewhere on the page -- a bare `::waypoint{id="..."}` anchor, or `id` on a `::stamp{...}`/`::icon{...}` (which already carry `data-waypoint-id` for free). This demo uses three small `::icon{name="circle" position="..."}` placeholders (`p1`/`p2`/`p3`) as its waypoints, rather than invisible `::waypoint{...}` anchors, so there\'s something to SEE at each end of the trail, not just the connecting line itself -- `p2` is deliberately offset well clear of the straight line between `p1`/`p3` (bowed out toward the right edge, not sitting at the diagonal\'s own midpoint) so the default `curve="smooth"` has visible room to swoop through it, rather than drawing what would otherwise look like a plain straight segment. Connects them, IN THE ORDER LISTED, through each one\'s own live center point, re-measured on every real resize (drag this browser window and watch the trail follow the dots -- genuinely different from `::line`/`::path`\'s fixed points, which never look at the DOM at all). Try removing `p2` from `waypoints` (or typing in a made-up id) -- an id with no matching element on the page is silently skipped, same "missing asset doesn\'t break the page" spirit `::icon`\'s unregistered-name fallback has, though here it just means one fewer point. No anchor/delta grammar here (nothing to anchor against but the waypoints themselves); `curve`/`tension` behave exactly as they do on `::line` below. `color`/`palette` resolve against the page\'s own `::swatch`/`::palette` registry (an OPEN vocabulary -- see the "Oxmarkdown Colors" garden seed); this demo prepends its own small `::swatch{role="color" ...}` set so `red`/`green`/`purple` below still resolve to something real.',
    attributes: [
      { key: "waypoints", label: "waypoints", kind: "text", default: "p1,p2,p3", placeholder: "p1, p2, p3" },
      {
        key: "curve",
        label: "curve",
        kind: "select",
        default: "smooth",
        options: [{ value: "smooth" }, { value: "straight" }, { value: "bezier" }],
      },
      { key: "tension", label: "tension (0-1)", kind: "text", default: "0.5" },
      { key: "color", label: "color", kind: "select", default: "red", options: ACCENT_COLOR_OPTIONS },
    ],
    buildMarkdown: (v) =>
      `${DEMO_COLOR_SWATCHES}::icon{name="circle" size="sm" id="p1" position="L4,T4"}\n::icon{name="circle" size="sm" id="p2" position="R40,C-10"}\n::icon{name="circle" size="sm" id="p3" position="R24,B24"}\n::trail{waypoints="${v.waypoints}" curve="${v.curve}" tension="${v.tension}"${v.color ? ` color="${v.color}"` : ""}}`,
  },
  {
    id: "line",
    name: "Line",
    directive: '::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}',
    note: 'Leaf. The shared wavy-line primitive (`WavyLine.tsx` + `oxmarkdown-core`\'s `buildSplinePath`) in its fixed-points mode. "A line is drawn from one end to the other": a cursor starts at the line\'s own top-left corner and walks forward, per-axis, per point, in LITERAL PIXELS -- a REVERSED design from an earlier normalized-then-rescaled-to-container version, which made the same numbers look different (often distorted) depending on the container they rendered inside; see `oxmarkdown-core`\'s `wavyLine.ts` header for the full reasoning. Each half of a pair is either a plain number (a DELTA -- moves the cursor by that amount, in real px, cumulative, NEVER rescaled by the container) or a reference letter plus optional offset (an ANCHOR, referenced to the container\'s own REAL measured edge instead of the previous point -- this one IS container-size-dependent, on purpose): `L`/`C`/`R` for x, `T`/`C`/`B` for y (same CSS-inset convention as `top`/`right`/`bottom`/`left` -- `T`/`L` add away from that edge, `B`/`R` subtract inward from it, `C` adds past center -- the offset itself is a literal pixel inset, not a percentage). Anchors and deltas mix freely, per axis, at any point. Sized to exactly fit the resulting path\'s own bounding box, recomputed on every real resize ONLY to re-resolve any anchor letters against the container\'s new real size (`ResizeObserver`, not a passive `preserveAspectRatio` stretch) -- plain deltas never change. `color`/`palette` resolve against the page\'s own `::swatch`/`::palette` registry (an OPEN vocabulary the page/theme author defines -- see the "Oxmarkdown Colors" garden seed; this demo prepends its own small `::swatch{role="color" ...}` set so `red`/`green`/`purple` below still resolve to something real) and set the stroke directly; omit `color`/leave it unresolved and the line inherits `currentColor` instead. Needs a positioned ancestor with real height to draw into -- this row\'s own preview box supplies that; `:::section-title{...}` supplies it for the paper below. Try the "SVG → Points" tool (see the sidebar\'s own "Tools" section) to trace a real shape into this syntax instead of hand-guessing numbers.',
    previewMinHeight: 100,
    attributes: [
      { key: "points", label: "points", kind: "text", default: "L0,B4 C5,B16 R0,B4", placeholder: "x,y x,y ..." },
      {
        key: "curve",
        label: "curve",
        kind: "select",
        default: "smooth",
        options: [{ value: "smooth" }, { value: "straight" }, { value: "bezier" }],
      },
      { key: "tension", label: "tension (0-1)", kind: "text", default: "0.4" },
      { key: "color", label: "color", kind: "select", default: "green", options: ACCENT_COLOR_OPTIONS },
    ],
    buildMarkdown: (v) =>
      `${DEMO_COLOR_SWATCHES}::line{points="${v.points}" curve="${v.curve}" tension="${v.tension}"${v.color ? ` color="${v.color}"` : ""}}`,
  },
  {
    id: "path",
    name: "Path",
    directive: '::path{points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}',
    note: 'Leaf. The SAME wavy-line primitive as `::line`, `points` parsed with the exact same delta/anchor grammar -- but DECOUPLES the traced shape\'s own natural proportions from how big it renders and where it sits, which `::line` bakes directly into the points themselves. Built for tracing a real, complex SVG shape (try the "SVG → Points" tool, in the sidebar\'s own "Tools" section) once, then resizing/repositioning it freely without re-baking numbers. `width`/`height` (each optional, independent) -- a plain number is literal px, a trailing `%` is a percentage of `::path`\'s own real measured container size, resolved fresh on every real resize (try dragging this browser window narrower with `width="40%"` set below -- the shape genuinely rescales, unlike anything `::line` can do). ALWAYS a uniform scale (the shape\'s own proportions are never independently stretched) -- give only one axis and the other follows proportionally; give both and it fits inside whichever constrains more. `start="x,y"` positions the (possibly-scaled) shape\'s own bounding box using the SAME anchor/delta vocabulary as a single `points="..."` pair, and an anchor is EDGE/CENTER-AWARE of the shape\'s OWN already-scaled size -- `start="C0,T10"` (the default below) puts the shape\'s own top-CENTER at the container\'s horizontal center, 10px down, not its top-left corner. Omit `start` and the shape renders at wherever its own resolved `points` naturally placed it.',
    previewMinHeight: 120,
    attributes: [
      { key: "points", label: "points", kind: "text", default: "0,0 10,-15 22,4 34,-18 46,0", placeholder: "x,y x,y ..." },
      { key: "width", label: "width (#|#%)", kind: "text", default: "40%" },
      { key: "height", label: "height (#|#%)", kind: "text", default: "" },
      { key: "start", label: "start (x,y)", kind: "text", default: "C0,T10", placeholder: "x,y" },
      {
        key: "curve",
        label: "curve",
        kind: "select",
        default: "smooth",
        options: [{ value: "smooth" }, { value: "straight" }, { value: "bezier" }],
      },
      { key: "tension", label: "tension (0-1)", kind: "text", default: "0.5" },
      { key: "color", label: "color", kind: "select", default: "purple", options: ACCENT_COLOR_OPTIONS },
    ],
    buildMarkdown: (v) =>
      `${DEMO_COLOR_SWATCHES}::path{points="${v.points}"${v.width ? ` width="${v.width}"` : ""}${v.height ? ` height="${v.height}"` : ""}${v.start ? ` start="${v.start}"` : ""} curve="${v.curve}" tension="${v.tension}"${v.color ? ` color="${v.color}"` : ""}}`,
  },
  {
    id: "line-word",
    name: "Line word",
    directive: ':line-word{text="..." points="x,y x,y ..." width="#|#%" height="#|#%" start="x,y" curve="smooth|straight|bezier" tension="0-1" color="..." palette="..."}',
    note: 'A TEXT directive (single colon) -- sits INLINE, mid-sentence, unlike every leaf/container directive above. Wraps `text` in an inline-block, `position: relative` span and draws the SAME `WavyLine` primitive as `::line`/`::path` BEHIND it (`z-index: -1`, `website.css`) -- a hand-drawn squiggle/underline decorating one word or short phrase, sized to that word\'s own real rendered box. `points`/`width`/`height`/`start`/`curve`/`tension`/`color`/`palette` all behave EXACTLY like `::path{...}` -- see that entry above for the full grammar (including the open `::swatch`/`::palette`-backed vocabulary `color`/`palette` now read); the only new attribute is `text`, the literal word/phrase to render (a plain attribute, not bracket-label content). Try editing `text` to something longer/shorter -- the default `points` uses `L`/`R` anchors, so the underline automatically re-spans the word\'s own new width, no manual re-tracing needed. NOTE on the default `points` own `T` values: this preview\'s own paragraph line-height (`--ox-grid`, 41px) is taller than the actual glyphs (measured ~21px, roughly centered inside it), so `T33`/`T39` were tuned by DIRECTLY measuring where the visible text really sits here, not guessed from the line-height alone -- expect to retune both numbers by hand for a real page with different type/line-height.',
    attributes: [
      { key: "text", label: "text", kind: "text", default: "waterproof jacket" },
      { key: "points", label: "points", kind: "text", default: "L0,T33 C0,T39 R0,T33", placeholder: "x,y x,y ..." },
      {
        key: "curve",
        label: "curve",
        kind: "select",
        default: "smooth",
        options: [{ value: "smooth" }, { value: "straight" }, { value: "bezier" }],
      },
      { key: "tension", label: "tension (0-1)", kind: "text", default: "0.5" },
      { key: "color", label: "color", kind: "select", default: "green", options: ACCENT_COLOR_OPTIONS },
    ],
    buildMarkdown: (v) =>
      `${DEMO_COLOR_SWATCHES}Take the early :line-word{text="${v.text}" points="${v.points}" curve="${v.curve}" tension="${v.tension}"${v.color ? ` color="${v.color}"` : ""}}.`,
  },
  {
    id: "section-title",
    name: "Section title",
    directive: ':::section-title{icon="..." color="..." h-color="..." palette="..."}',
    note: "Container. An icon + a real heading + (usually) a `::line{...}` composed as one titled-header unit -- see `website.css`'s `.website-section-title`. The heading stays real markdown inside it, so an unaware renderer just shows a plain heading, no visible artifact. `color` is a BASE text color that reaches everything inside (ordinary CSS inheritance, including the heading); `h-color`, when given, is a MORE SPECIFIC override that wins only for heading tags -- try setting both to different swatch names below and watch `h-color` win for the heading while `color` alone would still apply to it otherwise (same 'ancestor value vs. a more specific descendant rule' relationship CSS's own cascade already has -- see the \"Oxmarkdown Colors\" garden seed, round 13). Both resolve against the page's own `::swatch`/`::palette` registry -- the SAME registry/role `::line{color=\"...\"}` below reads, so give both the same name on purpose to keep a heading and a nearby line in sync (try it: this paper's own `::line` below is hardcoded to `color=\"green\"`). `color`/`h-color` do NOT also recolor that nested `::line{...}`; it needs its own, independent `color` attribute since it has to work standalone too.",
    fullBleed: true,
    attributes: [
      { key: "icon", label: "icon", kind: "select", default: "mountaineer-coffee", options: ICON_NAME_OPTIONS },
      { key: "color", label: "color", kind: "select", default: "green", options: ACCENT_COLOR_OPTIONS },
      { key: "h-color", label: "h-color (heading override)", kind: "select", default: "", options: ACCENT_COLOR_OPTIONS },
      { key: "heading", label: "heading text", kind: "text", default: "At a Cost" },
    ],
    buildMarkdown: (v) => `${DEMO_COLOR_SWATCHES}:::section-title{icon="${v.icon}"${v.color ? ` color="${v.color}"` : ""}${v["h-color"] ? ` h-color="${v["h-color"]}"` : ""}}
::line{points="L1,B0 R16,B10 R0,B0" curve="smooth" tension="0.4" color="green"}
## ${v.heading}
:::`,
  },
  {
    id: "box",
    name: "Box",
    directive: ':::box{surface="..." border="..." palette="..."}',
    note: "Container. A generic bordered container (border/radius/padding/background only) -- composes with plain markdown + other directives for everything else, UNLIKE the now-retired `:::pricing-card{...}`'s bespoke header/CTA structure (see the Flex/Button/Badge papers for how that composition actually looks). `surface`/`border`/`palette` resolve against the page's own `::swatch`/`::palette` registry -- the SAME open vocabulary `:::section{surface=\"...\"}` above uses. THIS demo prepends small `::swatch{role=\"surface\"/\"border\" ...}` definitions ahead of the directive below, same convention the Section paper already uses. NO margin of its own -- a box's own vertical spacing is the author's call via blank lines, same as every other block.",
    attributes: [
      { key: "surface", label: "surface", kind: "select", default: "", options: [{ value: "", label: "(default card color)" }, { value: "mint" }, { value: "white" }] },
      { key: "border", label: "border", kind: "select", default: "", options: [{ value: "", label: "(default)" }, { value: "green" }, { value: "purple" }] },
      { key: "content", label: "content", kind: "text", default: "Some content inside the box." },
    ],
    buildMarkdown: (v) => `${DEMO_SURFACE_SWATCHES}${DEMO_BOX_BORDER_SWATCHES}:::box{${v.surface ? `surface="${v.surface}" ` : ""}${v.border ? `border="${v.border}"` : ""}}
${v.content}
:::`,
  },
  {
    id: "flex",
    name: "Flex",
    directive: ':::flex{justify="space-between|flex-start|flex-end|center"}',
    note: "Container. Lays out its own direct block children in a single flex row (`justify` default `space-between`) -- e.g. a title + a price side by side. This is the EXACT title+price row the now-retired `:::pricing-card{...}`'s own header baked in, factored out here as its own reusable primitive -- deliberately the simpler sibling of `:::grid{columns=\"N\"}`/`::col` above: no per-item grouping marker, every direct block child is its own flex item.",
    attributes: [
      {
        key: "justify",
        label: "justify",
        kind: "select",
        default: "space-between",
        options: [{ value: "space-between" }, { value: "flex-start" }, { value: "flex-end" }, { value: "center" }],
      },
      { key: "left", label: "left item", kind: "text", default: "### Self-Guide" },
      { key: "right", label: "right item", kind: "text", default: "**$99/mo**" },
    ],
    buildMarkdown: (v) => `:::flex{justify="${v.justify}"}
${v.left}

${v.right}
:::`,
  },
  {
    id: "button",
    name: "Button",
    directive: '::button{text="..." href="..." variant="primary|purple|secondary|yellow|outline"}',
    note: 'Leaf. A standalone CTA link, styled with `stamps/button.css`\'s own `button({ variant })` recipe -- the site\'s ordinary buttons, not a bespoke website-only look. Has a SECOND, mutually-exclusive mode this basic paper doesn\'t demo directly: `::button{text="..." form-id="..." action="..."}` renders a real `<button>` that POSTs a shared form\'s collected values instead of navigating -- see the "Price select" paper below for a live, clickable demo of that mode end to end.',
    attributes: [
      { key: "text", label: "text", kind: "text", default: "Meet with a Guide" },
      { key: "href", label: "href", kind: "text", default: "#" },
      {
        key: "variant",
        label: "variant",
        kind: "select",
        default: "primary",
        options: [{ value: "primary" }, { value: "purple" }, { value: "secondary" }, { value: "yellow" }, { value: "outline" }],
      },
    ],
    buildMarkdown: (v) => `::button{text="${v.text}" href="${v.href}"${v.variant && v.variant !== "primary" ? ` variant="${v.variant}"` : ""}}`,
  },
  {
    id: "badge",
    name: "Badge",
    directive: '::badge{text="..." variant="neutral|success|warning|danger" position="x,y" height="#"}',
    note: 'Leaf. Renders `stamps/Badge` directly — the same component the "Draft" preview banner already uses — rather than a bespoke pill style. `position`/`height` are optional and demoed here wrapped in a `:::box{...}` -- the box supplies the `position: relative` ancestor a positioned badge needs to have any visible effect (the SAME relationship `:::section{...}`\'s own body has for a positioned `::icon{...}`), and this is literally the garden seed\'s own original motivating example: a badge overlapping a box\'s corner, signaling "this is coming soon." An anchor is EDGE/CENTER-AWARE of the badge\'s own real, MEASURED size -- `position="R10,T-10"` below puts the badge\'s own top-right corner 10px in from the box\'s top-right corner (not its top-LEFT corner sitting there), with no `height`/hand-math needed just to get a clean edge alignment. `height`, separately, still SETS the badge\'s own real rendered CSS height when given -- a plain "force this exact visual size" knob, independent of the positioning math.',
    attributes: [
      { key: "text", label: "text", kind: "text", default: "Coming Soon" },
      {
        key: "variant",
        label: "variant",
        kind: "select",
        default: "danger",
        options: [{ value: "neutral" }, { value: "success" }, { value: "warning" }, { value: "danger" }],
      },
      {
        key: "position",
        label: "position",
        kind: "select",
        default: "R10,C0",
        options: [
          { value: "", label: "(inline, unpositioned)" },
          { value: "R10,C0", label: "R10,C0 (right-center, exactly centered)" },
          { value: "C0,T-10", label: "C0,T-10 (top-center)" },
          { value: "L10,B10", label: "L10,B10 (bottom-left)" },
        ],
      },
      { key: "height", label: "height (optional -- independent of positioning now)", kind: "text", default: "20" },
    ],
    buildMarkdown: (v) => `:::box{}
${v.position ? `::badge{text="${v.text}" variant="${v.variant}" position="${v.position}"${v.height ? ` height="${v.height}"` : ""}}

` : `::badge{text="${v.text}" variant="${v.variant}"}

`}### Self-Guide
**$99/mo**
:::`,
  },
  {
    id: "price-select",
    name: "Price select (box + button, form-id)",
    directive: ':::box{form-id="..." select-group="..." value="..."} ... ::button{form-id="..." action="..."}',
    note: 'The garden seed\'s own original motivating case, composed and LIVE here -- this preview is a real, hydrated `OxRenderer`, not a static mockup, so you can actually click between the two boxes below, then click the button. Several selectable `:::box{form-id="..." select-group="..." value="..."}` siblings share one page-level store (`OxRenderer.tsx`\'s `WebsiteFormContext`) keyed by `(form-id, select-group)` -- clicking one writes its own `value` in and (since one key can only ever hold one value) automatically stops the previously-selected box from matching, radio-style, with no separate "deselect everything else" step anywhere. `::button{form-id="..." action="..."}` is `::button`\'s SECOND mode (not the `href`-link one above) -- clicking it POSTs whatever that `form-id` has collected so far, as JSON, to `action`. This demo\'s own `action` is a non-existent placeholder path, so the POST harmlessly 404s -- open devtools\' Network tab after clicking to see the real request and payload shape. Option 4 ("centralized storage, not centralized building") of the "Box Directive + Pricing Card UI Fix" garden seed.',
    attributes: [
      { key: "plan1", label: "plan 1 name", kind: "text", default: "Self-Guide" },
      { key: "price1", label: "plan 1 price", kind: "text", default: "$99/mo" },
      { key: "plan2", label: "plan 2 name", kind: "text", default: "Guided" },
      { key: "price2", label: "plan 2 price", kind: "text", default: "$199/mo" },
      { key: "cta", label: "button text", kind: "text", default: "Schedule a call" },
    ],
    buildMarkdown: (v) => `:::box{form-id="price-select-demo" select-group="plan" value="plan1"}
### ${v.plan1}
**${v.price1}**
:::

:::box{form-id="price-select-demo" select-group="plan" value="plan2"}
### ${v.plan2}
**${v.price2}**
:::

::button{form-id="price-select-demo" action="/api/demo-schedule-call" text="${v.cta}"}`,
  },
  {
    id: "daily-log",
    name: "Daily log",
    directive: '::daily-log{date="YYYY-MM-DD" project="..."}',
    note: "Leaf. Resolved server-side (`website.server.ts`'s `resolveWebsiteDailyLogEntries`) against the website owner's own Daily Log Cards — needs real vault/DB access this static playground doesn't have, so it renders nothing here (same fail-soft behavior an unresolved reference gets on the real site).",
    attributes: [
      { key: "date", label: "date", kind: "text", default: "2026-08-26", placeholder: "YYYY-MM-DD" },
      { key: "project", label: "project", kind: "text", default: "Crouch Casita" },
    ],
    buildMarkdown: (v) => `::daily-log{date="${v.date}" project="${v.project}"}`,
  },
  {
    id: "toggle",
    name: "Toggle",
    directive: ':::toggle{collapsed="true" border="..." palette="..."} (not new — the existing built-in, reused for FAQ)',
    note: "Not a website-specific directive — the pre-existing Notion-style Toggle List, reused as-is for the Guides page's FAQ. Included here since it's part of the same content vocabulary these pages compose with. `border`/`palette` are the one genuinely NEW piece (see the \"FAQ toggle design\" garden seed): the caret glyph's own color now resolves against the page's own `::swatch`/`::palette` registry -- the SAME `border` role namespace `:::box{border=\"...\"}` above already uses (THIS demo reuses that same paper's `DEMO_BOX_BORDER_SWATCHES` for its dropdown) -- falling back to the ordinary default accent color when neither resolves. Static/Interacting-mode only: the live WYSIWYG editor doesn't model these two attributes at all (a deliberate scope line -- that editor is a lightweight daily-logging surface, not meant to fully round-trip every directive's attributes), so a toggle using them will lose `border`/`palette` if it's ever opened and re-saved there.",
    attributes: [
      {
        key: "collapsed",
        label: "collapsed",
        kind: "select",
        default: "",
        options: [{ value: "", label: "(expanded)" }, { value: "true", label: "true" }],
      },
      {
        key: "border",
        label: "border",
        kind: "select",
        default: "",
        options: [{ value: "", label: "(default accent)" }, { value: "green" }, { value: "purple" }],
      },
      { key: "question", label: "question", kind: "text", default: "Can I change between plans?" },
      { key: "answer", label: "answer", kind: "text", default: "Yes, at the end of each contract." },
    ],
    buildMarkdown: (v) => {
      const attrs = [v.collapsed === "true" && `collapsed="true"`, v.border && `border="${v.border}"`].filter(Boolean).join(" ");
      const swatches = v.border ? DEMO_BOX_BORDER_SWATCHES : "";
      return `${swatches}:::${attrs ? `toggle{${attrs}}` : "toggle"}
${v.question}

${v.answer}
:::`;
    },
  },
  {
    id: "grid",
    name: "Grid",
    directive: ':::grid{columns="N"} ... ::col ... ::col ... ::: (not new — the existing built-in)',
    note: "Not a website-specific directive — the same pre-existing basic side-by-side layout (`oxmarkdown`'s own `renderDirective`, `OxRenderer.tsx`), reused as-is. `columns` picks how many EQUAL (`1fr`) columns the grid has — defaults to the number of `::col`-split cells when omitted, clamped to 1–6. `::col` is what splits cells: everything BEFORE the first `::col` is cell 1, then each `::col` after it starts a new cell. Collapses to a single column below `640px`. Included here for the same reason the Toggle paper above is: it's part of the same content vocabulary these pages compose with, even though it isn't website-specific.",
    attributes: [
      {
        key: "columns",
        label: "columns",
        kind: "select",
        default: "2",
        options: [{ value: "2" }, { value: "3" }, { value: "4" }],
      },
      { key: "cell1", label: "cell 1", kind: "text", default: "Left content" },
      { key: "cell2", label: "cell 2", kind: "text", default: "Right content" },
    ],
    buildMarkdown: (v) => `:::grid{columns="${v.columns}"}
${v.cell1}
::col
${v.cell2}
:::`,
  },
  {
    id: "gallery",
    name: "Gallery",
    directive: ':::gallery{max-columns="N"} ![alt](url) ![alt](url) ::: (not new — the existing built-in)',
    note: 'Not a website-specific directive — a basic photo/video grid built on ORDINARY markdown images (`![alt](url)`) as its own children, not a per-photo leaf directive (lets a gallery degrade to a plain sequence of images on any renderer that doesn\'t understand it). `max-columns` caps how many columns wide it gets before wrapping — omit it to let the image count decide instead. Demo images below are real assets already served under `/guides/` (the same stamp artwork `::stamp{...}` uses), so this actually renders something — unlike `::gallery{folder="..."}` (the vault-folder-backed LEAF sibling of this directive), which needs real vault access this static playground doesn\'t have and so isn\'t included here.',
    attributes: [
      {
        key: "maxColumns",
        label: "max-columns",
        kind: "select",
        default: "",
        options: [{ value: "", label: "(auto)" }, { value: "2" }, { value: "3" }],
      },
    ],
    buildMarkdown: (v) => `:::gallery${v.maxColumns ? `{max-columns="${v.maxColumns}"}` : ""}
![coffee stamp](/guides/stamp-coffee.svg)
![mountain stamp](/guides/stamp-mtn.svg)
![nopal stamp](/guides/stamp-nopal.svg)
:::`,
  },
];

// ─── Scratches / Pads ───────────────────────────────────────────────────────

/** A Scratch -- fully user-generated, DB-backed (`websiteScratches.server.ts`),
 * with no code-defined counterpart at all (unlike a Tracing Paper, above). */
type Scratch = { id: string } & WebsiteScratchOverrideFields;

/** A Pad -- an ORDERED group of Scratch ids (e.g. "The Terrain": Intro, At
 * a Cost, The Trade, ...), previewed together as one combined document
 * (`FocusedPadView`). Fully DB-backed (`websiteScratchPads.server.ts`), no
 * code-defined counterpart -- only save/delete, same as a Scratch. */
type ResolvedPad = { id: string; name: string; scratchIds: string[] };

/** Which single thing Focus mode is currently dominant-displaying -- a
 * Scratch (`FocusedEntryView`, editable), a Pad (`FocusedPadView`, a
 * combined preview + ordering/membership editor), a Tracing Paper
 * (`FocusedTracingPaperView`, fixed + attribute-driven, never editable),
 * or a Tool (`SvgToPointsTool` today -- the only one; a genuinely
 * different KIND of thing from all three above, since it has no fixed
 * directive/attributes of its own to preview -- it's a one-time
 * conversion utility, not a markdown example). `id` is a fixed,
 * hardcoded single value for a Tool today (`"svg-points"`) since there's
 * only one -- kept as a real `id` field (not a bare `{kind: "tool"}`) so
 * adding a second tool later doesn't need this union's own shape to
 * change. */
type FocusTarget =
  | { kind: "scratch"; id: string }
  | { kind: "pad"; id: string }
  | { kind: "paper"; id: string }
  | { kind: "tool"; id: "svg-points" };

/** Mirrors `ViewMode` (declared further below, with the rest of the
 * layout types) -- spelled out as a literal union here instead of
 * referencing it directly, just to keep this localStorage-adjacent block
 * self-contained and readable top-to-bottom. */
type RememberedScratchpadState = { focus: FocusTarget; viewMode: "focus" | "list" };

const LAST_FOCUS_STORAGE_KEY = "nopal:scratchpad:last-focus";

/** What was last focused (Scratch, Pad, or Tracing Paper) + which view mode
 * it was shown in -- read once, client-side only, when the URL itself has
 * no explicit `scratch`/`pad`/`paper` param (a bare `/maker/stamps/scratch`
 * visit), so reopening the page picks back up where you left off instead
 * of always resetting to `DEFAULT_FOCUS_ID`. Guarded the same way
 * `knownAccounts.ts`'s localStorage helpers are (`typeof window ===
 * "undefined"` -- this route's first render happens server-side, where
 * there's no `window`/`localStorage` at all). */
function readRememberedScratchpadState(): RememberedScratchpadState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedScratchpadState> | null;
    const focus = parsed?.focus;
    if (
      !focus ||
      (focus.kind !== "scratch" && focus.kind !== "pad" && focus.kind !== "paper" && focus.kind !== "tool") ||
      typeof focus.id !== "string"
    ) {
      return null;
    }
    return { focus, viewMode: parsed?.viewMode === "list" ? "list" : "focus" };
  } catch {
    return null;
  }
}

/** Persists the CURRENT focus/view -- called from every real navigation
 * (drawer clicks, the Focus/List toggle, a List row's own "Focus"
 * button), not from a generic "whenever these props change" effect --
 * simpler, and avoids any ordering hazard with the mount-time restore
 * (`readRememberedScratchpadState`) above racing a redundant write. */
function rememberScratchpadState(state: RememberedScratchpadState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_FOCUS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore -- e.g. storage disabled/full; not worth surfacing to the user
    // over something this low-stakes.
  }
}

/** Builds the next `URLSearchParams` for a given focus/view -- `scratch`/
 * `pad`/`paper`/`tool` are mutually exclusive (whichever's relevant is
 * set, the other three removed), `view` is omitted entirely in the
 * (default) "focus" mode rather than written as `view=focus`, so the
 * common case keeps a clean URL like `?scratch=my-scratch` or
 * `?paper=icon`. */
function buildFocusSearchParams(
  current: URLSearchParams,
  focus: FocusTarget,
  viewMode: "focus" | "list",
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("scratch");
  next.delete("pad");
  next.delete("paper");
  next.delete("tool");
  if (focus.kind === "pad") next.set("pad", focus.id);
  else if (focus.kind === "paper") next.set("paper", focus.id);
  else if (focus.kind === "tool") next.set("tool", focus.id);
  else next.set("scratch", focus.id);
  if (viewMode === "list") next.set("view", "list");
  else next.delete("view");
  return next;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const drawerNavLinkClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

/** Shared drawer-nav-button look -- used for Scratches (flat, or nested
 * under a Pad), Pads themselves, and Tracing Papers, just with different
 * `indent`/font weight so a Pad visually parents its own member Scratches. */
function NavButton({
  label,
  isFocused,
  indent = 0,
  bold = false,
  onClick,
}: {
  label: string;
  isFocused: boolean;
  indent?: number;
  bold?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Deliberately NOT `navLink`'s own `active` variant -- that one
      // hardcodes dark purple text on the assumption of a light pill
      // background (`navActiveBg`), which these buttons don't have
      // (`background: none` below). `scratch-focus-accent` (scratch.css)
      // gives the SAME purple-in-light/white-in-dark treatment the
      // focused entry's own border/label use, so both stay consistent and
      // legible in dark mode.
      className={`${navLink({ context: "drawer" })} ${drawerNavLinkClass} ${isFocused ? "scratch-focus-accent" : ""}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "none",
        cursor: "pointer",
        paddingLeft: indent,
        fontWeight: isFocused ? 700 : bold ? 600 : undefined,
      }}
    >
      {label}
    </button>
  );
}

/** A drawer section's own label, with an action link (e.g. "+ New") --
 * Pads and Scratches, which can both be created from here. */
function DrawerSectionHeader({
  label,
  actionLabel,
  onAction,
  disabled,
}: {
  label: string;
  actionLabel: string;
  onAction: () => void;
  disabled: boolean;
}) {
  return (
    <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
      <div
        className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
        style={{ color: semanticColors.textSubtle }}
      >
        {label}
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
        style={{
          background: "none",
          border: "none",
          cursor: disabled ? "default" : "pointer",
          color: semanticColors.textBrand,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {disabled ? "\u2026" : actionLabel}
      </button>
    </div>
  );
}

/** A drawer section's own label, with NO action -- Tracing Papers are
 * fixed/code-defined, nothing to create here. */
function DrawerLabel({ label }: { label: string }) {
  return (
    <div
      className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
      style={{ color: semanticColors.textSubtle }}
    >
      {label}
    </div>
  );
}

/** `pads` is the RESOLVED (override-aware) list, not raw DB rows -- so an
 * edited-and-saved `name` shows up here too. Each Pad's own member
 * Scratches render nested/indented directly underneath it, in order (the
 * whole point of a Pad, per its own doc comment) -- there's no separate
 * "ungrouped Scratches" section anymore; every Scratch belongs to exactly
 * one Pad, always (see `action`'s own doc comment), so this nested list
 * IS the complete list. Tracing Papers list separately below, with no
 * creation control of their own -- they're fixed. Also owns the "+ New
 * pad" creation control -- a Scratch can only ever be created FROM INSIDE
 * a Pad (`FocusedPadView`'s own "+ New scratch", or a Tracing Paper's
 * "Use as new Scratch"), never from the drawer directly. */
function ScratchNav({
  pads,
  scratchById,
  papers,
  focus,
  onFocusScratch,
  onFocusPad,
  onFocusPaper,
  onFocusTool,
}: {
  pads: ResolvedPad[];
  scratchById: Map<string, Scratch>;
  papers: TracingPaper[];
  focus: FocusTarget;
  onFocusScratch: (id: string) => void;
  onFocusPad: (id: string) => void;
  onFocusPaper: (id: string) => void;
  onFocusTool: () => void;
}) {

  const createPadFetcher = useFetcher<{ ok: boolean; id?: string }>();
  const isCreatingPad = createPadFetcher.state !== "idle";
  useEffect(() => {
    if (createPadFetcher.data?.ok && createPadFetcher.data.id) {
      onFocusPad(createPadFetcher.data.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPadFetcher.data]);
  function handleCreatePad() {
    createPadFetcher.submit({ intent: "create-pad" }, { method: "post", encType: "application/json" });
  }

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <DrawerSectionHeader label="Pads" actionLabel="+ New pad" onAction={handleCreatePad} disabled={isCreatingPad} />
        {pads.map((pad) => (
          <Stack key={pad.id} gap={0}>
            <NavButton
              label={pad.name}
              bold
              isFocused={focus.kind === "pad" && focus.id === pad.id}
              onClick={() => onFocusPad(pad.id)}
            />
            {pad.scratchIds.map((id) => (
              <NavButton
                key={id}
                label={scratchById.get(id)?.name ?? id}
                indent={16}
                isFocused={focus.kind === "scratch" && focus.id === id}
                onClick={() => onFocusScratch(id)}
              />
            ))}
          </Stack>
        ))}
      </Stack>
      <Stack gap={1}>
        <DrawerLabel label="Tracing Papers" />
        {papers.map((paper) => (
          <NavButton
            key={paper.id}
            label={paper.name}
            isFocused={focus.kind === "paper" && focus.id === paper.id}
            onClick={() => onFocusPaper(paper.id)}
          />
        ))}
      </Stack>
      <Stack gap={1}>
        <DrawerLabel label="Tools" />
        <NavButton label="SVG → Points" isFocused={focus.kind === "tool"} onClick={onFocusTool} />
      </Stack>
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

/** Shared "jump into Focus mode on this" control -- used by each List-mode
 * row (`TracingPaperRow`); the drawer's own nav buttons (`ScratchNav`)
 * call the exact same `onFocus*` callbacks from `StampsScratch`, just via
 * a different control. */
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

/** One `Rendered (static)` preview box, shared across every Focus/List
 * view in this file -- only the surrounding layout (dominant vs. a small
 * fixed-size thumbnail) differs between callers, not this box's own
 * styling rules. */
function PreviewBox({
  fullBleed,
  markdown,
  minHeight,
  previewScheme,
}: {
  /** Sections/pricing-cards (and a Pad's own combined, multi-scratch
   * preview) render their own full-bleed background and padding -- let
   * that reach the box's own edge instead of double-padding it. Everything
   * else gets the box's normal padding. */
  fullBleed?: boolean;
  markdown: string;
  minHeight: number;
  /** Forces this box's own `--website-accent-*`/`--website-bg-page`
   * tokens (website.css) to a specific scheme via a plain descendant
   * custom-property override (`.website-preview-force-{light,dark}`),
   * regardless of the browser's actual `prefers-color-scheme` -- lets
   * the guide's own toggle preview either one on demand. */
  previewScheme: "light" | "dark";
}) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {}, forcedScheme: previewScheme });
  return (
    <div
      className={previewScheme === "dark" ? "website-preview-force-dark" : "website-preview-force-light"}
      style={{
        border: `1px solid ${semanticColors.surfaceBorder}`,
        borderRadius: 6,
        padding: fullBleed ? 0 : 16,
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
      {/* `ox-no-heading-marks` -- a rendered directive preview isn't
          markdown source; a heading inside it shouldn't show a literal
          `#` in front of it, same as a real published `/v2` page
          (`WebsitePageView.tsx`'s own comment) or the Vault's own
          website-page preview (`vault.tsx`'s `WebsitePageSplitEditor`) --
          literal marks are an OxEditor (editing-surface) affordance,
          reserved for there, not for a finished-page preview like this
          one. `website-page-ox` -- goes ALONGSIDE those two in both real
          call sites (see `website.css`'s own comment); zeroes `.ox-content`'s
          own left/right gutter so this box's own padding above is the
          ONLY inset, instead of silently double-padding. */}
      <OxRenderer markdown={markdown} directives={registry} className="ox-no-heading-marks ox-no-dots website-page-ox" />
    </div>
  );
}

/** Side-by-side Light + Dark instances of the SAME markdown -- Tracing
 * Papers (unlike a Scratch/Pad, which stay on the page-level toggle,
 * `previewScheme`/`PREVIEW_SCHEME_OPTIONS` below) are FIXED, read-only
 * examples, so there's no real cost to always rendering both at once --
 * comparing a directive's light vs. dark treatment is exactly the kind
 * of "quick decision" a Tracing Paper exists to support, and flipping a
 * single toggle back and forth to do that is strictly slower than just
 * looking at both. `flexWrap` -- stacks light-over-dark on a narrow
 * column (a List row's own thumbnail) instead of squeezing two illegibly
 * narrow renders side by side. */
function PreviewBoxPair({
  fullBleed,
  markdown,
  minHeight,
}: {
  fullBleed?: boolean;
  markdown: string;
  minHeight: number;
}) {
  return (
    <div className={sprinkles({ display: "flex", gap: 3, flexWrap: "wrap" })}>
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <ColumnLabel>Light</ColumnLabel>
        <PreviewBox fullBleed={fullBleed} markdown={markdown} minHeight={minHeight} previewScheme="light" />
      </div>
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <ColumnLabel>Dark</ColumnLabel>
        <PreviewBox fullBleed={fullBleed} markdown={markdown} minHeight={minHeight} previewScheme="dark" />
      </div>
    </div>
  );
}

const SVG_ANCHOR_X_OPTIONS: { value: LineAnchorX["ref"]; label: string }[] = [
  { value: "L", label: "Left" },
  { value: "C", label: "Center" },
  { value: "R", label: "Right" },
];
const SVG_ANCHOR_Y_OPTIONS: { value: LineAnchorY["ref"]; label: string }[] = [
  { value: "T", label: "Top" },
  { value: "C", label: "Center" },
  { value: "B", label: "Bottom" },
];

type SvgConversionResult =
  | {
      ok: true;
      pointsAttr: string;
      lineDirective: string;
      pathDirective: string;
      pointCount: number;
      subpathCount: number;
      kind: "path" | "polyline" | "polygon";
      sourceWidth: number;
      sourceHeight: number;
      originalSvgMarkup: string;
    }
  | { ok: false; error: string };

const SVG_TO_POINTS_DEFAULT =
  '<svg viewBox="0 0 100 40"><path d="M0,20 C25,0 75,40 100,20" fill="none" stroke="currentColor"/></svg>';

/** Converts real SVG geometry into EITHER `::line{points="..."}`'s own
 * LITERAL-PIXEL coordinate vocabulary (see `oxmarkdown-core`'s
 * `wavyLine.ts` for why those are real, stable pixels rather than a
 * normalized-then-rescaled box) OR `::path{points="..." width="..."
 * height="..." start="..."}`'s decoupled shape/size/position one -- the
 * practical way to trace a hand-drawn squiggle (or a genuinely complex,
 * many-segment scribble -- multiple chained curves parse/sample fine, not
 * just a single simple arc) from Figma/Illustrator/a scanned sketch
 * instead of hand-guessing anchor/delta numbers one at a time. All the
 * actual parse/fit/format math is pure and lives in `oxmarkdown-core/src/
 * svgToLinePoints.ts` (zero React, independently testable/reusable) --
 * this component is purely the paste-in/configure/preview/copy UI wrapped
 * around it.
 *
 * Both outputs share the SAME paste/anchor/target-size inputs, used two
 * different ways:
 *   - `::line{...}`'s points get PRE-FIT into the target width/height and
 *     the anchor gets BAKED into the very first point (`formatLinePointsAttr`'s
 *     `firstPointAnchor`) -- a fully self-contained, one-time computation,
 *     matching `::line`'s own literal/static design.
 *   - `::path{...}`'s points are the RAW extracted deltas, completely
 *     UNSCALED -- the same target width/height and anchor instead become
 *     `::path`'s own live `width`/`height`/`start` attributes verbatim,
 *     so `::path`'s own render-time math (`fitAndPositionPoints`) does the
 *     actual fitting -- genuinely responsive if a `%` is used, unlike
 *     `::line`'s baked-in numbers.
 *
 * Lives as its OWN section (not folded into the "Line"/"Path" Tracing
 * Papers' own attribute controls above) since it's a fundamentally
 * different KIND of tool -- a one-time conversion utility you paste
 * something into and copy a result out of, not a live attribute editor
 * cycling through a fixed example. ALSO surfaced directly inside both
 * Tracing Papers' own Focus views (`FocusedTracingPaperView`, below)
 * since that's where an author is most likely to actually reach for it.
 *
 * The "anchor this shape at a position + offset" mental model reuses the
 * EXACT SAME `L`/`C`/`R` (x) + `T`/`C`/`B` (y) + numeric-offset vocabulary
 * both directives already use -- picking WHICH point of the traced shape
 * that anchor applies to (`referenceMode`) is one extra knob this needs
 * that a hand-typed `points="..."`/`start="..."` attribute doesn't, since
 * a real SVG's own "first drawn point" isn't always the most meaningful
 * anchor (a closed loop's bounding-box corner often reads more
 * predictably). `targetWidth`/`targetHeight` (px, typed as a plain
 * number here) is the other -- passed through VERBATIM as `::path`'s own
 * `width`/`height` (hand-edit the copied result to add a trailing `%`
 * for `::path`'s genuinely-responsive sizing; this tool's own inputs
 * only ever produce a plain px number, since `::line`'s OWN fit
 * computation needs one regardless). */
function SvgToPointsTool() {
  const [svgInput, setSvgInput] = useState(SVG_TO_POINTS_DEFAULT);
  const [targetWidth, setTargetWidth] = useState("100");
  const [targetHeight, setTargetHeight] = useState("40");
  const [anchorXRef, setAnchorXRef] = useState<LineAnchorX["ref"]>("C");
  const [anchorXOffset, setAnchorXOffset] = useState("0");
  const [anchorYRef, setAnchorYRef] = useState<LineAnchorY["ref"]>("C");
  const [anchorYOffset, setAnchorYOffset] = useState("0");
  const [scaleMode, setScaleMode] = useState<"fit" | "stretch">("fit");
  const [referenceMode, setReferenceMode] = useState<"first-point" | "bounding-box">("first-point");
  const [reverse, setReverse] = useState(false);

  const result: SvgConversionResult = useMemo(() => {
    const geometry = extractSvgGeometry(svgInput);
    if (!geometry) {
      return { ok: false, error: "Couldn't find any usable <path>/<polyline>/<polygon> data (or a bare point list) in that paste." };
    }
    // Reversed BEFORE anything else touches it -- fitting/anchoring/point-
    // counting all then naturally treat whichever end the trace happened
    // to end on as the shape's own "first" point instead, exactly as if
    // the SVG had been drawn in that direction to begin with.
    const orderedPoints = reverse ? reverseSvgGeometry(geometry.points) : geometry.points;
    const anchorX: LineAnchorX = { ref: anchorXRef, offset: Number(anchorXOffset) || 0 };
    const anchorY: LineAnchorY = { ref: anchorYRef, offset: Number(anchorYOffset) || 0 };
    const targetWidthPx = Number(targetWidth) || 100;
    const targetHeightPx = Number(targetHeight) || 40;

    // `::line{...}`: pre-fit into the target box, anchor baked into the
    // very first point -- fully self-contained, matching `::line`'s own
    // literal/static design.
    const fitted = fitSvgPointsToLineBox(orderedPoints, geometry.width, geometry.height, {
      targetWidth: targetWidthPx,
      targetHeight: targetHeightPx,
      referenceIndex: referenceMode === "bounding-box" ? "bounding-box" : 0,
      anchorX,
      anchorY,
      scaleMode,
    });
    const linePointsAttr = formatLinePointsAttr(fitted, { x: anchorX, y: anchorY });
    const lineDirective = `::line{points="${linePointsAttr}" curve="smooth" tension="0.5"}`;

    // `::path{...}`: the RAW extracted deltas, completely unscaled --
    // `width`/`height`/`start` carry the SAME target size/anchor instead,
    // as `::path`'s own live attributes, so ITS render-time math does the
    // actual fitting (see `fitAndPositionPoints`). `pointsAttr` (bare, no
    // directive wrapper) is exactly this same raw value -- the shape
    // itself, independent of which directive it ends up pasted into.
    const pointsAttr = formatLinePointsAttr(orderedPoints);
    const startAttr = `${anchorX.ref}${anchorXOffset || 0},${anchorY.ref}${anchorYOffset || 0}`;
    const pathDirective = `::path{points="${pointsAttr}" width="${targetWidthPx}" height="${targetHeightPx}" start="${startAttr}" curve="smooth" tension="0.5"}`;

    // A quick visual reference back to what was actually pasted -- a whole
    // `<svg>` renders as-is; a bare shape tag or plain point list gets
    // wrapped in a synthetic `<svg>` (using the extracted geometry's own
    // natural width/height as its `viewBox`) so there's still something to
    // look at either way.
    const trimmedInput = svgInput.trim();
    const originalSvgMarkup = /^<svg[\s>]/i.test(trimmedInput)
      ? trimmedInput
      : (() => {
          const shapeMatch = /<(path|polyline|polygon)\b[^>]*>/i.exec(trimmedInput);
          const inner = shapeMatch ? shapeMatch[0] : `<polyline points="${trimmedInput}" fill="none" stroke="currentColor" />`;
          return `<svg viewBox="0 0 ${geometry.width} ${geometry.height}">${inner}</svg>`;
        })();

    return {
      ok: true,
      pointsAttr,
      lineDirective,
      pathDirective,
      pointCount: geometry.points.reduce((n, group) => n + group.length, 0),
      subpathCount: geometry.points.length,
      kind: geometry.kind,
      sourceWidth: geometry.width,
      sourceHeight: geometry.height,
      originalSvgMarkup,
    };
  }, [svgInput, targetWidth, targetHeight, anchorXRef, anchorXOffset, anchorYRef, anchorYOffset, scaleMode, referenceMode, reverse]);

  const fieldClassName = `${textSize.sm} ${sprinkles({ p: 2, fontFamily: "mono" })}`;
  const fieldStyle: CSSProperties = {
    display: "block",
    width: "100%",
    background: semanticColors.surfaceInset,
    color: "inherit",
    border: "1px solid transparent",
    borderRadius: 6,
  };

  return (
    <div
      className={sprinkles({ display: "flex", gap: 5, flexWrap: "wrap" })}
      style={{ alignItems: "flex-start", border: `1px solid ${semanticColors.surfaceBorder}`, borderRadius: 8, padding: 16 }}
    >
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <ColumnLabel>Paste SVG (or a bare "x,y x,y ..." list)</ColumnLabel>
        <textarea
          value={svgInput}
          onChange={(e) => setSvgInput(e.target.value)}
          spellCheck={false}
          rows={4}
          className={`${textSize.sm} ${sprinkles({ p: 3, fontFamily: "mono" })}`}
          style={textAreaStyle(svgInput !== SVG_TO_POINTS_DEFAULT)}
        />
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, marginTop: 8, lineHeight: 1.5 }}>
          Reads the FIRST <code>path</code>/<code>polyline</code>/<code>polygon</code> found -- a whole copied{" "}
          <code>{"<svg>"}</code>, a bare shape tag, or just a plain point list all work. Curves (<code>C</code>/
          <code>S</code>/<code>Q</code>/<code>T</code>) are sampled into a smooth polyline; elliptical arcs (
          <code>A</code>) aren't supported.
        </p>

        <div className={sprinkles({ display: "flex", gap: 4, flexWrap: "wrap", mt: 4 })}>
          <div style={{ flex: "1 1 100px" }}>
            <ColumnLabel>Target width (px)</ColumnLabel>
            <input
              type="text"
              inputMode="decimal"
              value={targetWidth}
              onChange={(e) => setTargetWidth(e.target.value)}
              className={fieldClassName}
              style={fieldStyle}
            />
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <ColumnLabel>Target height (px)</ColumnLabel>
            <input
              type="text"
              inputMode="decimal"
              value={targetHeight}
              onChange={(e) => setTargetHeight(e.target.value)}
              className={fieldClassName}
              style={fieldStyle}
            />
          </div>
        </div>

        <div className={sprinkles({ display: "flex", gap: 4, flexWrap: "wrap", mt: 4 })}>
          <div style={{ flex: "1 1 160px" }}>
            <ColumnLabel>Anchor the {referenceMode === "bounding-box" ? "bounding box's top-left" : "first point"} at</ColumnLabel>
            <div className={sprinkles({ display: "flex", gap: 2 })}>
              <select
                value={anchorXRef}
                onChange={(e) => setAnchorXRef(e.target.value as LineAnchorX["ref"])}
                className={fieldClassName}
                style={fieldStyle}
              >
                {SVG_ANCHOR_X_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={anchorYRef}
                onChange={(e) => setAnchorYRef(e.target.value as LineAnchorY["ref"])}
                className={fieldClassName}
                style={fieldStyle}
              >
                {SVG_ANCHOR_Y_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <ColumnLabel>X offset</ColumnLabel>
            <input
              type="text"
              inputMode="decimal"
              value={anchorXOffset}
              onChange={(e) => setAnchorXOffset(e.target.value)}
              className={fieldClassName}
              style={fieldStyle}
            />
          </div>
          <div style={{ flex: "1 1 100px" }}>
            <ColumnLabel>Y offset</ColumnLabel>
            <input
              type="text"
              inputMode="decimal"
              value={anchorYOffset}
              onChange={(e) => setAnchorYOffset(e.target.value)}
              className={fieldClassName}
              style={fieldStyle}
            />
          </div>
        </div>

        <div className={sprinkles({ display: "flex", gap: 4, flexWrap: "wrap", mt: 4 })}>
          <div style={{ flex: "1 1 160px" }}>
            <ColumnLabel>Reference point</ColumnLabel>
            <select
              value={referenceMode}
              onChange={(e) => setReferenceMode(e.target.value as "first-point" | "bounding-box")}
              className={fieldClassName}
              style={fieldStyle}
            >
              <option value="first-point">Shape's first point</option>
              <option value="bounding-box">Shape's bounding-box corner</option>
            </select>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <ColumnLabel>Scale</ColumnLabel>
            <select
              value={scaleMode}
              onChange={(e) => setScaleMode(e.target.value as "fit" | "stretch")}
              className={fieldClassName}
              style={fieldStyle}
            >
              <option value="fit">Fit (keep proportions)</option>
              <option value="stretch">Stretch to fill</option>
            </select>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <ColumnLabel>Direction</ColumnLabel>
            <label
              className={`${textSize.sm} ${sprinkles({ display: "flex", alignItems: "center", gap: 2, p: 2, fontFamily: "mono" })}`}
              style={{ ...fieldStyle, cursor: "pointer" }}
            >
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              Reverse (flip start/end)
            </label>
          </div>
        </div>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, marginTop: 8, lineHeight: 1.5 }}>
          A traced SVG's own end point isn't always the one you actually want to build onto --
          "Reverse" swaps which end is first/last (the shape looks identical) so the point you
          want to extend from lands at the very END of <code>points="..."</code>, ready to keep
          typing deltas (or a <code>|</code> break) straight after it.
        </p>

        {!result.ok ? (
          <p className={textSize.sm} style={{ color: semanticColors.textDanger, marginTop: 12 }}>
            {result.error}
          </p>
        ) : (
          <>
            <div className={sprinkles({ mt: 4 })}>
              <ColumnLabel>
                {result.pointCount} point{result.pointCount === 1 ? "" : "s"}
                {result.subpathCount > 1 ? ` across ${result.subpathCount} disconnected strokes` : ""} parsed from a {result.kind} (
                {Math.round(result.sourceWidth)}×{Math.round(result.sourceHeight)} source)
              </ColumnLabel>
            </div>
            <div className={sprinkles({ display: "flex", gap: 2, flexWrap: "wrap", mt: 3 })}>
              <CopyButton label="Copy points" value={result.pointsAttr} />
              <CopyButton label="Copy line" value={result.lineDirective} />
              <CopyButton label="Copy path" value={result.pathDirective} />
            </div>
          </>
        )}
      </div>
      <div style={{ flex: "1 1 340px", minWidth: 280 }}>
        {result.ok && (
          <>
            <ColumnLabel>Original (as pasted)</ColumnLabel>
            <div
              className={`svg-original-preview ${sprinkles({ p: 3 })}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 120,
                border: `1px solid ${semanticColors.surfaceBorder}`,
                borderRadius: 6,
                background: "var(--website-bg-page)",
                color: semanticColors.textPrimary,
              }}
              // Safe here -- this whole route is Admin/Super-gated, and the
              // markup is the author's own paste, not untrusted user
              // content (see `scratch.css`'s own comment on this class).
              dangerouslySetInnerHTML={{ __html: result.originalSvgMarkup }}
            />
            <div className={sprinkles({ mt: 4 })}>
              <ColumnLabel>::line{"{...}"} preview</ColumnLabel>
              <PreviewBoxPair fullBleed markdown={result.lineDirective} minHeight={160} />
            </div>
            <div className={sprinkles({ mt: 4 })}>
              <ColumnLabel>::path{"{...}"} preview</ColumnLabel>
              <PreviewBoxPair fullBleed markdown={result.pathDirective} minHeight={160} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Renders a "note"/"description" -- plain markdown (inline `` `code` ``
 * spans, mainly), through the same `OxRenderer` pipeline as the actual
 * preview markdown, just without any expectation of block-level directives
 * actually appearing in it. */
function InfoText({ markdown }: { markdown: string }) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return <OxRenderer markdown={markdown} directives={registry} className="ox-no-dots" />;
}

/** Auto-grows a textarea to EXACTLY fit its own content -- including
 * wrapped lines, which a naive `rows={value.split("\n").length}` undercounts
 * the moment any single line wraps in a narrow column (a real bug: a long
 * `:::section-title{...}` attribute line was getting cut off with an
 * internal scrollbar). Re-measuring the browser's own `scrollHeight` (not a
 * guessed chars-per-row heuristic) is exact regardless of font/width, and
 * re-runs on every edit AND on mount alike, so a freshly-focused entry
 * always starts already sized to fit its own starting content, no
 * scrollbar needed. Reset height to "auto" first so shrinking (fewer lines
 * after an edit, or hitting "Reset") is measured correctly too --
 * `scrollHeight` alone never shrinks below whatever height was already
 * set. Shared by both the markdown and note textareas below. */
function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

/** Shared "discard local edits" link -- next to a "Save" button
 * (`SaveButton`, below) in both `FocusedEntryView` and `FocusedPadView`. */
function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={textSize.xs}
      style={{ background: "none", border: "none", cursor: "pointer", color: semanticColors.textBrand, textDecoration: "underline" }}
    >
      Reset
    </button>
  );
}

/** Shared "persist local edits" button -- see `ResetLink` above. */
function SaveButton({ onClick, isSaving }: { onClick: () => void; isSaving: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isSaving}
      className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 2, py: 1 })}`}
      style={{
        border: `1px solid ${semanticColors.textBrand}`,
        borderRadius: 6,
        background: "none",
        cursor: isSaving ? "default" : "pointer",
        color: semanticColors.textBrand,
        opacity: isSaving ? 0.6 : 1,
      }}
    >
      {isSaving ? "Saving\u2026" : "Save"}
    </button>
  );
}

/** Shared destructive action button -- "Delete this scratch" and "Delete
 * this pad" both use this. */
function DangerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${textSize.xs} ${sprinkles({ fontFamily: "mono", px: 2, py: 1 })}`}
      style={{
        border: `1px solid ${semanticColors.textDanger}`,
        borderRadius: 6,
        background: "none",
        cursor: "pointer",
        color: semanticColors.textDanger,
      }}
    >
      {label}
    </button>
  );
}

const textAreaStyle = (isDirty: boolean): CSSProperties => ({
  display: "block",
  width: "100%",
  background: semanticColors.surfaceInset,
  color: "inherit",
  border: `1px solid ${isDirty ? semanticColors.textBrand : "transparent"}`,
  borderRadius: 6,
  whiteSpace: "pre-wrap",
  margin: 0,
  resize: "vertical",
  // The `useAutoGrowTextarea` effect keeps `height` exactly matched to
  // `scrollHeight` on every render, so there's normally nothing TO scroll
  // -- `auto` (not `hidden`) is still the right fallback for the one brief
  // pre-hydration paint and for a user manually dragging the `resize`
  // handle smaller than the content needs.
  overflow: "auto",
});

/** Focus mode's single, dominant view of one Scratch -- fully editable,
 * unlike a Tracing Paper. All four fields (name/markdown/directive/note)
 * share ONE Reset/Save trio -- edited together as one Scratch, not four
 * independent things each needing their own save click. Every Scratch is
 * user-created, so "Delete" always applies here -- there's no code-defined
 * default to "revert" to (that's what a Tracing Paper is for). */
function FocusedEntryView({
  scratch,
  ownerPadId,
  onFocusScratch,
  onDeleted,
  previewScheme,
}: {
  scratch: Scratch;
  /** The id of the Pad that owns this scratch (every scratch belongs to
   * exactly one -- see `action`'s own doc comment) -- "+ New scratch"
   * below creates its sibling in the SAME pad, `undefined` only in the
   * (shouldn't-happen) case of a scratch whose owner couldn't be found. */
  ownerPadId: string | undefined;
  /** Focuses a different scratch -- used by "+ New scratch" below to jump
   * straight to the one it just created. */
  onFocusScratch: (id: string) => void;
  /** Called right after a successful delete -- there's no scratch left to
   * keep showing, so the caller needs to steer focus elsewhere. */
  onDeleted: () => void;
  previewScheme: "light" | "dark";
}) {
  // Local edit state -- `StampsScratch` mounts this with `key={scratch.id}`,
  // so switching to a DIFFERENT focused scratch always starts fresh instead
  // of carrying over stale edits from whatever was focused before.
  const [name, setName] = useState(scratch.name);
  const [directive, setDirective] = useState(scratch.directive);
  const [note, setNote] = useState(scratch.note);
  const [markdown, setMarkdown] = useState(scratch.markdown);
  const isDirty =
    name !== scratch.name || directive !== scratch.directive || note !== scratch.note || markdown !== scratch.markdown;

  // Persists/deletes this scratch via `action` (`websiteScratches.server.ts`)
  // -- a successful save submission revalidates this route's own loader,
  // which flows a fresh `scratch` back down as a prop, which is what
  // actually clears `isDirty` (no separate "saved!" state to manage by hand).
  const saveFetcher = useFetcher();
  const isSaving = saveFetcher.state !== "idle";

  function handleSave() {
    saveFetcher.submit(
      { intent: "save", entryId: scratch.id, name, directive, note, markdown },
      { method: "post", encType: "application/json" },
    );
  }

  function handleResetEdits() {
    setName(scratch.name);
    setDirective(scratch.directive);
    setNote(scratch.note);
    setMarkdown(scratch.markdown);
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${scratch.name}"? This can't be undone.`)) return;
    saveFetcher.submit(
      { intent: "delete", entryId: scratch.id },
      { method: "post", encType: "application/json" },
    );
    onDeleted();
  }

  // "+ New scratch" -- lets you keep going after finishing this one,
  // without a trip back through the drawer. Creates the new scratch in
  // the SAME pad this one belongs to (every scratch needs an owning pad;
  // this one's is the obvious default) and jumps straight to it, same
  // create-then-focus pattern `FocusedPadView`'s own "+ New scratch" and
  // a Tracing Paper's "Use as new Scratch" use.
  const createFetcher = useFetcher<{ ok: boolean; id?: string }>();
  const isCreatingScratch = createFetcher.state !== "idle";
  useEffect(() => {
    if (createFetcher.data?.ok && createFetcher.data.id) {
      onFocusScratch(createFetcher.data.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFetcher.data]);
  function handleNewScratch() {
    if (!ownerPadId) return;
    createFetcher.submit({ intent: "create", padId: ownerPadId }, { method: "post", encType: "application/json" });
  }

  const markdownRef = useAutoGrowTextarea(markdown);
  const noteRef = useAutoGrowTextarea(note);

  return (
    <div className={sprinkles({ display: "flex", gap: 5, flexWrap: "wrap" })} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 480px", minWidth: 0 }}>
        <ColumnLabel>Rendered (static)</ColumnLabel>
        <PreviewBox fullBleed markdown={markdown} minHeight={480} previewScheme={previewScheme} />
      </div>
      <div style={{ flex: "0 1 340px", minWidth: 280 }}>
        <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <ColumnLabel>Name</ColumnLabel>
          <div className={sprinkles({ display: "flex", alignItems: "center", gap: 3, mb: 2 })}>
            {isDirty && <ResetLink onClick={handleResetEdits} />}
            {isDirty && <SaveButton onClick={handleSave} isSaving={isSaving} />}
          </div>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${textSize.base} ${sprinkles({ fontWeight: "bold", p: 2 })}`}
          style={{
            display: "block",
            width: "100%",
            background: semanticColors.surfaceInset,
            color: "inherit",
            border: `1px solid ${name !== scratch.name ? semanticColors.textBrand : "transparent"}`,
            borderRadius: 6,
          }}
        />

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Markdown source</ColumnLabel>
          <textarea
            ref={markdownRef}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            rows={3}
            className={`${textSize.sm} ${sprinkles({ p: 3, fontFamily: "mono" })}`}
            style={textAreaStyle(markdown !== scratch.markdown)}
          />
        </div>

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Scratch info</ColumnLabel>
          <input
            type="text"
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            spellCheck={false}
            className={`${textSize.sm} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", p: 2 })}`}
            style={{
              display: "block",
              width: "100%",
              background: semanticColors.surfaceInset,
              color: semanticColors.textBrand,
              border: `1px solid ${directive !== scratch.directive ? semanticColors.textBrand : "transparent"}`,
              borderRadius: 6,
              marginBottom: 8,
            }}
          />
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            spellCheck={false}
            rows={3}
            className={`${textSize.sm} ${sprinkles({ p: 2 })}`}
            style={textAreaStyle(note !== scratch.note)}
          />
        </div>

        <div className={sprinkles({ mt: 4, display: "flex", gap: 3 })}>
          {ownerPadId && (
            <button
              type="button"
              onClick={handleNewScratch}
              disabled={isCreatingScratch}
              className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 2, py: 1 })}`}
              style={{
                border: `1px solid ${semanticColors.textBrand}`,
                borderRadius: 6,
                background: "none",
                cursor: isCreatingScratch ? "default" : "pointer",
                color: semanticColors.textBrand,
                opacity: isCreatingScratch ? 0.6 : 1,
              }}
            >
              {isCreatingScratch ? "\u2026" : "+ New scratch"}
            </button>
          )}
          <DangerButton label="Delete this scratch" onClick={handleDelete} />
        </div>
      </div>
    </div>
  );
}

/** One Tracing Paper attribute's own input -- a `<select>` (optionally
 * grouped into `<optgroup>`s, e.g. the Icon paper's `name`) or a plain text
 * `<input>`. Highlights itself the same "border turns brand-colored" way
 * every other dirty field in this file does, purely as a visual cue --
 * nothing here is ever saved. */
function AttributeField({
  attribute,
  value,
  onChange,
}: {
  attribute: TracingPaperAttribute;
  value: string;
  onChange: (next: string) => void;
}) {
  const isDirty = value !== attribute.default;
  const style: CSSProperties = {
    display: "block",
    width: "100%",
    background: semanticColors.surfaceInset,
    color: "inherit",
    border: `1px solid ${isDirty ? semanticColors.textBrand : "transparent"}`,
    borderRadius: 6,
  };
  const className = `${textSize.sm} ${sprinkles({ p: 2, fontFamily: "mono" })}`;

  if (attribute.kind === "select") {
    // Groups options by their own `group`, preserving first-seen order --
    // e.g. the Icon/Section title papers' own `name`/`icon` dropdown shows
    // a "Files" `<optgroup>` and a "Placeholders" one instead of one flat
    // list.
    const groups: { group?: string; options: TracingPaperSelectOption[] }[] = [];
    for (const opt of attribute.options) {
      const last = groups[groups.length - 1];
      if (last && last.group === opt.group) last.options.push(opt);
      else groups.push({ group: opt.group, options: [opt] });
    }
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className} style={style}>
        {groups.map((g, i) =>
          g.group ? (
            <optgroup key={`${g.group}-${i}`} label={g.group}>
              {g.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label ?? opt.value}
                </option>
              ))}
            </optgroup>
          ) : (
            g.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label ?? opt.value}
              </option>
            ))
          ),
        )}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={attribute.placeholder}
      spellCheck={false}
      className={className}
      style={style}
    />
  );
}

/** A read-only, copyable block of markdown -- the Tracing Paper's own
 * live-rebuilt source. `readOnly`/no textarea at all (unlike a Scratch's
 * own editable one) -- the whole point is that THIS text is a byproduct of
 * the attribute controls above it, not something to type into directly. */
function CopyableMarkdown({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable -- the text below is still
      // selectable by hand.
    }
  }

  return (
    <div>
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
        {value}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className={`${textSize.xs} ${sprinkles({ fontFamily: "mono", px: 2, py: 1, mt: 2 })}`}
        style={{
          border: `1px solid ${semanticColors.surfaceBorder}`,
          borderRadius: 6,
          background: "none",
          cursor: "pointer",
          color: semanticColors.textSubtle,
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

/** A bare copy-to-clipboard button with no visible text preview alongside
 * it -- `SvgToPointsTool`'s own "Copy points"/"Copy line"/"Copy path"
 * trio, where showing the full generated string isn't needed (unlike
 * `CopyableMarkdown` above, a Tracing Paper's own live-rebuilt source,
 * which IS meant to be read/eyeballed) -- the live preview already
 * confirms correctness visually. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable -- nothing else to fall back to
      // here, since there's no visible text to select by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 3, py: 2 })}`}
      style={{
        border: `1px solid ${semanticColors.textBrand}`,
        borderRadius: 6,
        background: "none",
        cursor: "pointer",
        color: semanticColors.textBrand,
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

/** Focus mode's single, dominant view of a Tracing Paper -- NOT editable
 * (no Save, no Delete, nothing here ever persists): the whole point is a
 * fixed, always-available example of what one directive can do. Each of
 * its own attributes (`TracingPaper.attributes`) gets a real input or
 * dropdown that live-rebuilds the markdown fed to the preview, instead of
 * a free-text box -- a second, more guided way to explore the same
 * directive Scratches let you type by hand. "Use as new Scratch" is the
 * bridge from here to there: it seeds a brand new, fully editable Scratch
 * with this paper's CURRENT (possibly attribute-tweaked) markdown. */
function FocusedTracingPaperView({
  paper,
  pads,
  onFocusScratch,
}: {
  paper: TracingPaper;
  /** Every existing Pad -- "Use as new Scratch" needs one to create the
   * new scratch INSIDE (every scratch must belong to exactly one pad; see
   * `action`'s own doc comment), offered here as a picker rather than
   * auto-creating one, so a paper's own examples don't each spawn their
   * own throwaway pad by default. */
  pads: ResolvedPad[];
  onFocusScratch: (id: string) => void;
}) {
  // Keyed by `key={paper.id}` at the call site, so switching Tracing
  // Papers always starts fresh from THAT paper's own defaults.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(paper.attributes.map((a) => [a.key, a.default])),
  );
  const isDirty = paper.attributes.some((a) => values[a.key] !== a.default);
  const markdown = paper.buildMarkdown(values);

  function handleReset() {
    setValues(Object.fromEntries(paper.attributes.map((a) => [a.key, a.default])));
  }

  // Which pad "Use as new Scratch" attaches the new scratch to -- defaults
  // to the first existing pad; stays in sync with a freshly-created one
  // below.
  const [targetPadId, setTargetPadId] = useState(pads[0]?.id ?? "");

  const createPadFetcher = useFetcher<{ ok: boolean; id?: string }>();
  const isCreatingPad = createPadFetcher.state !== "idle";
  useEffect(() => {
    if (createPadFetcher.data?.ok && createPadFetcher.data.id) {
      setTargetPadId(createPadFetcher.data.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPadFetcher.data]);
  function handleCreatePad() {
    createPadFetcher.submit({ intent: "create-pad" }, { method: "post", encType: "application/json" });
  }

  // Same create-then-focus pattern `ScratchNav`'s own "+ New pad" and
  // `FocusedPadView`'s "+ New scratch" use.
  const createFetcher = useFetcher<{ ok: boolean; id?: string }>();
  const isCreatingScratch = createFetcher.state !== "idle";
  useEffect(() => {
    if (createFetcher.data?.ok && createFetcher.data.id) {
      onFocusScratch(createFetcher.data.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFetcher.data]);
  function handleUseAsScratch() {
    if (!targetPadId) return;
    createFetcher.submit(
      { intent: "create", padId: targetPadId, name: paper.name, directive: paper.directive, note: paper.note, markdown },
      { method: "post", encType: "application/json" },
    );
  }

  return (
    <div className={sprinkles({ display: "flex", gap: 5, flexWrap: "wrap" })} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: "2 1 640px", minWidth: 0 }}>
        <ColumnLabel>Rendered (static)</ColumnLabel>
        <PreviewBoxPair fullBleed={paper.fullBleed} markdown={markdown} minHeight={Math.max(paper.previewMinHeight ?? 0, 480)} />
      </div>
      <div style={{ flex: "0 1 340px", minWidth: 280 }}>
        <ColumnLabel>Directive</ColumnLabel>
        <code
          className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}
          style={{ color: semanticColors.textBrand, display: "block", wordBreak: "break-word" }}
        >
          {paper.directive}
        </code>

        {paper.attributes.length > 0 && (
          <div className={sprinkles({ mt: 4 })}>
            <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
              <ColumnLabel>Attributes</ColumnLabel>
              {isDirty && <ResetLink onClick={handleReset} />}
            </div>
            <Stack gap={3}>
              {paper.attributes.map((attribute) => (
                <div key={attribute.key}>
                  <label
                    className={`${textSize.xs} ${sprinkles({ fontFamily: "mono", mb: 1 })}`}
                    style={{ display: "block", color: semanticColors.textSubtle }}
                  >
                    {attribute.label}
                  </label>
                  <AttributeField
                    attribute={attribute}
                    value={values[attribute.key]}
                    onChange={(next) => setValues((prev) => ({ ...prev, [attribute.key]: next }))}
                  />
                </div>
              ))}
            </Stack>
          </div>
        )}

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Markdown source (read-only)</ColumnLabel>
          <CopyableMarkdown value={markdown} />
        </div>

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Description</ColumnLabel>
          <div className={textSize.sm} style={{ color: semanticColors.textSubtle, lineHeight: 1.5 }}>
            <InfoText markdown={paper.note} />
          </div>
        </div>

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Add to pad</ColumnLabel>
          {pads.length === 0 ? (
            <div className={sprinkles({ display: "flex", alignItems: "center", gap: 2 })}>
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle, margin: 0 }}>
                No pads yet —
              </p>
              <button
                type="button"
                onClick={handleCreatePad}
                disabled={isCreatingPad}
                className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 2, py: 1 })}`}
                style={{
                  border: `1px solid ${semanticColors.textBrand}`,
                  borderRadius: 6,
                  background: "none",
                  cursor: isCreatingPad ? "default" : "pointer",
                  color: semanticColors.textBrand,
                  opacity: isCreatingPad ? 0.6 : 1,
                }}
              >
                {isCreatingPad ? "\u2026" : "+ New pad"}
              </button>
            </div>
          ) : (
            <select
              value={targetPadId}
              onChange={(e) => setTargetPadId(e.target.value)}
              className={`${textSize.sm} ${sprinkles({ p: 2 })}`}
              style={{
                display: "block",
                width: "100%",
                background: semanticColors.surfaceInset,
                color: "inherit",
                border: `1px solid ${semanticColors.surfaceBorder}`,
                borderRadius: 6,
              }}
            >
              {pads.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={sprinkles({ mt: 2 })}>
          <button
            type="button"
            onClick={handleUseAsScratch}
            disabled={isCreatingScratch || !targetPadId}
            className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 2, py: 1 })}`}
            style={{
              border: `1px solid ${semanticColors.textBrand}`,
              borderRadius: 6,
              background: "none",
              cursor: isCreatingScratch || !targetPadId ? "default" : "pointer",
              color: semanticColors.textBrand,
              opacity: isCreatingScratch || !targetPadId ? 0.6 : 1,
            }}
          >
            {isCreatingScratch ? "\u2026" : "Use as new Scratch \u2192"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** List mode's compact row for a Tracing Paper -- a small, read-only
 * preview thumbnail (using its own DEFAULT attribute values; List mode is
 * a static browse view, no interactivity here -- that only happens in
 * Focus mode) next to its directive signature, markdown source, and
 * description, plus a button to jump into Focus mode on it. */
function TracingPaperRow({
  paper,
  onFocus,
}: {
  paper: TracingPaper;
  onFocus: () => void;
}) {
  const markdown = paper.buildMarkdown(Object.fromEntries(paper.attributes.map((a) => [a.key, a.default])));
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
      <div style={{ flex: "0 0 480px", minWidth: 0 }}>
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
          <PreviewBoxPair fullBleed={paper.fullBleed} markdown={markdown} minHeight={paper.previewMinHeight ?? 120} />
        </div>
      </div>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <code className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`} style={{ color: semanticColors.textBrand }}>
          {paper.directive}
        </code>
        <div className={sprinkles({ mt: 2, mb: 2 })}>
          <ColumnLabel>Markdown source</ColumnLabel>
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
            {markdown}
          </pre>
        </div>
        <div className={textSize.sm} style={{ color: semanticColors.textSubtle, lineHeight: 1.5 }}>
          <InfoText markdown={paper.note} />
        </div>
        <div className={sprinkles({ mt: 3 })}>
          <FocusButton onClick={onFocus} />
        </div>
      </div>
    </div>
  );
}

/** Small "scratches in this pad" list row -- a name button (jumps to
 * editing that scratch) plus reorder (up/down) controls. Plain up/down
 * buttons rather than drag-and-drop -- simplest thing that fully works,
 * and a Pad realistically holds a handful of scratches (a page's worth of
 * sections), not hundreds. NO remove button -- every scratch belongs to
 * exactly one pad, always, so "removing" it here with no other pad to go
 * to isn't a valid action; move it to a different pad (from THAT pad's
 * own "Add to this pad" picker) or delete it outright instead. */
function PadMemberRow({
  label,
  onFocus,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  label: string;
  onFocus: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const smallButtonStyle: CSSProperties = {
    border: `1px solid ${semanticColors.surfaceBorder}`,
    borderRadius: 4,
    background: "none",
    width: 22,
    height: 22,
    lineHeight: 1,
    cursor: "pointer",
    color: semanticColors.textSubtle,
    flexShrink: 0,
  };
  return (
    <div className={sprinkles({ display: "flex", alignItems: "center", gap: 1 })}>
      <button
        type="button"
        onClick={onFocus}
        className={`${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: semanticColors.textBrand,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
      <button type="button" onClick={onMoveUp} disabled={!canMoveUp} style={{ ...smallButtonStyle, opacity: canMoveUp ? 1 : 0.35 }}>
        ↑
      </button>
      <button type="button" onClick={onMoveDown} disabled={!canMoveDown} style={{ ...smallButtonStyle, opacity: canMoveDown ? 1 : 0.35 }}>
        ↓
      </button>
    </div>
  );
}

/** Focus mode's single, dominant view of a PAD -- combines every member
 * scratch's CURRENT markdown into one document (joined in order, same as
 * multiple directives sitting one after another on a real page) and
 * renders it as ONE preview, simulating what the assembled page would
 * actually look like, instead of one directive's demo at a time. The
 * right column trades the per-field editors `FocusedEntryView` has for
 * ordering/membership controls instead -- a Pad's own "content" IS its
 * member list.
 *
 * Only `name` is staged locally with a Reset/Save pair, same convention
 * every other editable field in this file uses. Order/membership are
 * DIFFERENT -- always read straight from the `pad` prop (never mirrored
 * into local state) and persisted IMMEDIATELY on every change, because
 * every scratch belongs to EXACTLY ONE pad at all times (see `action`'s
 * own doc comment): moving a scratch INTO this pad has to simultaneously
 * take it OUT of wherever it was, which only makes sense as one atomic,
 * already-committed server call, not something a later "Save" click here
 * could still discard. */
function FocusedPadView({
  pad,
  allScratches,
  scratchById,
  onFocusScratch,
  onDeleted,
  previewScheme,
}: {
  pad: ResolvedPad;
  /** Every Scratch -- the "add an existing scratch" picker filters this
   * down to ones not already owned by THIS pad (they belong to some other
   * pad, since every scratch belongs to exactly one). */
  allScratches: Scratch[];
  scratchById: Map<string, Scratch>;
  onFocusScratch: (id: string) => void;
  /** Called right after a successful delete -- there's no Pad left to keep
   * showing, so the caller needs to steer focus elsewhere. */
  onDeleted: () => void;
  previewScheme: "light" | "dark";
}) {
  // Local edit state -- ONLY for `name`. `StampsScratch` mounts this with
  // `key={pad.id}`, same reset-on-switch convention `FocusedEntryView`
  // uses.
  const [name, setName] = useState(pad.name);
  const isDirty = name !== pad.name;

  const nameFetcher = useFetcher();
  const isSavingName = nameFetcher.state !== "idle";

  function handleSaveName() {
    nameFetcher.submit(
      { intent: "save-pad", padId: pad.id, name, scratchIds: pad.scratchIds },
      { method: "post", encType: "application/json" },
    );
  }

  function handleResetName() {
    setName(pad.name);
  }

  function handleDelete() {
    if (!window.confirm(`Delete the pad "${pad.name}"? Every scratch inside it will be deleted too.`)) return;
    nameFetcher.submit(
      { intent: "delete-pad", padId: pad.id },
      { method: "post", encType: "application/json" },
    );
    onDeleted();
  }

  // Reordering persists immediately (see this function's own doc comment)
  // -- always computed from `pad.scratchIds` (the current server truth),
  // never a locally-staged copy.
  const orderFetcher = useFetcher();
  function reorder(nextIds: string[]) {
    orderFetcher.submit(
      { intent: "save-pad", padId: pad.id, name: pad.name, scratchIds: nextIds },
      { method: "post", encType: "application/json" },
    );
  }
  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...pad.scratchIds];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    reorder(next);
  }
  function moveDown(index: number) {
    if (index === pad.scratchIds.length - 1) return;
    const next = [...pad.scratchIds];
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    reorder(next);
  }

  // Adding an EXISTING scratch here is really a MOVE -- `move-scratch`
  // removes it from whichever pad currently owns it and appends it here,
  // atomically, so it's never briefly ownerless OR double-owned.
  const moveFetcher = useFetcher();
  function handleAddExisting(id: string) {
    if (!id) return;
    moveFetcher.submit(
      { intent: "move-scratch", entryId: id, padId: pad.id },
      { method: "post", encType: "application/json" },
    );
  }

  // Creating a brand new scratch always specifies THIS pad as its owner
  // up front (`action` rejects `create` without a `padId`) -- there's no
  // separate "stage it, then Save to actually attach it" step; it's
  // already a real member of this pad the moment it exists.
  const createFetcher = useFetcher<{ ok: boolean; id?: string }>();
  const isCreatingScratch = createFetcher.state !== "idle";
  function handleCreateScratch() {
    createFetcher.submit({ intent: "create", padId: pad.id }, { method: "post", encType: "application/json" });
  }

  // Every member's CURRENT markdown, in order, joined with ZERO blank
  // lines -- not a stylistic no-op. `OxRenderer`'s own "a real blank line
  // gets a real `.ox-blank-line-spacer` grid unit" rhythm
  // (`countBlankLines`/`renderBlockNodes`, OxRenderer.tsx -- see the
  // oxmarkdown skill's own "Between blocks" section) means a single
  // joining `\n\n` (one blank line) WOULD draw a real, unwanted grid-unit
  // gap between each Scratch's own `:::section{...}` (ON TOP of that
  // directive's own internal padding) -- an artifact of this join, not
  // something any Scratch's own author actually wrote. `.trim()` matters
  // here as much as the join character itself: without it, a scratch
  // whose OWN markdown happens to end with a trailing newline would
  // silently reintroduce that same blank line regardless of what this
  // joins with.
  const combinedMarkdown = pad.scratchIds
    .map((id) => scratchById.get(id)?.markdown?.trim() ?? "")
    .filter((md) => md.length > 0)
    .join("\n");

  const availableToAdd = allScratches.filter((s) => !pad.scratchIds.includes(s.id));

  return (
    <div className={sprinkles({ display: "flex", gap: 5, flexWrap: "wrap" })} style={{ alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 480px", minWidth: 0 }}>
        <ColumnLabel>Rendered (static) — combined</ColumnLabel>
        <PreviewBox fullBleed markdown={combinedMarkdown} minHeight={480} previewScheme={previewScheme} />
      </div>
      <div style={{ flex: "0 1 340px", minWidth: 280 }}>
        <div className={sprinkles({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <ColumnLabel>Name</ColumnLabel>
          <div className={sprinkles({ display: "flex", alignItems: "center", gap: 3, mb: 2 })}>
            {isDirty && <ResetLink onClick={handleResetName} />}
            {isDirty && <SaveButton onClick={handleSaveName} isSaving={isSavingName} />}
          </div>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${textSize.base} ${sprinkles({ fontWeight: "bold", p: 2 })}`}
          style={{
            display: "block",
            width: "100%",
            background: semanticColors.surfaceInset,
            color: "inherit",
            border: `1px solid ${name !== pad.name ? semanticColors.textBrand : "transparent"}`,
            borderRadius: 6,
          }}
        />

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Scratches in this pad</ColumnLabel>
          {pad.scratchIds.length === 0 ? (
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              Empty — add an existing scratch below, or create a new one.
            </p>
          ) : (
            <Stack gap={2}>
              {pad.scratchIds.map((id, index) => (
                <PadMemberRow
                  key={id}
                  label={scratchById.get(id)?.name ?? id}
                  onFocus={() => onFocusScratch(id)}
                  onMoveUp={() => moveUp(index)}
                  onMoveDown={() => moveDown(index)}
                  canMoveUp={index > 0}
                  canMoveDown={index < pad.scratchIds.length - 1}
                />
              ))}
            </Stack>
          )}
        </div>

        <div className={sprinkles({ mt: 4 })}>
          <ColumnLabel>Add to this pad</ColumnLabel>
          <select
            value=""
            onChange={(e) => handleAddExisting(e.target.value)}
            disabled={availableToAdd.length === 0}
            className={`${textSize.sm} ${sprinkles({ p: 2 })}`}
            style={{
              display: "block",
              width: "100%",
              background: semanticColors.surfaceInset,
              color: "inherit",
              border: `1px solid ${semanticColors.surfaceBorder}`,
              borderRadius: 6,
            }}
          >
            <option value="" disabled>
              {availableToAdd.length === 0 ? "No other scratches to move here" : "Move an existing scratch here\u2026"}
            </option>
            {availableToAdd.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className={sprinkles({ mt: 2 })}>
            <button
              type="button"
              onClick={handleCreateScratch}
              disabled={isCreatingScratch}
              className={`${textSize.xs} ${sprinkles({ fontWeight: "bold", fontFamily: "mono", px: 2, py: 1 })}`}
              style={{
                border: `1px solid ${semanticColors.textBrand}`,
                borderRadius: 6,
                background: "none",
                cursor: isCreatingScratch ? "default" : "pointer",
                color: semanticColors.textBrand,
                opacity: isCreatingScratch ? 0.6 : 1,
              }}
            >
              {isCreatingScratch ? "\u2026" : "+ New scratch"}
            </button>
          </div>
        </div>

        <div className={sprinkles({ mt: 4 })}>
          <DangerButton label="Delete this pad" onClick={handleDelete} />
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

// Which Tracing Paper is focused by default on a totally bare visit (no
// URL param, no remembered localStorage state either) -- must be a real
// `TRACING_PAPERS` id.
const DEFAULT_FOCUS_ID = "section-title";

export default function StampsScratch() {
  const { overrides, pads } = useLoaderData<typeof loader>();

  // EVERY scratch is fully user-generated/DB-only -- unlike Tracing Papers
  // (fixed, code-defined, above), there's no "built-in" merge here at all;
  // `overrides` IS the complete list. See `websiteScratches.server.ts`.
  const resolvedEntries: Scratch[] = Object.keys(overrides).map((id) => ({ id, ...overrides[id] }));
  const scratchById = new Map(resolvedEntries.map((s) => [s.id, s]));

  // The URL is the source of truth for "what's focused" -- `?scratch=id`,
  // `?pad=id`, or `?paper=id`, plus `?view=list` -- NOT a separate
  // `useState`, so clicking around actually navigates (browser back/
  // forward moves through focus history) instead of just mutating local
  // state that the address bar knows nothing about. `setSearchParams`
  // (React Router) pushes a new history entry by default, same as a
  // normal link.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode: ViewMode = searchParams.get("view") === "list" ? "list" : "focus";
  const padParam = searchParams.get("pad");
  const scratchParam = searchParams.get("scratch");
  const paperParam = searchParams.get("paper");
  const toolParam = searchParams.get("tool");
  const focus: FocusTarget = padParam
    ? { kind: "pad", id: padParam }
    : scratchParam
      ? { kind: "scratch", id: scratchParam }
      : toolParam
        ? { kind: "tool", id: "svg-points" }
        : { kind: "paper", id: paperParam ?? DEFAULT_FOCUS_ID };

  // Independent of `viewMode` -- which scheme every "Rendered (static)"
  // preview box shows, regardless of the browser's own OS-level
  // `prefers-color-scheme`. Fixed at "light" by default (deterministic,
  // not environment-dependent) rather than trying to detect/mirror
  // whatever the browser already happens to be in. NOT persisted to the
  // URL/localStorage -- purely a today's-session preview toggle, unlike
  // `focus`/`viewMode` below.
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>("light");

  // Tracing Papers (List mode is ALWAYS the Tracing Papers list -- see
  // `viewMode`'s own type comment -- or Focus mode on one specifically)
  // always render `PreviewBoxPair` (both schemes at once, side by side)
  // instead of reading `previewScheme` -- the page-level Light/Dark
  // toggle has nothing to drive there anymore, so it's hidden rather than
  // left sitting around looking like it still does something.
  const isTracingPaperView = viewMode === "list" || focus.kind === "paper" || focus.kind === "tool";

  const focusedEntry = focus.kind === "scratch" ? (resolvedEntries.find((e) => e.id === focus.id) ?? resolvedEntries[0]) : undefined;
  const focusedPad = focus.kind === "pad" ? (pads.find((p) => p.id === focus.id) ?? pads[0]) : undefined;
  const focusedPaper = focus.kind === "paper" ? (TRACING_PAPERS.find((p) => p.id === focus.id) ?? TRACING_PAPERS[0]) : undefined;
  // Every scratch belongs to EXACTLY one pad, always (see `action`'s own
  // doc comment) -- used both by `FocusedEntryView` (its own "Delete"/"+
  // New scratch" need to know which pad to stay inside) and by the
  // breadcrumb below (a focused scratch's breadcrumb should point back at
  // ITS OWN pad, not the generic Stamps guide).
  const ownerPad = focusedEntry ? pads.find((p) => p.scratchIds.includes(focusedEntry.id)) : undefined;

  // A bare `/maker/stamps/scratch` visit (no `?scratch=`/`?pad=`/`?paper=`
  // at all) picks up wherever this browser last left off, client-side
  // only, once, right on mount -- see `readRememberedScratchpadState`'s
  // own doc comment. Deliberately checks the RAW url (`searchParams`, not
  // the already-defaulted `focus` above) for presence, and re-validates
  // the remembered id still exists (it may have been deleted since).
  useEffect(() => {
    if (searchParams.has("scratch") || searchParams.has("pad") || searchParams.has("paper") || searchParams.has("tool")) return;
    const remembered = readRememberedScratchpadState();
    if (!remembered) return;
    const stillExists =
      remembered.focus.kind === "pad"
        ? pads.some((p) => p.id === remembered.focus.id)
        : remembered.focus.kind === "paper"
          ? TRACING_PAPERS.some((p) => p.id === remembered.focus.id)
          : remembered.focus.kind === "tool"
            ? true
            : resolvedEntries.some((s) => s.id === remembered.focus.id);
    if (!stillExists) return;
    setSearchParams(buildFocusSearchParams(searchParams, remembered.focus, remembered.viewMode), { replace: true });
    // Mount-only, deliberately -- this is a ONE-TIME hydration step, not a
    // sync that should re-run whenever `searchParams`/`pads`/`resolvedEntries`
    // happen to change reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jumping to a specific scratch/Pad/Tracing Paper -- via the drawer, or
  // a List row's own "Focus" button -- always means "show me THIS one,
  // dominant," so both paths set the view along with the target rather
  // than leaving `viewMode` wherever it happened to be. Also remembers
  // this as the new "last focused" state for the next bare visit (see
  // above).
  function navigateFocus(target: FocusTarget, nextViewMode: ViewMode) {
    setSearchParams(buildFocusSearchParams(searchParams, target, nextViewMode));
    rememberScratchpadState({ focus: target, viewMode: nextViewMode });
  }
  function focusOnScratch(id: string) {
    navigateFocus({ kind: "scratch", id }, "focus");
  }
  function focusOnPad(id: string) {
    navigateFocus({ kind: "pad", id }, "focus");
  }
  function focusOnPaper(id: string) {
    navigateFocus({ kind: "paper", id }, "focus");
  }
  function focusOnTool() {
    navigateFocus({ kind: "tool", id: "svg-points" }, "focus");
  }
  function changeViewMode(nextViewMode: ViewMode) {
    navigateFocus(focus, nextViewMode);
  }

  // After deleting the currently-focused Scratch or Pad, there's nothing
  // left with that id to keep showing -- land back in List mode instead of
  // guessing which other one to jump to. Deliberately doesn't call
  // `rememberScratchpadState` -- the deleted id is no longer meaningful to
  // restore on a future bare visit. (Tracing Papers are never deletable,
  // so this callback is never wired to one.)
  function handleFocusedDeleted() {
    setSearchParams(buildFocusSearchParams(searchParams, focus, "list"));
  }

  // Switching the focused scratch/Pad/Paper (or back into Focus mode)
  // should land at the top of the content area -- `AppLayout`'s own
  // `<main>` scrolls independently (see `visual-check.ts`'s own note on
  // this same quirk), so plain `window.scrollTo` doesn't reach it. Depends
  // on the PRIMITIVE `focus.kind`/`focus.id`, NOT the `focus` object
  // itself -- it's a fresh object literal every render (derived from
  // `searchParams` above, not `useState`), so depending on its reference
  // would scroll on literally every render instead of only on an actual
  // focus change.
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [focus.kind, focus.id, viewMode]);

  return (
    <AppLayout>
      <DrawerContent
        drawer={
          <ScratchNav
            pads={pads}
            scratchById={scratchById}
            papers={TRACING_PAPERS}
            focus={focus}
            onFocusScratch={focusOnScratch}
            onFocusPad={focusOnPad}
            onFocusPaper={focusOnPaper}
            onFocusTool={focusOnTool}
          />
        }
        title="Scratches"
      >
        <CenterContent maxWidth={viewMode === "focus" ? 1400 : 1100}>
          <div className={sprinkles({ mb: 6 })}>
            {focus.kind === "scratch" && ownerPad ? (
              // A Scratch always belongs to exactly one Pad -- send its
              // breadcrumb back to THAT pad (the thing you'd actually
              // navigated in from), not the generic Stamps guide. A button,
              // not a `Link`, since this stays on the very same route (just
              // a different `?pad=` focus) -- same convention every other
              // in-page focus change here already uses (`navigateFocus`/
              // `focusOnPad`), not a real route navigation.
              <button
                type="button"
                onClick={() => focusOnPad(ownerPad.id)}
                className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
                style={{
                  color: semanticColors.textSubtle,
                  textDecoration: "none",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                ← {ownerPad.name}
              </button>
            ) : (
              <Link
                to="/maker/stamps"
                className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
                style={{ color: semanticColors.textSubtle, textDecoration: "none" }}
              >
                ← Stamps
              </Link>
            )}
            <div
              className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 3, mt: 2, mb: 2 })}
            >
              <h1
                className={`${textSize.xl} ${sprinkles({ fontWeight: "bold" })}`}
                style={{ color: semanticColors.textPrimary }}
              >
                {viewMode !== "focus"
                  ? "Tracing Papers"
                  : focus.kind === "pad"
                    ? (focusedPad?.name ?? "Pad")
                    : focus.kind === "paper"
                      ? (focusedPaper?.name ?? "Tracing Paper")
                      : focus.kind === "tool"
                        ? "SVG \u2192 Points"
                        : (focusedEntry?.name ?? "Scratch")}
              </h1>
              <div className={sprinkles({ display: "flex", gap: 2 })}>
                {!isTracingPaperView && (
                  <SegmentedToggle value={previewScheme} onChange={setPreviewScheme} options={PREVIEW_SCHEME_OPTIONS} />
                )}
                <SegmentedToggle value={viewMode} onChange={changeViewMode} options={VIEW_MODE_OPTIONS} />
              </div>
            </div>
            {viewMode === "list" && (
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: 640, lineHeight: 1.5 }}>
                One row per website directive's own Tracing Paper (see{" "}
                <code>oxmarkdown/websiteDirectives.tsx</code>) — a fixed,
                read-only example of what it can do. These can't be edited
                directly here; open one in <code>Focus</code> to play with
                its own attribute controls instead, then "Use as new
                Scratch" to turn it into your own editable creation.
              </p>
            )}
          </div>

          {viewMode === "focus" && focus.kind === "pad" && focusedPad ? (
            <FocusedPadView
              key={focusedPad.id}
              pad={focusedPad}
              allScratches={resolvedEntries}
              scratchById={scratchById}
              onFocusScratch={focusOnScratch}
              onDeleted={handleFocusedDeleted}
              previewScheme={previewScheme}
            />
          ) : viewMode === "focus" && focus.kind === "paper" && focusedPaper ? (
            <FocusedTracingPaperView
              key={focusedPaper.id}
              paper={focusedPaper}
              pads={pads}
              onFocusScratch={focusOnScratch}
            />
          ) : viewMode === "focus" && focus.kind === "tool" ? (
            <SvgToPointsTool />
          ) : viewMode === "focus" && focusedEntry ? (
            <FocusedEntryView
              key={focusedEntry.id}
              scratch={focusedEntry}
              ownerPadId={ownerPad?.id}
              onFocusScratch={focusOnScratch}
              onDeleted={handleFocusedDeleted}
              previewScheme={previewScheme}
            />
          ) : (
            <Stack gap={8}>
              <div>
                <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", mb: 2 })}`} style={{ color: semanticColors.textPrimary }}>
                  SVG → Points
                </h2>
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: 640, lineHeight: 1.5, marginBottom: 12 }}>
                  Paste real SVG geometry (a <code>{"<path>"}</code>, <code>{"<polyline>"}</code>/
                  <code>{"<polygon>"}</code>, or a bare point list) and trace it straight into either
                  a <code>::line{"{...}"}</code> or a <code>::path{"{...}"}</code> -- anchored to a
                  position + offset instead of hand-computed deltas.
                </p>
                <SvgToPointsTool />
              </div>
              <Stack gap={4}>
                {TRACING_PAPERS.map((paper) => (
                  <TracingPaperRow key={paper.id} paper={paper} onFocus={() => focusOnPaper(paper.id)} />
                ))}
              </Stack>
            </Stack>
          )}
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
