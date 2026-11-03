import type { ActionFunctionArgs } from "react-router";
import { applyStripeEvent } from "robustness-core/data/billing.server";
import { stripe } from "robustness-core/data/stripe.server";

/**
 * POST /api/stripe/webhook
 *
 * Stripe's events about payments and subscriptions (payments seed). The
 * signature is checked against the raw body, so this reads
 * `request.text()` and never `request.json()`; server.js has no JSON body
 * parser in front of it. A bad signature is a 400 and nothing is read.
 *
 * What each event writes is `applyStripeEvent`'s. Anything that throws
 * there returns 500 so Stripe retries it.
 *
 * Locally: `stripe listen --forward-to localhost:3001/api/stripe/webhook`
 * prints the STRIPE_WEBHOOK_SECRET to use.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  const body = await request.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, secret);
  } catch (err) {
    console.warn("stripe-webhook: signature check failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Bad signature" }, { status: 400 });
  }

  try {
    const applied = await applyStripeEvent(event);
    return Response.json({ received: true, applied });
  } catch (err) {
    console.error(`stripe-webhook: ${event.type} ${event.id} failed`, err);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
