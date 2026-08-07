import Surreal from "surrealdb";
import { DEFAULT_CONFIG } from "./db.server";

/**
 * Real-time vault change feed — the server side of "switch devices without
 * a force-refresh" (see the daily-log skill conversation this came out of).
 *
 * Driven entirely by SurrealDB's own `LIVE SELECT` on `file_refs` and
 * `vault_folders`, NOT by manually emitting an event at every mutation call
 * site in `vault.server.ts`. That means every write path — the web app, the
 * CLI's `nopal sync`, a future admin script — is picked up identically and
 * automatically, with nothing to remember to instrument as new mutation
 * functions get added later.
 *
 * `LIVE SELECT` only works over a WebSocket connection (never HTTP), so this
 * module opens exactly ONE persistent `ws://` connection per server process
 * — separate from, and unrelated to, the plain open-per-query-then-close
 * HTTP connections `generic.server.ts`'s `getDb()` hands out for everything
 * else. Registering the live queries broadly (whole-table, not one
 * `WHERE human_id = ...` query per signed-in human) is the deliberate
 * design choice that makes this scale with the number of APP INSTANCES
 * rather than the number of USERS: fan-out to the right human's own SSE
 * subscribers happens here, in process, after the fact. Running N Fly
 * machines means N of these connections against the same single-node
 * SurrealDB — trivial load for the database either way.
 *
 * Caveat worth remembering (not solving here): SurrealDB currently only
 * supports LIVE SELECT against a single-node deployment. Fine today (the
 * default `surrealkv://` backend both locally and in prod IS single-node),
 * but a future move to a clustered DB backend would need re-checking
 * against whatever SurrealDB supports by then.
 */

export type VaultChangeAction = "CREATE" | "UPDATE" | "DELETE";
type WatchedTable = "file_refs" | "vault_folders";
const LIVE_TABLES: WatchedTable[] = ["file_refs", "vault_folders"];

export type VaultChangeEvent = {
  table: WatchedTable;
  action: VaultChangeAction;
  /** The record's own id, without the table prefix (matches `_id` shape
   * used everywhere else in this codebase — see `formatRecord`). */
  id: string;
  humanId: string;
  /** `file_refs.folder_id` or `vault_folders.parent_folder_id`. */
  folderId: string | null;
  name: string | null;
  /** `file_refs` only. */
  contentType: string | null;
  /** `file_refs` only — true once `archived_at` is set on an otherwise
   * plain UPDATE. Archived files are invisible to every listing (see
   * `listFilesMetaByFolderIds`'s own comment), so a consumer should treat
   * this exactly like a DELETE for cache purposes. */
  archived: boolean;
  /** `file_refs.source` (`"daily_log"` | `"daily_log_card"` | undefined) —
   * lets a consumer like the Daily Log page filter to only the events that
   * could plausibly affect it, instead of reacting to every vault change
   * anywhere (a project file upload, an unrelated shared folder, …). Fewer
   * spurious revalidates also means fewer chances to hit the same-tab
   * stale-read race `saveFetcher.state` guards against client-side. */
  source: string | null;
  at: string;
};

type Listener = (event: VaultChangeEvent) => void;

const subscribersByHuman = new Map<string, Set<Listener>>();

/** Who owns a given record — refreshed on every CREATE/UPDATE we observe,
 * and used to route a DELETE notification even if it doesn't itself carry
 * `human_id` (SurrealDB's own docs are inconsistent across versions about
 * how much of the record a DELETE notification includes; this makes the
 * behavior correct either way without depending on which one is true for
 * the version actually deployed). Cleared on DELETE. */
const ownerByRecordKey = new Map<string, string>();

let liveConnection: Promise<Surreal> | null = null;

function toWebSocketUrl(httpUrl: string): string {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return httpUrl;
  }
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  // A RecordId-shaped reference (e.g. `folder_id` stored as a real link
  // rather than a plain string) — defensive, not something this codebase
  // does today, but cheap to guard against.
  if (typeof value === "object" && "id" in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id);
  }
  return String(value);
}

function handleNotification(
  table: WatchedTable,
  action: VaultChangeAction | "CLOSE",
  result: Record<string, unknown> | "killed" | "disconnected",
) {
  if (action === "CLOSE") {
    console.warn(`[realtime] live query on "${table}" closed: ${result}`);
    return;
  }

  const rawId = (result as Record<string, unknown>).id as
    | { tb?: string; id?: unknown }
    | undefined;
  if (!rawId || rawId.id === undefined) return;
  const id = String(rawId.id);
  const recordKey = `${table}:${id}`;

  let humanId = readString((result as Record<string, unknown>).human_id);
  if (humanId) {
    ownerByRecordKey.set(recordKey, humanId);
  } else {
    humanId = ownerByRecordKey.get(recordKey) ?? null;
  }
  if (action === "DELETE") ownerByRecordKey.delete(recordKey);
  if (!humanId) return; // no known owner to route this to — safest to drop it

  const archivedAt =
    table === "file_refs" ? (result as Record<string, unknown>).archived_at : null;

  const event: VaultChangeEvent = {
    table,
    action,
    id,
    humanId,
    folderId: readString(
      table === "file_refs"
        ? (result as Record<string, unknown>).folder_id
        : (result as Record<string, unknown>).parent_folder_id,
    ),
    name: readString((result as Record<string, unknown>).name),
    contentType:
      table === "file_refs"
        ? readString((result as Record<string, unknown>).content_type)
        : null,
    archived: table === "file_refs" ? !!archivedAt : false,
    source:
      table === "file_refs" ? readString((result as Record<string, unknown>).source) : null,
    at: new Date().toISOString(),
  };

  const subs = subscribersByHuman.get(humanId);
  if (!subs || subs.size === 0) return;
  for (const listener of subs) listener(event);
}

async function registerLiveQueries(db: Surreal) {
  for (const table of LIVE_TABLES) {
    try {
      await db.live(table, (action, result) => handleNotification(table, action, result));
    } catch (err) {
      console.error(`[realtime] failed to register LIVE SELECT on "${table}":`, err);
    }
  }
}

async function connectLiveDb(): Promise<Surreal> {
  const db = new Surreal();
  const url = toWebSocketUrl(DEFAULT_CONFIG.url);

  // The very first "connected" fires the instant the transport opens —
  // before this function's own signin/use below get a chance to run (they
  // raced, and lost, against `registerLiveQueries` here in practice: "the
  // table does not exist"/"Specify a namespace to use" from `db.live()`
  // confirmed it empirically). Skip that first event and do initial setup
  // explicitly, in order, right after `connect()` resolves instead; this
  // handler is then only for a real RECONNECT later, which drops the
  // signed-in session/namespace just as much as a fresh connection does,
  // so it needs the exact same signin → use → live sequence redone.
  let initial = true;
  db.emitter.subscribe("connected", () => {
    if (initial) return;
    setupLiveConnection(db).catch((err) =>
      console.error("[realtime] failed to re-establish live queries after reconnect:", err),
    );
  });
  db.emitter.subscribe("error", (err: Error) => {
    console.error("[realtime] SurrealDB live socket error:", err.message);
  });

  await db.connect(url, { versionCheck: false, reconnect: true });
  initial = false;
  await setupLiveConnection(db);
  return db;
}

async function setupLiveConnection(db: Surreal) {
  await db.signin({ ...DEFAULT_CONFIG.auth });
  await db.use({
    namespace: DEFAULT_CONFIG.namespace,
    database: DEFAULT_CONFIG.database,
  });
  await registerLiveQueries(db);
}

/** Lazily opens the one shared live-query connection on first subscriber —
 * never during module import (avoids opening a real socket during
 * build/typecheck, and means a brief SurrealDB outage at server boot
 * doesn't take the whole process down with it). */
function ensureLiveConnection(): Promise<Surreal> {
  if (!liveConnection) {
    liveConnection = connectLiveDb().catch((err) => {
      console.error("[realtime] failed to establish live connection:", err);
      liveConnection = null; // let the next subscriber retry from scratch
      throw err;
    });
  }
  return liveConnection;
}

/**
 * Subscribes `listener` to every real-time change (file or folder created,
 * updated, or deleted) affecting `humanId`'s own vault. Returns an
 * unsubscribe function — always call it when the caller's own connection
 * (e.g. an SSE request) ends.
 */
export function subscribeToVaultEvents(humanId: string, listener: Listener): () => void {
  ensureLiveConnection().catch(() => {
    // Already logged in `connectLiveDb`/`ensureLiveConnection` above —
    // the subscriber stays registered so it starts receiving events the
    // moment a later call successfully (re)establishes the connection.
  });

  let set = subscribersByHuman.get(humanId);
  if (!set) {
    set = new Set();
    subscribersByHuman.set(humanId, set);
  }
  set.add(listener);

  return () => {
    set?.delete(listener);
    if (set && set.size === 0) subscribersByHuman.delete(humanId);
  };
}
