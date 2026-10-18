/**
 * The zero-dependency core of server request-performance tracing: an
 * `AsyncLocalStorage` context that lets ANY function anywhere in the call
 * stack — in particular `generic.server.ts`'s own `query`/`select`/
 * `queryCollection` — record a timed "this happened during the active
 * request" event without being passed a recorder explicitly, and without
 * `generic.server.ts` needing to import the persistence layer
 * (`requestPerf.server.ts`, which itself depends on `generic.server.ts` to
 * write rows — importing it back from here would be a cycle).
 *
 * Deliberately NOT a cache of its own events, and never talks to the
 * database. It only buffers events in memory for whichever
 * `withRequestPerf` call (see `requestPerf.server.ts`) is currently
 * active, which flushes them once the request finishes. A call with no
 * active context (no request currently being traced) is a complete
 * no-op — every untraced request stays exactly as fast as it is today;
 * tracing is opt-in per route, not a blanket middleware (see
 * `requestPerf.server.ts`'s own header for why).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestPerfEventType = "fn" | "db";

export type RequestPerfEventDraft = {
  type: RequestPerfEventType;
  name: string;
  params: Record<string, unknown> | null;
  durationMs: number;
  startedAt: string;
  outcome: "ok" | "error";
};

export interface ActiveRequestPerfContext {
  pushEvent(event: RequestPerfEventDraft): void;
}

const requestPerfContext = new AsyncLocalStorage<ActiveRequestPerfContext>();

/** Runs `fn` with `ctx` as the active context for anything it calls,
 * directly or transitively (including across `await`s — that's exactly
 * what `AsyncLocalStorage` is for). Exported only for
 * `requestPerf.server.ts`'s own `withRequestPerf`; nothing else should
 * need to reach for this directly. */
export function runWithRequestPerfContext<T>(ctx: ActiveRequestPerfContext, fn: () => T): T {
  return requestPerfContext.run(ctx, fn);
}

function recordEvent(event: RequestPerfEventDraft): void {
  const ctx = requestPerfContext.getStore();
  if (!ctx) return;
  try {
    ctx.pushEvent(event);
  } catch (err) {
    // Same "metrics must never break the real work they're describing"
    // rule `graphLogPerf.server.ts` follows.
    console.error("Request perf event recording failed (non-fatal):", err);
  }
}

/**
 * Wraps an async call, timing it wall-clock and recording the event
 * automatically — records (with `outcome: "error"`) even if `fn` throws,
 * then rethrows so the caller's own error handling is unaffected. A
 * complete no-op (just runs and returns `fn()` unchanged, with no timing
 * overhead beyond one `getStore()` check) when no request is currently
 * being traced, so this is always safe to sprinkle around a call site —
 * see `generic.server.ts` for the automatic `"db"` use, and `vault.tsx`'s
 * loader for an explicit `"fn"` use around a suspected-expensive call.
 */
export async function timeRequestPerf<T>(
  type: RequestPerfEventType,
  name: string,
  params: Record<string, unknown> | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!requestPerfContext.getStore()) return fn();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const result = await fn();
    recordEvent({ type, name, params, durationMs: Date.now() - start, startedAt, outcome: "ok" });
    return result;
  } catch (err) {
    recordEvent({ type, name, params, durationMs: Date.now() - start, startedAt, outcome: "error" });
    throw err;
  }
}
