-- =============================================================================
-- 0011_steep_readings — the Steep-o-meter's table (ADR-022).
--
-- One row per person, per project, per day, at the record id
-- [human_id, project_folder_id, date], so a second tap the same day
-- replaces the first. `steepReadings.server.ts` also defines the table on
-- first use, because the dashboard reads it before anyone has tapped and
-- SurrealDB errors on a table it has never seen.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS steep_readings TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS steep_readings_project_date ON steep_readings FIELDS project_folder_id, date;
