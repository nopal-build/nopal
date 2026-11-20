// The pause proof (payments seed, chunk B's gate, 2026-11-03). Before any
// plan code is written: does a pause on a flexible-mode subscription
// schedule, set for the renewal, charge nothing for the paused month, and
// does resuming start a new full month from the resume date? The seed's
// code check found this in Stripe's changelog only; this runs it.
//
// Stripe test mode only (refuses a live key). Uses a test clock, so a
// month passes in seconds; deletes the clock (and its customer) at the end.
//
// From fruits/:
//   set -a; source ../.env; set +a
//   npx vite-node scripts/stripe-pause-proof.ts
import { stripe } from "robustness-core/data/stripe.server";
import { priceFor } from "robustness-core/data/stripe.server";

const DAY = 24 * 60 * 60;
const s = stripe();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function advance(clockId: string, to: number) {
  await s.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (let i = 0; i < 120; i++) {
    const clock = await s.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") throw new Error("test clock failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("test clock didn't finish advancing");
}

async function paidInvoices(subscriptionId: string) {
  const { data } = await s.invoices.list({ subscription: subscriptionId, limit: 20 });
  return data.filter((i) => i.status === "paid" && i.amount_paid > 0);
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Test keys only");
  const price = await priceFor("guide");
  const start = Math.floor(Date.now() / 1000);
  const clock = await s.testHelpers.testClocks.create({ frozen_time: start, name: "pause proof" });
  try {
    const customer = await s.customers.create({ test_clock: clock.id, email: "pause-proof@example.com" });
    const pm = await s.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await s.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });

    console.log("1. A Guide plan starts on a flexible-mode schedule");
    let schedule = await s.subscriptionSchedules.create({
      customer: customer.id,
      start_date: "now",
      billing_mode: { type: "flexible" },
      end_behavior: "release",
      phases: [{ items: [{ price: price.id }], duration: { interval: "month", interval_count: 12 } }],
    });
    const subId = typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id;
    if (!subId) throw new Error("schedule made no subscription");
    let sub = await s.subscriptions.retrieve(subId);
    const periodEnd = sub.items.data[0].current_period_end;
    check("subscription active", sub.status === "active", sub.status);
    // Stripe holds a subscription's first invoice as a draft for about an
    // hour before charging it; on a frozen test clock, that hour has to pass.
    await advance(clock.id, start + 2 * 60 * 60);
    const firstPaid = (await paidInvoices(subId)).length;
    check("first month paid", firstPaid === 1, `${firstPaid} paid`);

    console.log("2. Pause at the renewal, no resume date");
    schedule = await s.subscriptionSchedules.update(schedule.id, {
      pause_schedules: [{ pause: { pause_at: { type: "timestamp", timestamp: periodEnd } } }],
    });
    check("pause scheduled", schedule.pause_schedules?.length === 1);

    console.log("3. Time passes: the renewal, then most of the paused month");
    await advance(clock.id, periodEnd + 2 * DAY);
    sub = await s.subscriptions.retrieve(subId);
    check("subscription paused after the renewal", sub.status === "paused", sub.status);
    await advance(clock.id, periodEnd + 25 * DAY);
    check("nothing charged for the paused month", (await paidInvoices(subId)).length === 1);

    console.log("4. Resume now, a new full month from today");
    const resumeAt = periodEnd + 25 * DAY;
    schedule = await s.subscriptionSchedules.retrieve(schedule.id);
    const key = schedule.pause_schedules?.[0]?.key;
    schedule = await s.subscriptionSchedules.update(schedule.id, {
      pause_schedules: [
        {
          ...(key ? { key } : {}),
          pause: { pause_at: { type: "timestamp", timestamp: periodEnd } },
          resume: { resume_at: { type: "now" }, settings: { billing_cycle_anchor: "resume_at" } },
        },
      ],
    });
    await advance(clock.id, resumeAt + 60);
    sub = await s.subscriptions.retrieve(subId);
    check("subscription active again", sub.status === "active", sub.status);
    const anchorDays = Math.round((sub.billing_cycle_anchor - resumeAt) / DAY);
    check("billing anchor moved to the resume date", Math.abs(anchorDays) <= 1, `${anchorDays} days off`);
    check("resume billed one new month", (await paidInvoices(subId)).length === 2);

    console.log("5. The month after resuming bills on the new anchor");
    const nextEnd = sub.items.data[0].current_period_end;
    await advance(clock.id, nextEnd + DAY);
    check("next month billed", (await paidInvoices(subId)).length === 3);
  } finally {
    await s.testHelpers.testClocks.del(clock.id).catch(() => {});
  }
  console.log(failures === 0 ? "\nPause proof holds." : `\nPause proof FAILED: ${failures} check(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
