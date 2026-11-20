/**
 * What a project's Payments panel shows (payments seed): its plan, its
 * bills, and the choices for a new one. One builder for both places the
 * panel sits, the Maker's project list (in each project's twirl-down) and
 * the project's Maker page, so the two can't drift. Bills and plans for
 * every project are read in one query each.
 */
import { listChargesForProjects } from "robustness-core/data/billing.server";
import { listPlans } from "robustness-core/data/billingPlans.server";
import { MENU_PLANS, MENU_PLAN_LABELS, ONE_TIME_KINDS, ONE_TIME_LABELS, discountNote, formatUsd, hasTypedAmount } from "robustness-core/data/billingRules";
import { priceFor, stripeConfigured } from "robustness-core/data/stripe.server";
import { describePlan } from "./billingNotices.server";

type Member = { id: string; name: string; group: string };

export async function projectPaymentsViews(projects: { id: string; members: Member[] }[], origin: string) {
  const ids = projects.map((p) => p.id);
  const [charges, plans] = await Promise.all([listChargesForProjects(ids), listPlans(ids)]);
  const planOf = new Map(plans.map((p) => [p._id, p]));
  const configured = stripeConfigured();
  // Each fixed price, read from Stripe, so the guide sees what they're
  // sending (Austin, 2026-11-03). A typed-amount kind has none.
  const cents = async (item: Parameters<typeof priceFor>[0]) =>
    configured ? ((await priceFor(item).catch(() => null))?.unit_amount ?? null) : null;
  const kinds = await Promise.all(
    ONE_TIME_KINDS.map(async (k) => ({ value: k, label: ONE_TIME_LABELS[k], cents: hasTypedAmount(k) ? null : await cents(k) })),
  );
  const typedKinds = ONE_TIME_KINDS.filter(hasTypedAmount);
  const levels = await Promise.all(MENU_PLANS.map(async (p) => ({ value: p, label: MENU_PLAN_LABELS[p], cents: await cents(p) })));
  return new Map(
    projects.map((p) => {
      const names = new Map(p.members.map((m) => [m.id, m.name]));
      return [
        p.id,
        {
          configured,
          hasClients: p.members.some((m) => m.group === "Client"),
          kinds,
          typedKinds,
          levels,
          plan: describePlan(planOf.get(p.id) ?? null, "guide"),
          charges: charges
            .filter((c) => c.project_folder_id === p.id)
            .map((c) => ({
              id: c._id,
              label: c.label,
              amount: formatUsd(c.amount_cents),
              discount: discountNote(c.list_amount_cents, c.discount_percent),
              status: c.status,
              category: c.category,
              paidBy: c.paid_by_human_id ? (names.get(c.paid_by_human_id) ?? "someone no longer on the project") : null,
              payLink: `${origin}/pay/${c._id}`,
              attachments: (c.attachments ?? []).map((a) => a.name),
            })),
        },
      ] as const;
    }),
  );
}
