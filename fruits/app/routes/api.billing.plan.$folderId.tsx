// app/routes/api.billing.plan.$folderId.tsx → POST /api/billing/plan/:folderId
// The buttons on a Client's profile for a project's plan (payments seed):
// change the level, pause at the next billing date (and undo it), ask to
// resume, cancel with 30 days' notice. Only a Client on the project; the
// guide's own controls are on the project's Maker page.
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { isClientOn } from "../data/payments.server";
import { sendPlanNotices } from "../data/billingNotices.server";
import {
  cancelPlan,
  changePlan,
  getPlan,
  pausePlan,
  requestResume,
  undoPause,
  type PlanNotice,
} from "robustness-core/data/billingPlans.server";
import { isMenuPlan } from "robustness-core/data/billingRules";

export type PlanActionResult = { ok: true } | { error: string };

export async function action({ request, params }: ActionFunctionArgs): Promise<PlanActionResult> {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  const folder = params.folderId ? await getFolderById(params.folderId) : undefined;
  if (!folder || !(await isClientOn(folder, user._id))) throw data("Not found", { status: 404 });
  const plan = await getPlan(folder._id);
  if (!plan) return { error: "This project has no plan." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  let notices: PlanNotice[] = [];
  try {
    if (intent === "change") {
      const level = String(form.get("level") ?? "");
      if (!isMenuPlan(level)) return { error: "Pick a plan." };
      notices = await changePlan(plan, level);
    } else if (intent === "pause") {
      notices = await pausePlan(plan);
    } else if (intent === "undo_pause") {
      await undoPause(plan);
    } else if (intent === "request_resume") {
      notices = await requestResume(plan, user._id);
    } else if (intent === "cancel") {
      notices = await cancelPlan(plan);
    } else {
      return { error: "Unknown action." };
    }
  } catch (err) {
    console.error(`billing: client ${intent} on ${folder._id} failed`, err);
    return { error: err instanceof Error ? err.message : "That didn't go through." };
  }
  await sendPlanNotices(notices, new URL(request.url).origin);
  return { ok: true };
}
