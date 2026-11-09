// app/routes/maker_.projects_.$folderId_.billing.tsx → POST /maker/projects/:id/billing
// What the Payments panel on a project's Maker page posts to (payments
// seed, Austin 2026-11-03: billing is set on the project's Maker page).
// No page of its own: the panel lives on `/maker/projects/:id`. Same
// access as that page: the project's Guide or an admin, else 404.
//
// Intents:
// - `plan`: set the project's plan level (or None) and its monthly
//   billing day, which a new plan must have; emails what it changes.
//   Plans take no discount: every client pays the same monthly rate.
// - `approve_resume`: resume a paused plan, on a Client's request or the
//   guide's own say.
// - `pause`, `undo_pause`, `cancel`: the guide's own plan controls
//   (Austin, 2026-11-03): the same rules as the Client's (a pause from the
//   next billing date; a cancel with 30 days' notice).
// - `bill`: raise a bill, with any discount off a priced kind and any of
//   the project's receipts or PDFs
//   attached, and email it to every Client on the project.
// - `withdraw`: withdraw a bill nobody has paid.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { runsPeople } from "../data/projectPeople.server";
import { attachableFiles, clientsOn, sendPaymentRequest } from "../data/payments.server";
import { cancelCharge, createCharge, getCharge } from "robustness-core/data/billing.server";
import { hasTypedAmount, isMenuPlan, isOneTimeKind, parseDiscountPercent, parseUsdToCents } from "robustness-core/data/billingRules";
import { approveResume, cancelPlan, getPlan, pausePlan, setPlanLevel, undoPause } from "robustness-core/data/billingPlans.server";
import { sendPlanNotices } from "../data/billingNotices.server";

export type BillingActionResult = { ok: true; message?: string } | { error: string };

async function guidedFolder(request: Request, folderId: string | undefined) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  const folder = folderId ? await getFolderById(folderId) : undefined;
  if (!folder || !(await runsPeople(user, folder))) throw data("Not found", { status: 404 });
  return { user, folder };
}

/** `?files=1`: the project's receipts and PDFs a bill can carry, for the
 * panel's picker (loaded when the guide opens it, not with the page).
 * Anything else: the panel is on the project's Maker page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  if (!new URL(request.url).searchParams.has("files")) return redirect(`/maker/projects/${params.folderId ?? ""}`);
  const { folder } = await guidedFolder(request, params.folderId);
  return { files: await attachableFiles(folder) };
}

export async function action({ request, params }: ActionFunctionArgs): Promise<BillingActionResult> {
  const { user, folder } = await guidedFolder(request, params.folderId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const origin = new URL(request.url).origin;

  if (intent === "plan") {
    const raw = String(form.get("level") ?? "");
    const level = raw === "none" ? null : isMenuPlan(raw) ? raw : undefined;
    if (level === undefined) return { error: "Pick a plan, or None." };
    const startDay = String(form.get("start") ?? "").trim() || null;
    if (level && (await clientsOn(folder)).length === 0) {
      return { error: "Nobody on this project is a Client yet, so there's nobody to set the plan up." };
    }
    try {
      const notices = await setPlanLevel({ folderId: folder._id, level, startDay });
      await sendPlanNotices(notices, origin);
      return { ok: true, message: notices.length ? "Saved, and the client has an email." : "Saved." };
    } catch (err) {
      console.error("billing: set plan failed", err);
      return { error: err instanceof Error ? err.message : "Stripe didn't take that." };
    }
  }

  if (intent === "approve_resume") {
    try {
      await sendPlanNotices(await approveResume(folder._id), origin);
      return { ok: true, message: "Resumed. Billing starts again today." };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't resume it." };
    }
  }

  if (intent === "pause" || intent === "undo_pause" || intent === "cancel") {
    const plan = await getPlan(folder._id);
    if (!plan) return { error: "This project has no plan." };
    try {
      if (intent === "pause") await sendPlanNotices(await pausePlan(plan, "guide"), origin);
      else if (intent === "undo_pause") await undoPause(plan);
      else await sendPlanNotices(await cancelPlan(plan), origin);
    } catch (err) {
      console.error(`billing: guide ${intent} on ${folder._id} failed`, err);
      return { error: err instanceof Error ? err.message : "That didn't go through." };
    }
    const message = intent === "pause" ? "Paused from the next billing date, and the client has an email." : intent === "cancel" ? "Ending, and the client has an email." : "The pause is off.";
    return { ok: true, message };
  }

  if (intent === "bill") {
    const kind = form.get("kind");
    if (!isOneTimeKind(kind)) return { error: "Pick what the bill is for." };
    if ((await clientsOn(folder)).length === 0) {
      return { error: "Nobody on this project is a Client yet, so there's nobody to send it to." };
    }
    const note = String(form.get("note") ?? "").trim();
    if (!note) return { error: "Say what the bill is for, the way the client should read it." };
    let typedAmountCents: number | null = null;
    if (hasTypedAmount(kind)) {
      typedAmountCents = parseUsdToCents(String(form.get("amount") ?? ""));
      if (!typedAmountCents) return { error: "Type an amount in dollars, like 1000." };
    }
    const discountPercent = hasTypedAmount(kind) ? null : parseDiscountPercent(String(form.get("discount") ?? ""));
    if (discountPercent === "invalid") return { error: "A discount is a whole percent, 1 to 99." };
    // Only the project's own receipts and PDFs, whatever the form says.
    const picked = new Set(form.getAll("files").map(String));
    const attachments = picked.size
      ? (await attachableFiles(folder))
          .filter((f) => picked.has(f.fileId))
          .map(({ fileId, name, contentType }) => ({ fileId, name, contentType }))
      : [];
    if (attachments.length !== picked.size) return { error: "One of those files isn't on this project." };
    let charge;
    try {
      charge = await createCharge({
        attachments,
        projectFolderId: folder._id,
        createdBy: user._id,
        kind,
        typedAmountCents,
        discountPercent,
        note,
      });
    } catch (err) {
      console.error("billing: create charge failed", err);
      return { error: err instanceof Error && err.message.includes("terms") ? err.message : "Stripe didn't take that. Check the setup and try again." };
    }
    try {
      const sent = await sendPaymentRequest({ charge, folder, guide: user, origin });
      return { ok: true, message: `Sent to ${sent === 1 ? "the client" : `${sent} clients`}.` };
    } catch (err) {
      console.error(`billing: emailing bill ${charge._id} failed`, err);
      return { ok: true, message: "The bill is up, but the email didn't go. Copy its link and send it yourself." };
    }
  }

  if (intent === "withdraw") {
    const charge = await getCharge(String(form.get("chargeId") ?? ""));
    if (!charge || charge.project_folder_id !== folder._id) return { error: "That bill isn't on this project." };
    try {
      await cancelCharge(charge);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't remove it." };
    }
    return { ok: true };
  }

  return { error: "Unknown action." };
}
