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

/** One-time charges a guide can raise. `custom` and `reimbursement` have
 * no Price: the guide types the amount (Sue's report, 2026-11-02; costs
 * Nopal fronted, billed at exactly what Nopal paid). */
export const ONE_TIME_KINDS = ["one_hour", "one_hour_deliverable", "deliverable_upgrade", "custom", "reimbursement"] as const;
export type OneTimeKind = (typeof ONE_TIME_KINDS)[number];
export const ONE_TIME_LABELS: Record<OneTimeKind, string> = {
  one_hour: "One-hour decision",
  one_hour_deliverable: "One-hour decision with a letter",
  deliverable_upgrade: "Letter upgrade",
  custom: "Other service",
  reimbursement: "Reimbursed expenses",
};

/** The kinds whose amount the guide types; every other kind's amount is
 * its Stripe Price. */
export type TypedAmountKind = "custom" | "reimbursement";
export type PricedKind = Exclude<OneTimeKind, TypedAmountKind>;
export function hasTypedAmount(kind: OneTimeKind): kind is TypedAmountKind {
  return kind === "custom" || kind === "reimbursement";
}

/** Which standard terms a payment carries (Austin, 2026-11-03): a guide
 * plan, a one-off service, or costs passed through at cost. */
export const PAYMENT_CATEGORIES = ["subscription", "service", "reimbursement"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];
export function categoryFor(kind: OneTimeKind): Exclude<PaymentCategory, "subscription"> {
  return kind === "reimbursement" ? "reimbursement" : "service";
}

/** The Stripe Price lookup key for a menu plan or a priced one-time
 * kind. Typed-amount kinds have none. */
export function lookupKeyFor(item: MenuPlan | PricedKind): string {
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

/** A guide's discount on a priced item or a plan (Austin, 2026-11-03):
 * the price stays fixed, the guide may take a whole percent off it. Blank
 * is no discount; null for anything else, including 100 (a free bill
 * isn't a payment). */
export const DISCOUNT_MAX_PERCENT = 99;
export function parseDiscountPercent(input: string | null | undefined): number | null | "invalid" {
  const cleaned = (input ?? "").trim().replace(/%$/, "").trim();
  if (cleaned === "" || cleaned === "0") return null;
  if (!/^\d{1,2}$/.test(cleaned)) return "invalid";
  const pct = Number(cleaned);
  return pct >= 1 && pct <= DISCOUNT_MAX_PERCENT ? pct : "invalid";
}

/** A price with a discount taken off, to the cent, the way Stripe rounds
 * a percent-off coupon. */
export function discounted(cents: number, percent: number | null | undefined): number {
  return percent ? Math.round((cents * (100 - percent)) / 100) : cents;
}

/** "20% off $250" for a discounted bill, else null. */
export function discountNote(listCents: number | null | undefined, percent: number | null | undefined): string | null {
  return percent && listCents ? `${percent}% off ${formatUsd(listCents)}` : null;
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

/** A plan's first billing day is the guide's, always (Austin,
 * 2026-11-03): a client who links their bank late doesn't move it, and is
 * billed from that day. The guide can't set a day already gone, so the
 * only backdating is the client's own delay. Days compare in Mountain
 * time, where Nopal works. */
export function dayIn(date: Date, timeZone = "America/Denver"): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

export function isSettableFirstBillingDay(day: string, now: Date): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= dayIn(now);
}

/** The first billing day as a time: noon UTC on that day, early morning
 * in Mountain time, so it never lands on the day before. */
export function firstBillingTime(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** A one-off bill is due this long after it's sent (the terms, Austin
 * 2026-11-03). */
export const PAYMENT_DUE_DAYS = 30;
/** Past due this long, the project's work goes on hold (the terms: "Guide
 * may suspend services on accounts over 10 days past due"). A plan is due
 * on its billing day, a failed debit on the day it failed, a bill
 * `PAYMENT_DUE_DAYS` after it's sent. On hold, the Client sees only what
 * to pay; a late bank link's catch-up debit covers every month since the
 * billing day (probed: 65 days late bills three months at once). */
export const SUSPEND_AFTER_DAYS = 10;
export function holdStartsAt(dueIso: string): Date {
  return new Date(new Date(dueIso).getTime() + SUSPEND_AFTER_DAYS * DAY_MS);
}
export function billDueAt(sentIso: string): Date {
  return new Date(new Date(sentIso).getTime() + PAYMENT_DUE_DAYS * DAY_MS);
}

/** A plan's cancel needs this much notice (the terms: "Either party may
 * terminate with 30 days' written notice"); pressing Cancel is the notice. */
export const CANCEL_NOTICE_DAYS = 30;
/** When a cancel asked at `now` ends a plan: the first billing date at
 * least the notice away, so the client may pay one more month. */
export function cancelEffectiveAt(periodEnd: Date, now: Date): Date {
  let end = periodEnd;
  while (end.getTime() - now.getTime() < CANCEL_NOTICE_DAYS * DAY_MS) end = addMonthsClamped(end, 1);
  return end;
}

export type PauseMilestone = "none" | "warn" | "alert";

/** Where a pause that began at `pausedAt` stands at `now`. */
export function pauseMilestone(pausedAt: Date, now: Date): PauseMilestone {
  if (now.getTime() >= addMonthsClamped(pausedAt, PAUSE_ALERT_MONTHS).getTime()) return "alert";
  if (now.getTime() >= addMonthsClamped(pausedAt, PAUSE_WARN_MONTHS).getTime()) return "warn";
  return "none";
}
