/**
 * The one Stripe client (payments seed). Pinned to the API version this
 * SDK ships with, so a Stripe-side default change can't move under us;
 * moving it is a deliberate SDK bump. Endive removed
 * `payment_method_types` from intents; `allowed_payment_method_types`
 * is how a payment is limited to the methods below, in code rather than
 * a dashboard setting someone has to keep in step.
 */
import Stripe from "stripe";
import { lookupKeyFor, type MenuPlan, type PricedKind } from "./billingRules";

export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, appInfo: { name: "O.No" } });
  return client;
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PUBLISHABLE_KEY;
}

/** One-time payments: card (shown first) or a bank transfer. */
export const ONE_TIME_METHODS = ["card", "us_bank_account"] as const;
/** A guide plan's monthly debit: bank transfer (ACH) only. */
export const RECURRING_METHODS = ["us_bank_account"] as const;

/** The active Price behind a menu plan or priced one-time kind, by its
 * lookup key. Throws if the setup script hasn't been run. */
export async function priceFor(item: MenuPlan | PricedKind): Promise<Stripe.Price> {
  const key = lookupKeyFor(item);
  const { data } = await stripe().prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (!data[0]) throw new Error(`No active Stripe price with lookup key ${key}; run fruits/scripts/stripe-setup.ts`);
  return data[0];
}
