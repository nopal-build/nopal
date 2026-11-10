/**
 * Who hears about a plan's news, and in what words (payments seed). The
 * data layer reports what happened (`PlanNotice`, billingPlans.server.ts);
 * this decides the email. Clients hear whenever a debit moves, a pause is
 * set, or the plan ends; guides hear when something needs them: a resume
 * request, a payment that failed after Stripe's retries, a pause at six
 * months. Nothing in O.No locks on any of these.
 *
 * The wording is Austin's to judge (it reaches clients). Dates are in
 * Mountain time, where Nopal works.
 */
import type { Human } from "robustness-core/data/humans.server";
import { getHumansById } from "robustness-core/data/humans.server";
import { displayName } from "robustness-core/data/humanNames";
import { getProjectSharing, resolveRole } from "robustness-core/data/projectSharing.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getPlan, isOnHold, type BillingPlan, type PlanNotice } from "robustness-core/data/billingPlans.server";
import { MENU_PLAN_LABELS, formatUsd } from "robustness-core/data/billingRules";
import { priceFor } from "robustness-core/data/stripe.server";
import { groupOf } from "robustness-core/data/features";
import { sendEmail } from "../util/email.server";
import { BillingNotice } from "../emails/billingNotice";
import { clientsOn, signedPayLink, signedPlanLink } from "./payments.server";
import { getCharge, listChargesForProjects } from "robustness-core/data/billing.server";
import { billOnHold } from "robustness-core/data/planHold.server";

export function billingDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Denver" });
}

/** "the 3rd", the day a plan renews each month, in Mountain time. */
export function renewalDay(isoDate: string): string {
  const day = Number(new Date(isoDate).toLocaleDateString("en-US", { day: "numeric", timeZone: "America/Denver" }));
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `the ${day}${suffix}`;
}

/** How a plan's renewal reads to a client (Austin, 2026-11-03: say the
 * date and what it covers, don't explain the edge cases). */
export function renewalLines(startIso: string | null, now = new Date()): string[] {
  if (!startIso) return ["Each payment covers your next month of service."];
  const starts = new Date(startIso) > now ? `, starting ${billingDate(startIso)}` : "";
  return [`Your plan renews on ${renewalDay(startIso)} of each month${starts}. Each payment covers your next month of service.`];
}

export const monthlyAmount = (cents: number) => `${formatUsd(cents)} a month`;

async function guidesOn(folderId: string): Promise<Human[]> {
  const folder = await getFolderById(folderId);
  if (!folder) return [];
  const sharing = await getProjectSharing(folder);
  return getHumansById(sharing.filter((e) => groupOf(e.role) && resolveRole(e.role).guiding).map((e) => e.human));
}

type Mail = {
  to: "clients" | "guides" | { human: string };
  subject: string;
  lines: string[];
  button?: { label: string; url: string } | "plan-link" | { payChargeId: string };
};

/** The oldest unpaid bill past its hold date, for the hold email. */
async function oldestOverdue(folderId: string) {
  const bills = await listChargesForProjects([folderId]);
  return bills.filter((b) => billOnHold(b)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

async function mailFor(notice: PlanNotice, project: string, origin: string): Promise<Mail[]> {
  const maker = { label: "Open the project in the Maker", url: `${origin}/maker/projects/${notice.folderId}` };
  const profile = { label: "See it on your profile", url: `${origin}/profile#payments` };
  switch (notice.type) {
    case "setup_requested": {
      const price = await priceFor(notice.level);
      const plan = await getPlan(notice.folderId);
      return [
        {
          to: "clients",
          subject: `Set up the ${MENU_PLAN_LABELS[notice.level]} plan for ${project}`,
          lines: [
            `${project} is on the ${MENU_PLAN_LABELS[notice.level]} plan: ${monthlyAmount(price.unit_amount ?? 0)} by bank transfer.`,
            ...renewalLines(plan?.start_date ?? null),
            "Link the bank account it bills from to start. You can change the plan anytime on your profile.",
          ],
          button: "plan-link",
        },
      ];
    }
    case "plan_started": {
      const price = await priceFor(notice.level);
      const line = `The ${MENU_PLAN_LABELS[notice.level]} plan for ${project} has started: ${monthlyAmount(price.unit_amount ?? 0)}, renewing on ${renewalDay(notice.firstDebit)} of each month.`;
      return [
        { to: "clients", subject: `${project}'s plan has started`, lines: [line, "You can change, pause or cancel it on your profile."], button: profile },
        { to: "guides", subject: `${project}'s plan has started`, lines: [line], button: maker },
      ];
    }
    case "debit_moved": {
      const lines =
        notice.reason === "resume"
          ? [`${project}'s plan is back on. ${formatUsd(notice.amountCents)} is debited today, then on this day each month.`]
          : [`From ${billingDate(notice.date)}, ${project} is on the ${MENU_PLAN_LABELS[notice.level]} plan: ${formatUsd(notice.amountCents)} a month.`];
      return [
        { to: "clients", subject: `${project}'s next debit`, lines, button: profile },
        { to: "guides", subject: `${project}'s next debit`, lines, button: maker },
      ];
    }
    case "pause_scheduled":
      return [
        {
          to: "clients",
          subject: `${project}'s plan pauses on ${billingDate(notice.date)}`,
          lines:
            notice.by === "guide"
              ? [
                  `Your guide paused ${project}'s plan from ${billingDate(notice.date)}. Nothing is billed while it's paused.`,
                  "Your guide will pick it back up with you. You can also ask to resume from your profile.",
                ]
              : [
                  `${project}'s plan pauses on ${billingDate(notice.date)}. Nothing is billed while it's paused.`,
                  "You can undo this from your profile until then. When you're ready to come back, ask to resume there and your guide will confirm.",
                ],
          button: profile,
        },
        {
          to: "guides",
          subject: `${project}'s plan pauses on ${billingDate(notice.date)}`,
          lines: [`${notice.by === "guide" ? "A guide" : "The client"} paused ${project}'s plan from ${billingDate(notice.date)}.`],
          button: maker,
        },
      ];
    case "level_requested": {
      const [who] = await getHumansById([notice.byHumanId]);
      return [
        {
          to: "guides",
          subject: `${project} asked to move to ${MENU_PLAN_LABELS[notice.level]}`,
          lines: [
            `${who ? displayName(who) : "The client"} asked to move ${project} to the ${MENU_PLAN_LABELS[notice.level]} plan.`,
            "Approve or decline it under Change plan on the project's Maker page. Nothing changes until you do.",
          ],
          button: maker,
        },
      ];
    }
    case "level_declined":
      return [
        {
          to: "clients",
          subject: `${project} stays on its plan for now`,
          lines: [
            `Your guide kept ${project} on its current plan instead of moving to ${MENU_PLAN_LABELS[notice.level]}.`,
            "They'll talk it through with you. You can ask again from your profile.",
          ],
          button: profile,
        },
      ];
    case "resume_requested": {
      const [who] = await getHumansById([notice.byHumanId]);
      return [
        {
          to: "guides",
          subject: `${project} asked to resume`,
          lines: [`${who ? displayName(who) : "The client"} asked to resume ${project}'s plan. Approve it on the project's Maker page once Nopal can take the project back on.`],
          button: maker,
        },
      ];
    }
    case "canceling": {
      const line = `${project}'s plan ends on ${billingDate(notice.date)}. Nothing is billed after that.`;
      return [
        { to: "clients", subject: `${project}'s plan ends ${billingDate(notice.date)}`, lines: [line], button: profile },
        { to: "guides", subject: `${project}'s plan ends ${billingDate(notice.date)}`, lines: [line], button: maker },
      ];
    }
    case "payment_failed":
      return [
        {
          to: "guides",
          subject: `${project}'s debit didn't go through`,
          lines: [
            `The ${formatUsd(notice.amountCents)} debit for ${project} failed, and Stripe has stopped retrying. Nothing in O.No is locked.`,
            "Worth a word with the client. They can link another account from their profile.",
          ],
          button: maker,
        },
      ];
    case "pause_warn":
      return [
        {
          to: "clients",
          subject: `${project} has been paused five months`,
          lines: [
            `${project}'s plan has been paused since ${billingDate(notice.since)}. How is it going? If you have plans to pick it back up, or there's something we can help with, let your guide know.`,
            "When you're ready, ask to resume from your profile.",
          ],
          button: profile,
        },
      ];
    case "work_on_hold": {
      const bill = notice.reason === "bill_overdue" ? await oldestOverdue(notice.folderId) : null;
      const why =
        notice.reason === "no_bank"
          ? `${project}'s plan started on ${billingDate(notice.since)} and no bank account is linked yet`
          : notice.reason === "debit_failed"
            ? `${project}'s plan payment didn't go through`
            : `A bill for ${project}${bill ? ` (${bill.label}, ${formatUsd(bill.amount_cents)})` : ""} was due on ${billingDate(notice.since)} and is still unpaid`;
      const fix =
        notice.reason === "no_bank"
          ? "Link a bank account to pick back up. The first payment covers every month since the plan started."
          : notice.reason === "debit_failed"
            ? "Link another bank account on your profile to pick back up."
            : "Pay it to pick back up.";
      return [
        {
          to: "clients",
          subject: `Work on ${project} is on hold`,
          lines: [`${why}, so work is on hold.`, fix],
          button: notice.reason === "no_bank" ? "plan-link" : bill ? { payChargeId: bill._id } : profile,
        },
        {
          to: "guides",
          subject: `${project} is on hold`,
          lines: [`${why}, ten days past due. Work is on hold: the client sees only what to pay until it clears.`],
          button: maker,
        },
      ];
    }
    case "charge_paid": {
      const charge = await getCharge(notice.chargeId);
      if (!charge) return [];
      const [payer] = await getHumansById([notice.payerId]);
      const amount = formatUsd(charge.amount_cents);
      const back = notice.wasHeld ? " Work on the project is back on." : "";
      return [
        {
          to: { human: notice.payerId },
          subject: `Payment received: ${amount} for ${project}`,
          lines: [
            notice.clearing
              ? `We've got your ${amount} payment for ${charge.label}. It's a bank transfer, so it clears in a few days.${back}`
              : `Thanks, your ${amount} payment for ${charge.label} went through.${back}`,
            "Your bills and receipts are on your profile.",
          ],
          button: profile,
        },
        {
          to: "guides",
          subject: `${payer ? displayName(payer) : "The client"} paid ${amount} for ${project}`,
          lines: [`${payer ? displayName(payer) : "The client"} paid ${amount} for ${charge.label}${notice.clearing ? " by bank transfer, which clears in a few days" : ""}.`],
          button: maker,
        },
      ];
    }
    case "plan_paid": {
      const plan = await getPlan(notice.folderId);
      if (!plan?.payer_human_id) return [];
      const name = plan.level ? `${MENU_PLAN_LABELS[plan.level]} plan` : "plan";
      return [
        {
          to: { human: plan.payer_human_id },
          subject: `Payment received: ${formatUsd(notice.amountCents)} for ${project}`,
          lines: [`Your ${formatUsd(notice.amountCents)} payment for ${project}'s ${name} cleared. Thanks.`],
          button: profile,
        },
      ];
    }
    case "hold_lifted": {
      const line = `${project}'s payment cleared, and work is back on.`;
      return [
        { to: "clients", subject: `${project} is back on`, lines: [line], button: profile },
        { to: "guides", subject: `${project} is back on`, lines: [line], button: maker },
      ];
    }
    case "pause_alert":
      return [
        {
          to: "guides",
          subject: `${project} has been paused six months`,
          lines: [`${project}'s plan has been paused since ${billingDate(notice.since)} with no resume request. It stays paused.`],
          button: maker,
        },
      ];
  }
}

/** Send every email a batch of notices calls for. A failed send is logged,
 * never thrown: the billing change it reports has already happened. */
export async function sendPlanNotices(notices: PlanNotice[], origin: string): Promise<void> {
  for (const notice of notices) {
    try {
      const folder = await getFolderById(notice.folderId);
      if (!folder) continue;
      const [clients, guides] = await Promise.all([clientsOn(folder), guidesOn(folder._id)]);
      for (const mail of await mailFor(notice, folder.name, origin)) {
        const to = mail.to;
        const people = to === "clients" ? clients : to === "guides" ? guides : clients.filter((c) => c._id === to.human);
        for (const person of people) {
          const b = mail.button;
          const button =
            b === "plan-link"
              ? { label: "Link a bank account", url: signedPlanLink(origin, folder._id, person._id) }
              : b && "payChargeId" in b
                ? { label: "Pay the bill", url: signedPayLink(origin, b.payChargeId, person._id) }
                : b;
          await sendEmail({
            to: [person.email],
            subject: mail.subject,
            react: BillingNotice({ name: displayName(person), lines: mail.lines, button }),
          });
        }
      }
    } catch (err) {
      console.error(`billing: emailing ${notice.type} for ${notice.folderId} failed`, err);
    }
  }
}

export type PlanView = {
  level: string | null;
  status: string;
  line: string;
  canPause: boolean;
  canUndoPause: boolean;
  canRequestResume: boolean;
  canApproveResume: boolean;
  /** A Client's open ask for a different level, by its label. */
  levelRequested: string | null;
  /** A Client may ask for a different level (they never change it directly). */
  canRequestLevel: boolean;
  /** A guide resuming a pause nobody asked to end. */
  canResumeNow: boolean;
  canCancel: boolean;
  canUpdateBank: boolean;
  awaitingSetup: boolean;
  onHold: boolean;
};

/** A plan in one line, for the Maker page (guide) or the profile (client). */
export function describePlan(plan: BillingPlan | null, audience: "guide" | "client"): PlanView {
  const status = plan?.status ?? "none";
  const name = plan?.level ? MENU_PLAN_LABELS[plan.level] : null;
  const amount = plan?.next_amount_cents != null ? formatUsd(plan.next_amount_cents) : null;
  const on = (d: string | null) => (d ? billingDate(d) : "the next billing date");
  const renew = plan?.start_date ? `${renewalDay(plan.start_date)} of each month` : "the same day each month";
  let line: string;
  switch (status) {
    case "awaiting_setup":
      line =
        audience === "guide"
          ? `${name} plan, renewing on ${renew}. Waiting for a client to link a bank account.`
          : `Your guide set up the ${name} plan, renewing on ${renew}. Link a bank account to start it.`;
      break;
    case "active":
      line = `${name}${amount ? `, ${amount} a month` : ""}. Next debit ${on(plan!.current_period_end)}.`;
      if (plan!.pending_level) line += ` Moves to ${MENU_PLAN_LABELS[plan!.pending_level]} on ${on(plan!.pending_at)}.`;
      break;
    case "pause_scheduled":
      line = `${name}. Pauses on ${on(plan!.pause_at)}; nothing is billed while it's paused.`;
      break;
    case "paused":
      line = `Paused since ${on(plan!.paused_at)}.`;
      break;
    case "resume_requested":
      line = `Paused since ${on(plan!.paused_at)}. ${audience === "guide" ? "The client asked" : "You asked"} to resume on ${on(plan!.resume_requested_at)}.`;
      break;
    case "canceling":
      line = `${name}. Ends on ${on(plan!.current_period_end)}.`;
      break;
    case "canceled":
      line = "The plan has ended.";
      break;
    case "past_due":
      line = `${name}. The last debit didn't go through, and Stripe is trying again.`;
      break;
    default:
      line = "No plan.";
  }
  if (plan?.level_requested && ["active", "pause_scheduled", "past_due"].includes(status)) {
    const asked = MENU_PLAN_LABELS[plan.level_requested];
    line += audience === "guide" ? ` The client asked to move to ${asked}.` : ` You asked to move to ${asked}; your guide will confirm.`;
  }
  if (isOnHold(plan)) {
    line =
      status === "awaiting_setup"
        ? `Work on hold: no bank account linked since ${on(plan!.start_date)}. ${line}`
        : `Work on hold until the first payment clears. ${line}`;
  }
  return {
    level: plan?.level ?? null,
    status,
    line,
    canPause: status === "active",
    // A guide's pause isn't the client's to undo.
    canUndoPause: status === "pause_scheduled" && (audience === "guide" || plan?.pause_by !== "guide"),
    canRequestResume: status === "paused",
    levelRequested: plan?.level_requested ? MENU_PLAN_LABELS[plan.level_requested] : null,
    canRequestLevel: status === "active" || status === "pause_scheduled" || status === "past_due",
    canApproveResume: status === "resume_requested",
    canResumeNow: audience === "guide" && status === "paused",
    canCancel: ["active", "pause_scheduled", "paused", "resume_requested", "past_due"].includes(status),
    canUpdateBank: ["active", "pause_scheduled", "paused", "resume_requested", "past_due"].includes(status),
    awaitingSetup: status === "awaiting_setup",
    onHold: isOnHold(plan),
  };
}
