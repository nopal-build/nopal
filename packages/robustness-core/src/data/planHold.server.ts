/**
 * Whether a project's work is on hold for money past due (Austin,
 * 2026-11-03; the terms: "Guide may suspend services on accounts over 10
 * days past due"). Three ways in, each `SUSPEND_AFTER_DAYS` past due:
 *   - a plan's billing day with no bank account linked;
 *   - a plan debit that failed;
 *   - a one-off bill unpaid `PAYMENT_DUE_DAYS` after it was sent.
 * A plan hold, once begun, stays (`hold_since`) until a debit clears; a
 * bill hold lasts while the bill is unpaid. On hold, a Client on the
 * project has no features (`getProjectRole`) and is sent to what to pay;
 * guides and the pay pages are untouched.
 *
 * Apart from `billingPlans.server.ts` so the sharing code can ask without
 * loading Stripe: this reads the plan row and the project's unpaid bills.
 */
import { RecordId } from "surrealdb";
import { query, select, type Data } from "./generic.server";
import { billDueAt, holdStartsAt } from "./billingRules";

type PlanHoldFields = {
  status: string;
  start_date: string | null;
  hold_since?: string | null;
  past_due_since?: string | null;
};

/** A plan's own hold: begun, or a bank link or failed debit 10 days past
 * due (so the gate doesn't wait for the daily check). */
export function isOnHold(plan: PlanHoldFields | null | undefined, now = new Date()): boolean {
  if (!plan) return false;
  if (plan.hold_since) return true;
  if (plan.status === "awaiting_setup" && plan.start_date) return now >= holdStartsAt(plan.start_date);
  if (plan.status === "past_due" && plan.past_due_since) return now >= holdStartsAt(plan.past_due_since);
  return false;
}

export function billOnHold(bill: { status: string; created_at: string }, now = new Date()): boolean {
  return (bill.status === "open" || bill.status === "failed") && now >= holdStartsAt(billDueAt(bill.created_at).toISOString());
}

/** Why a project is on hold, and where its Client goes to pay. */
export type ProjectHold = { kind: "plan" } | { kind: "bill"; chargeId: string };

export async function projectHold(folderId: string, now = new Date()): Promise<ProjectHold | null> {
  try {
    const plan = (await select<Data & PlanHoldFields>(new RecordId("billing_plans", folderId))) ?? null;
    if (isOnHold(plan, now)) return { kind: "plan" };
    const result = await query<[{ id: unknown; status: string; created_at: string }[]]>(
      `SELECT id, status, created_at FROM billing_charges WHERE project_folder_id = $folderId AND status IN ["open", "failed"]`,
      { folderId },
    );
    const overdue = (result?.[0] ?? []).filter((b) => billOnHold(b, now)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!overdue) return null;
    const id = overdue.id as { id?: unknown } | string;
    return { kind: "bill", chargeId: String(typeof id === "object" && id ? id.id : id).replace(/^billing_charges:/, "") };
  } catch {
    // No billing tables yet (a fresh database) is no hold.
    return null;
  }
}

export async function projectOnHold(folderId: string, now = new Date()): Promise<boolean> {
  return (await projectHold(folderId, now)) !== null;
}
