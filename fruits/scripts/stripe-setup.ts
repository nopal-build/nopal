// Stripe setup, run once per Stripe account (payments seed, 2026-11-02).
// Creates a Product and Price for each menu plan and priced one-time kind,
// found later by lookup key (`lookupKeyFor` in billingRules.ts). A key that
// already has an active Price is left alone, so running it twice is safe
// and an amount someone changed in Stripe is never put back.
//
// The amounts below are the seed's starting menu, written once. After this
// runs, Stripe is where a price lives: change it there (new Price, move the
// lookup key with `transfer_lookup_key`), not here.
//
// From fruits/, with test keys first, then live:
//   set -a; source ../.env; set +a
//   npx vite-node scripts/stripe-setup.ts
import { stripe } from "robustness-core/data/stripe.server";
import {
  lookupKeyFor,
  MENU_PLAN_LABELS,
  ONE_TIME_LABELS,
  formatUsd,
  type MenuPlan,
  type OneTimeKind,
} from "robustness-core/data/billingRules";

type Item =
  | { key: MenuPlan; name: string; cents: number; monthly: true }
  | { key: Exclude<OneTimeKind, "custom">; name: string; cents: number; monthly: false };

const ITEMS: Item[] = [
  { key: "light_guide", name: MENU_PLAN_LABELS.light_guide, cents: 1_500_00, monthly: true },
  { key: "guide", name: MENU_PLAN_LABELS.guide, cents: 3_000_00, monthly: true },
  { key: "deep_guide", name: MENU_PLAN_LABELS.deep_guide, cents: 6_000_00, monthly: true },
  { key: "one_hour", name: ONE_TIME_LABELS.one_hour, cents: 500_00, monthly: false },
  { key: "one_hour_deliverable", name: ONE_TIME_LABELS.one_hour_deliverable, cents: 1_500_00, monthly: false },
  { key: "deliverable_upgrade", name: ONE_TIME_LABELS.deliverable_upgrade, cents: 1_000_00, monthly: false },
];

async function main() {
  const s = stripe();
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Stripe ${mode} mode`);

  for (const item of ITEMS) {
    const lookupKey = lookupKeyFor(item.key);
    const { data } = await s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (data[0]) {
      console.log(`  ${lookupKey}: exists (${formatUsd(data[0].unit_amount ?? 0)}), left alone`);
      continue;
    }
    const product = await s.products.create({ name: item.name, metadata: { nopal_item: item.key } });
    const price = await s.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: item.cents,
      lookup_key: lookupKey,
      ...(item.monthly ? { recurring: { interval: "month" as const } } : {}),
    });
    console.log(`  ${lookupKey}: created ${price.id} (${formatUsd(item.cents)}${item.monthly ? "/month" : ""})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
