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
 * - `billing_charges` — a one-time charge a guide raised on a project
 *   (the one-hour service, the deliverable upgrade, or an amount typed
 *   in). Each is its own pay link the client approves; nothing here ever
 *   charges a saved payment method off-session (cards.md: a stored
 *   mandate is not an authorization for a debit outside the pattern).
 * - `stripe_events:<eventId>` — events already handled.
 *
 * Who may raise, see or pay a charge is the routes' to check.
 */
import { RecordId } from "surrealdb";
import type Stripe from "stripe";
import { defineTable, formatRecord, merge, newRecordId, query, select, upsert, type Data } from "./generic.server";
import { ONE_TIME_LABELS, type OneTimeKind } from "./billingRules";
import { ONE_TIME_METHODS, priceFor, stripe } from "./stripe.server";

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

export type BillingCharge = Data & {
  _id: string;
  project_folder_id: string;
  payer_human_id: string;
  created_by: string;
  kind: OneTimeKind;
  label: string;
  amount_cents: number;
  status: ChargeStatus;
  stripe_payment_intent_id: string | null;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

/** Raise a one-time charge. A priced kind takes its amount from Stripe
 * now; `custom` takes the amount the guide typed. */
export async function createCharge(input: {
  projectFolderId: string;
  payerHumanId: string;
  createdBy: string;
  kind: OneTimeKind;
  customAmountCents?: number | null;
  note?: string | null;
}): Promise<BillingCharge> {
  await ensureTables();
  let amount: number;
  if (input.kind === "custom") {
    if (!input.customAmountCents) throw new Error("A custom charge needs an amount");
    amount = input.customAmountCents;
  } else {
    const price = await priceFor(input.kind);
    if (price.unit_amount == null) throw new Error(`Price ${price.id} has no unit amount`);
    amount = price.unit_amount;
  }
  const now = new Date().toISOString();
  const id = newRecordId();
  const row = {
    project_folder_id: input.projectFolderId,
    payer_human_id: input.payerHumanId,
    created_by: input.createdBy,
    kind: input.kind,
    label: input.note?.trim() || ONE_TIME_LABELS[input.kind],
    amount_cents: amount,
    status: "open" as ChargeStatus,
    stripe_payment_intent_id: null,
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
  return (
    await rows<BillingCharge>(`SELECT * FROM ${CHARGES} WHERE project_folder_id = $projectFolderId`, { projectFolderId })
  ).sort(newestFirst);
}

export async function listChargesForPayer(payerHumanId: string): Promise<BillingCharge[]> {
  return (await rows<BillingCharge>(`SELECT * FROM ${CHARGES} WHERE payer_human_id = $payerHumanId`, { payerHumanId })).sort(
    newestFirst,
  );
}

/** Withdraw a charge nobody has paid. Refused once money is moving. */
export async function cancelCharge(charge: BillingCharge): Promise<void> {
  if (charge.status !== "open" && charge.status !== "failed") {
    throw new Error("Only an unpaid charge can be withdrawn");
  }
  if (charge.stripe_payment_intent_id) {
    const pi = await stripe().paymentIntents.retrieve(charge.stripe_payment_intent_id);
    if (pi.status === "processing" || pi.status === "succeeded") {
      await syncChargeFromPaymentIntent(pi);
      throw new Error("That charge is already being paid");
    }
    if (pi.status !== "canceled") await stripe().paymentIntents.cancel(pi.id);
  }
  await merge(CHARGES, charge._id, { status: "canceled", updated_at: new Date().toISOString() });
}

/** The client secret the pay page hands Stripe's form: the charge's
 * PaymentIntent, made on first open. The client confirms it in the form,
 * which is the authorization; the server never confirms it. */
export async function paymentIntentSecretFor(
  charge: BillingCharge,
  payer: { _id: string; email: string; name?: string | null },
): Promise<string> {
  if (charge.stripe_payment_intent_id) {
    const pi = await stripe().paymentIntents.retrieve(charge.stripe_payment_intent_id);
    if (pi.client_secret && pi.status !== "canceled" && pi.status !== "succeeded") return pi.client_secret;
    throw new Error("This charge can no longer be paid");
  }
  const customer = await ensureCustomer(payer);
  const pi = await stripe().paymentIntents.create(
    {
      amount: charge.amount_cents,
      currency: "usd",
      customer,
      description: charge.label,
      allowed_payment_method_types: [...ONE_TIME_METHODS],
      metadata: { charge_id: charge._id, project_folder_id: charge.project_folder_id, payer_human_id: charge.payer_human_id },
    },
    { idempotencyKey: `charge-${charge._id}` },
  );
  await merge(CHARGES, charge._id, { stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() });
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

async function syncChargeFromPaymentIntent(pi: Stripe.PaymentIntent): Promise<void> {
  const chargeId = pi.metadata?.charge_id;
  if (!chargeId) return;
  const charge = await getCharge(chargeId);
  if (!charge) return;
  const status = chargeStatusFor(pi);
  await merge(CHARGES, charge._id, {
    status,
    stripe_payment_intent_id: pi.id,
    paid_at: status === "paid" ? (charge.paid_at ?? new Date().toISOString()) : charge.paid_at,
    updated_at: new Date().toISOString(),
  });
}

/** Re-read a charge's PaymentIntent and save its status, for the pay
 * page after Stripe sends the client back (the webhook may not be in yet). */
export async function refreshCharge(charge: BillingCharge): Promise<BillingCharge> {
  if (!charge.stripe_payment_intent_id) return charge;
  await syncChargeFromPaymentIntent(await stripe().paymentIntents.retrieve(charge.stripe_payment_intent_id));
  return (await getCharge(charge._id)) ?? charge;
}

// ─── Webhook events ─────────────────────────────────────────────────────

/** Apply one verified Stripe event. Returns false for an event already
 * handled. Every handler re-reads its object from Stripe, so the event's
 * own snapshot never decides anything. */
export async function applyStripeEvent(event: Stripe.Event): Promise<boolean> {
  await ensureTables();
  const seen = await select(new RecordId(EVENTS, event.id));
  if (seen) return false;

  switch (event.type) {
    case "payment_intent.processing":
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const pi = await stripe().paymentIntents.retrieve((event.data.object as Stripe.PaymentIntent).id);
      await syncChargeFromPaymentIntent(pi);
      break;
    }
    default:
      break;
  }

  // Marked after the work, so a failure above leaves it for Stripe's retry.
  await upsert(new RecordId(EVENTS, event.id), { type: event.type, handled_at: new Date().toISOString() });
  return true;
}
