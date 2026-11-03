/**
 * A project's plan: the monthly Guide subscription (payments seed, Austin
 * 2026-10-06 and 2026-11-03). One per project (`billing_plans:<folderId>`),
 * set by the guide on the project's Maker page and run by the project's
 * Clients from their profile.
 *
 * Stripe is the record. Each plan is a SubscriptionSchedule in flexible
 * billing mode, because a schedule is what can pause at a renewal and
 * resume on a new anchor (proved in test mode, `stripe-pause-proof.ts`,
 * 2026-11-03). The row ties it to the project and caches what the pages
 * show; every webhook re-reads the subscription and schedule from Stripe.
 *
 * The flow:
 * 1. The guide picks a level → `awaiting_setup`. The app emails the Clients.
 * 2. A Client links a bank account on `/pay/plan/<folderId>`: a SetupIntent
 *    for bank transfer (ACH) only, which carries Stripe's mandate and the
 *    subscription terms. Confirming it is the authorization and acceptance.
 * 3. `setup_intent.succeeded` starts the schedule on the first billing day.
 *
 * Nothing here charges a saved bank account outside the plan's own monthly
 * debit; one-off bills are always a fresh payment the Client confirms
 * (cards.md: a stored mandate is not an authorization for a debit outside
 * the pattern).
 *
 * This module reports what happened as `PlanNotice`s; the app decides who
 * gets which email.
 */
import { RecordId } from "surrealdb";
import type Stripe from "stripe";
import { defineTable, formatRecord, merge, query, select, upsert, type Data } from "./generic.server";
import {
  MENU_PLANS,
  billDueAt,
  cancelEffectiveAt,
  firstBillingTime,
  holdStartsAt,
  isSettableFirstBillingDay,
  lookupKeyFor,
  pauseMilestone,
  planChangeEffectiveAt,
  type MenuPlan,
} from "./billingRules";
import { assertTermsUsable, termsFor } from "./billingTerms";
import { RECURRING_METHODS, priceFor, stripe } from "./stripe.server";
import { ensureCustomer } from "./billing.server";
import { billOnHold, isOnHold } from "./planHold.server";

const PLANS = "billing_plans";

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(PLANS);
  tableEnsured = true;
}

export type PlanStatus =
  | "none"
  | "awaiting_setup"
  | "active"
  | "pause_scheduled"
  | "paused"
  | "resume_requested"
  | "canceling"
  | "canceled"
  | "past_due";

export type BillingPlan = Data & {
  _id: string;
  /** The level billing now (or, before setup, the one the guide picked). */
  level: MenuPlan | null;
  status: PlanStatus;
  /** A first billing day the guide set, if any. */
  start_date: string | null;
  /** humanId → SetupIntent id, one per Client who opened the setup page. */
  setup_intents: Record<string, string>;
  payer_human_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_schedule_id: string | null;
  current_period_end: string | null;
  next_amount_cents: number | null;
  /** A plan change waiting for its billing date. */
  pending_level: MenuPlan | null;
  pending_at: string | null;
  pause_at: string | null;
  /** Who asked for the pause: a guide's pause isn't the client's to undo. */
  pause_by?: "client" | "guide" | null;
  paused_at: string | null;
  resume_requested_at: string | null;
  resume_requested_by: string | null;
  pause_warned_at: string | null;
  pause_alerted_at: string | null;
  /** When the project's work went on hold for a missing bank link; null
   * once the catch-up debit clears, or the guide resets the plan. */
  hold_since?: string | null;
  /** When the plan's debits started failing (Stripe's `past_due`). */
  past_due_since?: string | null;
  terms_version: string | null;
  accepted_at: string | null;
  updated_at: string;
};

/** What happened, for the app to email about. */
export type PlanNotice =
  | { type: "setup_requested"; folderId: string; level: MenuPlan }
  | { type: "plan_started"; folderId: string; level: MenuPlan; firstDebit: string }
  | { type: "debit_moved"; folderId: string; level: MenuPlan; date: string; amountCents: number; reason: "change" | "resume" }
  | { type: "pause_scheduled"; folderId: string; date: string; by: "client" | "guide" }
  | { type: "resume_requested"; folderId: string; byHumanId: string }
  | { type: "canceling"; folderId: string; date: string }
  | { type: "payment_failed"; folderId: string; amountCents: number }
  | { type: "pause_warn"; folderId: string; since: string }
  | { type: "pause_alert"; folderId: string; since: string }
  | { type: "work_on_hold"; folderId: string; reason: "no_bank" | "debit_failed" | "bill_overdue"; since: string }
  | { type: "hold_lifted"; folderId: string }
  | { type: "charge_paid"; folderId: string; chargeId: string; payerId: string; clearing: boolean; wasHeld: boolean }
  | { type: "plan_paid"; folderId: string; amountCents: number };

const SETTLED: PlanStatus[] = ["none", "canceled"];
/** A plan with a live subscription behind it. */
export const RUNNING: PlanStatus[] = ["active", "pause_scheduled", "paused", "resume_requested", "canceling", "past_due"];

/** A schedule's last phase with no end runs one billing period, then the
 * schedule releases its subscription, and a released subscription can't
 * pause or resume through it (found by the billing walk, 2026-11-03). So
 * a plan's open-ended phase is given a long duration instead. */
const OPEN_ENDED = { duration: { interval: "year" as const, interval_count: 10 } };

const iso = (unix: number) => new Date(unix * 1000).toISOString();

type Phase = Stripe.SubscriptionSchedule.Phase;
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));
const priceIdOf = (phase: Phase) => idOf(phase.items[0].price) as string;
const unix = (date: Date) => Math.floor(date.getTime() / 1000);

function emptyPlan(): Omit<BillingPlan, "id" | "_id"> {
  return {
    level: null,
    status: "none",
    start_date: null,
    setup_intents: {},
    payer_human_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_schedule_id: null,
    current_period_end: null,
    next_amount_cents: null,
    pending_level: null,
    pending_at: null,
    pause_at: null,
    pause_by: null,
    paused_at: null,
    resume_requested_at: null,
    resume_requested_by: null,
    pause_warned_at: null,
    pause_alerted_at: null,
    hold_since: null,
    past_due_since: null,
    terms_version: null,
    accepted_at: null,
    updated_at: new Date().toISOString(),
  };
}

export async function getPlan(folderId: string): Promise<BillingPlan | null> {
  await ensureTable();
  return (await select<BillingPlan>(new RecordId(PLANS, folderId))) ?? null;
}

export async function listPlans(folderIds: string[]): Promise<BillingPlan[]> {
  if (folderIds.length === 0) return [];
  await ensureTable();
  const ids = folderIds.map((id) => new RecordId(PLANS, id));
  const result = await query<[BillingPlan[]]>(`SELECT * FROM $ids`, { ids });
  return (result?.[0] ?? []).map((r) => formatRecord(r));
}

async function savePlan(folderId: string, fields: Partial<BillingPlan>): Promise<BillingPlan> {
  await ensureTable();
  const existing = await getPlan(folderId);
  const base: Omit<BillingPlan, "id" | "_id"> = existing
    ? (({ id: _id, _id: __id, ...rest }) => rest)(existing)
    : emptyPlan();
  const next = { ...base, ...fields, updated_at: new Date().toISOString() };
  await upsert(new RecordId(PLANS, folderId), next);
  return { ...(next as BillingPlan), id: { tb: PLANS, id: folderId }, _id: folderId };
}

function levelOfPrice(price: Stripe.Price | string | null | undefined): MenuPlan | null {
  const key = typeof price === "object" && price ? price.lookup_key : null;
  return MENU_PLANS.find((p) => lookupKeyFor(p) === key) ?? null;
}

// ─── The guide's side ───────────────────────────────────────────────────

/** The guide sets the project's plan level, or None. Before a Client has
 * linked a bank account this records the pick and the first billing day,
 * which the guide must give (`YYYY-MM-DD`, today or later); after, it's a
 * plan change (with the 7-day ACH rule) or, for None, a cancel at the
 * period's end. */
export async function setPlanLevel(input: {
  folderId: string;
  level: MenuPlan | null;
  /** The first billing day; required to start a plan, unused after. */
  startDay: string | null;
  now?: Date;
}): Promise<PlanNotice[]> {
  const plan = await getPlan(input.folderId);
  const running = plan && RUNNING.includes(plan.status) && plan.stripe_schedule_id;
  if (!running) {
    if (!input.level) {
      if (plan && !SETTLED.includes(plan.status)) await savePlan(input.folderId, { status: "none", level: null, start_date: null, hold_since: null });
      return [];
    }
    assertTermsUsable("subscription");
    if (!input.startDay) throw new Error("Pick the monthly billing day");
    if (!isSettableFirstBillingDay(input.startDay, input.now ?? new Date())) {
      throw new Error("The monthly billing day can't be before today");
    }
    const startDate = firstBillingTime(input.startDay).toISOString();
    const asked = plan?.status === "awaiting_setup" && plan.level === input.level && plan.start_date === startDate;
    // A new day from the guide is a fresh start: any hold lifts.
    await savePlan(input.folderId, { status: "awaiting_setup", level: input.level, start_date: startDate, hold_since: null });
    return asked ? [] : [{ type: "setup_requested", folderId: input.folderId, level: input.level }];
  }
  if (!input.level) return cancelPlan(plan, input.now ?? new Date());
  return changePlan(plan, input.level, input.now ?? new Date());
}

/** A guide resumes a paused plan, on a Client's request or their own
 * (Austin, 2026-11-03): billing resumes now, on a new full month from
 * today. */
export async function approveResume(folderId: string): Promise<PlanNotice[]> {
  const plan = await getPlan(folderId);
  if (!plan?.stripe_schedule_id || (plan.status !== "resume_requested" && plan.status !== "paused")) {
    throw new Error("Nothing is paused to resume");
  }
  const schedule = await stripe().subscriptionSchedules.retrieve(plan.stripe_schedule_id);
  const entry = schedule.pause_schedules?.[0];
  await stripe().subscriptionSchedules.update(plan.stripe_schedule_id, {
    pause_schedules: [
      {
        ...(entry?.key ? { key: entry.key } : {}),
        pause: { pause_at: { type: "timestamp", timestamp: entry?.pause?.pause_at ?? unix(new Date()) } },
        resume: { resume_at: { type: "now" }, settings: { billing_cycle_anchor: "resume_at" } },
      },
    ],
  });
  await savePlan(folderId, { resume_requested_at: null, resume_requested_by: null });
  const synced = await syncPlanFromStripe(folderId);
  return [
    {
      type: "debit_moved",
      folderId,
      level: synced?.level ?? plan.level ?? "guide",
      date: new Date().toISOString(),
      amountCents: synced?.next_amount_cents ?? 0,
      reason: "resume",
    },
  ];
}

// ─── The client's side ──────────────────────────────────────────────────

/** A plan change, by the guide or a Client: takes effect at the next
 * billing date, or the one after if that is inside the ACH notice. */
export async function changePlan(plan: BillingPlan, level: MenuPlan, now = new Date()): Promise<PlanNotice[]> {
  if (!plan.stripe_schedule_id || !plan.stripe_subscription_id) throw new Error("This plan hasn't started");
  if (plan.status === "paused" || plan.status === "resume_requested") throw new Error("Resume the plan before changing it");
  const schedule = await stripe().subscriptionSchedules.retrieve(plan.stripe_schedule_id);
  const sub = await stripe().subscriptions.retrieve(plan.stripe_subscription_id);
  const current = schedule.phases.find((p) => p.start_date === schedule.current_phase?.start_date) ?? schedule.phases[0];
  const currentPriceId = priceIdOf(current);
  const newPrice = await priceFor(level);
  const metadata = { project_folder_id: plan._id };

  if (newPrice.id === currentPriceId) {
    // Back to what bills now: drop any waiting change.
    await stripe().subscriptionSchedules.update(schedule.id, {
      phases: [{ items: [{ price: currentPriceId }], start_date: current.start_date, metadata, ...OPEN_ENDED }],
      proration_behavior: "none",
    });
    await syncPlanFromStripe(plan._id);
    return [];
  }

  const effective = planChangeEffectiveAt(new Date(sub.items.data[0].current_period_end * 1000), now);
  await stripe().subscriptionSchedules.update(schedule.id, {
    phases: [
      { items: [{ price: currentPriceId }], start_date: current.start_date, end_date: unix(effective), metadata },
      { items: [{ price: newPrice.id }], start_date: unix(effective), metadata, ...OPEN_ENDED },
    ],
    proration_behavior: "none",
  });
  await syncPlanFromStripe(plan._id);
  return [
    {
      type: "debit_moved",
      folderId: plan._id,
      level,
      date: effective.toISOString(),
      amountCents: newPrice.unit_amount ?? 0,
      reason: "change",
    },
  ];
}

/** Pause from the next billing date, by a Client or the guide. Undoable
 * until then, by whoever can (a guide's pause is the guide's to undo). */
export async function pausePlan(plan: BillingPlan, by: "client" | "guide" = "client"): Promise<PlanNotice[]> {
  if (plan.status !== "active" || !plan.stripe_schedule_id || !plan.current_period_end) throw new Error("Only a running plan can pause");
  const at = Math.floor(new Date(plan.current_period_end).getTime() / 1000);
  await stripe().subscriptionSchedules.update(plan.stripe_schedule_id, {
    pause_schedules: [{ pause: { pause_at: { type: "timestamp", timestamp: at } } }],
  });
  await savePlan(plan._id, { pause_by: by });
  await syncPlanFromStripe(plan._id);
  return [{ type: "pause_scheduled", folderId: plan._id, date: plan.current_period_end, by }];
}

export async function undoPause(plan: BillingPlan): Promise<void> {
  if (plan.status !== "pause_scheduled" || !plan.stripe_schedule_id) throw new Error("No pause is waiting to start");
  await stripe().subscriptionSchedules.update(plan.stripe_schedule_id, { pause_schedules: "" });
  await syncPlanFromStripe(plan._id);
}

/** A paused plan's Client asks to resume; the guide approves. */
export async function requestResume(plan: BillingPlan, byHumanId: string): Promise<PlanNotice[]> {
  if (plan.status !== "paused") throw new Error("Only a paused plan can resume");
  await savePlan(plan._id, {
    status: "resume_requested",
    resume_requested_at: new Date().toISOString(),
    resume_requested_by: byHumanId,
  });
  return [{ type: "resume_requested", folderId: plan._id, byHumanId }];
}

/** Cancel with the terms' 30 days' notice: the plan ends at the first
 * billing date at least that far off, so the client may pay one more
 * month. A paused plan ends now (no service is running, nothing bills). */
export async function cancelPlan(plan: BillingPlan, now = new Date()): Promise<PlanNotice[]> {
  if (!plan.stripe_subscription_id || !plan.stripe_schedule_id) throw new Error("This plan hasn't started");
  if (plan.status === "paused" || plan.status === "resume_requested") {
    await stripe().subscriptions.cancel(plan.stripe_subscription_id);
    await syncPlanFromStripe(plan._id);
    return [{ type: "canceling", folderId: plan._id, date: new Date().toISOString() }];
  }
  const schedule = await stripe().subscriptionSchedules.retrieve(plan.stripe_schedule_id);
  const sub = await stripe().subscriptions.retrieve(plan.stripe_subscription_id);
  const current = schedule.phases.find((p) => p.start_date === schedule.current_phase?.start_date) ?? schedule.phases[0];
  const end = unix(cancelEffectiveAt(new Date(sub.items.data[0].current_period_end * 1000), now));
  await stripe().subscriptionSchedules.update(schedule.id, {
    end_behavior: "cancel",
    phases: [
      {
        items: [{ price: priceIdOf(current) }],
        start_date: current.start_date,
        end_date: end,
        metadata: { project_folder_id: plan._id },
      },
    ],
    proration_behavior: "none",
    pause_schedules: "",
  });
  await syncPlanFromStripe(plan._id);
  return [{ type: "canceling", folderId: plan._id, date: iso(end) }];
}

/** The setup page's client secret: this Client's own SetupIntent for a
 * bank account, which carries Stripe's ACH mandate. `purpose` "bank"
 * replaces the account a running plan debits. */
export async function setupIntentSecretFor(
  plan: BillingPlan,
  payer: { _id: string; email: string; name?: string | null },
  purpose: "setup" | "bank",
): Promise<string> {
  if (purpose === "setup" && plan.status !== "awaiting_setup") throw new Error("This plan isn't waiting to be set up");
  if (purpose === "bank" && !RUNNING.includes(plan.status)) throw new Error("This plan isn't running");
  const termsVersion = termsFor("subscription").version;
  const key = `${payer._id}:${purpose}`;
  const existing = plan.setup_intents?.[key];
  if (existing) {
    const si = await stripe().setupIntents.retrieve(existing);
    const usable = si.client_secret && si.status !== "canceled" && si.status !== "succeeded";
    if (usable && si.metadata?.terms_version === termsVersion) return si.client_secret!;
    if (usable) await stripe().setupIntents.cancel(si.id);
  }
  const customer = await ensureCustomer(payer);
  const si = await stripe().setupIntents.create(
    {
      customer,
      allowed_payment_method_types: [...RECURRING_METHODS],
      metadata: {
        project_folder_id: plan._id,
        payer_human_id: payer._id,
        purpose,
        terms_category: "subscription",
        terms_version: termsVersion,
      },
    },
    // Keyed to this round of the plan: a plan ended and set up again the
    // same day is a new request, not a replay of the first (found by the
    // billing walk, 2026-11-03). Two loads in one round still share it.
    { idempotencyKey: `plan-${plan._id}-${key}-${existing ?? `first-${plan.updated_at}`}` },
  );
  await savePlan(plan._id, { setup_intents: { ...(plan.setup_intents ?? {}), [key]: si.id } });
  if (!si.client_secret) throw new Error("Stripe returned no client secret");
  return si.client_secret;
}

// ─── From Stripe ────────────────────────────────────────────────────────

/** A bank account is linked: start the plan, or switch a running plan's
 * debits to the new account. */
async function onSetupSucceeded(si: Stripe.SetupIntent): Promise<PlanNotice[]> {
  const folderId = si.metadata?.project_folder_id;
  const payerId = si.metadata?.payer_human_id;
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  const customer = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!folderId || !payerId || !pm || !customer) return [];
  const plan = await getPlan(folderId);
  if (!plan) return [];

  if (si.metadata?.purpose === "bank") {
    if (!plan.stripe_schedule_id || !plan.stripe_subscription_id) return [];
    await stripe().customers.update(customer, { invoice_settings: { default_payment_method: pm } });
    await stripe().subscriptionSchedules.update(plan.stripe_schedule_id, { default_settings: { default_payment_method: pm } });
    await stripe().subscriptions.update(plan.stripe_subscription_id, { default_payment_method: pm });
    // A plan whose debit failed: try the month it owes again on the new
    // account. The same monthly debit the mandate covers, not a new one.
    if (plan.status === "past_due") {
      const { data: open } = await stripe().invoices.list({ subscription: plan.stripe_subscription_id, status: "open", limit: 5 });
      for (const inv of open) {
        if (!inv.id) continue;
        await stripe()
          .invoices.pay(inv.id, { payment_method: pm })
          .catch((err) => console.warn(`billing: retrying ${inv.id} on the new account failed`, err));
      }
    }
    return [];
  }

  // Started already (two Clients, or the event twice): nothing more.
  if (plan.status !== "awaiting_setup" || plan.stripe_schedule_id || !plan.level) return [];
  await stripe().customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  const price = await priceFor(plan.level);
  const now = new Date();
  // The guide's day, always. Ahead, the plan starts then; already gone
  // (the client linked late), Stripe backdates to it and the first debit
  // covers from that day (Austin, 2026-11-03). Stripe judges which, on its
  // own clock.
  const first = plan.start_date ? new Date(plan.start_date) : now;
  const metadata = { project_folder_id: folderId };
  const schedule = await stripe().subscriptionSchedules.create(
    {
      customer,
      start_date: unix(first),
      billing_mode: { type: "flexible" },
      end_behavior: "release",
      default_settings: { default_payment_method: pm, collection_method: "charge_automatically" },
      phases: [{ items: [{ price: price.id }], metadata, ...OPEN_ENDED }],
      metadata,
    },
    { idempotencyKey: `plan-start-${folderId}-${si.id}` },
  );
  const subId = typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id ?? null;
  // Recurring is bank transfer only (seed), on the subscription itself.
  if (subId) {
    await stripe().subscriptions.update(subId, {
      payment_settings: { payment_method_types: [...RECURRING_METHODS] },
      metadata,
    });
  }
  // Linked after the hold began: work stays on hold until the catch-up
  // debit clears, even if the daily check hadn't run yet.
  const late = plan.start_date && now >= holdStartsAt(plan.start_date);
  await savePlan(folderId, {
    status: "active",
    hold_since: plan.hold_since ?? (late ? now.toISOString() : null),
    payer_human_id: payerId,
    stripe_customer_id: customer,
    stripe_schedule_id: schedule.id,
    stripe_subscription_id: subId,
    terms_version: si.metadata?.terms_version ?? null,
    accepted_at: now.toISOString(),
  });
  await syncPlanFromStripe(folderId);
  return [{ type: "plan_started", folderId, level: plan.level, firstDebit: first.toISOString() }];
}

/** Re-read a plan's schedule and subscription from Stripe and save what
 * the pages show. Stripe's word is the status, except a resume request,
 * which only O.No knows about. */
export async function syncPlanFromStripe(folderId: string): Promise<BillingPlan | null> {
  const plan = await getPlan(folderId);
  if (!plan?.stripe_schedule_id) return plan;
  const schedule = await stripe().subscriptionSchedules.retrieve(plan.stripe_schedule_id, { expand: ["phases.items.price"] });
  const subId =
    plan.stripe_subscription_id ??
    (typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id ?? null);
  const sub = subId ? await stripe().subscriptions.retrieve(subId, { expand: ["items.data.price"] }) : null;

  // Stripe's current phase, not this server's clock (see pauseWaiting).
  const currentIdx = Math.max(
    0,
    schedule.phases.findIndex((p) => p.start_date === schedule.current_phase?.start_date),
  );
  const nextPhase = schedule.phases[currentIdx + 1];
  const currentLevel = levelOfPrice(sub?.items.data[0]?.price ?? (schedule.phases[currentIdx]?.items[0]?.price as Stripe.Price));
  const pendingLevel = nextPhase ? levelOfPrice(nextPhase.items[0]?.price as Stripe.Price) : null;
  const periodEnd = sub?.items.data[0]?.current_period_end ?? schedule.phases[currentIdx]?.start_date ?? null;
  const pauseEntry = schedule.pause_schedules?.[0]?.pause ?? null;
  const pauseAt = pauseEntry?.pause_at ?? null;
  // Stripe's own stage for the pause, not a date compare: a test clock
  // (and Stripe's clock generally) isn't this server's.
  const pauseWaiting = pauseEntry?.status?.type === "scheduled";

  let status: PlanStatus;
  if (!sub || sub.status === "canceled" || schedule.status === "canceled") status = "canceled";
  else if (sub.status === "paused") status = plan.status === "resume_requested" ? "resume_requested" : "paused";
  else if (sub.status === "past_due" || sub.status === "unpaid") status = "past_due";
  else if (schedule.end_behavior === "cancel" || sub.cancel_at) status = "canceling";
  else if (pauseWaiting) status = "pause_scheduled";
  else status = "active";

  const nextLevel = pendingLevel && nextPhase && periodEnd && nextPhase.start_date <= periodEnd ? pendingLevel : currentLevel;
  const nextPrice = nextLevel ? await priceFor(nextLevel) : null;

  return savePlan(folderId, {
    status,
    level: currentLevel ?? plan.level,
    stripe_subscription_id: subId,
    current_period_end: periodEnd ? iso(periodEnd) : null,
    next_amount_cents: status === "active" || status === "past_due" ? (nextPrice?.unit_amount ?? null) : null,
    pending_level: pendingLevel && pendingLevel !== currentLevel ? pendingLevel : null,
    pending_at: pendingLevel && pendingLevel !== currentLevel && nextPhase ? iso(nextPhase.start_date) : null,
    pause_at: pauseWaiting && pauseAt ? iso(pauseAt) : null,
    paused_at: status === "paused" || status === "resume_requested" ? (plan.paused_at ?? new Date().toISOString()) : null,
    pause_by: status === "pause_scheduled" || status === "paused" || status === "resume_requested" ? (plan.pause_by ?? null) : null,
    pause_warned_at: status === "paused" || status === "resume_requested" ? plan.pause_warned_at : null,
    pause_alerted_at: status === "paused" || status === "resume_requested" ? plan.pause_alerted_at : null,
    past_due_since: status === "past_due" ? (plan.past_due_since ?? new Date().toISOString()) : null,
  });
}

function folderOf(obj: { metadata?: Stripe.Metadata | null } | null | undefined): string | null {
  return obj?.metadata?.project_folder_id ?? null;
}

/** The plan events a webhook hands on. Returns what to email about. */
export async function applyPlanEvent(event: Stripe.Event): Promise<PlanNotice[]> {
  switch (event.type) {
    case "setup_intent.succeeded": {
      const si = await stripe().setupIntents.retrieve((event.data.object as Stripe.SetupIntent).id);
      return onSetupSucceeded(si);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.deleted": {
      const sub = await stripe().subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
      const folderId = folderOf(sub);
      if (folderId) await syncPlanFromStripe(folderId);
      return [];
    }
    case "subscription_schedule.updated":
    case "subscription_schedule.completed":
    case "subscription_schedule.released":
    case "subscription_schedule.canceled": {
      const schedule = await stripe().subscriptionSchedules.retrieve((event.data.object as Stripe.SubscriptionSchedule).id);
      const folderId = folderOf(schedule);
      if (folderId) await syncPlanFromStripe(folderId);
      return [];
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = await stripe().invoices.retrieve((event.data.object as Stripe.Invoice).id);
      const subRef = invoice.parent?.subscription_details?.subscription;
      const subId = typeof subRef === "string" ? subRef : subRef?.id;
      if (!subId) return [];
      const sub = await stripe().subscriptions.retrieve(subId);
      const folderId = folderOf(sub) ?? invoice.parent?.subscription_details?.metadata?.project_folder_id ?? null;
      if (!folderId) return [];
      const synced = await syncPlanFromStripe(folderId);
      if (event.type === "invoice.paid" && invoice.amount_paid > 0) {
        const paid: PlanNotice[] = [{ type: "plan_paid", folderId, amountCents: invoice.amount_paid }];
        if (!synced?.hold_since) return paid;
        await savePlan(folderId, { hold_since: null });
        return [...paid, { type: "hold_lifted", folderId }];
      }
      // Only once Stripe has stopped retrying: the guide is told then.
      if (event.type === "invoice.payment_failed" && invoice.next_payment_attempt == null) {
        return [{ type: "payment_failed", folderId, amountCents: invoice.amount_due }];
      }
      return [];
    }
    default:
      return [];
  }
}

export { isOnHold } from "./planHold.server";

/** The daily check. Money 10 days past due puts work on hold and says
 * so, once: a plan with no bank linked, a plan whose debit failed, a bill
 * unpaid past its due date. At five months paused, the Client hears from
 * us; at six with no resume request, the guide does. Each once per pause. */
export async function pauseCheck(now = new Date()): Promise<PlanNotice[]> {
  await ensureTable();
  const result = await query<[BillingPlan[]]>(
    `SELECT * FROM ${PLANS} WHERE status IN ["paused", "resume_requested", "awaiting_setup", "past_due"]`,
    {},
  );
  const notices: PlanNotice[] = [];
  for (const plan of (result?.[0] ?? []).map((r) => formatRecord(r))) {
    if (plan.status === "awaiting_setup" || plan.status === "past_due") {
      const since = plan.status === "awaiting_setup" ? plan.start_date : (plan.past_due_since ?? null);
      if (!plan.hold_since && since && isOnHold(plan, now)) {
        await merge(PLANS, plan._id, { hold_since: now.toISOString() });
        notices.push({ type: "work_on_hold", folderId: plan._id, reason: plan.status === "awaiting_setup" ? "no_bank" : "debit_failed", since });
      }
      continue;
    }
    if (!plan.paused_at) continue;
    const milestone = pauseMilestone(new Date(plan.paused_at), now);
    if (milestone !== "none" && !plan.pause_warned_at) {
      notices.push({ type: "pause_warn", folderId: plan._id, since: plan.paused_at });
      await merge(PLANS, plan._id, { pause_warned_at: now.toISOString() });
    }
    if (milestone === "alert" && !plan.pause_alerted_at && plan.status === "paused") {
      notices.push({ type: "pause_alert", folderId: plan._id, since: plan.paused_at });
      await merge(PLANS, plan._id, { pause_alerted_at: now.toISOString() });
    }
  }
  // Bills past due: said once per bill.
  const bills = await query<[{ id: unknown; project_folder_id: string; status: string; created_at: string; hold_notified_at?: string | null }[]]>(
    `SELECT id, project_folder_id, status, created_at, hold_notified_at FROM billing_charges WHERE status IN ["open", "failed"]`,
    {},
  );
  for (const bill of (bills?.[0] ?? []).map((r) => formatRecord(r as never) as typeof r & { _id: string })) {
    if (bill.hold_notified_at || !billOnHold(bill, now)) continue;
    await merge("billing_charges", bill._id, { hold_notified_at: now.toISOString() });
    notices.push({ type: "work_on_hold", folderId: bill.project_folder_id, reason: "bill_overdue", since: billDueAt(bill.created_at).toISOString() });
  }
  return notices;
}

export type PlanInvoice = { id: string; amountCents: number; status: "paid" | "clearing"; at: string };

/** A plan's debits since `since`, read from Stripe each time: O.No keeps
 * no copy of them (Stripe is the record of money). Paid ones, and ones
 * Stripe has tried and is waiting on (a bank transfer clearing). Nothing
 * at $0, which is what a paused month bills. */
export async function listPlanInvoices(subscriptionId: string, since: Date): Promise<PlanInvoice[]> {
  const { data: invoices } = await stripe().invoices.list({
    subscription: subscriptionId,
    created: { gte: unix(since) },
    limit: 24,
  });
  return invoices.flatMap((inv): PlanInvoice[] => {
    if (inv.status === "paid" && inv.amount_paid > 0) {
      return [{ id: inv.id ?? "", amountCents: inv.amount_paid, status: "paid", at: iso(inv.status_transitions?.paid_at ?? inv.created) }];
    }
    if (inv.status === "open" && inv.attempted && inv.amount_due > 0) {
      return [{ id: inv.id ?? "", amountCents: inv.amount_due, status: "clearing", at: iso(inv.created) }];
    }
    return [];
  });
}
