// The guide's Payments ledger (Austin, 2026-11-03). Gates: a failed bill
// or debit and a resume request land in Needs you; open bills and each
// monthly debit inside 60 days in Upcoming, at the new level once a
// change takes effect; paid bills and Stripe's paid
// debits in Recent, newest first; a withdrawn bill, a paused plan's
// months, and a project with no payments nowhere.
import { describe, expect, it } from "vitest";
import { buildLedger } from "../data/paymentsLedger.server";
import type { BillingCharge } from "robustness-core/data/billing.server";
import type { BillingPlan } from "robustness-core/data/billingPlans.server";

const now = new Date("2026-11-03T18:00:00Z");
const charge = (over: Partial<BillingCharge>): BillingCharge =>
  ({
    _id: "c",
    project_folder_id: "attic",
    label: "One-hour decision",
    amount_cents: 250_00,
    status: "open",
    paid_by_human_id: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    paid_at: null,
    ...over,
  }) as BillingCharge;
const plan = (over: Partial<BillingPlan>): BillingPlan =>
  ({
    _id: "kitchen",
    level: "guide",
    status: "active",
    payer_human_id: "sue",
    current_period_end: "2026-11-20T12:00:00Z",
    next_amount_cents: 300_000,
    pending_level: null,
    pending_at: null,
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  }) as BillingPlan;

const ledger = (charges: BillingCharge[], plans: BillingPlan[], invoices = new Map()) =>
  buildLedger({
    projects: [
      { id: "attic", name: "Attic" },
      { id: "kitchen", name: "Kitchen" },
      { id: "porch", name: "Porch" },
    ],
    charges,
    plans,
    invoices,
    prices: new Map([
      ["guide", 300_000],
      ["deep_guide", 600_000],
    ]),
    names: new Map([["sue", "Sue"]]),
    now,
  });

describe("the ledger", () => {
  it("puts failures and resume requests under Needs you", () => {
    const l = ledger([charge({ _id: "f", status: "failed" })], [plan({ status: "resume_requested", resume_requested_by: "sue" })]);
    expect(l.needsYou.map((r) => r.state)).toEqual(["failed", "resume"]);
  });

  it("lists each monthly debit inside 60 days, at the new level after a change", () => {
    const l = ledger([], [plan({ pending_level: "deep_guide", pending_at: "2026-12-20T12:00:00Z" })]);
    expect(l.upcoming.map((r) => [r.at.slice(0, 10), r.what, r.amountCents])).toEqual([
      ["2026-11-20", "Guide plan", 300_000],
      ["2026-12-20", "Deep Guide plan", 600_000],
    ]);
  });

  it("shows nothing upcoming for a paused or ending plan", () => {
    expect(ledger([], [plan({ status: "paused" }), plan({ _id: "attic", status: "canceling" })]).upcoming).toEqual([]);
  });

  it("puts paid bills and Stripe's debits under Recent, newest first, with the payer", () => {
    const l = ledger(
      [charge({ _id: "p", status: "paid", paid_at: "2026-11-02T00:00:00Z", paid_by_human_id: "sue" })],
      [plan({})],
      new Map([["kitchen", [{ id: "in_1", amountCents: 300_000, status: "paid", at: "2026-10-20T12:00:00Z" }]]]),
    );
    expect(l.recent.map((r) => [r.project, r.who, r.state])).toEqual([
      ["Attic", "Sue", "paid"],
      ["Kitchen", "Sue", "paid"],
    ]);
  });

  it("leaves out withdrawn bills and projects with no payments", () => {
    const l = ledger([charge({ status: "canceled" })], []);
    expect([...l.needsYou, ...l.upcoming, ...l.recent]).toEqual([]);
  });
});
