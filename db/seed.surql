-- =============================================================================
-- Dev Seed
-- Run via: make seed
-- NOTE: Each USE must be on the same line as any statement that depends on its
--       context, because the surreal sql REPL processes lines individually.
-- =============================================================================

-- Namespaces
DEFINE NAMESPACE IF NOT EXISTS nopal;

-- Databases
USE NS nopal; DEFINE DATABASE IF NOT EXISTS dev;

-- =============================================================================
-- Verify
-- =============================================================================

INFO FOR ROOT;
USE NS nopal; INFO FOR NS;
USE NS nopal DB opuntia; INFO FOR DB;
