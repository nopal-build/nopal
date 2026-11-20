// Stripe webhook → charge rows (payments seed, 2026-11-02). Gates:
//   - a signed event is applied; an unsigned or tampered one is a 400 and
//     writes nothing (the real SDK checks the signature, offline)
//   - the status written is the one Stripe returns on a re-read, never the
//     event's own snapshot, so late or out-of-order events land the same
//   - a duplicate event is ignored
//   - a failure leaves the event unmarked, so Stripe's retry applies it
//
// The events are hand-built in Stripe's shape. Swap in ones recorded with
// `stripe listen` once test keys exist.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const canceledIds = vi.hoisted(() => [] as string[]);
const retrieve = vi.hoisted(() => ({ fn: (_id: string): Promise<unknown> => Promise.reject(new Error("unset")) }));
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
});

vi.mock("robustness-core/data/generic.server", () => {
  const key = (rid: { tb: string; id: unknown }) => `${rid.tb}:${String(rid.id)}`;
  return {
    defineTable: async () => {},
    query: async () => [[]],
    formatRecord: (r: unknown) => r,
    newRecordId: () => `r${store.size + 1}`,
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

vi.mock("robustness-core/data/stripe.server", async () => {
  const actual = await vi.importActual<typeof import("robustness-core/data/stripe.server")>(
    "robustness-core/data/stripe.server",
  );
  const real = actual.stripe();
  const fake = {
    webhooks: real.webhooks,
    paymentIntents: {
      retrieve: (id: string) => retrieve.fn(id),
      cancel: async (id: string) => {
        canceledIds.push(id);
        return { id, status: "canceled" };
      },
    },
  };
  return { ...actual, stripe: () => fake };
});

vi.mock("../data/billingNotices.server", () => ({ sendPlanNotices: async () => {} }));

import { applyStripeEvent } from "robustness-core/data/billing.server";
import { stripe } from "robustness-core/data/stripe.server";
import { action } from "../routes/api.stripe.webhook";

type PiStatus = "requires_payment_method" | "processing" | "succeeded" | "canceled";

/** Sue's own intent on the bill, or (`payer: "tom"`) the other Client's. */
function pi(status: PiStatus, opts: { chargeId?: string | null; failed?: boolean; payer?: "sue" | "tom" } = {}) {
  const chargeId = opts.chargeId === undefined ? "sue1" : opts.chargeId;
  const payer = opts.payer ?? "sue";
  return {
    id: `pi_${payer}`,
    object: "payment_intent",
    status,
    amount: 1_000_00,
    currency: "usd",
    metadata: chargeId
      ? { charge_id: chargeId, payer_human_id: payer, terms_category: "service", terms_version: "v-test" }
      : {},
    last_payment_error: opts.failed ? { code: "payment_method_provider_decline" } : null,
  };
}

function event(id: string, type: string, object: unknown) {
  return { id, object: "event", type, created: 1_793_000_000, livemode: false, data: { object } } as never;
}

/** Stripe answers every re-read with these PaymentIntents, by id. */
function stripeSays(...intents: ReturnType<typeof pi>[]) {
  retrieve.fn = async (id) => intents.find((i) => i.id === id) ?? intents[0];
}

const charge = () => store.get("billing_charges:sue1");
const marked = (eventId: string) => store.has(`stripe_events:${eventId}`);

beforeEach(() => {
  store.clear();
  canceledIds.length = 0;
  // A bill on a project with two Clients, Sue and Tom, both of whom
  // opened the pay page (each has their own intent). Nobody has paid.
  store.set("billing_charges:sue1", {
    project_folder_id: "madison-attic",
    kind: "custom",
    category: "service",
    label: "Report",
    amount_cents: 1_000_00,
    status: "open",
    terms_version: "v-raised",
    payment_intents: { sue: "pi_sue", tom: "pi_tom" },
    stripe_payment_intent_id: null,
    paid_by_human_id: null,
    accepted_at: null,
    paid_at: null,
  });
});

describe("applyStripeEvent", () => {
  it("marks a charge paid from Stripe's re-read, not the event's snapshot", async () => {
    stripeSays(pi("succeeded"));
    expect((await applyStripeEvent(event("evt_1", "payment_intent.processing", pi("processing")))).applied).toBe(true);
    expect(charge()?.status).toBe("paid");
    expect(charge()?.paid_at).toBeTruthy();
    expect(marked("evt_1")).toBe(true);
  });

  it("holds an ACH debit as processing until it settles", async () => {
    stripeSays(pi("processing"));
    await applyStripeEvent(event("evt_1", "payment_intent.processing", pi("processing")));
    expect(charge()?.status).toBe("processing");
    expect(charge()?.paid_at).toBeNull();
  });

  it("marks a returned or declined payment failed, so the pay link works again", async () => {
    stripeSays(pi("requires_payment_method", { failed: true }));
    await applyStripeEvent(event("evt_1", "payment_intent.payment_failed", pi("requires_payment_method")));
    expect(charge()?.status).toBe("failed");
  });

  it("ignores an event it already handled", async () => {
    stripeSays(pi("succeeded"));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")));
    store.set("billing_charges:sue1", { ...charge(), status: "open" });
    expect((await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")))).applied).toBe(false);
    expect(charge()?.status).toBe("open");
  });

  it("keeps the first paid date when a late event repeats the payment", async () => {
    stripeSays(pi("succeeded"));
    store.set("billing_charges:sue1", { ...charge(), status: "paid", paid_at: "2026-11-02T10:00:00.000Z" });
    await applyStripeEvent(event("evt_2", "payment_intent.succeeded", pi("succeeded")));
    expect(charge()?.paid_at).toBe("2026-11-02T10:00:00.000Z");
  });

  it("an older event arriving last can't undo a payment", async () => {
    stripeSays(pi("succeeded"));
    await applyStripeEvent(event("evt_2", "payment_intent.succeeded", pi("succeeded")));
    await applyStripeEvent(event("evt_1", "payment_intent.processing", pi("processing")));
    expect(charge()?.status).toBe("paid");
  });

  it("leaves rows alone for a PaymentIntent that isn't a charge, and still marks the event", async () => {
    stripeSays(pi("succeeded", { chargeId: null }));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded", { chargeId: null })));
    expect(charge()?.status).toBe("open");
    expect(marked("evt_1")).toBe(true);
  });

  it("marks an event type it doesn't handle without calling Stripe", async () => {
    retrieve.fn = async () => {
      throw new Error("should not be called");
    };
    expect((await applyStripeEvent(event("evt_1", "customer.created", { id: "cus_1" }))).applied).toBe(true);
    expect(marked("evt_1")).toBe(true);
  });

  it("leaves a failed event unmarked so Stripe's retry applies it", async () => {
    retrieve.fn = async () => {
      throw new Error("Stripe is down");
    };
    await expect(applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")))).rejects.toThrow();
    expect(marked("evt_1")).toBe(false);

    stripeSays(pi("succeeded"));
    expect((await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")))).applied).toBe(true);
    expect(charge()?.status).toBe("paid");
  });
});

describe("a bill any Client on the project may pay", () => {
  it("records who paid and the terms version they accepted", async () => {
    stripeSays(pi("succeeded"), pi("requires_payment_method", { payer: "tom" }));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")));
    expect(charge()?.paid_by_human_id).toBe("sue");
    expect(charge()?.terms_version).toBe("v-test");
    expect(charge()?.accepted_at).toBeTruthy();
    expect(charge()?.stripe_payment_intent_id).toBe("pi_sue");
  });

  it("closes the other Client's intent once one pays", async () => {
    stripeSays(pi("succeeded"), pi("requires_payment_method", { payer: "tom" }));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")));
    expect(canceledIds).toEqual(["pi_tom"]);
  });

  it("keeps the first payer when a second payment lands on a paid bill", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripeSays(pi("succeeded"), pi("succeeded", { payer: "tom" }));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")));
    await applyStripeEvent(event("evt_2", "payment_intent.succeeded", pi("succeeded", { payer: "tom" })));
    expect(charge()?.paid_by_human_id).toBe("sue");
    expect(charge()?.stripe_payment_intent_id).toBe("pi_sue");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("paid twice"));
  });

  it("a returned bank transfer makes the bill payable again", async () => {
    stripeSays(pi("processing"));
    await applyStripeEvent(event("evt_1", "payment_intent.processing", pi("processing")));
    expect(charge()?.status).toBe("processing");
    stripeSays(pi("requires_payment_method", { failed: true }));
    await applyStripeEvent(event("evt_2", "payment_intent.payment_failed", pi("requires_payment_method")));
    expect(charge()?.status).toBe("failed");
  });

  it("another Client's failed try doesn't touch a bill being paid", async () => {
    stripeSays(pi("processing"), pi("requires_payment_method", { payer: "tom", failed: true }));
    await applyStripeEvent(event("evt_1", "payment_intent.processing", pi("processing")));
    await applyStripeEvent(event("evt_2", "payment_intent.payment_failed", pi("requires_payment_method", { payer: "tom" })));
    expect(charge()?.status).toBe("processing");
  });

  it("an intent closed because someone else paid changes nothing", async () => {
    stripeSays(pi("succeeded"), pi("canceled", { payer: "tom" }));
    await applyStripeEvent(event("evt_1", "payment_intent.succeeded", pi("succeeded")));
    await applyStripeEvent(event("evt_2", "payment_intent.canceled", pi("canceled", { payer: "tom" })));
    expect(charge()?.status).toBe("paid");
  });
});

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const body = JSON.stringify(event("evt_http", "payment_intent.succeeded", pi("succeeded")));

  async function post(payload: string, signature: string | null) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signature) headers["stripe-signature"] = signature;
    const request = new Request("http://localhost/api/stripe/webhook", { method: "POST", headers, body: payload });
    return (await action({ request, params: {}, context: {} } as never)) as Response;
  }

  const sign = (payload: string, secret = "whsec_unit") =>
    stripe().webhooks.generateTestHeaderStringAsync({ payload, secret });

  it("applies a signed event", async () => {
    stripeSays(pi("succeeded"));
    const res = await post(body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, applied: true });
    expect(charge()?.status).toBe("paid");
  });

  it("refuses an unsigned event and writes nothing", async () => {
    expect((await post(body, null)).status).toBe(400);
    expect(charge()?.status).toBe("open");
    expect(marked("evt_http")).toBe(false);
  });

  it("refuses a body changed after signing", async () => {
    const signature = await sign(body);
    const res = await post(body.replace("evt_http", "evt_forged"), signature);
    expect(res.status).toBe(400);
    expect(marked("evt_forged")).toBe(false);
  });

  it("refuses an event signed with another secret", async () => {
    expect((await post(body, await sign(body, "whsec_other"))).status).toBe(400);
  });

  it("answers 500 when applying fails, so Stripe retries", async () => {
    retrieve.fn = async () => {
      throw new Error("Stripe is down");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(body, await sign(body))).status).toBe(500);
    expect(marked("evt_http")).toBe(false);
  });
});
