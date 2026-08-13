import Surreal, { RecordId } from "surrealdb";
import { getDb } from "./db.server";

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
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return formatCollection();
  }

  try {
    const { limit = DEFAULT_LIMIT, start = 0 } = options;
    const result = await db.query<[T[]]>(query, {
      ...params,
      limit: limit + 1,
      start,
    });
    return formatCollection(result?.[0] || [], { start, limit });
  } catch (err) {
    console.error("Failed to get data:", err);
  } finally {
    await db.close();
  }
  return formatCollection();
}

export async function query<T extends unknown[]>(
  query: string,
  params: Record<string, any> = {},
) {
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return [];
  }

  try {
    const result = await db.query<T>(query, params);
    return result;
  } catch (err) {
    console.error("Failed to get data:", err);
  } finally {
    await db.close();
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
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return undefined;
  }

  try {
    const result = await db.select<T>(thing);
    if (!result) {
      return undefined;
    }
    if (Array.isArray(result)) {
      return formatCollection<T>(result, { limit: result.length });
    }
    return formatRecord<T>(result);
  } catch (err) {
    console.error("Failed to get data:", err);
  } finally {
    await db.close();
  }
  return undefined;
}

export async function defineTable(name: string) {
  return await query(
    `DEFINE TABLE IF NOT EXISTS ${name} TYPE ANY SCHEMALESS PERMISSIONS NONE`,
  );
}

export async function remove(tb: string, id: string) {
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return undefined;
  }

  try {
    const result = await db.delete(new RecordId(tb, id));
    return result;
  } catch (err) {
    console.error("Failed to delete data:", err);
  } finally {
    await db.close();
  }
  return undefined;
}

export async function merge(
  tb: string,
  id: string,
  data: Record<string, unknown>,
) {
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return undefined;
  }
  try {
    const result = await db.merge(new RecordId(tb, id), data);
    return result;
  } catch (err) {
    console.error("Failed to merge data:", err);
  } finally {
    await db.close();
  }
  return undefined;
}

export async function upsert(name: string | RecordId, record: any) {
  const db = await getDb();
  if (!db) {
    console.error("Database not initialized");
    return undefined;
  }

  try {
    const result = await db.upsert(name, record);
    if (!result) {
      return undefined;
    }
    return result;
  } catch (err) {
    console.error("Failed to upsert data:", err);
  } finally {
    await db.close();
  }
  return undefined;
}
