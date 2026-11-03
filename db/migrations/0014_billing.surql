-- =============================================================================
-- 0014_billing — Stripe customers, one-time charges, subscriptions per
-- project, and the Stripe events already handled (`billing.server.ts`).
--
-- Stripe is the record of money; these rows only tie Stripe's objects to
-- people and projects and cache the last status read. The module also
-- defines the tables on first use, as seed packets do.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS billing_customers TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE TABLE IF NOT EXISTS billing_charges TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS billing_charges_project ON billing_charges FIELDS project_folder_id;
DEFINE INDEX IF NOT EXISTS billing_charges_payer ON billing_charges FIELDS payer_human_id;
DEFINE TABLE IF NOT EXISTS billing_subscriptions TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS billing_subscriptions_payer ON billing_subscriptions FIELDS payer_human_id;
DEFINE INDEX IF NOT EXISTS billing_subscriptions_stripe ON billing_subscriptions FIELDS stripe_subscription_id;
DEFINE TABLE IF NOT EXISTS stripe_events TYPE ANY SCHEMALESS PERMISSIONS NONE;
