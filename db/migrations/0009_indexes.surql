-- =============================================================================
-- 0009_indexes — hot-path indexes for vault_folders/file_refs/daily_logs
--
-- Every query against these tables was a full TableScan (confirmed via
-- `SELECT ... EXPLAIN`) — fine while the tables are small, but they're
-- exactly the tables that grow fastest (every sync, upload, PhyLog capture
-- run adds rows), which is why Vault/Dashboard/Daily Log pages degrade
-- over time while pages hitting small/bounded tables (e.g. Maker's
-- `humans`/date-windowed `daily_logs`) don't. See the query patterns in
-- `packages/robustness-core/src/data/{vault,dailyLog,releaseLog}.server.ts`.
-- =============================================================================

-- vault_folders: `WHERE human_id = $x` (getFoldersByHuman, and others) and
-- `WHERE parent_folder_id = $x` (listFolderChildren and others) are each
-- used as the SOLE filter in several call sites.
DEFINE INDEX IF NOT EXISTS vault_folders_human_id       ON vault_folders FIELDS human_id;
DEFINE INDEX IF NOT EXISTS vault_folders_parent_folder  ON vault_folders FIELDS parent_folder_id;

-- file_refs: `human_id` and `folder_id` are each used alone in several
-- places (getFileRefsByHuman, getFileRefsByFolderIds), and together in
-- others (getDailyLogCards, createDailyLogCard, getDailyLogFolderAndReadmeId)
-- — the compound index below covers both the compound queries AND (via its
-- leftmost prefix) plain `WHERE human_id = $x` queries; folder_id alone
-- still gets its own index since it's also queried without human_id.
DEFINE INDEX IF NOT EXISTS file_refs_human_folder  ON file_refs FIELDS human_id, folder_id;
DEFINE INDEX IF NOT EXISTS file_refs_folder_id     ON file_refs FIELDS folder_id;
DEFINE INDEX IF NOT EXISTS file_refs_s3_key        ON file_refs FIELDS s3_key;
DEFINE INDEX IF NOT EXISTS file_refs_project_folder ON file_refs FIELDS project_folder_id;
DEFINE INDEX IF NOT EXISTS file_refs_archived_at   ON file_refs FIELDS archived_at;

-- daily_logs: `WHERE humanId = $x [AND date ...]` (getDailyLogs,
-- getDailyLogByDate) and `WHERE date >= $x` alone (getDailyLogsSince, used
-- by Maker's own stats AND the sort-all cron) — both patterns covered.
DEFINE INDEX IF NOT EXISTS daily_logs_human_date ON daily_logs FIELDS humanId, date;
DEFINE INDEX IF NOT EXISTS daily_logs_date       ON daily_logs FIELDS date;
