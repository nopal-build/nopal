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
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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
  const user = await requireMakerAccess(request);
  const overrides = await getWebsiteScratchOverrides();
  const pads = await getWebsiteScratchPads();
  return { user, overrides, pads };
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
  /** Sections/pricing-cards render their own full-bleed background and
   * padding — let that reach the preview box's own edge instead of
   * double-padding it. Everything else gets the box's normal padding. */
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
    directive: ':::section{bg="..." accent="..."}',
    note: "Container. `bg` picks a full-bleed background class (`cream`/`peach`/`mint`/`lavender`, each aliasing an existing palette token — see `website.css`); `accent` optionally recolors headings inside it (`red`/`green`/`purple`) via a `data-website-accent` attribute. Body renders through the ordinary OxRenderer pipeline — nothing section-specific about the heading/paragraph/list styling itself.",
    fullBleed: true,
    attributes: [
      {
        key: "bg",
        label: "bg",
        kind: "select",
        default: "mint",
        options: [{ value: "cream" }, { value: "peach" }, { value: "mint" }, { value: "lavender" }],
      },
      { key: "accent", label: "accent", kind: "select", default: "green", options: ACCENT_COLOR_OPTIONS },
    ],
    buildMarkdown: (v) => `:::section{bg="${v.bg}"${v.accent ? ` accent="${v.accent}"` : ""}}
## At a Cost

- We favored synthetic materials for their higher performance metrics.
- The risks increased and the improvements diminished.
:::`,
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
    directive: '::icon{name="..." size="sm|md|lg" id="..."}',
    note: 'Leaf. Checks real file-based assets first (**Files**, below), then a small set of inline-drawn placeholder shapes (**Placeholders**), then falls back to a labeled dashed circle for any other name — see `websiteIcons.tsx`. Meant for small inline glyphs or standalone floating shapes, distinct from `::stamp`\'s full postage-stamp graphics.\n\n**Adding a new icon:** drop a new SVG under `public/guides/`, then add one `{name: path}` entry to `WEBSITE_ICON_FILES` in `websiteIcons.tsx` (both the `webapp` and `fruits` copies — see its own header comment) — it appears in the `name` dropdown above automatically, nothing else needs to change.',
    attributes: [
      { key: "name", label: "name", kind: "select", default: "sun-home", options: ICON_NAME_OPTIONS },
      {
        key: "size",
        label: "size",
        kind: "select",
        default: "lg",
        options: [{ value: "sm" }, { value: "md" }, { value: "lg" }],
      },
    ],
    buildMarkdown: (v) => `::icon{name="${v.name}" size="${v.size}"}`,
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
    note: "Leaf, invisible on purpose — a zero-size anchor (`data-waypoint-id`) for the not-yet-built wavy connector overlay to measure. Nothing to see here today (that's the point); included so the directive's own markup is visible in the DOM. Needs its own line, same as any leaf directive — embedded mid-sentence it doesn't parse as a directive at all, just literal text.",
    attributes: [{ key: "id", label: "id", kind: "text", default: "p1" }],
    buildMarkdown: (v) => `Some text before.\n\n::waypoint{id="${v.id}"}\n\nAnd after.`,
  },
  {
    id: "line",
    name: "Line",
    directive: '::line{points="x,y x,y ..." curve="smooth|straight|bezier" tension="0-1" color="red|green|purple"}',
    note: 'Leaf. The shared wavy-line primitive (`WavyLine.tsx` + `oxmarkdown-core`\'s `buildSplinePath`) in its fixed-points mode. "A line is drawn from one end to the other": a cursor starts at the box\'s own top-left corner (normalized to a `0-100` (x) / `0-40` (y) box) and walks forward, per-axis, per point. Each half of a pair is either a plain number (a DELTA -- moves the cursor by that amount, cumulative) or a reference letter plus optional offset (an ANCHOR, pixel-referenceable to the box\'s own geometry instead of the previous point): `L`/`C`/`R` for x, `T`/`C`/`B` for y (same CSS-inset convention as `top`/`right`/`bottom`/`left` -- `T`/`L` add away from that edge, `B`/`R` subtract inward from it, `C` adds past center). Anchors and deltas mix freely, per axis, at any point. Sized to exactly fit the resulting path\'s own bounding box, recomputed to real pixels on every real resize (`ResizeObserver`, not a passive `preserveAspectRatio` stretch). `color` sets the stroke directly; omit it and the line inherits `currentColor` instead. Needs a positioned ancestor with real height to draw into -- this row\'s own preview box supplies that; `:::section-title{...}` supplies it for the paper below.',
    previewMinHeight: 100,
    attributes: [
      { key: "points", label: "points", kind: "text", default: "L0,B1 C5,B4 R0,B0", placeholder: "x,y x,y ..." },
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
      `::line{points="${v.points}" curve="${v.curve}" tension="${v.tension}"${v.color ? ` color="${v.color}"` : ""}}`,
  },
  {
    id: "section-title",
    name: "Section title",
    directive: ':::section-title{icon="..." color="red|green|purple"}',
    note: "Container. An icon + a real heading + (usually) a `::line{...}` composed as one titled-header unit -- see `website.css`'s `.website-section-title`. The heading stays real markdown inside it, so an unaware renderer just shows a plain heading, no visible artifact. `color` recolors JUST the heading text (same named-color vocabulary as `:::section`'s `accent`) -- it does NOT also recolor a nested `::line{...}` (try changing `color` here and watch the line stay green regardless), which needs its own, independent `color` attribute since it has to work standalone too.",
    fullBleed: true,
    attributes: [
      { key: "icon", label: "icon", kind: "select", default: "mountaineer-coffee", options: ICON_NAME_OPTIONS },
      { key: "color", label: "color", kind: "select", default: "green", options: ACCENT_COLOR_OPTIONS },
      { key: "heading", label: "heading text", kind: "text", default: "At a Cost" },
    ],
    buildMarkdown: (v) => `:::section-title{icon="${v.icon}"${v.color ? ` color="${v.color}"` : ""}}
::line{points="L1,B0 R16,B4 R0,B0" curve="smooth" tension="0.4" color="green"}
## ${v.heading}
:::`,
  },
  {
    id: "pricing-card",
    name: "Pricing card",
    directive: ':::pricing-card{name="..." price="..." cta="..." cta-href="..."}',
    note: "Container. Header row (name + price) + body (ordinary children, typically a bullet list) + an optional CTA rendered through the same `.website-button` style as a standalone `::button`.",
    attributes: [
      { key: "name", label: "name", kind: "text", default: "Light-Guide" },
      { key: "price", label: "price", kind: "text", default: "$1,499/mo" },
      { key: "cta", label: "cta", kind: "text", default: "Meet with a Guide" },
    ],
    buildMarkdown: (v) => `:::pricing-card{name="${v.name}" price="${v.price}" cta="${v.cta}" cta-href="#"}
- Everything in Self-Guide and...
- Three 90 minute meetings
- One report
:::`,
  },
  {
    id: "button",
    name: "Button",
    directive: '::button{text="..." href="..."}',
    note: "Leaf. A standalone CTA pill link — same visual class the pricing card's own cta uses.",
    attributes: [
      { key: "text", label: "text", kind: "text", default: "Meet with a Guide" },
      { key: "href", label: "href", kind: "text", default: "#" },
    ],
    buildMarkdown: (v) => `::button{text="${v.text}" href="${v.href}"}`,
  },
  {
    id: "badge",
    name: "Badge",
    directive: '::badge{text="..." variant="neutral|success|warning|danger"}',
    note: 'Leaf. Renders `stamps/Badge` directly — the same component the "Draft" preview banner already uses — rather than a bespoke pill style.',
    attributes: [
      { key: "text", label: "text", kind: "text", default: "Coming Soon" },
      {
        key: "variant",
        label: "variant",
        kind: "select",
        default: "danger",
        options: [{ value: "neutral" }, { value: "success" }, { value: "warning" }, { value: "danger" }],
      },
    ],
    buildMarkdown: (v) => `::badge{text="${v.text}" variant="${v.variant}"}`,
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
    directive: ':::toggle{collapsed="true"} (not new — the existing built-in, reused for FAQ)',
    note: "Not a website-specific directive — the pre-existing Notion-style Toggle List, reused as-is for the Guides page's FAQ. Included here since it's part of the same content vocabulary these pages compose with.",
    attributes: [
      {
        key: "collapsed",
        label: "collapsed",
        kind: "select",
        default: "",
        options: [{ value: "", label: "(expanded)" }, { value: "true", label: "true" }],
      },
      { key: "question", label: "question", kind: "text", default: "Can I change between plans?" },
      { key: "answer", label: "answer", kind: "text", default: "Yes, at the end of each contract." },
    ],
    buildMarkdown: (v) => `:::${v.collapsed === "true" ? `toggle{collapsed="true"}` : "toggle"}
${v.question}

${v.answer}
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
 * combined preview + ordering/membership editor), or a Tracing Paper
 * (`FocusedTracingPaperView`, fixed + attribute-driven, never editable). */
type FocusTarget = { kind: "scratch"; id: string } | { kind: "pad"; id: string } | { kind: "paper"; id: string };

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
      (focus.kind !== "scratch" && focus.kind !== "pad" && focus.kind !== "paper") ||
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
 * `pad`/`paper` are mutually exclusive (whichever's relevant is set, the
 * other two removed), `view` is omitted entirely in the (default) "focus"
 * mode rather than written as `view=focus`, so the common case keeps a
 * clean URL like `?scratch=my-scratch` or `?paper=icon`. */
function buildFocusSearchParams(
  current: URLSearchParams,
  focus: FocusTarget,
  viewMode: "focus" | "list",
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("scratch");
  next.delete("pad");
  next.delete("paper");
  if (focus.kind === "pad") next.set("pad", focus.id);
  else if (focus.kind === "paper") next.set("paper", focus.id);
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
}: {
  pads: ResolvedPad[];
  scratchById: Map<string, Scratch>;
  papers: TracingPaper[];
  focus: FocusTarget;
  onFocusScratch: (id: string) => void;
  onFocusPad: (id: string) => void;
  onFocusPaper: (id: string) => void;
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
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
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
      <OxRenderer markdown={markdown} directives={registry} className="ox-no-dots" />
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
  previewScheme,
}: {
  paper: TracingPaper;
  /** Every existing Pad -- "Use as new Scratch" needs one to create the
   * new scratch INSIDE (every scratch must belong to exactly one pad; see
   * `action`'s own doc comment), offered here as a picker rather than
   * auto-creating one, so a paper's own examples don't each spawn their
   * own throwaway pad by default. */
  pads: ResolvedPad[];
  onFocusScratch: (id: string) => void;
  previewScheme: "light" | "dark";
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
      <div style={{ flex: "1 1 480px", minWidth: 0 }}>
        <ColumnLabel>Rendered (static)</ColumnLabel>
        <PreviewBox fullBleed={paper.fullBleed} markdown={markdown} minHeight={Math.max(paper.previewMinHeight ?? 0, 480)} previewScheme={previewScheme} />
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
  previewScheme,
}: {
  paper: TracingPaper;
  onFocus: () => void;
  previewScheme: "light" | "dark";
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
          <PreviewBox fullBleed={paper.fullBleed} markdown={markdown} minHeight={paper.previewMinHeight ?? 120} previewScheme={previewScheme} />
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

  // Every member's CURRENT markdown, in order, joined the same way
  // multiple directives sit one after another on a real page (a blank line
  // between each).
  const combinedMarkdown = pad.scratchIds
    .map((id) => scratchById.get(id)?.markdown ?? "")
    .filter((md) => md.trim().length > 0)
    .join("\n\n");

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
  const focus: FocusTarget = padParam
    ? { kind: "pad", id: padParam }
    : scratchParam
      ? { kind: "scratch", id: scratchParam }
      : { kind: "paper", id: paperParam ?? DEFAULT_FOCUS_ID };

  // Independent of `viewMode` -- which scheme every "Rendered (static)"
  // preview box shows, regardless of the browser's own OS-level
  // `prefers-color-scheme`. Fixed at "light" by default (deterministic,
  // not environment-dependent) rather than trying to detect/mirror
  // whatever the browser already happens to be in. NOT persisted to the
  // URL/localStorage -- purely a today's-session preview toggle, unlike
  // `focus`/`viewMode` below.
  const [previewScheme, setPreviewScheme] = useState<PreviewScheme>("light");

  const focusedEntry = focus.kind === "scratch" ? (resolvedEntries.find((e) => e.id === focus.id) ?? resolvedEntries[0]) : undefined;
  const focusedPad = focus.kind === "pad" ? (pads.find((p) => p.id === focus.id) ?? pads[0]) : undefined;
  const focusedPaper = focus.kind === "paper" ? (TRACING_PAPERS.find((p) => p.id === focus.id) ?? TRACING_PAPERS[0]) : undefined;

  // A bare `/maker/stamps/scratch` visit (no `?scratch=`/`?pad=`/`?paper=`
  // at all) picks up wherever this browser last left off, client-side
  // only, once, right on mount -- see `readRememberedScratchpadState`'s
  // own doc comment. Deliberately checks the RAW url (`searchParams`, not
  // the already-defaulted `focus` above) for presence, and re-validates
  // the remembered id still exists (it may have been deleted since).
  useEffect(() => {
    if (searchParams.has("scratch") || searchParams.has("pad") || searchParams.has("paper")) return;
    const remembered = readRememberedScratchpadState();
    if (!remembered) return;
    const stillExists =
      remembered.focus.kind === "pad"
        ? pads.some((p) => p.id === remembered.focus.id)
        : remembered.focus.kind === "paper"
          ? TRACING_PAPERS.some((p) => p.id === remembered.focus.id)
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
          />
        }
        title="Scratches"
      >
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
                {viewMode !== "focus"
                  ? "Tracing Papers"
                  : focus.kind === "pad"
                    ? (focusedPad?.name ?? "Pad")
                    : focus.kind === "paper"
                      ? (focusedPaper?.name ?? "Tracing Paper")
                      : (focusedEntry?.name ?? "Scratch")}
              </h1>
              <div className={sprinkles({ display: "flex", gap: 2 })}>
                <SegmentedToggle value={previewScheme} onChange={setPreviewScheme} options={PREVIEW_SCHEME_OPTIONS} />
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
              previewScheme={previewScheme}
            />
          ) : viewMode === "focus" && focusedEntry ? (
            <FocusedEntryView
              key={focusedEntry.id}
              scratch={focusedEntry}
              ownerPadId={pads.find((p) => p.scratchIds.includes(focusedEntry.id))?.id}
              onFocusScratch={focusOnScratch}
              onDeleted={handleFocusedDeleted}
              previewScheme={previewScheme}
            />
          ) : (
            <Stack gap={4}>
              {TRACING_PAPERS.map((paper) => (
                <TracingPaperRow key={paper.id} paper={paper} onFocus={() => focusOnPaper(paper.id)} previewScheme={previewScheme} />
              ))}
            </Stack>
          )}
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
