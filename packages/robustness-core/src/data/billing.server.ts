/**
 * What O.No keeps about billing (payments seed, Austin 2026-10-06:
 * "clients pay through our own billing instead of invoices sent by
 * hand").
 *
 * Stripe is the record of money. These rows only say which Stripe
 * objects belong to which person and project, and the status last read
 * from Stripe, so a page can show it without a Stripe call. Every
 * webhook re-reads the object from Stripe before writing, so events
 * arriving late, twice or out of order land the same.
 *
 * Three tables:
 * - `billing_customers:<humanId>` — the Stripe customer for a person who
 *   pays. One per person, reused across every project they pay for.
 * - `billing_charges` — a one-time bill a guide raised on a project
 *   (the one-hour service, the deliverable upgrade, another service or
 *   reimbursed costs). Any Client on the project pays it with their own
 *   approval; nothing here ever
 *   charges a saved payment method off-session (cards.md: a stored
 *   mandate is not an authorization for a debit outside the pattern).
 * - `stripe_events:<eventId>` — events already handled.
 *
 * Who may raise, see or pay a charge is the routes' to check.
 */
import { RecordId } from "surrealdb";
import type Stripe from "stripe";
import { defineTable, formatRecord, merge, newRecordId, query, select, upsert, type Data } from "./generic.server";
import { categoryFor, discounted, hasTypedAmount, type OneTimeKind } from "./billingRules";
import { assertTermsUsable, termsFor } from "./billingTerms";
import { ONE_TIME_METHODS, priceFor, stripe } from "./stripe.server";
import { applyPlanEvent, type PlanNotice } from "./billingPlans.server";

const CUSTOMERS = "billing_customers";
const CHARGES = "billing_charges";
const EVENTS = "stripe_events";

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  // The profile reads charges before any exist; SurrealDB errors on a
  // table it has never seen.
  await Promise.all([defineTable(CUSTOMERS), defineTable(CHARGES), defineTable(EVENTS)]);
  tablesEnsured = true;
}

async function rows<T extends Data>(sql: string, vars: Record<string, unknown>): Promise<T[]> {
  await ensureTables();
  const result = await query<[T[]]>(sql, vars);
  return (result?.[0] ?? []).map((r) => formatRecord(r));
}

// ─── Customers ──────────────────────────────────────────────────────────

type CustomerRow = Data & { _id: string; stripe_customer_id: string; created_at: string };

/** The Stripe customer for this person, made on first need. */
export async function ensureCustomer(payer: { _id: string; email: string; name?: string | null }): Promise<string> {
  await ensureTables();
  const existing = await select<CustomerRow>(new RecordId(CUSTOMERS, payer._id));
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const customer = await stripe().customers.create(
    { email: payer.email, name: payer.name || undefined, metadata: { human_id: payer._id } },
    // Two tabs opening the pay page at once make one customer, not two.
    { idempotencyKey: `customer-${payer._id}` },
  );
  await upsert(new RecordId(CUSTOMERS, payer._id), {
    stripe_customer_id: customer.id,
    created_at: new Date().toISOString(),
  });
  return customer.id;
}

// ─── One-time charges ───────────────────────────────────────────────────

export type ChargeStatus = "open" | "processing" | "paid" | "failed" | "canceled";

/** A bill on a project. Any Client on the project may pay it (Austin,
 * 2026-11-03), so it names no payer up front: each Client who opens it
 * gets their own PaymentIntent (`payment_intents`, keyed by human), and
 * the one that pays is recorded with who paid and the terms they agreed
 * to. */
export type BillingCharge = Data & {
  _id: string;
  project_folder_id: string;
  created_by: string;
  kind: OneTimeKind;
  category: "service" | "reimbursement";
  label: string;
  /** What the client pays: the price less any discount. */
  amount_cents: number;
  /** The price before the guide's discount, on a priced kind with one. */
  list_amount_cents?: number | null;
  discount_percent?: number | null;
  status: ChargeStatus;
  terms_version: string;
  /** humanId → PaymentIntent id, one per Client who opened the bill. */
  payment_intents: Record<string, string>;
  /** The intent that paid, or is paying. */
  stripe_payment_intent_id: string | null;
  paid_by_human_id: string | null;
  /** When the payer accepted the terms, which is when they paid. */
  accepted_at: string | null;
  /** Receipts or PDFs from the project the guide attached: what the
   * Client sees behind the amount. Names are kept as they were then. */
  attachments?: ChargeAttachment[];
  /** When the daily check put the project's work on hold for this bill. */
  hold_notified_at?: string | null;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

export type ChargeAttachment = { fileId: string; name: string; contentType: string };

/** Raise a bill. A priced kind takes its amount from Stripe now; a
 * typed-amount kind takes what the guide typed. */
export async function createCharge(input: {
  projectFolderId: string;
  createdBy: string;
  kind: OneTimeKind;
  typedAmountCents?: number | null;
  note?: string | null;
  /** Off a priced kind only; a typed amount is already what the guide means. */
  discountPercent?: number | null;
  attachments?: ChargeAttachment[];
}): Promise<BillingCharge> {
  await ensureTables();
  // The guide always says what the bill is for, in the client's words
  // (Austin, 2026-11-03: "One-hour decision" alone is vague).
  const label = input.note?.trim();
  if (!label) throw new Error("Say what the bill is for");
  const category = categoryFor(input.kind);
  assertTermsUsable(category);
  let amount: number;
  let list: number | null = null;
  let discount: number | null = null;
  if (hasTypedAmount(input.kind)) {
    if (!input.typedAmountCents) throw new Error("This kind of bill needs an amount");
    amount = input.typedAmountCents;
  } else {
    const price = await priceFor(input.kind);
    if (price.unit_amount == null) throw new Error(`Price ${price.id} has no unit amount`);
    discount = input.discountPercent || null;
    list = discount ? price.unit_amount : null;
    amount = discounted(price.unit_amount, discount);
  }
  const now = new Date().toISOString();
  const id = newRecordId();
  const row = {
    project_folder_id: input.projectFolderId,
    created_by: input.createdBy,
    kind: input.kind,
    category,
    label,
    amount_cents: amount,
    list_amount_cents: list,
    discount_percent: discount,
    status: "open" as ChargeStatus,
    terms_version: termsFor(category).version,
    payment_intents: {} as Record<string, string>,
    stripe_payment_intent_id: null,
    paid_by_human_id: null,
    accepted_at: null,
    attachments: input.attachments ?? [],
    created_at: now,
    paid_at: null,
    updated_at: now,
  };
  await upsert(new RecordId(CHARGES, id), row);
  return { id: { tb: CHARGES, id }, _id: id, ...row };
}

export async function getCharge(id: string): Promise<BillingCharge | null> {
  await ensureTables();
  return (await select<BillingCharge>(new RecordId(CHARGES, id))) ?? null;
}

const newestFirst = (a: BillingCharge, b: BillingCharge) => b.created_at.localeCompare(a.created_at);

export async function listChargesForProject(projectFolderId: string): Promise<BillingCharge[]> {
  return listChargesForProjects([projectFolderId]);
}

export async function listChargesForProjects(projectFolderIds: string[]): Promise<BillingCharge[]> {
  if (projectFolderIds.length === 0) return [];
  return (
    await rows<BillingCharge>(`SELECT * FROM ${CHARGES} WHERE project_folder_id IN $projectFolderIds`, { projectFolderIds })
  ).sort(newestFirst);
}

export function isPayable(charge: Pick<BillingCharge, "status">): boolean {
  return charge.status === "open" || charge.status === "failed";
}

/** Withdraw a bill nobody has paid. Refused once money is moving. */
export async function cancelCharge(charge: BillingCharge): Promise<void> {
  if (!isPayable(charge)) throw new Error("Only an unpaid payment can be removed");
  for (const piId of Object.values(charge.payment_intents ?? {})) {
    const pi = await stripe().paymentIntents.retrieve(piId);
    if (pi.status === "processing" || pi.status === "succeeded") {
      await syncChargeFromPaymentIntent(pi);
      throw new Error("That bill is already being paid");
    }
    if (pi.status !== "canceled") await stripe().paymentIntents.cancel(pi.id);
  }
  await merge(CHARGES, charge._id, { status: "canceled", updated_at: new Date().toISOString() });
}

/** The client secret the pay page hands Stripe's form: this payer's own
 * PaymentIntent on the bill, made on their first open. The client
 * confirms it in the form, which is both the payment authorization and
 * the acceptance of the terms; the server never confirms it. */
export async function paymentIntentSecretFor(
  charge: BillingCharge,
  payer: { _id: string; email: string; name?: string | null },
): Promise<string> {
  // The terms shown are the current text; an intent made under older
  // terms is replaced, so the version recorded is the one they read.
  const termsVersion = termsFor(charge.category ?? categoryFor(charge.kind)).version;
  const existing = charge.payment_intents?.[payer._id];
  if (existing) {
    const pi = await stripe().paymentIntents.retrieve(existing);
    const usable = pi.client_secret && pi.status !== "canceled" && pi.status !== "succeeded";
    if (usable && pi.metadata?.terms_version === termsVersion) return pi.client_secret!;
    if (usable) await stripe().paymentIntents.cancel(pi.id);
  }
  const customer = await ensureCustomer(payer);
  const pi = await stripe().paymentIntents.create(
    {
      amount: charge.amount_cents,
      currency: "usd",
      customer,
      description: charge.label,
      allowed_payment_method_types: [...ONE_TIME_METHODS],
      metadata: {
        charge_id: charge._id,
        project_folder_id: charge.project_folder_id,
        payer_human_id: payer._id,
        terms_category: charge.category ?? categoryFor(charge.kind),
        terms_version: termsVersion,
      },
    },
    // A canceled or spent intent gets a fresh key, so a retry after a
    // failure isn't handed the dead one back.
    { idempotencyKey: `charge-${charge._id}-${payer._id}-${existing ?? "first"}` },
  );
  await merge(CHARGES, charge._id, {
    payment_intents: { ...(charge.payment_intents ?? {}), [payer._id]: pi.id },
    updated_at: new Date().toISOString(),
  });
  if (!pi.client_secret) throw new Error("Stripe returned no client secret");
  return pi.client_secret;
}

/** A PaymentIntent's state, as a charge status. */
export function chargeStatusFor(pi: Pick<Stripe.PaymentIntent, "status" | "last_payment_error">): ChargeStatus {
  switch (pi.status) {
    case "succeeded":
      return "paid";
    case "processing":
      return "processing";
    case "canceled":
      return "canceled";
    default:
      // Back to needing a payment method after a try: the try failed.
      return pi.last_payment_error ? "failed" : "open";
  }
}

/** Returns a notice the first time a bill is paid or starts paying, so the
 * payer gets a confirmation and the guide hears (Austin, 2026-11-03). */
async function syncChargeFromPaymentIntent(pi: Stripe.PaymentIntent): Promise<PlanNotice[]> {
  const chargeId = pi.metadata?.charge_id;
  if (!chargeId) return [];
  const charge = await getCharge(chargeId);
  if (!charge) return [];
  const status = chargeStatusFor(pi);
  const now = new Date().toISOString();
  const isActive = charge.stripe_payment_intent_id === pi.id;

  if (status === "paid" || status === "processing") {
    if (charge.stripe_payment_intent_id && !isActive && (charge.status === "paid" || charge.status === "processing")) {
      // Two Clients paid the same bill. Stripe holds both payments; one
      // needs refunding by hand in Stripe's dashboard.
      console.error(`billing: charge ${charge._id} paid twice (${charge.stripe_payment_intent_id} and ${pi.id})`);
      return [];
    }
    const firstNews = charge.status !== "paid" && charge.status !== "processing";
    await merge(CHARGES, charge._id, {
      status,
      stripe_payment_intent_id: pi.id,
      paid_by_human_id: pi.metadata?.payer_human_id ?? null,
      terms_version: pi.metadata?.terms_version ?? charge.terms_version,
      accepted_at: isActive && charge.accepted_at ? charge.accepted_at : now,
      paid_at: status === "paid" ? (charge.paid_at ?? now) : null,
      updated_at: now,
    });
    // The other Clients' intents on this bill can't be paid now.
    for (const [human, otherId] of Object.entries(charge.payment_intents ?? {})) {
      if (otherId === pi.id) continue;
      try {
        const other = await stripe().paymentIntents.retrieve(otherId);
        if (other.status !== "canceled" && other.status !== "succeeded" && other.status !== "processing") {
          await stripe().paymentIntents.cancel(otherId);
        }
      } catch (err) {
        console.warn(`billing: couldn't close ${human}'s intent ${otherId} on ${charge._id}`, err);
      }
    }
    const payer = pi.metadata?.payer_human_id ?? null;
    return firstNews && payer
      ? [{ type: "charge_paid", folderId: charge.project_folder_id, chargeId: charge._id, payerId: payer, clearing: status === "processing", wasHeld: !!charge.hold_notified_at }]
      : [];
  }

  if (status === "failed" && (isActive || isPayable(charge))) {
    // A card decline, or a bank transfer that came back: payable again.
    await merge(CHARGES, charge._id, { status: "failed", paid_at: null, updated_at: now });
  }
  // `canceled` is written by `cancelCharge` itself; an intent closed
  // because someone else paid changes nothing.
  return [];
}

/** Re-read one of a bill's PaymentIntents and save what it says, for the
 * pay page after Stripe sends the client back (the webhook may not be in
 * yet). Only an intent that belongs to this bill is read. */
export async function refreshCharge(charge: BillingCharge, paymentIntentId: string): Promise<BillingCharge> {
  if (!Object.values(charge.payment_intents ?? {}).includes(paymentIntentId)) return charge;
  await syncChargeFromPaymentIntent(await stripe().paymentIntents.retrieve(paymentIntentId));
  return (await getCharge(charge._id)) ?? charge;
}

// ─── Webhook events ─────────────────────────────────────────────────────

/** Apply one verified Stripe event. `applied` is false for an event
 * already handled; `notices` is what the app should email about (plan
 * events only). Every handler re-reads its object from Stripe, so the
 * event's own snapshot never decides anything. */
export async function applyStripeEvent(event: Stripe.Event): Promise<{ applied: boolean; notices: PlanNotice[] }> {
  await ensureTables();
  const seen = await select(new RecordId(EVENTS, event.id));
  if (seen) return { applied: false, notices: [] };
  let notices: PlanNotice[] = [];

  switch (event.type) {
    case "payment_intent.processing":
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const pi = await stripe().paymentIntents.retrieve((event.data.object as Stripe.PaymentIntent).id);
      notices = await syncChargeFromPaymentIntent(pi);
      break;
    }
    default:
      notices = await applyPlanEvent(event);
      break;
  }

  // Marked after the work, so a failure above leaves it for Stripe's retry.
  await upsert(new RecordId(EVENTS, event.id), { type: event.type, handled_at: new Date().toISOString() });
  return { applied: true, notices };
}
