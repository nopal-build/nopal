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
// connection is a second, long-lived one, distinct from the plain
// open-per-query-then-close HTTP connections `getDb()` itself hands out
// below. Never mutate this object — treat it as read-only config.
export const DEFAULT_CONFIG: DbConfig = {
  url: process.env.DATABASE_URL || "http://localhost:8080/rpc",
  namespace: "nopal",
  database: "opuntia",
  auth: {
    username: process.env.DATABASE_USERNAME || "",
    password: process.env.DATABASE_PASSWORD || "",
  },
};

export async function getDb(
  config: DbConfig = DEFAULT_CONFIG
): Promise<Surreal> {
  const db = new Surreal();

  try {
    await db.connect(config.url, { versionCheck: false });
    await db.signin({
      ...config.auth,
    });

    await db.use({ namespace: config.namespace, database: config.database });
    return db;
  } catch (err) {
    console.error(
      "Failed to connect to SurrealDB:",
      err instanceof Error ? err.message : String(err)
    );
    await db.close();
    throw err;
  }
}
