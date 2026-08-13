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
  namespace: "nopal",
  database: "opuntia",
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

async function connect(config: DbConfig): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(config.url, { versionCheck: false });
  await db.signin({ ...config.auth });
  await db.use({ namespace: config.namespace, database: config.database });
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
  cachedDbPromise = null;
}
