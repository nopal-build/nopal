// app/components/prototype-onboarding/shared.tsx
//
// Shared data + small helpers for the client-facing onboarding funnel
// prototype (garden/1-seeds/project-map.md's "Next step" — a build-
// capable pass at a real 1:1 UI, not an annotated mockup). Six routes
// share this file: prototype.guides -> prototype.schedule ->
// prototype.details -> prototype.project-setup ->
// prototype.project-setup.hold -> prototype.seed. No backend; state
// threads between routes entirely through URL search params (see each
// route's own top comment).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { link } from "stamps/link.css";
import type { StepperStep } from "stamps/Stepper";
import "./prototypeOnboarding.css";

/** Stand-in for the real `/guides` plans — that page is Vault/OxMarkdown
 * content (`projects/nopal-web/guides.md`), not a React component, so
 * there's nothing to import; this just echoes its real copy closely
 * enough to start the funnel from something recognizable. Light-Guide/
 * Just-a-Guide/Deep-Guide's bullets below are illustrative placeholders
 * (only Self-Guide's were confirmed verbatim via
 * `garden/4-harvested/box-directive-pricing-card.md`) — fine for a
 * click-through prototype, not meant to ship as real marketing copy. */
export const PLANS = [
  {
    slug: "self-guide",
    name: "Self-Guide",
    price: "$99/mo",
    bullets: ["Unlimited Logging", "Good Building System access", "Ad-hoc meetings are $350/hr"],
    comingSoon: true,
  },
  {
    slug: "light-guide",
    name: "Light-Guide",
    price: "$1,499/mo",
    bullets: ["Everything in Self-Guide", "Monthly Guide check-ins", "Priority email support"],
  },
  {
    slug: "just-a-guide",
    name: "Just-a-Guide",
    price: "$3,000/mo",
    bullets: ["Everything in Light-Guide", "A dedicated Guide", "Weekly working sessions"],
  },
  {
    slug: "deep-guide",
    name: "Deep-Guide",
    price: "$6,000/mo",
    bullets: ["Everything in Just-a-Guide", "On-site visits", "Full project management"],
  },
] as const;

export type PlanSlug = (typeof PLANS)[number]["slug"];

export function planBySlug(slug: string | null): (typeof PLANS)[number] | undefined {
  return PLANS.find((p) => p.slug === slug);
}

/** The hold page's loader phases — Gerald, 2026-10-28 (new-session
 * follow-up): "In the future I expect these to change," so this is a
 * single easily-edited array, not strings scattered through the
 * component. */
export const PROJECT_SETUP_PHASES = ["Creating Project", "Notifying Guides", "Finalizing Project"];

const NAME_ADJECTIVES = [
  "Quiet", "Golden", "Steep", "Open", "High", "Long", "Granite", "Evergreen",
  "Switchback", "Alpine", "Early", "Clear",
];
const NAME_NOUNS = [
  "Ridge", "Trailhead", "Overlook", "Summit", "Switchback", "Pass", "Ravine",
  "Crest", "Divide", "Basecamp", "Hollow", "Bluff",
];

/** Placeholder name generator — Gerald flagged "naming is hard... needs
 * ideation" (2026-10-28 follow-up), this is a first rough pass to make
 * the button clickable, NOT a settled design. Picks an adjective + a
 * trail/peak noun (matches Nopal's existing Basecamp/Camps/Guides/Summit
 * language); personalizes with the person's first name when given. */
export function generateProjectName(firstName?: string): string {
  const adjective = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  const base = `${adjective} ${noun}`;
  return firstName ? `${firstName}'s ${base}` : base;
}

/** Next N weekdays (skips Sat/Sun), starting tomorrow — a throwaway
 * stand-in for real Guide availability. Default of 10 deliberately
 * spans a month boundary most of the time, so the calendar's prev/next
 * navigation actually has something to do. */
export function availableDates(count = 10): Date[] {
  const days: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) days.push(new Date(d));
  }
  return days;
}

export const TIME_SLOTS = ["9:00 AM", "11:00 AM", "1:00 PM", "3:00 PM"];

// Date-comparison/month-arithmetic helpers now live on `stamps/
// MiniCalendar` (`isSameDay`, `startOfMonth`, `addMonths`) — re-exported
// from nowhere on purpose; import them from there directly so there's
// one copy, not two drifting apart.

export function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Fuller heading for the planner list's per-day section, e.g.
 * "Monday, November 3". */
export function formatDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Carries every funnel field forward as query params — only the ones
 * that are actually set. Centralized so each route doesn't hand-roll
 * its own subset and accidentally drop a field the next page needs. */
export function funnelQuery(fields: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** The one `AuthShell` `maxWidth` every page that shows the `Stepper`
 * (schedule/details/project-setup) must use — Gerald, 2026-11-02: "never
 * want it jumping around." The `Stepper` centers itself WITHIN its
 * parent's width, so if that width differs page to page, the centered
 * strip still lands at a different spot on screen even though each
 * page looks centered in isolation. One shared width fixes that; it's
 * also wide enough for the schedule page's planner+calendar box. */
export const FUNNEL_MAX_WIDTH = "640px";

/** Passed straight to `stamps/Stepper`'s `steps` prop by every funnel
 * page after `/guides` — one source of truth for the 5 steps, not one
 * array per page. */
export const FUNNEL_STEPS: StepperStep[] = [
  { key: "schedule", label: "Schedule" },
  { key: "details", label: "Your info" },
  { key: "project-setup", label: "Name it" },
  { key: "hold", label: "Setting up" },
  { key: "seed", label: "Your project" },
];

export function ProtoNote({ children }: { children: ReactNode }) {
  return (
    <p className={`${textSize.sm} ${sprinkles({ mt: 2 })}`} style={{ color: semanticColors.textSubtle }}>
      {children}
    </p>
  );
}

/** Thin wrapper over stamps' own `link` recipe (same one `/verify` and
 * `/login` use for their own back-links) — just prefixes the arrow glyph
 * consistently, so callers don't repeat it. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={`${textSize.sm} ${link}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {"\u2190"} {children}
    </Link>
  );
}
