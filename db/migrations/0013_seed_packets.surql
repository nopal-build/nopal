-- =============================================================================
-- 0013_seed_packets — seeding rounds, seed packet files, and the questions
-- sowing raises (`seedPackets.server.ts`).
--
-- A packet is rows, not a Vault folder: the bytes sit in storage (or
-- inline for text) and only the packet route serves them. The module also
-- defines the tables on first use, because the project page reads them
-- before anyone has opened a round and SurrealDB errors on a table it has
-- never seen.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS seed_rounds TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS seed_rounds_project ON seed_rounds FIELDS project_folder_id;
DEFINE TABLE IF NOT EXISTS seed_packet_files TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS seed_packet_files_project_human ON seed_packet_files FIELDS project_folder_id, human_id;
DEFINE TABLE IF NOT EXISTS seed_questions TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS seed_questions_project_status ON seed_questions FIELDS project_folder_id, status;
