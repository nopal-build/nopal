/**
 * The guide's Payments page as a ledger (Austin, 2026-11-03): what needs
 * the guide, what's coming in the next 60 days, and what came in, newest
 * first. A project with no payments doesn't show.
 *
 * `buildLedger` is pure so a test can check what lands where; `loadLedger`
 * reads the rows and Stripe's plan debits to feed it.
 */
import type { BillingCharge } from "robustness-core/data/billing.server";
import { isOnHold, listPlanInvoices, type BillingPlan, type PlanInvoice } from "robustness-core/data/billingPlans.server";
import { MENU_PLANS, MENU_PLAN_LABELS, addMonthsClamped, discountNote, type MenuPlan } from "robustness-core/data/billingRules";
import { priceFor } from "robustness-core/data/stripe.server";
import { getHumansById } from "robustness-core/data/humans.server";
import { displayName } from "robustness-core/data/humanNames";

export const UPCOMING_DAYS = 60;
export const RECENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LedgerState = "hold" | "failed" | "resume" | "level" | "waiting" | "due" | "awaiting_bank" | "paid" | "clearing";

export type LedgerRow = {
  key: string;
  at: string;
  projectId: string;
  project: string;
  what: string;
  who: string | null;
  amountCents: number | null;
  note: string | null;
  state: LedgerState;
};

export type Ledger = { needsYou: LedgerRow[]; upcoming: LedgerRow[]; recent: LedgerRow[] };

export function buildLedger(input: {
  projects: { id: string; name: string }[];
  charges: BillingCharge[];
  plans: BillingPlan[];
  invoices: Map<string, PlanInvoice[]>;
  prices: Map<MenuPlan, number>;
  names: Map<string, string>;
  now: Date;
}): Ledger {
  const { now, names } = input;
  const project = new Map(input.projects.map((p) => [p.id, p.name]));
  const who = (id: string | null | undefined) => (id ? (names.get(id) ?? "someone no longer on the project") : null);
  const horizon = now.getTime() + UPCOMING_DAYS * DAY_MS;
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const needsYou: LedgerRow[] = [];
  const upcoming: LedgerRow[] = [];
  const recent: LedgerRow[] = [];

  for (const c of input.charges) {
    const name = project.get(c.project_folder_id);
    if (!name || c.status === "canceled") continue;
    const base = { projectId: c.project_folder_id, project: name, what: c.label, amountCents: c.amount_cents, note: discountNote(c.list_amount_cents, c.discount_percent) };
    if (c.status === "failed") needsYou.push({ ...base, key: c._id, at: c.updated_at, who: null, state: "failed" });
    else if (c.status === "open") upcoming.push({ ...base, key: c._id, at: c.created_at, who: null, state: "waiting" });
    else if (c.status === "processing") recent.push({ ...base, key: c._id, at: c.updated_at, who: who(c.paid_by_human_id), state: "clearing" });
    else if (c.status === "paid" && new Date(c.paid_at ?? c.updated_at).getTime() >= since) {
      recent.push({ ...base, key: c._id, at: c.paid_at ?? c.updated_at, who: who(c.paid_by_human_id), state: "paid" });
    }
  }

  for (const p of input.plans) {
    const name = project.get(p._id);
    if (!name || !p.level) continue;
    const base = { projectId: p._id, project: name, note: null };
    const planName = (level: MenuPlan) => `${MENU_PLAN_LABELS[level]} plan`;
    const amountAt = (at: Date) => {
      const level = p.pending_level && p.pending_at && at >= new Date(p.pending_at) ? p.pending_level : p.level!;
      return { level, cents: input.prices.get(level) ?? null };
    };

    if (isOnHold(p, now)) {
      needsYou.push({ ...base, key: `${p._id}-hold`, at: p.hold_since ?? p.start_date ?? p.updated_at, what: `${planName(p.level)}, work on hold`, who: null, amountCents: null, state: "hold" });
    }
    if (p.status === "resume_requested") {
      needsYou.push({ ...base, key: `${p._id}-resume`, at: p.resume_requested_at ?? p.updated_at, what: `${planName(p.level)}, asked to resume`, who: who(p.resume_requested_by), amountCents: null, state: "resume" });
    }
    if (p.level_requested && ["active", "pause_scheduled", "past_due"].includes(p.status)) {
      needsYou.push({ ...base, key: `${p._id}-level`, at: p.level_requested_at ?? p.updated_at, what: `${planName(p.level)}, asked to move to ${MENU_PLAN_LABELS[p.level_requested]}`, who: who(p.level_requested_by ?? null), amountCents: null, state: "level" });
    }
    if (p.status === "past_due") {
      needsYou.push({ ...base, key: `${p._id}-failed`, at: p.updated_at, what: planName(p.level), who: who(p.payer_human_id), amountCents: p.next_amount_cents, state: "failed" });
    }
    if (p.status === "awaiting_setup" && p.start_date) {
      const { cents } = amountAt(new Date(p.start_date));
      upcoming.push({ ...base, key: `${p._id}-setup`, at: p.start_date, what: planName(p.level), who: null, amountCents: cents, state: "awaiting_bank" });
    }
    // Each monthly debit inside the window. A pause or a cancel bills
    // nothing more, so only a running, unpaused plan has any.
    if ((p.status === "active" || p.status === "past_due") && p.current_period_end) {
      for (let i = 0; ; i++) {
        const at = addMonthsClamped(new Date(p.current_period_end), i);
        if (at.getTime() > horizon) break;
        const { level, cents } = amountAt(at);
        upcoming.push({ ...base, key: `${p._id}-due-${i}`, at: at.toISOString(), what: planName(level), who: who(p.payer_human_id), amountCents: i === 0 ? (p.next_amount_cents ?? cents) : cents, state: "due" });
      }
    }
    for (const inv of input.invoices.get(p._id) ?? []) {
      if (p.status === "past_due" && inv.status === "clearing") continue; // counted under Needs you
      recent.push({ ...base, key: inv.id, at: inv.at, what: planName(p.level), who: who(p.payer_human_id), amountCents: inv.amountCents, state: inv.status });
    }
  }

  const oldestFirst = (a: LedgerRow, b: LedgerRow) => a.at.localeCompare(b.at);
  return {
    needsYou: needsYou.sort(oldestFirst),
    upcoming: upcoming.sort(oldestFirst),
    recent: recent.sort((a, b) => b.at.localeCompare(a.at)),
  };
}

export async function loadLedger(input: {
  projects: { id: string; name: string }[];
  charges: BillingCharge[];
  plans: BillingPlan[];
  now?: Date;
}): Promise<Ledger> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const [invoices, prices, people] = await Promise.all([
    Promise.all(
      input.plans
        .filter((p) => p.stripe_subscription_id)
        .map(async (p) => [p._id, await listPlanInvoices(p.stripe_subscription_id!, since).catch(() => [])] as const),
    ),
    Promise.all(MENU_PLANS.map(async (l) => [l, (await priceFor(l).catch(() => null))?.unit_amount ?? null] as const)),
    getHumansById([
      ...new Set(
        [
          ...input.charges.map((c) => c.paid_by_human_id),
          ...input.plans.flatMap((p) => [p.payer_human_id, p.resume_requested_by, p.level_requested_by ?? null]),
        ].filter((id): id is string => !!id),
      ),
    ]),
  ]);
  return buildLedger({
    ...input,
    now,
    invoices: new Map(invoices),
    prices: new Map(prices.filter((p): p is readonly [MenuPlan, number] => p[1] != null)),
    names: new Map(people.map((h) => [h._id, displayName(h)])),
  });
}
