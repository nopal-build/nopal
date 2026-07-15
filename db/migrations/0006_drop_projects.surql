-- =============================================================================
-- 0006_drop_projects — remove the projects table (feature retired; superseded
-- by vault project folders, which are unrelated data)
-- =============================================================================

REMOVE TABLE IF EXISTS projects;
