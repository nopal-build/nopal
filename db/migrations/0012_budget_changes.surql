-- =============================================================================
-- 0012_budget_changes — the Budget's table (ADR-028).
--
-- Append-only: one row per budget line per change, `kind: start` for the
-- first values (dated the estimate's own day) and `kind: change` after,
-- each with its author and date. The current value of a line is its
-- latest row; nothing is rewritten. `budget.server.ts` also defines the
-- table on first use, because the Costs tab reads it before anyone has
-- started a budget and SurrealDB errors on a table it has never seen.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS budget_changes TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS budget_changes_project_line ON budget_changes FIELDS project_folder_id, line_key;
