// app/routes/pay.$chargeId.tsx → /pay/:chargeId
// Where a client pays a one-time charge their guide raised (payments
// seed). Stripe's own form, embedded: card first, bank transfer offered.
// It lives outside the project because a Client can't open project pages
// (ADR-023). Only the person the charge names can open it; anyone else
// gets the same 404 as a charge that doesn't exist.
import { useEffect, useState, type FormEvent } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getUser } from "../modules/auth/auth.server";
import { navFor } from "../data/nav.server";
import { getCharge, paymentIntentSecretFor, refreshCharge } from "robustness-core/data/billing.server";
import { formatUsd } from "robustness-core/data/billingRules";
import { AppLayout } from "../components/AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · Pay" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const url = new URL(request.url);
  if (!user) return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  let charge = params.chargeId ? await getCharge(params.chargeId) : null;
  if (!charge || charge.payer_human_id !== user._id) throw data("Not found", { status: 404 });

  // Back from Stripe (a bank login or card check): read where it stands
  // now rather than wait for the webhook.
  if (url.searchParams.has("payment_intent")) charge = await refreshCharge(charge);

  const payable = charge.status === "open" || charge.status === "failed";
  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    ...(await navFor(user._id)),
    label: charge.label,
    amount: formatUsd(charge.amount_cents),
    status: charge.status,
    clientSecret: payable ? await paymentIntentSecretFor(charge, user) : null,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}

function PayForm({ amount }: { amount: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href.split("?")[0] },
    });
    // Only reached if Stripe didn't send the page away.
    setError(error?.message ?? "That didn't go through. Try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <Stack gap={4}>
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card", "us_bank_account"] }} />
        {error && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
        <button type="submit" className={button({ variant: "primary" })} disabled={!stripe || busy}>
          {busy ? "Paying…" : `Pay ${amount}`}
        </button>
      </Stack>
    </form>
  );
}

const DONE: Record<string, string> = {
  paid: "Paid. Thank you. A receipt is on its way to your email.",
  processing: "Got it. Bank transfers take a few business days to clear, and you'll get a receipt by email when it does.",
  canceled: "This charge was withdrawn, so there's nothing to pay.",
};

export default function Pay() {
  const { label, amount, status, clientSecret, publishableKey } = useLoaderData<typeof loader>();
  // Stripe's script loads in the browser only.
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  useEffect(() => {
    if (clientSecret && publishableKey) setStripePromise(loadStripe(publishableKey));
  }, [clientSecret, publishableKey]);

  return (
    <AppLayout>
      <CenterContent maxWidth={560}>
        <Stack gap={5} className={sprinkles({ mb: 8 })}>
          <Stack gap={1}>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>{amount}</h1>
            <p className={sprinkles({ m: 0 })}>{label}</p>
          </Stack>
          {status === "failed" && (
            <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
              The last try didn't go through. You can try again below.
            </p>
          )}
          {clientSecret ? (
            <Surface className={sprinkles({ p: 4 })}>
              {stripePromise ? (
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <PayForm amount={amount} />
                </Elements>
              ) : (
                <p className={textSize.sm}>Loading the payment form…</p>
              )}
            </Surface>
          ) : (
            <p>{DONE[status] ?? "Nothing to pay here."}</p>
          )}
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
