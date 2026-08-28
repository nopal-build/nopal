/**
 * Static Anthropic model pricing — used ONLY to estimate a $ figure on top
 * of GraphLog's tokens-only usage tracking (`graphLogMetrics.server.ts`),
 * never to bill or gate anything. A pure estimate, not reconciled against
 * real Anthropic billing.
 *
 * WHY hand-maintained rather than fetched: Anthropic has no public
 * "current price for model X" API. The closest thing, the Usage & Cost
 * Admin API (`GET /v1/organizations/cost_report`,
 * https://platform.claude.com/docs/en/manage-claude/usage-cost-api),
 * reports ACTUAL BILLED SPEND after the fact (not a price list you can
 * look up ahead of a call) and requires a separate Admin API key plus
 * organization-level Console access — meaningfully more setup than the
 * single `ANTHROPIC_API_KEY` this app uses today. The plain Models API
 * (`GET /v1/models`) lists model IDs/metadata, not pricing, either. So:
 * this table is transcribed by hand from
 * https://platform.claude.com/docs/en/about-claude/pricing, and flagged
 * STALE (`isPricingStale`) once `PRICING_AS_OF` is more than
 * `PRICING_MAX_AGE_DAYS` old — there's no way to auto-refresh it, only to
 * surface "someone should go re-check this" in the dashboard.
 *
 * No server-only imports — safe on both client and server, same
 * convention as `vaultRoots.ts`/`vaultFolderTypes.ts`.
 */

/** Bump this alongside the table below whenever prices are re-verified
 * against https://platform.claude.com/docs/en/about-claude/pricing —
 * whether or not the numbers actually changed, so staleness reflects
 * "last checked," not just "last edited." */
export const PRICING_AS_OF = "2026-08-14";

const PRICING_MAX_AGE_DAYS = 30;

export type ModelPricing = {
  /** USD per 1,000,000 input tokens — standard tier, global, ≤200K
   * context (this app's calls are all well under that). */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens — same tier/scope as above. */
  outputPerMTok: number;
};

// Anthropic's 5-minute ("ephemeral", the only TTL this app uses -- see
// anthropicProvider.server.ts's own module doc) prompt-caching multipliers
// ON TOP OF a model's own `inputPerMTok`: a WRITE (the first time a given
// prefix is cached) costs 25% MORE than an ordinary input token, and a
// READ (a later call reusing that exact cached prefix) costs 90% LESS.
// These ratios are fixed by Anthropic across every model that supports
// caching, so they live here once rather than per-model.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// USD per 1M tokens. Only models this app actually configures
// (`DEFAULT_MODEL`/`PHYLOG_ANTHROPIC_MODEL`, `anthropicProvider.server.ts`)
// need an entry — an unlisted model just can't be cost-estimated yet
// (`estimateCostUsd` returns null, never throws).
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5-20250929": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Best-effort $ estimate for one (model, token counts) combination — null
 * when the model isn't in the table above (a brand new/unlisted model),
 * never a thrown error. */
export function estimateCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | null {
  if (!model) return null;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok +
    (cacheWriteTokens / 1_000_000) * pricing.inputPerMTok * CACHE_WRITE_MULTIPLIER +
    (cacheReadTokens / 1_000_000) * pricing.inputPerMTok * CACHE_READ_MULTIPLIER
  );
}

/** Whether `PRICING_AS_OF` is old enough that a human should go re-check
 * https://platform.claude.com/docs/en/about-claude/pricing before trusting
 * cost figures derived from this table. */
export function isPricingStale(): boolean {
  return pricingAgeDays() > PRICING_MAX_AGE_DAYS;
}

export function pricingAgeDays(): number {
  const ageMs = Date.now() - new Date(PRICING_AS_OF).getTime();
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}
