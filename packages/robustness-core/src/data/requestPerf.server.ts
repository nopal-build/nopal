/**
 * Server-side request performance tracing — the same "measure real
 * durations, persist them, show them somewhere a human actually looks"
 * discipline `graphLogPerf.server.ts` already established for GraphLog
 * jobs (see that file's own header), applied here to ordinary page loads
 * instead. Deliberately server-side only — no browser/client timing
 * (Web Vitals, hydration) is tracked here; see the
 * `fruits-performance-monitoring` garden seed for why.
 *
 * Three tiers of granularity, one flat ordered timeline per request,
 * mirroring GraphLog's own `graphlog_runs`/`graphlog_run_events` shape:
 *
 *   1. `perf_requests` — one row per TRACED request (route, method, total
 *      wall-clock duration, outcome).
 *   2. `perf_request_events`, type `"fn"` — an explicit
 *      `timeRequestPerf("fn", ...)` call wrapped around one specific
 *      suspected-expensive function at its call site (see `vault.tsx`'s
 *      loader for the first example).
 *   3. `perf_request_events`, type `"db"` — automatic. `generic.server.ts`'s
 *      own `query`/`select`/`queryCollection` call `timeRequestPerf`
 *      directly, so every DB round trip during a traced request is
 *      captured for free, with no call-site changes needed anywhere else
 *      in the data layer.
 *
 * `timeRequestPerf` and the context it reads live in the separate,
 * dependency-free `requestPerfContext.server.ts`, specifically so
 * `generic.server.ts` can call it without a circular import back to THIS
 * file (which needs `generic.server.ts` itself to persist rows).
 *
 * Opt-in per route via `withRequestPerf` — deliberately NOT a blanket
 * middleware wrapping every request. This bounds write volume to exactly
 * the routes worth watching (today: the Vault loader) rather than a row
 * per request across the whole app, and sidesteps needing a sampling
 * scheme before one is actually needed — add more routes deliberately,
 * one at a time, not by flipping a global switch. See the garden seed's
 * own open question on this.
 *
 * Persistence is fire-and-forget: `withRequestPerf` returns the wrapped
 * function's own result/error to its caller immediately, and writes the
 * request + event rows afterward without making the caller wait on them.
 * A slow or failed write can never add latency to, or break, the real
 * request being measured — same rule `graphLogPerf.server.ts` and
 * `recordGraphLogUsage` already follow, for the same reason.
 */
import { RecordId } from "surrealdb";
import { query, remove, upsert, formatRecord, defineTable, newRecordId, type Data } from "./generic.server";
import { runWithRequestPerfContext, type RequestPerfEventDraft } from "./requestPerfContext.server";

export type PerfApp = "fruits" | "webapp";

export type PerfRequest = Data & {
  app: PerfApp;
  /** The route pathname, not the full URL — e.g. "/vault", not
   * "/vault?folder=abc123" — so requests to the same page group together
   * on the dashboard regardless of query string. */
  route: string;
  method: string;
  human_id: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** Reflects only whether the traced function threw a non-`Response`
   * error. A thrown `Response` (redirect, 404, etc.) is not an error —
   * its status lands in `status` below instead. Same kind of distinction
   * `graphlog_runs`'s own `ok` vs. `incomplete` draws for a different
   * reason: being well-behaved and being successful aren't the same
   * question. */
  outcome: "ok" | "error";
  /** HTTP status when known (every thrown `Response`, and every plain
   * return defaults to 200). `null` only for a thrown non-`Response`
   * error (see `outcome: "error"` and `error` below instead). */
  status: number | null;
  error: string | null;
};

export type PerfRequestEvent = Data & {
  request_id: string;
  /** Monotonic within one request — same ordering role `seq` plays in
   * `graphlog_run_events`. */
  seq: number;
  type: "fn" | "db";
  name: string;
  params: Record<string, unknown> | null;
  duration_ms: number;
  outcome: "ok" | "error";
  started_at: string;
};

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await defineTable("perf_requests");
  await defineTable("perf_request_events");
  tablesEnsured = true;
}

async function persistRequest(
  requestId: string,
  row: Omit<PerfRequest, "id" | "_id">,
  events: RequestPerfEventDraft[],
): Promise<void> {
  try {
    await ensureTables();
    await upsert(new RecordId("perf_requests", requestId), row);
    let seq = 0;
    for (const event of events) {
      await upsert("perf_request_events", {
        request_id: requestId,
        seq: seq++,
        type: event.type,
        name: event.name,
        params: event.params,
        duration_ms: Math.max(0, Math.round(event.durationMs)),
        outcome: event.outcome,
        started_at: event.startedAt,
      });
    }
  } catch (err) {
    console.error("Request perf persistence failed (non-fatal):", err);
  }
}

/**
 * Wraps a loader/action body, tracing its total duration plus every
 * nested `"fn"`/`"db"` event recorded during it (see the file header).
 * Returns/throws exactly what `fn` returns/throws, unchanged — tracing is
 * purely observational and never alters control flow, and the
 * persistence it triggers is fire-and-forget (see the file header).
 */
export async function withRequestPerf<T>(
  opts: { app: PerfApp; route: string; method: string; humanId: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const requestId = newRecordId();
  const events: RequestPerfEventDraft[] = [];
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const finish = (outcome: "ok" | "error", status: number | null, error: string | null) => {
    void persistRequest(
      requestId,
      {
        app: opts.app,
        route: opts.route,
        method: opts.method,
        human_id: opts.humanId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - start,
        outcome,
        status,
        error,
      },
      events,
    );
  };

  try {
    const result = await runWithRequestPerfContext({ pushEvent: (e) => events.push(e) }, fn);
    finish("ok", result instanceof Response ? result.status : 200, null);
    return result;
  } catch (err) {
    if (err instanceof Response) {
      finish("ok", err.status, null);
    } else {
      finish("error", null, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

/** Most recent traced requests, newest first — powers the "Recent
 * Requests" list on `/maker/performance`. */
export async function listRecentPerfRequests(limit = 50): Promise<PerfRequest[]> {
  await ensureTables();
  const result = await query<[PerfRequest[]]>(`SELECT * FROM perf_requests ORDER BY started_at DESC LIMIT $limit`, {
    limit,
  });
  return (result?.[0] ?? []).map(formatRecord);
}

/** One request plus its full event timeline, in order — powers the
 * individual request drill-down page. `null` if the request doesn't
 * exist (e.g. already pruned). */
export async function getPerfRequest(
  requestId: string,
): Promise<{ request: PerfRequest; events: PerfRequestEvent[] } | null> {
  await ensureTables();
  const requestResult = await query<[PerfRequest[]]>(`SELECT * FROM perf_requests WHERE id = $rid`, {
    rid: new RecordId("perf_requests", requestId),
  });
  const request = requestResult?.[0]?.[0] ? formatRecord(requestResult[0][0]) : null;
  if (!request) return null;

  const eventsResult = await query<[PerfRequestEvent[]]>(
    `SELECT * FROM perf_request_events WHERE request_id = $requestId ORDER BY seq ASC`,
    { requestId },
  );
  const events = (eventsResult?.[0] ?? []).map(formatRecord);
  return { request, events };
}

export type PerfSummary = {
  requestCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  /** Per-route breakdown, slowest average first — what the Maker landing
   * page's summary card actually shows. */
  byRoute: {
    route: string;
    requestCount: number;
    avgDurationMs: number;
    maxDurationMs: number;
  }[];
};

const EMPTY_SUMMARY: PerfSummary = {
  requestCount: 0,
  avgDurationMs: 0,
  p95DurationMs: 0,
  maxDurationMs: 0,
  errorCount: 0,
  byRoute: [],
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** High-level stats for the last `sinceDays` days of traced requests —
 * powers the "Performance" summary section on the Maker landing page.
 * Computed directly from `perf_requests` rows (no separate rollup table
 * yet — see the garden seed's open question on retention/pruning once
 * this grows past what's comfortable to scan on every Maker page load). */
export async function getPerfSummary(sinceDays = 7, limit = 1000): Promise<PerfSummary> {
  await ensureTables();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await query<[PerfRequest[]]>(
    `SELECT * FROM perf_requests WHERE started_at >= $since ORDER BY started_at DESC LIMIT $limit`,
    { since, limit },
  );
  const requests = (result?.[0] ?? []).map(formatRecord);
  if (requests.length === 0) return EMPTY_SUMMARY;

  const durations = requests.map((r) => r.duration_ms).sort((a, b) => a - b);
  const errorCount = requests.filter((r) => r.outcome === "error").length;

  const byRouteMap = new Map<string, number[]>();
  for (const r of requests) {
    const durationsForRoute = byRouteMap.get(r.route) ?? [];
    durationsForRoute.push(r.duration_ms);
    byRouteMap.set(r.route, durationsForRoute);
  }
  const byRoute = [...byRouteMap.entries()]
    .map(([route, d]) => ({
      route,
      requestCount: d.length,
      avgDurationMs: Math.round(d.reduce((a, b) => a + b, 0) / d.length),
      maxDurationMs: Math.max(...d),
    }))
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs);

  return {
    requestCount: requests.length,
    avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    p95DurationMs: percentile(durations, 95),
    maxDurationMs: durations[durations.length - 1],
    errorCount,
    byRoute,
  };
}

const DEFAULT_REQUEST_RETENTION_DAYS = 14;

/** Deletes requests (and their events) older than `retentionDays` — same
 * retention-window shape as `pruneOldGraphLogRuns`, just a shorter
 * default window since ordinary page-load volume is far higher than
 * GraphLog run volume (see the garden seed's write-volume question). Not
 * yet wired to a cron route — safe to call on-demand until it is. */
export async function pruneOldPerfRequests(
  retentionDays: number = DEFAULT_REQUEST_RETENTION_DAYS,
): Promise<{ deletedRequests: number; deletedEvents: number }> {
  await ensureTables();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const requestsResult = await query<[PerfRequest[]]>(`SELECT id FROM perf_requests WHERE started_at < $cutoff`, {
    cutoff,
  });
  const requests = (requestsResult?.[0] ?? []).map(formatRecord);

  let deletedEvents = 0;
  for (const r of requests) {
    const eventsResult = await query<[PerfRequestEvent[]]>(
      `SELECT id FROM perf_request_events WHERE request_id = $requestId`,
      { requestId: r._id },
    );
    const events = (eventsResult?.[0] ?? []).map(formatRecord);
    for (const ev of events) {
      await remove("perf_request_events", ev._id);
      deletedEvents++;
    }
    await remove("perf_requests", r._id);
  }
  return { deletedRequests: requests.length, deletedEvents };
}
