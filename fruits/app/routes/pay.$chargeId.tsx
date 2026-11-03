// app/routes/pay.$chargeId.tsx → /pay/:chargeId
// Where a Client pays a bill their guide raised on the project (payments
// seed). Stripe's own form, embedded: card first, bank transfer offered,
// with the bill's terms above the button; paying accepts them. It lives
// outside the project because a Client can't open project pages
// (ADR-023). Any Client on the project may open it, logged in or through
// the signed link their email carries (`payments.server.ts`); anyone
// else gets the same 404 as a bill that doesn't exist.
import { useEffect, useState, type FormEvent } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getUser } from "../modules/auth/auth.server";
import { navFor } from "../data/nav.server";
import { isClientOn, personFromPayLink } from "../data/payments.server";
import { getCharge, isPayable, paymentIntentSecretFor, refreshCharge } from "robustness-core/data/billing.server";
import { categoryFor, discountNote, formatUsd } from "robustness-core/data/billingRules";
import { TERMS_PREAMBLE, termsAreDraft, termsFor } from "robustness-core/data/billingTerms";
import { getFolderById } from "robustness-core/data/vault.server";
import { PayFrame } from "../components/PayFrame";
import { PaymentTerms } from "../components/PaymentTerms";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · Pay" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const chargeId = params.chargeId ?? "";
  // A valid link names who pays, whoever is logged in on this browser.
  const fromLink = await personFromPayLink(chargeId, url);
  const sessionUser = await getUser(request);
  const user = fromLink && sessionUser?._id !== fromLink._id ? null : sessionUser;
  const payer = fromLink ?? user;
  if (!payer) return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname)}`);

  let charge = chargeId ? await getCharge(chargeId) : null;
  const folder = charge ? await getFolderById(charge.project_folder_id) : undefined;
  if (!charge || !folder || !(await isClientOn(folder, payer._id))) throw data("Not found", { status: 404 });

  // Back from Stripe (a bank login or card check): read where it stands
  // now rather than wait for the webhook.
  const returned = url.searchParams.get("payment_intent");
  if (returned) charge = await refreshCharge(charge, returned);

  // Stripe sends the client back here; a link visitor keeps their link.
  const back = new URL(`/pay/${charge._id}`, url.origin);
  if (fromLink) {
    back.searchParams.set("for", url.searchParams.get("for") ?? "");
    back.searchParams.set("sig", url.searchParams.get("sig") ?? "");
  }

  // A bill raised before categories existed reads its kind's.
  const category = charge.category ?? categoryFor(charge.kind);
  const terms = termsFor(category);
  // A link visitor's own `for` and `sig` ride on each file link.
  const linkQuery = fromLink ? `?${new URLSearchParams({ for: url.searchParams.get("for") ?? "", sig: url.searchParams.get("sig") ?? "" })}` : "";
  const attachments = (charge.attachments ?? []).map((a) => ({
    name: a.name,
    href: `/pay/${charge._id}/file/${a.fileId}${linkQuery}`,
  }));
  return {
    user: user ? { name: user.name ?? null, email: user.email, role: user.role } : null,
    ...(user ? await navFor(user._id) : {}),
    project: folder.name,
    label: charge.label,
    amount: formatUsd(charge.amount_cents),
    discount: discountNote(charge.list_amount_cents, charge.discount_percent),
    status: charge.status,
    attachments,
    terms: { preamble: TERMS_PREAMBLE, title: terms.title, text: terms.text, draft: termsAreDraft(category) },
    returnUrl: back.toString(),
    clientSecret: isPayable(charge) ? await paymentIntentSecretFor(charge, payer) : null,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}

function PayForm({ amount, returnUrl }: { amount: string; returnUrl: string }) {
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
      confirmParams: { return_url: returnUrl },
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
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
          By paying you agree to the contract terms and conditions below.
        </p>
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
  canceled: "This bill was withdrawn, so there's nothing to pay.",
};

export default function Pay() {
  const { user, project, label, amount, discount, status, attachments, terms, returnUrl, clientSecret, publishableKey } =
    useLoaderData<typeof loader>();
  // Stripe's script loads in the browser only.
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
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>{amount}</h1>
        {discount && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
            {discount}
          </p>
        )}
        <p className={sprinkles({ m: 0 })}>{label}</p>
      </Stack>
      {attachments.length > 0 && (
        <Stack gap={1}>
          <p className={`${textSize.sm} ${sprinkles({ m: 0, fontWeight: "bold" })}`}>Attached</p>
          {attachments.map((a) => (
            <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className={`${link} ${textSize.sm}`}>
              {a.name}
            </a>
          ))}
        </Stack>
      )}
      {status === "failed" && (
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
          The last try didn't go through. You can try again below.
        </p>
      )}
      {clientSecret ? (
        <>
          <Surface className={sprinkles({ p: 4 })}>
            {stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PayForm amount={amount} returnUrl={returnUrl} />
              </Elements>
            ) : (
              <p className={textSize.sm}>Loading the payment form…</p>
            )}
          </Surface>
          <PaymentTerms terms={terms} />
        </>
      ) : (
        <p>{DONE[status] ?? "Nothing to pay here."}</p>
      )}
    </PayFrame>
  );
}
