import Surreal from "surrealdb";

export interface DbConfig {
  url: string;
  namespace: string;
  database: string;
  auth: {
    username: string;
    password: string;
  };
}

// Exported (not just module-local) so `realtime.server.ts` can open its own
// dedicated persistent connection against the exact same namespace/database/
// auth — SurrealDB's LIVE SELECT only works over a WebSocket, so that
// connection is a second, long-lived one, distinct from `getDb()`'s own
// cached connection below. Never mutate this object — treat it as read-only
// config.
export const DEFAULT_CONFIG: DbConfig = {
  url: process.env.DATABASE_URL || "http://localhost:8080/rpc",
  // Overridable so a staging deployment can point at the SAME SurrealDB
  // instance/credentials as prod, just a different `database` (see
  // db/clone-to-staging.sh) — unset in prod, so this is a no-op there.
  namespace: process.env.DATABASE_NAMESPACE || "nopal",
  database: process.env.DATABASE_DATABASE || "opuntia",
  auth: {
    username: process.env.DATABASE_USERNAME || "",
    password: process.env.DATABASE_PASSWORD || "",
  },
};

/**
 * A SINGLE connection, reused for the lifetime of the process — NOT one
 * `connect()`+`signin()`+`use()` handshake per query. `generic.server.ts`'s
 * `query`/`select`/`merge`/`upsert`/`remove` used to call `getDb()` fresh
 * (and `db.close()` it again) for every single operation; each of those is
 * a full round trip (connect, authenticate, select namespace/database)
 * BEFORE the actual query even runs, and every one of those round trips
 * crosses regions in production (`webapp` runs in `lax`, `db` in `dfw`) —
 * on a page whose loader makes many small sequential queries (e.g. Daily
 * Log resolving several days' worth of Cards), that overhead dominates
 * total latency far more than the query's own execution time, which is why
 * indexing alone (see migration `0009_indexes.surql`) wasn't the fix.
 *
 * `cachedDbPromise` (not just the resolved `Surreal` instance) so that
 * multiple requests arriving concurrently on a cold process all await the
 * SAME in-flight connection attempt instead of racing to open several.
 */
let cachedDbPromise: Promise<Surreal> | null = null;

/**
 * Identifies which `connect()` call a given keepalive timer (below) belongs
 * to, bumped once per successful connection. Lets a timer notice it's been
 * superseded (by a fresh reconnect, from either its OWN failed ping or
 * `generic.server.ts` hitting a dead connection first) and stop quietly
 * instead of going on to ping a `Surreal` instance nobody holds a reference
 * to anymore.
 */
let connectionGeneration = 0;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Comfortably under the idle timeouts of the intermediaries this
 * connection's traffic actually crosses in production (`webapp`/`fruits`
 * in `lax`, the DB in `dfw` -- some proxy or NAT in between, not SurrealDB
 * itself, is the one silently dropping a quiet-too-long socket). A real
 * repro motivated this: `/v2` 404ing after the page sat untouched for a
 * while, loading fine again on the very next request (see `generic.server
 * .ts`'s own retry-on-dead-connection fix for the other half of that
 * story) -- this keepalive aims to stop the connection from ever going
 * idle long enough to be dropped in the first place, rather than only
 * recovering gracefully after the fact.
 */
const KEEPALIVE_INTERVAL_MS = 20_000;

function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/** `.unref()`'d so this timer never by itself keeps the Node process alive
 * (a graceful shutdown, a one-off script, a test run that happens to
 * import this module) -- it should only ever fire while something else is
 * already keeping the process running. */
function startKeepalive(db: Surreal, generation: number): void {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (generation !== connectionGeneration) {
      // Superseded by a newer connection already -- this timer's own `db`
      // is on its way out (or already gone); nothing left to keep alive.
      stopKeepalive();
      return;
    }
    db.ping().catch((err) => {
      console.error(
        "SurrealDB keepalive ping failed -- invalidating the cached connection so the next query reconnects:",
        err instanceof Error ? err.message : String(err),
      );
      invalidateDb();
    });
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveTimer.unref?.();
}

async function connect(config: DbConfig): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(config.url, { versionCheck: false });
  await db.signin({ ...config.auth });
  await db.use({ namespace: config.namespace, database: config.database });
  connectionGeneration += 1;
  startKeepalive(db, connectionGeneration);
  return db;
}

export async function getDb(config: DbConfig = DEFAULT_CONFIG): Promise<Surreal> {
  if (!cachedDbPromise) {
    cachedDbPromise = connect(config).catch((err) => {
      // Don't cache a failed attempt forever — let the next call retry.
      cachedDbPromise = null;
      throw err;
    });
  }

  try {
    return await cachedDbPromise;
  } catch (err) {
    console.error(
      "Failed to connect to SurrealDB:",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Drops the cached connection so the NEXT `getDb()` call reconnects from
 * scratch — self-healing after a connection genuinely dies (DB restart, a
 * network blip) without needing a process restart. `generic.server.ts`
 * calls this from its own catch blocks; it does NOT try to distinguish
 * "the connection died" from "this one query was invalid" (SurrealDB
 * errors aren't reliably typed for that), so a bad query does cost one
 * wasted reconnect — a rare, cheap price for never getting stuck on a
 * silently-dead connection.
 */
export function invalidateDb(): void {
  stopKeepalive();
  cachedDbPromise = null;
}
