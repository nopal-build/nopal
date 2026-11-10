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
}));

vi.mock("robustness-core/data/generic.server", () => {
  const key = (rid: { tb: string; id: unknown }) => `${rid.tb}:${String(rid.id)}`;
  return {
    defineTable: async () => {},
    formatRecord: (r: unknown) => r,
    newRecordId: () => `r${store.size + 1}`,
    query: async (sql: string) => {
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
    invoices: { retrieve: async () => fx.invoice },
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
        phases: [{ start_date: 1, end_date: null, items: [{ price: price("guide") }] }],
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
    RECURRING_METHODS: ["us_bank_account"],
    ONE_TIME_METHODS: ["card", "us_bank_account"],
  };
});

import { applyPlanEvent, approveLevelRequest, approveResume, declineLevelRequest, getPlan, isOnHold, pauseCheck, pausePlan, requestLevel, setPlanLevel } from "robustness-core/data/billingPlans.server";
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
