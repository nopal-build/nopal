// A project's plan (payments seed, 2026-11-03). Gates:
//   - a guide's pick needs a first billing day, today or later, then waits
//     for a Client's bank account, and asks once
//   - a linked bank account starts one flexible-mode schedule, bank
//     transfer only, on the guide's day, ahead or already gone (a late
//     link is billed from that day); a second Client linking doesn't start
//     a second
//   - a bank link 10 days overdue puts work on hold, said once; linking
//     late keeps it on hold until the catch-up debit clears; a guide's
//     fresh day lifts it
//   - the guide hears of a failed debit only once Stripe stops retrying
//   - the pause check emails at five months and alerts at six, once each,
//     and not at six if the Client has asked to resume
// Stripe and the database are fakes; the events are hand-built.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const calls = vi.hoisted(() => ({
  scheduleCreates: [] as Record<string, unknown>[],
  subscriptionUpdates: [] as Record<string, unknown>[],
  scheduleUpdates: [] as Record<string, unknown>[],
}));
const fx = vi.hoisted(() => ({
  setupIntent: {} as Record<string, unknown>,
  invoice: {} as Record<string, unknown>,
  pauseSchedules: [] as unknown[],
  subStatus: "active",
  // What the linked payment method is, as Stripe would report it.
  paymentMethod: { type: "us_bank_account" } as Record<string, unknown>,
  // A card fee line already on the running plan's phase, in cents.
  feeOnPhase: 0,
}));

vi.mock("robustness-core/data/generic.server", () => {
  const key = (rid: { tb: string; id: unknown }) => `${rid.tb}:${String(rid.id)}`;
  return {
    defineTable: async () => {},
    formatRecord: (r: unknown) => r,
    newRecordId: () => `r${store.size + 1}`,
    query: async (sql: string, vars: { rec?: { tb: string; id: unknown }; at?: string } = {}) => {
      // The say-it-once claim: set the field only if nothing has.
      const claimed = /^UPDATE \$rec SET (\w+) = \$at WHERE/.exec(sql);
      if (claimed && vars.rec) {
        const row = store.get(key(vars.rec));
        if (!row || row[claimed[1]] != null) return [[]];
        store.set(key(vars.rec), { ...row, [claimed[1]]: vars.at });
        return [[vars.rec]];
      }
      if (sql.includes("billing_plans WHERE status")) {
        const rows = [...store.entries()]
          .filter(([k, v]) => k.startsWith("billing_plans:") && ["paused", "resume_requested", "awaiting_setup"].includes(String(v.status)))
          .map(([k, v]) => ({ ...v, _id: k.split(":")[1] }));
        return [rows];
      }
      return [[]];
    },
    select: async (rid: { tb: string; id: unknown }) => {
      const row = store.get(key(rid));
      return row ? { ...row, _id: String(rid.id) } : undefined;
    },
    upsert: async (rid: { tb: string; id: unknown }, data: Record<string, unknown>) => {
      store.set(key(rid), { ...data });
    },
    merge: async (tb: string, id: string, data: Record<string, unknown>) => {
      store.set(`${tb}:${id}`, { ...(store.get(`${tb}:${id}`) ?? {}), ...data });
    },
  };
});

vi.mock("robustness-core/data/stripe.server", () => {
  const price = (level: string) => ({ id: `price_${level}`, lookup_key: `nopal_${level}`, unit_amount: { light_guide: 150000, guide: 300000, deep_guide: 600000 }[level] });
  const day = 86400;
  const fake = {
    customers: { create: async () => ({ id: "cus_1" }), update: async () => ({}) },
    setupIntents: { retrieve: async () => fx.setupIntent },
    paymentMethods: { retrieve: async () => fx.paymentMethod },
    invoices: { retrieve: async () => fx.invoice },
    invoicePayments: { list: async () => ({ data: fx.invoice.id ? [{ invoice: fx.invoice.id }] : [] }) },
    subscriptionSchedules: {
      create: async (params: Record<string, unknown>) => {
        calls.scheduleCreates.push(params);
        return { id: "sub_sched_1", subscription: "sub_1" };
      },
      update: async (_id: string, params: Record<string, unknown>) => {
        calls.scheduleUpdates.push(params);
        return {};
      },
      retrieve: async () => ({
        id: "sub_sched_1",
        subscription: "sub_1",
        status: "active",
        end_behavior: "release",
        pause_schedules: fx.pauseSchedules,
        current_phase: { start_date: 1 },
        phases: [
          {
            start_date: 1,
            end_date: 999,
            items: [{ price: price("guide") }, ...(fx.feeOnPhase ? [{ price: { id: "price_fee", product: "nopal_card_fee", unit_amount: fx.feeOnPhase } }] : [])],
          },
        ],
      }),
    },
    subscriptions: {
      update: async (_id: string, params: Record<string, unknown>) => {
        calls.subscriptionUpdates.push(params);
        return {};
      },
      retrieve: async () => ({
        id: "sub_1",
        status: fx.subStatus,
        cancel_at: null,
        metadata: { project_folder_id: "attic" },
        items: { data: [{ price: price("guide"), current_period_end: Math.floor(Date.now() / 1000) + 30 * day }] },
      }),
    },
  };
  return {
    stripe: () => fake,
    priceFor: async (level: string) => price(level),
    RECURRING_METHODS: ["us_bank_account", "card"],
    CARD_FEE_PRODUCT_ID: "nopal_card_fee",
    ensureCardFeeProduct: async () => "nopal_card_fee",
    ONE_TIME_METHODS: ["card", "us_bank_account"],
  };
});

import { planPaymentRefunded } from "robustness-core/data/billingPlans.server";
import { applyPlanEvent, approveLevelRequest, approveResume, cancelPlan, changePlan, declineLevelRequest, getPlan, isOnHold, pauseCheck, pausePlan, requestLevel, setPlanLevel } from "robustness-core/data/billingPlans.server";
import { dayIn, firstBillingTime } from "robustness-core/data/billingRules";

const TODAY = dayIn(new Date());

const plan = () => store.get("billing_plans:attic") as Record<string, unknown> | undefined;
const event = (type: string, object: unknown) => ({ id: "evt", type, data: { object } }) as never;
const linked = (payer = "sue") => {
  fx.setupIntent = {
    id: `seti_${payer}`,
    status: "succeeded",
    customer: "cus_1",
    payment_method: `pm_${payer}`,
    metadata: { project_folder_id: "attic", payer_human_id: payer, purpose: "setup", terms_version: "v-sub" },
  };
  return applyPlanEvent(event("setup_intent.succeeded", { id: fx.setupIntent.id }));
};

beforeEach(() => {
  store.clear();
  calls.scheduleCreates.length = 0;
  calls.subscriptionUpdates.length = 0;
  calls.scheduleUpdates.length = 0;
  fx.pauseSchedules = [];
  fx.subStatus = "active";
  fx.paymentMethod = { type: "us_bank_account" };
  fx.feeOnPhase = 0;
});

describe("the guide picks a level", () => {
  it("waits for a Client's bank account and asks the Clients once", async () => {
    const first = await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    expect(first).toEqual([{ type: "setup_requested", folderId: "attic", level: "guide" }]);
    expect(plan()?.status).toBe("awaiting_setup");
    expect(await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY })).toEqual([]);
  });

  it("needs a first billing day", async () => {
    await expect(setPlanLevel({ folderId: "attic", level: "guide", startDay: null })).rejects.toThrow(/monthly billing day/);
    expect(plan()).toBeUndefined();
  });

  it("refuses a day already gone", async () => {
    await expect(setPlanLevel({ folderId: "attic", level: "guide", startDay: "2020-01-01" })).rejects.toThrow(/before today/);
  });

  it("asks again when the guide moves the day", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    const later = dayIn(new Date(Date.now() + 10 * 86400_000));
    expect(await setPlanLevel({ folderId: "attic", level: "guide", startDay: later })).toHaveLength(1);
  });

  it("None before setup clears the pick", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await setPlanLevel({ folderId: "attic", level: null, startDay: TODAY });
    expect(plan()?.status).toBe("none");
  });
});

describe("a Client links a bank account", () => {
  it("starts one flexible-mode schedule, bank transfer only, on the guide's day", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    const notices = await linked();
    expect(calls.scheduleCreates).toHaveLength(1);
    expect(calls.scheduleCreates[0]).toMatchObject({
      start_date: Math.floor(firstBillingTime(TODAY).getTime() / 1000),
      billing_mode: { type: "flexible" },
    });
    // A last phase with no end lasts one period, then the schedule lets
    // go and pause stops working (billing walk, 2026-11-03).
    const phases = calls.scheduleCreates[0].phases as { duration?: unknown; end_date?: unknown }[];
    expect(phases.at(-1)?.duration ?? phases.at(-1)?.end_date).toBeTruthy();
    expect(calls.subscriptionUpdates[0]).toMatchObject({ payment_settings: { payment_method_types: ["us_bank_account"] } });
    expect(plan()).toMatchObject({ status: "active", payer_human_id: "sue", terms_version: "v-sub" });
    expect(notices[0]).toMatchObject({ type: "plan_started", level: "guide" });
  });

  it("starts on the guide's day when it's ahead", async () => {
    const later = dayIn(new Date(Date.now() + 10 * 86400_000));
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: later });
    await linked();
    expect(calls.scheduleCreates[0].start_date).toBe(Math.floor(firstBillingTime(later).getTime() / 1000));
  });

  it("a Client who links late is still billed from the guide's day", async () => {
    // Set today; the Client links ten days on (the clock moves, the day doesn't).
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    vi.useFakeTimers({ now: Date.now() + 10 * 86400_000, toFake: ["Date"] });
    try {
      await linked();
    } finally {
      vi.useRealTimers();
    }
    expect(calls.scheduleCreates[0].start_date).toBe(Math.floor(firstBillingTime(TODAY).getTime() / 1000));
  });

  it("a second Client linking doesn't start a second plan", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked("sue");
    expect(await linked("tom")).toEqual([]);
    expect(calls.scheduleCreates).toHaveLength(1);
    expect(plan()?.payer_human_id).toBe("sue");
  });
});

it("a plan carries no discount: the schedule bills the level's price", async () => {
  await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
  await linked();
  const phase = (calls.scheduleCreates[0].phases as Record<string, unknown>[])[0];
  expect(phase.discounts).toBeUndefined();
  expect(phase.items).toEqual([{ price: "price_guide" }]);
});

describe("the guide's own controls", () => {
  it("a guide's pause says who paused, and keeps it while paused", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
    fx.pauseSchedules = [{ pause: { pause_at: 2_000_000_000, status: { type: "scheduled" } } }];
    const notices = await pausePlan((await getPlan("attic"))!, "guide");
    expect(notices[0]).toMatchObject({ type: "pause_scheduled", by: "guide" });
    expect(plan()).toMatchObject({ status: "pause_scheduled", pause_by: "guide" });
  });

  it("a guide resumes a pause nobody asked to end", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
    fx.subStatus = "paused";
    await applyPlanEvent(event("customer.subscription.paused", { id: "sub_1" }));
    expect(plan()?.status).toBe("paused");
    fx.subStatus = "active";
    expect((await approveResume("attic"))[0]).toMatchObject({ type: "debit_moved", reason: "resume" });
  });
});

describe("work on hold", () => {
  const DAY_MS = 86400000;
  // A plan the guide set up 40 days ago that nobody has linked.
  const overdue = () =>
    store.set("billing_plans:attic", { status: "awaiting_setup", level: "guide", start_date: new Date(Date.now() - 40 * DAY_MS).toISOString(), setup_intents: {} });

  it("isn't on hold inside 10 days past the billing day", () => {
    expect(isOnHold({ status: "awaiting_setup", start_date: new Date(Date.now() - 9 * DAY_MS).toISOString(), hold_since: null })).toBe(false);
  });

  it("goes on hold 10 days after a debit fails", () => {
    const failedAgo = (days: number) => ({ status: "past_due", start_date: null, past_due_since: new Date(Date.now() - days * DAY_MS).toISOString() });
    expect(isOnHold(failedAgo(9))).toBe(false);
    expect(isOnHold(failedAgo(11))).toBe(true);
  });

  it("goes on hold 10 days after the billing day, before the daily check runs", async () => {
    overdue();
    expect(isOnHold((await getPlan("attic"))!)).toBe(true);
  });

  it("the daily check says so once", async () => {
    overdue();
    expect((await pauseCheck()).map((n) => n.type)).toEqual(["work_on_hold"]);
    expect(await pauseCheck()).toEqual([]);
  });

  it("stays on hold after a late link, until the debit clears", async () => {
    overdue();
    await linked();
    expect(plan()?.status).toBe("active");
    expect(isOnHold((await getPlan("attic"))!)).toBe(true);
    fx.invoice = { id: "in_1", amount_paid: 900000, parent: { subscription_details: { subscription: "sub_1", metadata: { project_folder_id: "attic" } } } };
    expect((await applyPlanEvent(event("invoice.paid", { id: "in_1" }))).map((n) => n.type)).toEqual(["plan_paid", "hold_lifted"]);
    expect(isOnHold((await getPlan("attic"))!)).toBe(false);
  });

  it("lifts when the guide sets a fresh day", async () => {
    overdue();
    await pauseCheck();
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    expect(isOnHold((await getPlan("attic"))!)).toBe(false);
  });
});

describe("a debit fails", () => {
  const failed = (nextAttempt: number | null) => {
    fx.invoice = {
      id: "in_1",
      amount_due: 300000,
      next_payment_attempt: nextAttempt,
      parent: { subscription_details: { subscription: "sub_1", metadata: { project_folder_id: "attic" } } },
    };
    return applyPlanEvent(event("invoice.payment_failed", { id: "in_1" }));
  };

  beforeEach(async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
  });

  it("says nothing while Stripe is still retrying", async () => {
    expect(await failed(Math.floor(Date.now() / 1000) + 86400)).toEqual([]);
  });

  it("tells the guide once Stripe stops", async () => {
    expect(await failed(null)).toEqual([{ type: "payment_failed", folderId: "attic", amountCents: 300000 }]);
  });
});

describe("the pause check", () => {
  const pausedSince = (monthsAgo: number, status = "paused") => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - monthsAgo);
    d.setUTCDate(d.getUTCDate() - 1);
    store.set("billing_plans:attic", { status, paused_at: d.toISOString(), pause_warned_at: null, pause_alerted_at: null });
  };

  it("is quiet before five months", async () => {
    pausedSince(4);
    expect(await pauseCheck()).toEqual([]);
  });

  it("emails the Client at five months, once", async () => {
    pausedSince(5);
    expect((await pauseCheck()).map((n) => n.type)).toEqual(["pause_warn"]);
    expect(await pauseCheck()).toEqual([]);
  });

  it("alerts the guide at six months, once", async () => {
    pausedSince(6);
    expect((await pauseCheck()).map((n) => n.type)).toEqual(["pause_warn", "pause_alert"]);
    expect(await pauseCheck()).toEqual([]);
  });

  it("doesn't alert when the Client has asked to resume", async () => {
    pausedSince(6, "resume_requested");
    expect((await pauseCheck()).map((n) => n.type)).toEqual(["pause_warn"]);
  });
});

// Austin, 2026-11-09: a Client asks for a different level; the guide
// decides. Asking moves nothing in Stripe.
describe("a Client asks for a different level", () => {
  const running = async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
    return (await getPlan("attic"))!;
  };

  it("records the ask and tells the guide, and touches nothing in Stripe", async () => {
    const before = calls.scheduleUpdates.length;
    const notices = await requestLevel(await running(), "deep_guide", "sue");
    expect(notices).toEqual([{ type: "level_requested", folderId: "attic", level: "deep_guide", byHumanId: "sue" }]);
    expect(plan()).toMatchObject({ level: "guide", level_requested: "deep_guide", level_requested_by: "sue" });
    expect(calls.scheduleUpdates).toHaveLength(before);
  });

  it("refuses the plan they're already on", async () => {
    await expect(requestLevel(await running(), "guide", "sue")).rejects.toThrow("That's the plan you're on");
  });

  it("refuses while the plan is paused", async () => {
    await running();
    fx.subStatus = "paused";
    await applyPlanEvent(event("customer.subscription.paused", { id: "sub_1" }));
    await expect(requestLevel((await getPlan("attic"))!, "deep_guide", "sue")).rejects.toThrow("Only a running plan");
  });

  it("the guide approves: a plan change to the asked level, and the ask clears", async () => {
    await requestLevel(await running(), "deep_guide", "sue");
    const notices = await approveLevelRequest("attic");
    expect(notices[0]).toMatchObject({ type: "debit_moved", level: "deep_guide", reason: "change" });
    const phases = calls.scheduleUpdates.at(-1)?.phases as { items: { price: string }[] }[];
    expect(phases.at(-1)?.items[0].price).toBe("price_deep_guide");
    expect(plan()?.level_requested).toBeNull();
  });

  it("the guide declines: the ask clears, the Client hears, Stripe is untouched", async () => {
    await requestLevel(await running(), "light_guide", "sue");
    const before = calls.scheduleUpdates.length;
    const notices = await declineLevelRequest("attic");
    expect(notices).toEqual([{ type: "level_declined", folderId: "attic", level: "light_guide", byHumanId: "sue" }]);
    expect(plan()?.level_requested).toBeNull();
    expect(calls.scheduleUpdates).toHaveLength(before);
  });

  it("a guide changing the level themselves clears an open ask", async () => {
    await requestLevel(await running(), "deep_guide", "sue");
    await setPlanLevel({ folderId: "attic", level: "light_guide", startDay: null });
    expect(plan()?.level_requested).toBeNull();
  });
});

// A plan paid by card (Austin, 2026-11-17): a credit card pays Stripe's
// card fee as its own line, a debit card and a bank account pay the plain
// price. Stripe doesn't hold this rule for a subscription, so these do:
// the fee line is on every phase a credit card pays, survives a change
// and a cancel, and follows the payment method when it is switched.
describe("a plan paid by card", () => {
  const CREDIT = { type: "card", card: { funding: "credit" } };
  const DEBIT = { type: "card", card: { funding: "debit" } };
  type Item = { price?: string; price_data?: { unit_amount: number; product: string; recurring: { interval: string } } };
  const itemsOf = (phase: unknown) => (phase as { items: Item[] }).items;
  const feeOf = (phase: unknown) => itemsOf(phase).find((i) => i.price_data)?.price_data?.unit_amount ?? itemsOf(phase).some((i) => i.price === "price_fee");
  const start = async (method: Record<string, unknown>) => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    fx.paymentMethod = method;
    await linked();
    return (await getPlan("attic"))!;
  };
  const switchTo = (method: Record<string, unknown>) => {
    fx.paymentMethod = method;
    fx.setupIntent = { id: "seti_switch", status: "succeeded", customer: "cus_1", payment_method: "pm_new", metadata: { project_folder_id: "attic", payer_human_id: "sue", purpose: "bank" } };
    return applyPlanEvent(event("setup_intent.succeeded", { id: "seti_switch" }));
  };

  it("a credit card starts the plan with the card fee as a second monthly line", async () => {
    const p = await start(CREDIT);
    const [phase] = calls.scheduleCreates[0].phases as unknown[];
    expect(itemsOf(phase)).toEqual([
      { price: "price_guide" },
      { price_data: { currency: "usd", product: "nopal_card_fee", recurring: { interval: "month" }, unit_amount: 8730 } },
    ]);
    expect(calls.subscriptionUpdates[0]).toMatchObject({ payment_settings: { payment_method_types: ["card"] } });
    expect(p).toMatchObject({ pay_method: "card", card_funding: "credit", next_amount_cents: 308730, card_fee_cents: 8730 });
  });

  it("a debit card starts it at the plain price", async () => {
    const p = await start(DEBIT);
    expect(itemsOf((calls.scheduleCreates[0].phases as unknown[])[0])).toEqual([{ price: "price_guide" }]);
    expect(calls.subscriptionUpdates[0]).toMatchObject({ payment_settings: { payment_method_types: ["card"] } });
    expect(p).toMatchObject({ pay_method: "card", card_funding: "debit", next_amount_cents: 300000, card_fee_cents: 0 });
  });

  it("a bank account starts it at the plain price", async () => {
    const p = await start({ type: "us_bank_account" });
    expect(itemsOf((calls.scheduleCreates[0].phases as unknown[])[0])).toEqual([{ price: "price_guide" }]);
    expect(p).toMatchObject({ pay_method: "bank", next_amount_cents: 300000 });
  });

  it("a level change keeps the fee on the month still running and puts the new level's fee on the next", async () => {
    const p = await start(CREDIT);
    fx.feeOnPhase = 8730;
    const notices = await changePlan(p, "deep_guide");
    const phases = calls.scheduleUpdates.at(-1)!.phases as unknown[];
    expect(itemsOf(phases[0])).toEqual([{ price: "price_guide" }, { price: "price_fee" }]);
    expect(itemsOf(phases[1])[0]).toEqual({ price: "price_deep_guide" });
    expect(feeOf(phases[1])).toBe(17430);
    expect(notices[0]).toMatchObject({ type: "debit_moved", amountCents: 617430 });
  });

  it("a cancel keeps the fee on the months left", async () => {
    const p = await start(CREDIT);
    fx.feeOnPhase = 8730;
    await cancelPlan(p);
    const phases = calls.scheduleUpdates.at(-1)!.phases as unknown[];
    expect(itemsOf(phases[0])).toEqual([{ price: "price_guide" }, { price: "price_fee" }]);
  });

  it("switching from a bank account to a credit card adds the fee, on the same dates", async () => {
    await start({ type: "us_bank_account" });
    await switchTo(CREDIT);
    const update = calls.scheduleUpdates.find((u) => u.phases)!;
    const [phase] = update.phases as { start_date: number; end_date: number }[];
    expect(feeOf(phase)).toBe(8730);
    expect(phase).toMatchObject({ start_date: 1, end_date: 999 });
    expect(update.proration_behavior).toBe("none");
    expect(calls.subscriptionUpdates.at(-1)).toMatchObject({ default_payment_method: "pm_new", payment_settings: { payment_method_types: ["card"] } });
    expect(plan()).toMatchObject({ pay_method: "card", card_funding: "credit", card_fee_cents: 8730 });
  });

  it("switching from a credit card to a bank account takes the fee off", async () => {
    await start(CREDIT);
    fx.feeOnPhase = 8730;
    await switchTo({ type: "us_bank_account" });
    const update = calls.scheduleUpdates.find((u) => u.phases)!;
    expect(itemsOf((update.phases as unknown[])[0])).toEqual([{ price: "price_guide" }]);
    expect(plan()).toMatchObject({ pay_method: "bank", card_fee_cents: 0 });
  });

  it("a switch that stopped halfway is finished when Stripe sends the event again", async () => {
    await start(CREDIT);
    fx.feeOnPhase = 8730;
    // The row already says debit (the first pass got that far), the
    // schedule still carries the fee.
    store.set("billing_plans:attic", { ...plan(), pay_method: "card", card_funding: "debit" });
    await switchTo(DEBIT);
    const update = calls.scheduleUpdates.find((u) => u.phases)!;
    expect(itemsOf((update.phases as unknown[])[0])).toEqual([{ price: "price_guide" }]);
  });

  it("switching between two that pay no fee leaves the schedule's phases alone", async () => {
    await start({ type: "us_bank_account" });
    await switchTo(DEBIT);
    expect(calls.scheduleUpdates.some((u) => u.phases)).toBe(false);
    expect(plan()).toMatchObject({ pay_method: "card", card_funding: "debit" });
  });
});

describe("a plan after a plan", () => {
  it("a plan set on a project whose last one ended starts when a Client links", async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
    store.set("billing_plans:attic", { ...plan(), status: "canceled" });
    await setPlanLevel({ folderId: "attic", level: "light_guide", startDay: TODAY });
    expect(plan()).toMatchObject({ status: "awaiting_setup", stripe_schedule_id: null, stripe_subscription_id: null });
    await linked("tom");
    expect(calls.scheduleCreates).toHaveLength(2);
    expect(plan()).toMatchObject({ status: "active", payer_human_id: "tom" });
  });
});

// A plan's monthly payment refunded in Stripe (Austin, 2026-11-20): found
// through the invoice it paid, written on the plan by invoice for the
// ledger, and the guides told.
describe("a plan payment refunded in Stripe", () => {
  const running = async () => {
    await setPlanLevel({ folderId: "attic", level: "guide", startDay: TODAY });
    await linked();
    fx.invoice = { id: "in_1", parent: { subscription_details: { subscription: "sub_1", metadata: { project_folder_id: "attic" } } } };
  };

  it("is written on the plan under its invoice, and the guides are told", async () => {
    await running();
    expect(await planPaymentRefunded("pi_month", 300000, 300000)).toEqual([{ type: "refunded", folderId: "attic", what: null, refundedCents: 300000, paidCents: 300000 }]);
    expect(plan()?.refunds).toMatchObject({ in_1: { cents: 300000 } });
  });

  it("the same total twice says nothing; a larger total is the new one", async () => {
    await running();
    await planPaymentRefunded("pi_month", 100000, 300000);
    expect(await planPaymentRefunded("pi_month", 100000, 300000)).toEqual([]);
    expect(await planPaymentRefunded("pi_month", 300000, 300000)).toMatchObject([{ refundedCents: 300000 }]);
  });

  it("a payment that paid no invoice is nobody's plan", async () => {
    await running();
    fx.invoice = {};
    expect(await planPaymentRefunded("pi_other", 5000, 5000)).toEqual([]);
  });
});
