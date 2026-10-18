import Surreal, { RecordId } from "surrealdb";
import { getDb, invalidateDb } from "./db.server";
import { timeRequestPerf } from "./requestPerfContext.server";

/** A short, loggable label for a SurrealQL query string — collapsed
 * whitespace, capped length — used as the `name` of the automatic `"db"`
 * perf event these functions record whenever a request is being traced
 * (see `requestPerfContext.server.ts`). Never the full query, just a
 * label: some callers build quite long multi-line SurrealQL. */
function summarizeQuery(q: string): string {
  const collapsed = q.replace(/\s+/g, " ").trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
}

export type AllQueryOptions = {
  order?: "date" | "title";
  limit?: number;
  start?: number;
};

export type Data = {
  id: { tb: string; id: string };
  _id: string;
};

export type Collection<T extends Data> = {
  data: T[];
  metadata: {
    nextStart: number | null;
  };
};

const DEFAULT_LIMIT = 5;

export function formatRecord<T extends Data>({ id, ...data }: T): T {
  return {
    ...data,
    _id: id.id,
    id: { tb: id.tb, id: id.id },
  } as T;
}

// Helps keep collection response consistent, handles extra pagination.
export function formatCollection<T extends Data>(
  data: T[] = [],
  { start = 0, limit = DEFAULT_LIMIT }: AllQueryOptions = {},
): Collection<T> {
  if (!data.length) {
    return {
      metadata: { nextStart: null },
      data: [],
    };
  }

  const nextStart = data.length > limit ? start + limit : null;
  return {
    metadata: { nextStart },
    data: data.reduce((acc: T[], d: T, i: number) => {
      if (i >= limit) {
        return acc;
      }
      const r = formatRecord<T>(d);
      return acc.concat(r);
    }, []),
  };
}

export async function queryCollection<T extends Data>(
  query: string,
  params: Record<string, any> = {},
  options: AllQueryOptions = {},
): Promise<Collection<T>> {
  const { limit = DEFAULT_LIMIT, start = 0 } = options;
  const queryParams = { ...params, limit: limit + 1, start };

  // Up to 2 attempts: `getDb()` can hand back a cached connection that's
  // gone dead (e.g. an idle cross-region WebSocket silently dropped by a
  // proxy/NAT) -- the dead connection's first query throws, which used to
  // be swallowed here and returned as an empty collection, indistinguishable
  // from a real "no rows" result to every caller (e.g. a vault lookup
  // reading this as "not found" and 404ing a page that's actually fine --
  // see the /v2 404-after-idle investigation). `invalidateDb()` already
  // resets the cached connection so the NEXT call reconnects from scratch;
  // retrying once HERE means that reconnect happens within the same
  // request instead of only benefiting whichever request happens to come
  // next.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await timeRequestPerf("db", summarizeQuery(query), queryParams, () =>
        db.query<[T[]]>(query, queryParams),
      );
      return formatCollection(result?.[0] || [], { start, limit });
    } catch (err) {
      console.error("Failed to get data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return formatCollection();
}

export async function query<T extends unknown[]>(
  query: string,
  params: Record<string, any> = {},
) {
  // See `queryCollection`'s own comment above on why this retries once
  // instead of swallowing a dead-connection error as an empty result.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await timeRequestPerf("db", summarizeQuery(query), params, () => db.query<T>(query, params));
      return result;
    } catch (err) {
      console.error("Failed to get data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return [];
}

export async function select<T extends Data>(
  thing: RecordId,
): Promise<T | undefined>;
export async function select<T extends Data>(
  thing: string,
): Promise<Collection<T> | undefined>;
export async function select<T extends Data>(thing: RecordId | string) {
  // See `queryCollection`'s own comment above on why this retries once
  // instead of swallowing a dead-connection error as an empty result.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await timeRequestPerf(
        "db",
        `select ${typeof thing === "string" ? thing : thing.tb}`,
        null,
        () => db.select<T>(thing),
      );
      if (!result) {
        return undefined;
      }
      if (Array.isArray(result)) {
        return formatCollection<T>(result, { limit: result.length });
      }
      return formatRecord<T>(result);
    } catch (err) {
      console.error("Failed to get data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return undefined;
}

/** Random id in the shape SurrealDB generates (20 lowercase alnum), for
 * a row made in code. */
export function newRecordId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function defineTable(name: string) {
  return await query(
    `DEFINE TABLE IF NOT EXISTS ${name} TYPE ANY SCHEMALESS PERMISSIONS NONE`,
  );
}

export async function remove(tb: string, id: string) {
  // See `queryCollection`'s own comment above on why this retries once
  // instead of swallowing a dead-connection error as an empty result.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await db.delete(new RecordId(tb, id));
      return result;
    } catch (err) {
      console.error("Failed to delete data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return undefined;
}

export async function merge(
  tb: string,
  id: string,
  data: Record<string, unknown>,
) {
  // See `queryCollection`'s own comment above on why this retries once
  // instead of swallowing a dead-connection error as an empty result.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await db.merge(new RecordId(tb, id), data);
      return result;
    } catch (err) {
      console.error("Failed to merge data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return undefined;
}

export async function upsert(name: string | RecordId, record: any) {
  // See `queryCollection`'s own comment above on why this retries once
  // instead of swallowing a dead-connection error as an empty result.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const db = await getDb();
    try {
      const result = await db.upsert(name, record);
      if (!result) {
        return undefined;
      }
      return result;
    } catch (err) {
      console.error("Failed to upsert data:", err);
      invalidateDb();
      if (attempt === 2) break;
    }
  }
  return undefined;
}
