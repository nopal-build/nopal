/**
 * Billing's rules with no I/O (payments seed, Austin 2026-10-06), kept
 * apart from `billing.server.ts` so a test can check each one without
 * Stripe or the database.
 *
 * Prices are not here. Every amount on the menu lives in Stripe as a
 * Price found by its lookup key (`fruits/scripts/stripe-setup.ts` makes
 * them), so changing a price is a Stripe edit, not a deploy. What lives
 * here is which lookup keys exist and the durations the seed decided.
 */

/** A recurring debit's timing can't move with less notice than this
 * (ACH rule). A plan change asked inside it waits a period longer. */
export const ACH_NOTICE_DAYS = 7;
/** Paused this long, O.No asks the client how it's going. */
export const PAUSE_WARN_MONTHS = 5;
/** Paused this long with no resume request, the guide is told. */
export const PAUSE_ALERT_MONTHS = 6;
/** A custom one-time amount above this is a typo until someone says
 * otherwise; the guide's form refuses it. */
export const CUSTOM_AMOUNT_MAX_CENTS = 50_000_00;

export const MENU_PLANS = ["light_guide", "guide", "deep_guide"] as const;
export type MenuPlan = (typeof MENU_PLANS)[number];
export const MENU_PLAN_LABELS: Record<MenuPlan, string> = {
  light_guide: "Light Guide",
  guide: "Guide",
  deep_guide: "Deep Guide",
};

/** One-time charges a guide can raise. `custom` has no Price: the guide
 * types the amount (Sue's report, 2026-11-02). */
export const ONE_TIME_KINDS = ["one_hour", "one_hour_deliverable", "deliverable_upgrade", "custom"] as const;
export type OneTimeKind = (typeof ONE_TIME_KINDS)[number];
export const ONE_TIME_LABELS: Record<OneTimeKind, string> = {
  one_hour: "One-hour decision",
  one_hour_deliverable: "One-hour decision with a deliverable",
  deliverable_upgrade: "Deliverable upgrade",
  custom: "Custom amount",
};

/** The Stripe Price lookup key for a menu plan or a priced one-time
 * kind. Custom has none. */
export function lookupKeyFor(item: MenuPlan | Exclude<OneTimeKind, "custom">): string {
  return `nopal_${item}`;
}

export function isMenuPlan(value: unknown): value is MenuPlan {
  return typeof value === "string" && (MENU_PLANS as readonly string[]).includes(value);
}

export function isOneTimeKind(value: unknown): value is OneTimeKind {
  return typeof value === "string" && (ONE_TIME_KINDS as readonly string[]).includes(value);
}

/** "$1,000", "1000", "1000.50" → cents. Null for anything that isn't a
 * positive amount under the cap. */
export function parseUsdToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > CUSTOM_AMOUNT_MAX_CENTS) return null;
  return cents;
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `date` plus `months` calendar months, clamped to the month's last day
 * the way Stripe anchors a monthly bill (Jan 31 → Feb 28/29). UTC. */
export function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}

/** When a plan change asked at `now` takes effect: the next billing date
 * (`periodEnd`), or the one after if that is inside the ACH notice. */
export function planChangeEffectiveAt(periodEnd: Date, now: Date): Date {
  return periodEnd.getTime() - now.getTime() >= ACH_NOTICE_DAYS * DAY_MS
    ? periodEnd
    : addMonthsClamped(periodEnd, 1);
}

/** The first billing day: the start date the guide set, if it is still
 * ahead, else the day the client finished the form. */
export function firstBillingDay(completedAt: Date, guideStart?: Date | null): Date {
  return guideStart && guideStart.getTime() > completedAt.getTime() ? guideStart : completedAt;
}

export type PauseMilestone = "none" | "warn" | "alert";

/** Where a pause that began at `pausedAt` stands at `now`. */
export function pauseMilestone(pausedAt: Date, now: Date): PauseMilestone {
  if (now.getTime() >= addMonthsClamped(pausedAt, PAUSE_ALERT_MONTHS).getTime()) return "alert";
  if (now.getTime() >= addMonthsClamped(pausedAt, PAUSE_WARN_MONTHS).getTime()) return "warn";
  return "none";
}
