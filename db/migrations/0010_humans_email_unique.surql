-- =============================================================================
-- 0010_humans_email_unique — one human per email address, enforced by the
-- schema instead of guessed at by every reader.
--
-- Two `humans` rows sharing an email is data corruption, not a local-dev
-- quirk. It happened routinely: `make reset` seeds fixture humans at
-- hand-written ids (`admin_1` and friends), `pull-daily-logs.ts` then adds
-- another row at the real PRODUCTION id with the same address, and
-- `getHumanByEmail` — the login path (login.tsx, auth.server.ts,
-- webauthn.server.ts) — ran an unordered `SELECT` and took `result[0][0]`.
-- Which identity a login bound to was a coin flip that could differ between
-- machines, and between resets on the same machine. The account that owns
-- your pulled data and the account you were logged in as were not reliably
-- the same account.
--
-- The other two halves of the fix live in `webapp/scripts/seed/tables/
-- humans.ts` (fixtures use a reserved `@seed.local` domain, so the
-- collision is structurally impossible rather than repaired after the
-- fact) and `humans.server.ts` (`getHumanByEmail` orders deterministically
-- and warns if it ever sees more than one row — which this index should
-- make unreachable, and that is exactly why the warning is worth keeping).
--
-- NOT YET RUN AGAINST PRODUCTION. This needs a deliberate run by whoever
-- holds database access, alongside `webapp/scripts/migrate-recascade-
-- shared-with.ts`. See ADR-015.
-- =============================================================================

-- Duplicates are REPORTED, never resolved automatically. Merging two humans
-- means deciding which row keeps the vault folders, daily logs, sessions and
-- passkeys already hanging off it, and nothing here can make that call
-- safely — picking a winner by hand is the whole job. A `DEFINE INDEX` that
-- fails on a duplicate rolls back cleanly (verified against surrealdb 3.2),
-- so re-running this migration after fixing the data is safe; the throw
-- below just replaces a one-record-at-a-time index error with the full list
-- and a next step.
--
-- Note a row with NO email counts here too: two of those collide in a unique
-- index exactly like two matching addresses do, and a human with no email
-- can't log in anyway, so it is a real problem either way.
LET $duplicates = (
  SELECT * FROM (
    SELECT string::lowercase(email) AS email, count() AS rows FROM humans GROUP BY email
  ) WHERE rows > 1
);

IF array::len($duplicates) > 0 {
  THROW "0010_humans_email_unique: these email addresses have more than one `humans` row, so a unique index cannot be defined yet: "
    + <string>$duplicates
    + ". Decide which row each address should keep (the one that owns its vault data), move or delete the others, then re-run. This migration will not choose for you.";
};

DEFINE INDEX IF NOT EXISTS humans_email_unique ON humans FIELDS email UNIQUE;
