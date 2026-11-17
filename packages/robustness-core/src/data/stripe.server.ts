/**
 * The one Stripe client (payments seed). Pinned to the API version this
 * SDK ships with, so a Stripe-side default change can't move under us;
 * moving it is a deliberate SDK bump. Endive removed
 * `payment_method_types` from intents; `allowed_payment_method_types`
 * is how a payment is limited to the methods below, in code rather than
 * a dashboard setting someone has to keep in step.
 */
import Stripe from "stripe";
import { lookupKeyFor, stripeKeyMode, type MenuPlan, type PricedKind, type StripeMode } from "./billingRules";

export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, appInfo: { name: "O.No" } });
  return client;
}

/** Why Stripe can't be used on this server, or null when it can: both
 * keys set, both readable, and both from the same side of Stripe. A live
 * secret key with a test publishable key (or the reverse) would raise
 * payments the form can never confirm. */
export function stripeKeysProblem(env: { STRIPE_SECRET_KEY?: string; STRIPE_PUBLISHABLE_KEY?: string } = process.env): string | null {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY) return "The Stripe keys aren't set";
  const secret = stripeKeyMode(env.STRIPE_SECRET_KEY);
  const publishable = stripeKeyMode(env.STRIPE_PUBLISHABLE_KEY);
  if (!secret || !publishable) return "A Stripe key isn't one this app can read (sk_, rk_ or pk_, test or live)";
  if (secret !== publishable) return `The Stripe secret key is a ${secret} key and the publishable key is a ${publishable} key`;
  return null;
}

export function stripeConfigured(): boolean {
  return stripeKeysProblem() === null;
}

/** The side of Stripe this server's secret key is on. */
export function stripeMode(): StripeMode | null {
  return stripeKeyMode(process.env.STRIPE_SECRET_KEY);
}

/** One-time payments: card (shown first) or a bank transfer. */
export const ONE_TIME_METHODS = ["card", "us_bank_account"] as const;
/** A guide plan's monthly payment: a bank transfer (ACH, shown first) or
 * a card (Austin, 2026-11-17). A credit card pays Stripe's card fee on
 * top (`cardFeeCents`). */
export const RECURRING_METHODS = ["us_bank_account", "card"] as const;

/** The Stripe Product a plan's card fee line is priced under. A fixed id,
 * so the fee line can be told from the plan's own line on a schedule and
 * on an invoice, and made on first use (`stripe-setup.ts` makes it too). */
export const CARD_FEE_PRODUCT_ID = "nopal_card_fee";
let feeProductEnsured = false;
export async function ensureCardFeeProduct(): Promise<string> {
  if (feeProductEnsured) return CARD_FEE_PRODUCT_ID;
  try {
    await stripe().products.retrieve(CARD_FEE_PRODUCT_ID);
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") throw err;
    await stripe()
      .products.create({ id: CARD_FEE_PRODUCT_ID, name: "Credit card fee", metadata: { nopal_item: "card_fee" } })
      .catch((e) => {
        // Two requests at once: the other one made it.
        if ((e as { code?: string }).code !== "resource_already_exists") throw e;
      });
  }
  feeProductEnsured = true;
  return CARD_FEE_PRODUCT_ID;
}

/** The active Price behind a menu plan or priced one-time kind, by its
 * lookup key. Throws if the setup script hasn't been run. */
export async function priceFor(item: MenuPlan | PricedKind): Promise<Stripe.Price> {
  const key = lookupKeyFor(item);
  const { data } = await stripe().prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (!data[0]) throw new Error(`No active Stripe price with lookup key ${key}; run fruits/scripts/stripe-setup.ts`);
  return data[0];
}
