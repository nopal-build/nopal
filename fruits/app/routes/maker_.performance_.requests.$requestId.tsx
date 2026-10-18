// app/routes/maker_.performance_.requests.$requestId.tsx
// One traced request's own performance timeline — every "fn"/"db" event
// recorded during it, in the order it actually happened, each with a
// right-aligned duration bar. Linked from the "Recent Requests" list on
// /maker/performance. Admin/Super only, same gate as every other Maker
// page. See `requestPerf.server.ts` for how this data is captured —
// every duration here is code-measured wall-clock time server-side,
// never a self-reported number and never browser/client timing.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, redirect, useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { getPerfRequest, withRequestPerf, type PerfRequestEvent } from "robustness-core/data/requestPerf.server";
import { getHumansById } from "robustness-core/data/humans.server";
import { navFor } from "../data/nav.server";
import { TimezoneSelect } from "../components/TimezoneSelect";
import { useTimezonePref } from "../hooks/useTimezonePref";
import { formatPerfTimestamp } from "../util/perfTimezones";

export const meta: MetaFunction = () => [{ title: "O.No · M.Performance" }];

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireMakerAccess(request);
  const url = new URL(request.url);
  return withRequestPerf(
    { app: "fruits", route: url.pathname, method: request.method, humanId: user._id },
    async () => {
  const nav = await navFor(user._id);
  const requestId = params.requestId;
  if (!requestId) throw data("Missing request id", { status: 400 });

  const found = await getPerfRequest(requestId);
  if (!found) throw data("Request not found", { status: 404 });

  const humanName = found.request.human_id
    ? ((await getHumansById([found.request.human_id]))[0]?.name ?? found.request.human_id)
    : null;

  return { user, ...nav, request: found.request, events: found.events, humanName };
    },
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && (error.status === 403 || error.status === 404)) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-12" style={{ maxWidth: "640px" }}>
          <p className="text-sm subtle-text">
            {error.status === 404 ? "That request wasn't found — it may have been pruned." : "You don't have access to this page."}
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "640px" }}>
        <p className="text-sm subtle-text">Something went wrong loading this page.</p>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Milliseconds since the request itself started — lets the timeline
 * read as "T+0.4s", "T+2.1s", ... rather than repeating full timestamps
 * on every row. Same device the GraphLog run page uses. */
function formatOffset(iso: string, requestStartedAt: string): string {
  const offsetMs = new Date(iso).getTime() - new Date(requestStartedAt).getTime();
  if (!Number.isFinite(offsetMs) || offsetMs < 0) return "T+0s";
  return `T+${(offsetMs / 1000).toFixed(2)}s`;
}

const TYPE_BAR_COLOR: Record<PerfRequestEvent["type"], string> = {
  db: "var(--yellow)",
  fn: "var(--green-light)",
};

const TYPE_BADGE_VARIANT: Record<PerfRequestEvent["type"], "warning" | "success"> = {
  db: "warning",
  fn: "success",
};

const TYPE_LABEL: Record<PerfRequestEvent["type"], string> = {
  db: "DB",
  fn: "Fn",
};

function TypeBadge({ type }: { type: PerfRequestEvent["type"] }) {
  return <Badge variant={TYPE_BADGE_VARIANT[type]}>{TYPE_LABEL[type]}</Badge>;
}

function RequestStatusBadge({ outcome, status }: { outcome: "ok" | "error"; status: number | null }) {
  if (outcome === "error") return <Badge variant="danger">Error</Badge>;
  if (status !== null && status >= 400) return <Badge variant="warning">{status}</Badge>;
  if (status !== null && status >= 300) return <Badge variant="neutral">{status}</Badge>;
  return <Badge variant="success">OK</Badge>;
}

function formatParams(params: Record<string, unknown> | null): string | null {
  if (!params) return null;
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}

/**
 * One event row — the label side (type/name/params/offset) grows to fill
 * the row; the duration bar is right-aligned in a track that maxes out
 * at 33% of the row's own width, filled to `duration / maxDuration` of
 * that track — the single longest event in the request is the only one
 * that ever fills the full 33%. Same layout as the GraphLog run page's
 * own `EventRow`, kept visually consistent on purpose.
 */
function EventRow({
  event,
  requestStartedAt,
  maxDurationMs,
}: {
  event: PerfRequestEvent;
  requestStartedAt: string;
  maxDurationMs: number;
}) {
  const pct = maxDurationMs > 0 ? Math.max(2, Math.round((event.duration_ms / maxDurationMs) * 100)) : 0;
  const paramsText = formatParams(event.params);
  return (
    <div className="flex flex-col gap-1 py-2" style={{ borderBottom: "1px solid var(--midground)" }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
          <span className="text-xs font-mono subtle-text" style={{ minWidth: "62px" }}>
            {formatOffset(event.started_at, requestStartedAt)}
          </span>
          <TypeBadge type={event.type} />
          <span className="text-sm font-mono">{event.name}</span>
          {event.outcome === "error" && <Badge variant="danger">error</Badge>}
          {paramsText && (
            <span className="text-xs font-mono subtle-text" title={paramsText}>
              {paramsText}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0" style={{ flex: "0 0 33%", maxWidth: "33%" }}>
          <div
            style={{
              flex: 1,
              height: "8px",
              background: "var(--midground)",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: event.outcome === "error" ? "var(--red)" : TYPE_BAR_COLOR[event.type],
              }}
            />
          </div>
          <span className="text-xs font-mono subtle-text shrink-0" style={{ minWidth: "48px", textAlign: "right" }}>
            {formatDuration(event.duration_ms)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerPerformanceRequest() {
  const { request, events, humanName } = useLoaderData<typeof loader>();
  const [tz, setTz] = useTimezonePref();

  const maxDurationMs = Math.max(1, ...events.map((e) => e.duration_ms));
  const dbEvents = events.filter((e) => e.type === "db");
  const fnEvents = events.filter((e) => e.type === "fn");
  const dbTotalMs = dbEvents.reduce((sum, e) => sum + e.duration_ms, 0);
  const fnTotalMs = fnEvents.reduce((sum, e) => sum + e.duration_ms, 0);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "960px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/maker/performance" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Performance
          </Link>
          <TimezoneSelect value={tz} onChange={setTz} />
        </div>

        <div className={`${surfaceBase} p-5 mb-8`}>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="accent">{request.app}</Badge>
              <span className="font-bold text-lg font-mono">
                {request.method} {request.route}
              </span>
            </div>
            <RequestStatusBadge outcome={request.outcome} status={request.status} />
          </div>
          <div className="text-xs font-mono subtle-text flex flex-wrap gap-3">
            {humanName && <span>By {humanName}</span>}
            <span>Started {formatPerfTimestamp(request.started_at, tz)}</span>
            <span>Total {formatDuration(request.duration_ms)}</span>
            <span>{events.length} event(s)</span>
          </div>
          <div className="text-xs font-mono subtle-text flex flex-wrap gap-3" style={{ marginTop: "6px" }}>
            <span>
              DB: {formatDuration(dbTotalMs)} across {dbEvents.length} call(s)
            </span>
            <span>
              Fn: {formatDuration(fnTotalMs)} across {fnEvents.length} call(s)
            </span>
            <span>
              Unaccounted: {formatDuration(Math.max(0, request.duration_ms - dbTotalMs - fnTotalMs))}
            </span>
          </div>
          {request.error && (
            <p className="text-sm mt-3" style={{ margin: 0, marginTop: "12px", color: "var(--red)" }}>
              {request.error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="font-bold text-lg font-mono purple-text" style={{ margin: 0 }}>
            Timeline
          </h2>
          <span className="text-xs font-mono subtle-text">
            in order · bar length relative to this request's longest event ({formatDuration(maxDurationMs)})
          </span>
        </div>
        <div className={`${surfaceBase} p-5`}>
          {events.length === 0 ? (
            <p className="text-sm subtle-text" style={{ margin: 0 }}>
              No events were recorded for this request — its total duration above is everything that
              happened outside any `timeRequestPerf`-wrapped call.
            </p>
          ) : (
            events.map((event) => (
              <EventRow
                key={event._id}
                event={event}
                requestStartedAt={request.started_at}
                maxDurationMs={maxDurationMs}
              />
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
