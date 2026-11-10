// app/routes/pay.plan.$folderId.tsx → /pay/plan/:folderId
// Where a Client links the bank account a project's plan bills from
// (payments seed): Stripe's form for a bank transfer (ACH) only, which
// carries Stripe's own mandate wording, with the plan's terms above it.
// Linking is the authorization and the acceptance. `?bank=1` replaces the
// account a running plan bills from. Any Client on the project, logged in
// or through their emailed link; anyone else gets a 404.
import { useEffect, useState, type FormEvent } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getUser } from "../modules/auth/auth.server";
import { navFor } from "../data/nav.server";
import { isClientOn, personFromPlanLink } from "../data/payments.server";
import { monthlyAmount, renewalLines } from "../data/billingNotices.server";
import { getPlan, isOnHold, setupIntentSecretFor, RUNNING } from "robustness-core/data/billingPlans.server";
import { MENU_PLAN_LABELS } from "robustness-core/data/billingRules";
import { TERMS_PREAMBLE, termsAreDraft, termsFor } from "robustness-core/data/billingTerms";
import { priceFor, stripe } from "robustness-core/data/stripe.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { PayFrame } from "../components/PayFrame";
import { PaymentTerms } from "../components/PaymentTerms";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · Plan" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const folderId = params.folderId ?? "";
  const fromLink = await personFromPlanLink(folderId, url);
  const sessionUser = await getUser(request);
  const user = fromLink && sessionUser?._id !== fromLink._id ? null : sessionUser;
  const payer = fromLink ?? user;
  if (!payer) return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);

  const folder = await getFolderById(folderId);
  if (!folder || !(await isClientOn(folder, payer._id))) throw data("Not found", { status: 404 });
  const plan = await getPlan(folder._id);
  // A plan on hold for a failed debit needs a new account, not a setup.
  const purpose = url.searchParams.get("bank") || plan?.status === "past_due" ? "bank" : "setup";

  // Back from Stripe: say where the bank link stands. The plan itself
  // starts from the webhook.
  const returned = url.searchParams.get("setup_intent");
  let linked: "done" | "verifying" | null = null;
  if (returned) {
    const si = await stripe().setupIntents.retrieve(returned);
    if (si.metadata?.project_folder_id === folder._id) {
      linked = si.status === "succeeded" ? "done" : si.status === "requires_action" ? "verifying" : null;
    }
  }

  const back = new URL(`/pay/plan/${folder._id}`, url.origin);
  if (purpose === "bank") back.searchParams.set("bank", "1");
  if (fromLink) {
    back.searchParams.set("for", url.searchParams.get("for") ?? "");
    back.searchParams.set("sig", url.searchParams.get("sig") ?? "");
  }

  const canLink =
    !linked && !!plan && (purpose === "setup" ? plan.status === "awaiting_setup" : RUNNING.includes(plan.status));
  const level = plan?.level ?? null;
  const price = level ? await priceFor(level) : null;
  const terms = termsFor("subscription");
  return {
    user: user ? { name: user.name ?? null, email: user.email, role: user.role } : null,
    ...(user ? await navFor(user._id) : {}),
    project: folder.name,
    onHold: isOnHold(plan),
    purpose,
    linked,
    plan: level
      ? {
          name: MENU_PLAN_LABELS[level],
          amount: monthlyAmount(price?.unit_amount ?? 0),
          starts: renewalLines(plan?.start_date ?? null).join(" "),
        }
      : null,
    terms: { preamble: TERMS_PREAMBLE, title: terms.title, text: terms.text, draft: termsAreDraft("subscription") },
    returnUrl: back.toString(),
    clientSecret: canLink && plan ? await setupIntentSecretFor(plan, payer, purpose) : null,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}

function LinkForm({ label, returnUrl }: { label: string; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmSetup({ elements, confirmParams: { return_url: returnUrl } });
    setError(error?.message ?? "That didn't go through. Try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <Stack gap={4}>
        <PaymentElement />
        {error && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
          By linking this account you agree to the contract terms and conditions below.
        </p>
        <button type="submit" className={button({ variant: "primary" })} disabled={!stripe || busy}>
          {busy ? "Linking…" : label}
        </button>
      </Stack>
    </form>
  );
}

export default function PlanSetup() {
  const { user, project, onHold, purpose, linked, plan, terms, returnUrl, clientSecret, publishableKey } = useLoaderData<typeof loader>();
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  useEffect(() => {
    if (clientSecret && publishableKey) setStripePromise(loadStripe(publishableKey));
  }, [clientSecret, publishableKey]);

  return (
    <PayFrame loggedIn={!!user}>
      <Stack gap={1}>
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
          {project}
        </p>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>
          {plan ? `${plan.name} plan, ${plan.amount}` : "Plan"}
        </h1>
        {plan && purpose === "setup" && !linked && <p className={sprinkles({ m: 0 })}>{plan.starts}</p>}
        {purpose === "bank" && !linked && <p className={sprinkles({ m: 0 })}>Link the account the plan bills from from now on.</p>}
      </Stack>
      {onHold && (
        <Surface className={sprinkles({ p: 4 })}>
          <p className={sprinkles({ m: 0 })}>
            {!clientSecret
              ? "Work on this project is on hold until the payment clears. That takes a few days by bank transfer, and you'll get an email when it's back on."
              : purpose === "bank"
                ? "Work on this project is on hold because the plan's last payment didn't go through. Link another account and it's tried again."
                : "Work on this project is on hold until a bank account is linked. The first payment covers every month since the plan started."}
          </p>
        </Surface>
      )}
      {linked === "done" && <p>Linked. You'll get an email with the date of the first debit.</p>}
      {linked === "verifying" && (
        <p>Stripe is checking the account with two small deposits. Watch your email from Stripe, then confirm them, and the plan starts.</p>
      )}
      {!linked && clientSecret ? (
        <>
          <Surface className={sprinkles({ p: 4 })}>
            {stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <LinkForm label={purpose === "bank" ? "Use this account" : "Link and start the plan"} returnUrl={returnUrl} />
              </Elements>
            ) : (
              <p className={textSize.sm}>Loading the form…</p>
            )}
          </Surface>
          <PaymentTerms terms={terms} />
        </>
      ) : (
        !linked && !onHold && <p>There's nothing to set up here right now.</p>
      )}
    </PayFrame>
  );
}
