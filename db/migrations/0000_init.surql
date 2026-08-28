-- =============================================================================
-- 0000_init — initial schema
--
-- Context: NS nopal / DB prod (pre-selected by the migration runner).
-- Statements do not need inline USE — the session context is already set.
--
-- All statements should be idempotent so the file is safe to inspect/replay.
-- Use DEFINE ... IF NOT EXISTS for additive changes.
-- Use DEFINE ... OVERWRITE only when intentionally replacing a definition.
-- =============================================================================

-- Tables
DEFINE TABLE IF NOT EXISTS humans   TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE TABLE IF NOT EXISTS projects TYPE ANY SCHEMALESS PERMISSIONS NONE;
