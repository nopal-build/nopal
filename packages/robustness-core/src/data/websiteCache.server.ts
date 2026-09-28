/**
 * A small Redis-backed cache for `/v2/*`'s resolved page lookups
 * (`website.server.ts`'s `resolveWebsitePageByPath`) — resolving a URL path
 * means walking the vault's folder tree (one `listFolderChildren` round
 * trip per path segment, then a final `getFileRefById`), all live SurrealDB
 * queries. Caching the RESOLVED result means a cache hit skips every one of
 * those round trips entirely and serves straight out of Redis.
 *
 * Same shared Redis instance `robustness-core`'s BullMQ queues already use
 * (`graphLogQueue.server.ts`, `mediaQueue.server.ts`, `publicZip.server.ts`)
 * — reachable from both `webapp` (the reader, `/v2/*`) and `fruits` (the
 * writer, Vault's website-page editor) even though they're two separate
 * deployed apps/processes, so a save made in `fruits` can invalidate a
 * cache entry read by `webapp`. A per-process in-memory `Map` couldn't do
 * this at all — it would only ever see writes from ITS OWN process.
 *
 * INVALIDATION is a version bump, not a delete. Every cached entry's own
 * Redis key embeds a per-site version number
 * (`website:page-cache-version:{siteFolderId}`); writing new content
 * doesn't touch any existing cache entry directly — it just `INCR`s that
 * version number (`invalidateWebsiteCache`, called from `vault.server.ts`'s
 * `updateFileRef` via `website.server.ts`'s `invalidateWebsiteCacheForFile`
 * whenever a `website`-project file's content/name/folder changes). The
 * very next read computes its cache key against the NEW version, which was
 * never written under, so it's an automatic, guaranteed miss — it
 * re-resolves for real and repopulates the cache under the new version.
 *
 * This sidesteps two real problems a delete-based scheme would have: (1) no
 * need to know exactly which cache KEY(s) a given file affects (a rename
 * changes the URL path; walking the tree backwards to figure out the old
 * AND new path just to delete two keys is real work this avoids entirely —
 * bumping the version invalidates every path under the site at once), and
 * (2) no race where a slow in-flight read (started before the write, still
 * resolving from the DB) repopulates a just-invalidated key with
 * about-to-be-stale data — it can only ever repopulate the version's key
 * that was CURRENT at the moment it read the version, which is correct by
 * construction. The TTL below is a pure backstop against a version number
 * surviving a Redis restart with no matching data (or just very
 * long-tail staleness protection) — not the primary invalidation
 * mechanism, which is immediate.
 *
 * Fails soft, on purpose: a cache is a performance optimization, not a
 * correctness dependency. If Redis is unreachable, every function below
 * swallows the error and behaves as a cache miss (read) or a no-op
 * (write/invalidate) — a page view falls back to resolving straight from
 * the DB, exactly like before this cache existed, rather than 500ing or
 * hanging the request. `enableOfflineQueue: false` +
 * `maxRetriesPerRequest: 1` (unlike the BullMQ connections elsewhere in
 * this package, which deliberately retry forever) make a disconnected
 * Redis fail FAST here instead of queueing/retrying — this is a
 * request-path cache, not a durable job queue.
 */

import IORedis from "ioredis";

let connection: IORedis | undefined;
function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    // A connection-level error would otherwise crash the process (Node's
    // default behavior for an EventEmitter's unhandled "error") — every
    // real call site below already wraps its own command in try/catch, so
    // this listener exists purely to absorb the emitter's own event, not
    // to handle anything itself.
    connection.on("error", () => {});
  }
  return connection;
}

const TTL_SECONDS = 60 * 60; // 1 hour backstop — see header comment.

function versionKey(siteFolderId: string): string {
  return `website:page-cache-version:${siteFolderId}`;
}

function pageKey(siteFolderId: string, version: number, pathKey: string): string {
  return `website:page-cache:${siteFolderId}:v${version}:${pathKey || "__index__"}`;
}

async function getVersion(siteFolderId: string): Promise<number> {
  try {
    const raw = await getConnection().get(versionKey(siteFolderId));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Bumps a site's cache version, invalidating every page cached under it in
 * one atomic, O(1) operation — see this module's header comment for why a
 * version bump instead of a delete. Call this any time a `website`
 * project's rendered page output could have changed. Today: only
 * `vault.server.ts`'s `updateFileRef`, via `website.server.ts`'s
 * `invalidateWebsiteCacheForFile`, whenever `content`/`name`/`folder_id`
 * is part of the update to a file living inside a `website`-typed folder.
 *
 * NOT hooked into a website-project FOLDER's own rename/move — a page
 * nested under a renamed folder resolves to a different URL going
 * forward, but the folder-rename path (`updateVaultFolder`/
 * `moveVaultFolder`) doesn't call this yet. A real, known, narrow gap:
 * until the TTL above naturally expires the old entry, a renamed/moved
 * folder's pages could serve a stale cached lookup by their OLD path for
 * up to an hour. Left unaddressed for now since renaming/moving a page
 * inside a live `website` project is rare compared to editing one's
 * content.
 */
export async function invalidateWebsiteCache(siteFolderId: string): Promise<void> {
  try {
    await getConnection().incr(versionKey(siteFolderId));
  } catch {
    // Fails soft — see header comment.
  }
}

export async function getCachedWebsitePage<T>(
  siteFolderId: string,
  pathKey: string,
): Promise<T | null> {
  try {
    const version = await getVersion(siteFolderId);
    const raw = await getConnection().get(pageKey(siteFolderId, version, pathKey));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedWebsitePage(
  siteFolderId: string,
  pathKey: string,
  page: unknown,
): Promise<void> {
  try {
    const version = await getVersion(siteFolderId);
    await getConnection().set(
      pageKey(siteFolderId, version, pathKey),
      JSON.stringify(page),
      "EX",
      TTL_SECONDS,
    );
  } catch {
    // Fails soft — see header comment.
  }
}
