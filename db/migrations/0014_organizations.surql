-- =============================================================================
-- 0014_organizations — Organizations as a first-class concept (foundation
-- only; see garden/3-growing/organizations.md, Phase A).
--
-- `organizations`: which Organizations exist.
-- `organization_members`: which Humans belong to one, and their role —
--   reusing the existing project-role vocabulary (`features.ts`'s `GROUPS`:
--   Guide/Crafter/Observer/Client), not a new one invented for this.
--
-- Exactly one Organization is hard-coded for now: Nopal, at a fixed,
-- well-known id (`organizations:nopal`) so `organizations.server.ts` can
-- reference it as a literal TypeScript constant (`NOPAL_ORGANIZATION_ID`)
-- rather than looking it up by name. It is the default used anywhere an
-- Organization is needed until a second one is ever created.
--
-- No access-control behavior changes here — `vault_folders.organization_id`
-- (stamped by `createVaultFolder`, backfilled onto existing projects by the
-- "Backfill organizations" admin script) and `organization_members` are pure
-- additions; nothing yet reads them to grant or refuse access.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS organizations TYPE ANY SCHEMALESS PERMISSIONS NONE;
DEFINE TABLE IF NOT EXISTS organization_members TYPE ANY SCHEMALESS PERMISSIONS NONE;

-- `organization_members`: looked up by org (list its members) and by human
-- (a human's own org memberships) — both used alone as the sole filter, same
-- precedent as 0009_indexes' vault_folders/file_refs indexes.
DEFINE INDEX IF NOT EXISTS organization_members_organization ON organization_members FIELDS organization_id;
DEFINE INDEX IF NOT EXISTS organization_members_human ON organization_members FIELDS human_id;
-- One membership row per (organization, human) pair.
DEFINE INDEX IF NOT EXISTS organization_members_org_human_unique ON organization_members FIELDS organization_id, human_id UNIQUE;

-- The one hard-coded Organization.
UPSERT organizations:nopal CONTENT { name: "Nopal", created_at: time::now() };
