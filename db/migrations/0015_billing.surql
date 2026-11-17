-- =============================================================================
-- 0015_billing — Stripe customers, one-time charges, one plan per project,
-- and the Stripe events already handled (`billing.server.ts`,
-- `billingPlans.server.ts`).
--
-- Stripe is the record of money; these rows only tie Stripe's objects to
-- people and projects and cache the last status read. The modules also
-- define the tables on first use, as seed packets do.
--
-- Was 0014_billing, which shared its number with 0014_organizations. A
-- database that ran it under the old name runs this once more; every line
-- is IF NOT EXISTS. The old file also defined `billing_subscriptions`,
-- which nothing ever read (plans live in `billing_plans`); a database that
-- has that empty table can drop it by hand.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS billing_customers TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE TABLE IF NOT EXISTS billing_charges TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS billing_charges_project ON billing_charges FIELDS project_folder_id;
DEFINE INDEX IF NOT EXISTS billing_charges_paid_by ON billing_charges FIELDS paid_by_human_id;
DEFINE TABLE IF NOT EXISTS billing_plans TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE TABLE IF NOT EXISTS stripe_events TYPE ANY SCHEMALESS PERMISSIONS NONE;
