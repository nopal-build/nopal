// The billing walk (payments seed, 2026-11-03). Gates the money paths end
// to end on the dev stack, with Stripe in test mode and its events going
// through the real webhook (`stripe listen` forwarding to the app):
//   1. A bill on a project with two Clients: both get the email; a signed
//      link opens the pay page with no login, and not for the guide; the
//      second Client pays; the bill records who paid; the other Client's
//      intent closes.
//   2. A Guide plan: the guide's pick waits; a Client links a bank account;
//      one schedule starts, bank transfer only; the first $3,000 debit pays.
//   3. A plan change inside the 7-day notice waits a period longer.
//   4. Pause at renewal charges nothing; resume moves the billing anchor.
//   5. A bank account that fails: the guide hears once Stripe stops retrying.
//   6. Cancel ends the plan at the period's end.
// A Client's confirmations (paying, linking the bank) are made here with
// Stripe's test card and test bank account, standing in for the form.
//
// It seeds its own project and two test Clients (pulled data has only
// real people) and removes them, the Stripe test clock and every billing
// row it made at the end.
//
// From fruits/, with the dev stack up and the listener running:
//   set -a; source ../.env; set +a; unset SESSION_SECRET
//   DATABASE_USERNAME=root DATABASE_PASSWORD=root SMTP_HOST=localhost SMTP_PORT=1025 \
//     npx vite-node scripts/billing-walk.ts
import { RecordId } from "surrealdb";
import { query, upsert } from "robustness-core/data/generic.server";
import { createHuman, deleteHuman, getHumanById, type Human } from "robustness-core/data/humans.server";
import { getProjectRole, writeProjectSharing } from "robustness-core/data/projectSharing.server";
import { projectHold } from "robustness-core/data/planHold.server";
import { createVaultFolder, deleteVaultFolderCascade, ensureVaultRootFolders } from "robustness-core/data/vault.server";
import { createCharge, getCharge, paymentIntentSecretFor } from "robustness-core/data/billing.server";
import {
  approveResume,
  cancelPlan,
  changePlan,
  getPlan,
  isOnHold,
  listPlanInvoices,
  pauseCheck,
  pausePlan,
  requestResume,
  setPlanLevel,
  setupIntentSecretFor,
  type BillingPlan,
} from "robustness-core/data/billingPlans.server";
import { stripe } from "robustness-core/data/stripe.server";
import { dayIn, firstBillingTime } from "robustness-core/data/billingRules";
import { sendPaymentRequest, signedPayLink } from "../app/data/payments.server";
import { sendPlanNotices } from "../app/data/billingNotices.server";

const APP = process.env.WALK_APP ?? "http://localhost:3001";
const MAILPIT = "http://localhost:8025";
const DAY = 86400;
const s = stripe();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function until<T>(label: string, read: () => Promise<T>, done: (v: T) => boolean, seconds = 60): Promise<T> {
  let v = await read();
  for (let i = 0; i < seconds && !done(v); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    v = await read();
  }
  if (!done(v)) console.log(`  (gave up waiting: ${label})`);
  return v;
}

async function advance(clockId: string, to: number) {
  await s.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  await until(
    "clock",
    () => s.testHelpers.testClocks.retrieve(clockId),
    (c) => c.status === "ready",
    180,
  );
}

async function mailTo(email: string, subjectPart: string): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  const body = (await res.json()) as { messages: { To: { Address: string }[]; Subject: string }[] };
  return body.messages.filter((m) => m.To.some((t) => t.Address === email) && m.Subject.includes(subjectPart)).length;
}

const BANK_OK = { routing_number: "110000000", account_number: "000123456789", account_holder_type: "individual" as const };
const BANK_FAILS = { routing_number: "110000000", account_number: "000111111116", account_holder_type: "individual" as const };

/** What a Client's "Link" press does in the form, with Stripe's test bank. */
async function linkBank(clientSecret: string, bank: typeof BANK_OK) {
  const id = clientSecret.split("_secret_")[0];
  let si = await s.setupIntents.confirm(id, {
    payment_method_data: { type: "us_bank_account", us_bank_account: bank, billing_details: { name: "Walk Client" } },
    mandate_data: { customer_acceptance: { type: "online", online: { ip_address: "127.0.0.1", user_agent: "billing-walk" } } },
  });
  if (si.status === "requires_action") si = await s.setupIntents.verifyMicrodeposits(id, { amounts: [32, 45] });
  return si;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Test keys only");
  const stamp = Date.now().toString(36);
  const guide = (await getHumanById("admin_1")) as Human;
  const made: { humans: string[]; folder: string | null; clock: string | null; clock2: string | null } = { humans: [], folder: null, clock: null, clock2: null };

  try {
    // ── Seed ──────────────────────────────────────────────────────────
    const sue = (await createHuman({ email: `walk-sue-${stamp}@example.com`, name: "Walk Sue", role: "Human" as never }))!;
    const tom = (await createHuman({ email: `walk-tom-${stamp}@example.com`, name: "Walk Tom", role: "Human" as never }))!;
    made.humans.push(sue._id, tom._id);
    const root = (await ensureVaultRootFolders(guide._id)).find((r) => r.vault_root_key === "projects")!;
    const folder = (await createVaultFolder({ human_id: guide._id, name: `Billing walk ${stamp}`, parent_folder_id: root._id }))!;
    made.folder = folder._id;
    await writeProjectSharing(folder, [
      { human: guide._id, role: "Guide" },
      { human: sue._id, role: "Client" },
      { human: tom._id, role: "Client" },
    ]);
    const clock = await s.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `billing walk ${stamp}` });
    made.clock = clock.id;
    // Sue's Stripe customer lives on the test clock, so her plan's months
    // can pass in seconds.
    const cus = await s.customers.create({ email: sue.email, name: "Walk Sue", test_clock: clock.id, metadata: { human_id: sue._id } });
    await upsert(new RecordId("billing_customers", sue._id), { stripe_customer_id: cus.id, created_at: new Date().toISOString() });

    // ── 1. A bill ─────────────────────────────────────────────────────
    console.log("1. A $1,000 bill on a project with two Clients");
    const charge = await createCharge({ projectFolderId: folder._id, createdBy: guide._id, kind: "custom", typedAmountCents: 1_000_00, note: "Walk report" });
    const sent = await sendPaymentRequest({ charge, folder, guide, origin: APP });
    check("emailed to both Clients", sent === 2);
    check("Sue's email arrived", (await until("mail", () => mailTo(sue.email, "sent a bill"), (n) => n > 0, 15)) === 1);
    check("Tom's email arrived", (await mailTo(tom.email, "sent a bill")) === 1);
    const sueLink = await fetch(signedPayLink(APP, charge._id, sue._id), { redirect: "manual" });
    check("Sue's link opens the pay page with no login", sueLink.status === 200, String(sueLink.status));
    const guideLink = await fetch(signedPayLink(APP, charge._id, guide._id), { redirect: "manual" });
    check("a link signed for the guide is refused", guideLink.status === 404, String(guideLink.status));
    // Both opened it (Sue through the link above); Tom pays.
    await paymentIntentSecretFor((await getCharge(charge._id))!, tom);
    const opened = (await getCharge(charge._id))!;
    check("each Client has their own intent", Object.keys(opened.payment_intents).length === 2);
    await s.paymentIntents.confirm(opened.payment_intents[tom._id], { payment_method: "pm_card_visa", return_url: `${APP}/pay/${charge._id}` });
    const paid = await until("bill paid", () => getCharge(charge._id), (c) => c?.status === "paid");
    check("bill paid through the webhook", paid?.status === "paid", paid?.status);
    check("records Tom as the payer", paid?.paid_by_human_id === tom._id);
    check("records the terms version accepted", !!paid?.terms_version && !!paid?.accepted_at, paid?.terms_version);
    const sueIntent = await s.paymentIntents.retrieve(opened.payment_intents[sue._id]);
    check("Sue's intent closed", sueIntent.status === "canceled", sueIntent.status);
    check("Tom gets a payment confirmation", (await until("mail", () => mailTo(tom.email, "Payment received"), (n) => n > 0, 15)) === 1);
    check("the guide hears it's paid", (await mailTo(guide.email, " paid $1,000")) >= 1);

    // ── 2. A plan ─────────────────────────────────────────────────────
    console.log("2. The guide picks Guide; Sue links a bank account");
    // The guide's day is today; Sue links ten days later, so the plan is
    // billed from the guide's day, not from when she linked.
    const guideDay = dayIn(new Date());
    await sendPlanNotices(await setPlanLevel({ folderId: folder._id, level: "guide", startDay: guideDay }), APP);
    check("plan waits for a bank account", (await getPlan(folder._id))?.status === "awaiting_setup");
    check("Clients asked to set it up", (await until("mail", () => mailTo(sue.email, "Set up the Guide plan"), (n) => n > 0, 15)) === 1);
    await advance(clock.id, clock.frozen_time + 10 * DAY);
    const si = await linkBank(await setupIntentSecretFor((await getPlan(folder._id))!, sue, "setup"), BANK_OK);
    check("bank account linked", si.status === "succeeded", si.status);
    let plan = await until("plan active", () => getPlan(folder._id), (p) => p?.status === "active" && !!p.stripe_subscription_id);
    check("plan active through the webhook", plan?.status === "active", plan?.status);
    const sub = await s.subscriptions.retrieve(plan!.stripe_subscription_id!);
    check("bank transfer only", JSON.stringify(sub.payment_settings?.payment_method_types) === '["us_bank_account"]', JSON.stringify(sub.payment_settings?.payment_method_types));
    check("one schedule, flexible mode", !!plan?.stripe_schedule_id && (await s.subscriptionSchedules.retrieve(plan!.stripe_schedule_id!)).billing_mode?.type === "flexible");
    const guideStart = Math.floor(firstBillingTime(guideDay).getTime() / 1000);
    check("billed from the guide's day, not the late link", Math.abs(sub.billing_cycle_anchor - guideStart) < DAY, `${Math.round((sub.billing_cycle_anchor - guideStart) / DAY)} days off`);
    // The first invoice waits about an hour as a draft; ACH clears in days.
    await advance(clock.id, clock.frozen_time + 10 * DAY + 2 * 60 * 60);
    await advance(clock.id, clock.frozen_time + 16 * DAY);
    const invoices = async () => (await s.invoices.list({ subscription: sub.id, limit: 20 })).data.filter((i) => i.status === "paid" && i.amount_paid > 0);
    const firstPaid = await until("first debit", invoices, (l) => l.length >= 1, 30);
    check("first $3,000 debit paid", firstPaid.length === 1 && firstPaid[0].amount_paid === 300000, `${firstPaid.length} paid, ${firstPaid[0]?.amount_paid}`);
    const ledgerRead = await listPlanInvoices(sub.id, new Date(0));
    check("the ledger reads it from Stripe", ledgerRead.length === 1 && ledgerRead[0].amountCents === 300000 && ledgerRead[0].status === "paid", JSON.stringify(ledgerRead));
    if (firstPaid.length !== 1) {
      const all = (await s.invoices.list({ subscription: sub.id, limit: 20 })).data;
      const clockAt = new Date((await s.testHelpers.testClocks.retrieve(clock.id)).frozen_time * 1000).toISOString();
      console.log("    clock at", clockAt, all.map((i) => `${i.status} ${i.amount_due} ${i.billing_reason} ${new Date(i.period_start * 1000).toISOString().slice(0, 10)}`));
    }

    // ── 3. A change inside the notice ─────────────────────────────────
    console.log("3. Deep Guide asked 3 days before the next debit");
    plan = await until("synced", () => getPlan(folder._id), (p) => !!p?.current_period_end);
    const periodEnd = Math.floor(new Date(plan!.current_period_end!).getTime() / 1000);
    await advance(clock.id, periodEnd - 3 * DAY);
    const clockNow = new Date((await s.testHelpers.testClocks.retrieve(clock.id)).frozen_time * 1000);
    await changePlan(plan!, "deep_guide", clockNow);
    plan = await getPlan(folder._id);
    const waitDays = plan?.pending_at ? Math.round((new Date(plan.pending_at).getTime() / 1000 - periodEnd) / DAY) : null;
    check("waits a period longer", plan?.pending_level === "deep_guide" && waitDays !== null && waitDays >= 28, `${waitDays} days after the next debit`);
    await changePlan(plan!, "guide", clockNow);
    check("changing back clears it", (await getPlan(folder._id))?.pending_level === null);

    // ── 4. Pause and resume ───────────────────────────────────────────
    console.log("4. Pause at renewal, then resume");
    await sendPlanNotices(await pausePlan((await getPlan(folder._id))!), APP);
    check("pause scheduled", (await getPlan(folder._id))?.status === "pause_scheduled");
    await advance(clock.id, periodEnd + 2 * DAY);
    plan = await until("paused", () => getPlan(folder._id), (p) => p?.status === "paused");
    check("paused after the renewal", plan?.status === "paused", plan?.status);
    await advance(clock.id, periodEnd + 20 * DAY);
    check("nothing charged while paused", (await invoices()).length === 1);
    await sendPlanNotices(await requestResume(plan!, sue._id), APP);
    check("guide asked to approve", (await until("mail", () => mailTo(guide.email, "asked to resume"), (n) => n > 0, 15)) >= 1);
    const resumeAt = (await s.testHelpers.testClocks.retrieve(clock.id)).frozen_time;
    await sendPlanNotices(await approveResume(folder._id), APP);
    // Stripe resumes once the resume debit succeeds, and a bank transfer
    // takes days to clear: let it.
    await advance(clock.id, resumeAt + 60);
    await advance(clock.id, resumeAt + 6 * DAY);
    plan = await until("resumed", () => getPlan(folder._id), (p) => p?.status === "active");
    check("active again", plan?.status === "active", plan?.status);
    const resumed = await s.subscriptions.retrieve(sub.id);
    check("billing anchor moved to the resume date", Math.abs(resumed.billing_cycle_anchor - resumeAt) < 2 * DAY, `${Math.round((resumed.billing_cycle_anchor - resumeAt) / DAY)} days off`);

    // ── 5. A failing bank account ─────────────────────────────────────
    console.log("5. Sue switches to an account that fails");
    const bank = await linkBank(await setupIntentSecretFor((await getPlan(folder._id))!, sue, "bank"), BANK_FAILS);
    check("new account linked", bank.status === "succeeded", bank.status);
    await until("bank switched", async () => (await s.subscriptions.retrieve(sub.id)).default_payment_method, (pm) => pm === bank.payment_method, 30);
    const nextEnd = (await s.subscriptions.retrieve(sub.id)).items.data[0].current_period_end;
    for (const days of [1, 5, 10, 20, 30, 40, 45]) await advance(clock.id, nextEnd + days * DAY);
    check("guide told the debit failed", (await until("mail", () => mailTo(guide.email, "didn't go through"), (n) => n > 0, 60)) >= 1);

    // ── 6. Cancel ─────────────────────────────────────────────────────
    console.log("6. Cancel");
    plan = (await getPlan(folder._id)) as BillingPlan;
    if (plan.status !== "canceled") {
      const askedAt = (await s.testHelpers.testClocks.retrieve(clock.id)).frozen_time;
      const periodEndNow = (await s.subscriptions.retrieve(sub.id)).items.data[0].current_period_end;
      const ending = await cancelPlan(plan, new Date(askedAt * 1000));
      await sendPlanNotices(ending, APP);
      const endsAt = ending[0]?.type === "canceling" ? Math.floor(new Date(ending[0].date).getTime() / 1000) : periodEndNow;
      check("a cancel gives 30 days' notice, ending on a billing date", endsAt - askedAt >= 30 * DAY && (endsAt === periodEndNow || endsAt - periodEndNow > 27 * DAY), `${Math.round((endsAt - askedAt) / DAY)} days`);
      await advance(clock.id, endsAt + DAY);
    }
    plan = await until("canceled", () => getPlan(folder._id), (p) => p?.status === "canceled");
    check("plan ended", plan?.status === "canceled", plan?.status);

    // ── 7. A link more than a month late: work on hold ────────────────
    console.log("7. The billing day was 40 days ago and nobody linked");
    // Its own clock, at today, so Stripe's backdate is the 40 days alone.
    const clock2 = await s.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `billing walk hold ${stamp}` });
    made.clock2 = clock2.id;
    const cus2 = await s.customers.create({ email: sue.email, name: "Walk Sue", test_clock: clock2.id, metadata: { human_id: sue._id } });
    await upsert(new RecordId("billing_customers", sue._id), { stripe_customer_id: cus2.id, created_at: new Date().toISOString() });
    // A guide can't pick a day already gone, so the overdue row is written
    // straight: what the guide's day looks like 40 days on.
    const lateStart = new Date(Date.now() - 40 * DAY * 1000);
    lateStart.setUTCHours(12, 0, 0, 0);
    await upsert(new RecordId("billing_plans", folder._id), {
      ...(await getPlan(folder._id)),
      id: undefined,
      _id: undefined,
      status: "awaiting_setup",
      level: "guide",
      start_date: lateStart.toISOString(),
      setup_intents: {},
      payer_human_id: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_schedule_id: null,
      hold_since: null,
      updated_at: new Date().toISOString(),
    });
    check("on hold before the daily check runs", isOnHold(await getPlan(folder._id)));
    const sueRole = await getProjectRole(folder, sue._id);
    check("the Client reaches none of the project", sueRole?.role === "Client" && sueRole.features.length === 0, JSON.stringify(sueRole?.features));
    const held = (await pauseCheck()).filter((n) => n.folderId === folder._id);
    check("the daily check says so", held.length === 1 && held[0].type === "work_on_hold");
    await sendPlanNotices(held, APP);
    check("the guide is told", (await until("mail", () => mailTo(guide.email, "is on hold"), (n) => n > 0, 15)) >= 1);
    check("the Client is told", (await mailTo(sue.email, "is on hold")) >= 1);
    const lateSi = await linkBank(await setupIntentSecretFor((await getPlan(folder._id))!, sue, "setup"), BANK_OK);
    check("Sue links late", lateSi.status === "succeeded", lateSi.status);
    plan = await until("late plan active", () => getPlan(folder._id), (p) => p?.status === "active" && !!p.stripe_subscription_id);
    check("still on hold while the payment clears", isOnHold(plan));
    await advance(clock2.id, clock2.frozen_time + 2 * 60 * 60);
    await advance(clock2.id, clock2.frozen_time + 6 * DAY);
    const catchUp = await until("catch-up debit", async () => (await s.invoices.list({ subscription: plan!.stripe_subscription_id!, limit: 5 })).data.filter((i) => i.status === "paid"), (l) => l.length > 0, 30);
    check("the catch-up debit covers every month since the billing day", catchUp[0]?.amount_paid === 600000, String(catchUp[0]?.amount_paid));
    plan = await until("hold lifted", () => getPlan(folder._id), (p) => !isOnHold(p), 30);
    check("the hold lifts once it clears", !isOnHold(plan));
    check("everyone hears it's back on", (await until("mail", () => mailTo(guide.email, "is back on"), (n) => n > 0, 15)) >= 1);
    check("the Client reaches the project again", ((await getProjectRole(folder, sue._id))?.features.length ?? 0) > 0);
    // The 30-day cancel, on a plan that's running (step 6's ended early).
    const askedAt2 = (await s.testHelpers.testClocks.retrieve(clock2.id)).frozen_time;
    const periodEnd2 = (await s.subscriptions.retrieve(plan!.stripe_subscription_id!)).items.data[0].current_period_end;
    const ending2 = await cancelPlan((await getPlan(folder._id))!, new Date(askedAt2 * 1000));
    const endsAt2 = ending2[0]?.type === "canceling" ? Math.floor(new Date(ending2[0].date).getTime() / 1000) : 0;
    check("a cancel gives 30 days' notice, ending on a billing date", endsAt2 - askedAt2 >= 30 * DAY && (endsAt2 === periodEnd2 || Math.abs(endsAt2 - periodEnd2 - 30 * DAY) < 4 * DAY), `${Math.round((endsAt2 - askedAt2) / DAY)} days after asking; period ended in ${Math.round((periodEnd2 - askedAt2) / DAY)}`);
    await advance(clock2.id, endsAt2 - DAY);
    check("still running the day before", (await until("synced", () => getPlan(folder._id), (p) => !!p, 5))?.status === "canceling");
    await advance(clock2.id, endsAt2 + DAY);
    plan = await until("canceled at notice end", () => getPlan(folder._id), (p) => p?.status === "canceled", 30);
    check("ends on that day", plan?.status === "canceled", plan?.status);

    // ── 8. A bill unpaid 10 days past due ─────────────────────────────
    console.log("8. A bill sent 41 days ago, unpaid");
    const late = await createCharge({ projectFolderId: folder._id, createdBy: guide._id, kind: "custom", typedAmountCents: 500_00, note: "Site visit, October" });
    await upsert(new RecordId("billing_charges", late._id), { ...(await getCharge(late._id)), id: undefined, _id: undefined, created_at: new Date(Date.now() - 41 * DAY * 1000).toISOString() });
    const billHold = await projectHold(folder._id);
    check("the project is on hold for the bill", billHold?.kind === "bill" && billHold.chargeId === late._id, JSON.stringify(billHold));
    check("the Client reaches none of it", (await getProjectRole(folder, sue._id))?.features.length === 0);
    const billNotices = (await pauseCheck()).filter((n) => n.folderId === folder._id);
    check("the daily check says so once", billNotices.length === 1 && billNotices[0].type === "work_on_hold" && billNotices[0].reason === "bill_overdue");
    await sendPlanNotices(billNotices, APP);
    check("the Client's email carries the pay link", (await until("mail", () => mailTo(sue.email, "is on hold"), (n) => n > 1, 15)) >= 2);
    check("said once", (await pauseCheck()).filter((n) => n.folderId === folder._id).length === 0);
  } finally {
    // ── Put everything back ───────────────────────────────────────────
    if (made.clock) await s.testHelpers.testClocks.del(made.clock).catch(() => {});
    if (made.clock2) await s.testHelpers.testClocks.del(made.clock2).catch(() => {});
    if (made.folder) {
      await query(`DELETE billing_charges WHERE project_folder_id = $f; DELETE $plan;`, {
        f: made.folder,
        plan: new RecordId("billing_plans", made.folder),
      });
      await deleteVaultFolderCascade(made.folder);
    }
    for (const id of made.humans) {
      await query(`DELETE $c`, { c: new RecordId("billing_customers", id) });
      await deleteHuman(id);
    }
  }
  console.log(failures === 0 ? "\nBilling walk holds." : `\nBilling walk FAILED: ${failures} check(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
