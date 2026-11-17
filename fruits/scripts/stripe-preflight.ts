// Stripe preflight (payments, 2026-11-17). Reads this environment's Stripe
// account and says whether the app would work against it. It changes
// nothing in Stripe and nothing in the database. Run it against the
// sandbox any time, and against live before the first live payment:
// every line must pass before a Fly secret is set.
//
// What it checks, each one a thing a deploy list used to ask a person to
// remember:
//   - both keys are set and from the same side of Stripe
//   - every menu price exists, active, at the amount the menu says, and
//     monthly where it should be
//   - the card fee product exists, and the fee is under the surcharge cap
//     at every plan price
//   - (live, or with --endpoint) a webhook endpoint for the app is
//     enabled and subscribed to exactly the events the app handles
//   - (live) the terms aren't a draft
//
// From fruits/:
//   set -a; source ../.env; set +a
//   npx vite-node scripts/stripe-preflight.ts
//   npx vite-node scripts/stripe-preflight.ts --endpoint https://o.nopal.build/api/stripe/webhook
import { CARD_FEE_PRODUCT_ID, STRIPE_API_VERSION, stripe, stripeKeysProblem, stripeMode } from "robustness-core/data/stripe.server";
import {
  CARD_FEE_CAP_PERCENT,
  HANDLED_STRIPE_EVENTS,
  MENU_PLANS,
  PAYMENT_CATEGORIES,
  cardFeeCents,
  formatUsd,
  lookupKeyFor,
  type MenuPlan,
  type PricedKind,
} from "robustness-core/data/billingRules";
import { PAYMENT_TERMS, termsAreDraft } from "robustness-core/data/billingTerms";

// The menu as the seed decided it. Stripe is where a price lives after
// setup, so a deliberate price change in Stripe shows here as a failed
// line until this is changed to match: that is the point.
const MENU: { key: MenuPlan | PricedKind; cents: number; monthly: boolean }[] = [
  { key: "light_guide", cents: 1_500_00, monthly: true },
  { key: "guide", cents: 3_000_00, monthly: true },
  { key: "deep_guide", cents: 6_000_00, monthly: true },
  { key: "one_hour", cents: 500_00, monthly: false },
  { key: "one_hour_deliverable", cents: 1_500_00, monthly: false },
  { key: "deliverable_upgrade", cents: 1_000_00, monthly: false },
];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
function note(text: string) {
  console.log(`  NOTE ${text}`);
}

async function main() {
  const flag = process.argv.indexOf("--endpoint");
  const endpointUrl = flag > -1 ? process.argv[flag + 1] : null;

  console.log("Keys");
  const problem = stripeKeysProblem();
  check("both keys set, from the same side of Stripe", !problem, problem ?? "");
  if (problem) return;
  const mode = stripeMode();
  const live = mode !== "test";
  console.log(`  Stripe ${live ? "LIVE" : "test"} mode, API ${STRIPE_API_VERSION}`);
  const s = stripe();

  console.log("Prices");
  for (const item of MENU) {
    const key = lookupKeyFor(item.key);
    const { data } = await s.prices.list({ lookup_keys: [key], active: true, limit: 2, expand: ["data.product"] });
    const price = data[0];
    if (!price) {
      check(`${key} exists`, false, "run scripts/stripe-setup.ts");
      continue;
    }
    const monthly = price.recurring?.interval === "month" && (price.recurring.interval_count ?? 1) === 1;
    check(
      `${key} is ${formatUsd(item.cents)}${item.monthly ? " a month" : ", one time"}`,
      price.unit_amount === item.cents && price.currency === "usd" && (item.monthly ? monthly : !price.recurring),
      `${formatUsd(price.unit_amount ?? 0)} ${price.currency}${price.recurring ? ` every ${price.recurring.interval_count ?? 1} ${price.recurring.interval}` : ", one time"}`,
    );
    const product = price.product;
    if (typeof product === "object" && product && !("deleted" in product && product.deleted)) {
      const name = (product as { name: string }).name;
      // The app never shows a Stripe product's name, but Stripe's own
      // receipts and the dashboard do.
      if (/deliverable/i.test(name)) note(`${key}'s product is still named "${name}" in Stripe; the menu calls it a letter`);
    }
  }

  console.log("Card fee");
  const feeProduct = await s.products.retrieve(CARD_FEE_PRODUCT_ID).catch(() => null);
  check(`the ${CARD_FEE_PRODUCT_ID} product exists and is active`, !!feeProduct && feeProduct.active, feeProduct ? "" : "run scripts/stripe-setup.ts");
  for (const level of MENU_PLANS) {
    const cents = MENU.find((m) => m.key === level)!.cents;
    const fee = cardFeeCents(cents, "card", "credit");
    check(`${level}: ${formatUsd(fee)} on ${formatUsd(cents)} is under ${CARD_FEE_CAP_PERCENT}%`, fee > 0 && fee <= (cents * CARD_FEE_CAP_PERCENT) / 100, `${((fee / cents) * 100).toFixed(3)}%`);
  }

  if (live || endpointUrl) {
    console.log("Webhook endpoint");
    const { data: endpoints } = await s.webhookEndpoints.list({ limit: 100 });
    const ours = endpoints.filter((e) => (endpointUrl ? e.url === endpointUrl : e.url.endsWith("/api/stripe/webhook")));
    check("one endpoint for the app", ours.length === 1, ours.length ? ours.map((e) => e.url).join(", ") : `none of ${endpoints.length} endpoint(s) match`);
    for (const e of ours) {
      check(`${e.url} is enabled`, e.status === "enabled", e.status);
      const want = new Set<string>(HANDLED_STRIPE_EVENTS);
      const has = new Set<string>(e.enabled_events);
      const missing = [...want].filter((t) => !has.has(t));
      const extra = has.has("*") ? ["* (every event)"] : [...has].filter((t) => !want.has(t));
      check(`subscribed to the ${want.size} events the app handles`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "");
      check("and to nothing else", extra.length === 0, extra.join(", "));
    }
  } else {
    note("no webhook endpoint check in test mode (a local listener forwards events); pass --endpoint <url> to check one");
  }

  console.log("Terms");
  for (const category of PAYMENT_CATEGORIES) {
    const draft = termsAreDraft(category);
    if (live) check(`${PAYMENT_TERMS[category].title} terms are approved`, !draft, PAYMENT_TERMS[category].version);
    else note(`${PAYMENT_TERMS[category].title}: ${PAYMENT_TERMS[category].version}${draft ? " (a draft: live mode would refuse payments)" : ""}`);
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nPreflight holds." : `\nPreflight FAILED: ${failures} check(s).`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
