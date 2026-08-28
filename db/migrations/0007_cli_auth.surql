-- =============================================================================
-- 0007_cli_auth — bearer tokens for the `nopal` CLI ("nopal login")
--
-- A single table doubles as both the durable token record and the transient
-- "exchange code" handoff used during the loopback login flow: `exchangeCode`
-- / `exchangeCodeExpiresAt` / `pendingRawToken` are only ever populated
-- between "user approved in the browser" and "CLI exchanged the code for a
-- token", then cleared — mirroring the `inviteToken` pattern already used on
-- `humans`.
-- =============================================================================

DEFINE TABLE IF NOT EXISTS api_tokens TYPE ANY SCHEMALESS PERMISSIONS NONE;
