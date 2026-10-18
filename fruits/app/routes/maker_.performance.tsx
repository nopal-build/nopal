// app/routes/maker_.performance.tsx
// Server request-performance deep-dive — linked from /maker's own
// summary section. Mirrors maker_.graphlog.tsx's shape against this
// feature's own tables (`requestPerf.server.ts`). Admin/Super only, same
// gate as the parent Maker dashboard.
//
// Server-side timing only — no browser/client (Web Vitals, hydration)
// tracking here, deliberately; see the `fruits-performance-monitoring`
// garden seed. Tracing itself is opt-in per route (`withRequestPerf`),
// not every request across the app — today that's just the Vault loader
// (`vault.tsx`) — so an empty/sparse list here means "nothing traced
// recently", not "nothing happened".
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, redirect, useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import {
  getPerfSummary,
  listRecentPerfRequests,
  withRequestPerf,
  type PerfBucket,
  type PerfRequest,
  type PerfSummary,
} from "robustness-core/data/requestPerf.server";
import { getHumansById } from "robustness-core/data/humans.server";
import { navFor } from "../data/nav.server";
import { TimezoneSelect } from "../components/TimezoneSelect";
import { useTimezonePref } from "../hooks/useTimezonePref";
import { formatPerfTimestamp, type PerfTimezoneKey } from "../util/perfTimezones";

export const meta: MetaFunction = () => [{ title: "O.No · M.Performance" }];

const RECENT_REQUESTS_LIMIT = 50;

type MakerRangeDays = 7 | 30;

// Label/order for the four preset filters -- the user's own framing:
// "All" is no filter, "Webapp" is the `webapp` app only, "O.No" (fruits's
// own product name, see the page title above) is `fruits` minus the
// `/maker` section, and "Maker" is exactly that `/maker` slice. See
// `requestPerf.server.ts`'s own `PerfBucket`/`bucketCondition` for where
// this is actually applied (in the DB query, before any `LIMIT`).
const BUCKETS: { key: PerfBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "webapp", label: "Webapp" },
  { key: "ono", label: "O.No" },
  { key: "maker", label: "Maker" },
];
const BUCKET_KEYS = new Set(BUCKETS.map((b) => b.key));

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireMakerAccess(request);
  const url = new URL(request.url);
  return withRequestPerf(
    { app: "fruits", route: url.pathname, method: request.method, humanId: user._id },
    async () => {
  const nav = await navFor(user._id);

  const days: MakerRangeDays = url.searchParams.get("range") === "30" ? 30 : 7;
  const wantedBucket = url.searchParams.get("bucket") ?? "all";
  const bucket: PerfBucket = (BUCKET_KEYS.has(wantedBucket as PerfBucket) ? wantedBucket : "all") as PerfBucket;

  const [summary, recentRequests] = await Promise.all([
    getPerfSummary(days, 1000, bucket),
    listRecentPerfRequests(RECENT_REQUESTS_LIMIT, bucket),
  ]);

  const humanIds = [...new Set(recentRequests.map((r) => r.human_id).filter((id): id is string => Boolean(id)))];
  const humans = await getHumansById(humanIds);
  const humanNameById: Record<string, string> = {};
  humans.forEach((h) => {
    humanNameById[h._id] = h.name;
  });

  return { user, ...nav, days, bucket, summary, recentRequests, humanNameById };
    },
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-12" style={{ maxWidth: "640px" }}>
          <p className="text-sm subtle-text">You don't have access to this page.</p>
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

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className={`${surfaceBase} p-5 flex flex-col gap-1`} style={{ minWidth: "180px" }}>
      <div className="text-xs font-mono subtle-text uppercase tracking-wide">{label}</div>
      <div className="font-bold text-2xl purple-text">{value}</div>
      {hint && <div className="text-xs font-mono subtle-text">{hint}</div>}
    </div>
  );
}

function RangeToggle({ days, bucket }: { days: MakerRangeDays; bucket: PerfBucket }) {
  return (
    <div className="flex gap-2">
      {([7, 30] as const).map((option) => {
        const isActive = option === days;
        return (
          <Link
            key={option}
            to={`/maker/performance?range=${option}&bucket=${bucket}`}
            prefetch="intent"
            className="text-sm font-mono rounded"
            style={{
              padding: "6px 14px",
              textDecoration: "none",
              border: `1px solid ${isActive ? "var(--purple)" : "var(--midground)"}`,
              background: isActive ? "var(--purple)" : "transparent",
              color: isActive ? "var(--farground)" : "var(--purple-light)",
            }}
          >
            Last {option} days
          </Link>
        );
      })}
    </div>
  );
}

/** The four preset filters — see `BUCKETS`' own comment above. Styled as
 * a small pill row, same visual language as `RangeToggle` right next to
 * it, so the two read as one coherent filter bar rather than two
 * unrelated controls. */
function BucketToggle({ bucket, days }: { bucket: PerfBucket; days: MakerRangeDays }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {BUCKETS.map((option) => {
        const isActive = option.key === bucket;
        return (
          <Link
            key={option.key}
            to={`/maker/performance?range=${days}&bucket=${option.key}`}
            prefetch="intent"
            className="text-sm font-mono rounded"
            style={{
              padding: "6px 14px",
              textDecoration: "none",
              border: `1px solid ${isActive ? "var(--purple)" : "var(--midground)"}`,
              background: isActive ? "var(--purple)" : "transparent",
              color: isActive ? "var(--farground)" : "var(--purple-light)",
            }}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function BarRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1 py-2" style={{ borderBottom: "1px solid var(--midground)" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-mono">{label}</span>
        <span className="text-xs font-mono subtle-text">{detail}</span>
      </div>
      <div style={{ height: "6px", background: "var(--midground)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--purple)" }} />
      </div>
    </div>
  );
}

function RequestStatusBadge({ request }: { request: PerfRequest }) {
  if (request.outcome === "error") return <Badge variant="danger">Error</Badge>;
  if (request.status !== null && request.status >= 400) return <Badge variant="warning">{request.status}</Badge>;
  if (request.status !== null && request.status >= 300) return <Badge variant="neutral">{request.status}</Badge>;
  return <Badge variant="success">OK</Badge>;
}

function RecentRequestsSection({
  requests,
  humanNameById,
  tz,
  now,
}: {
  requests: PerfRequest[];
  humanNameById: Record<string, string>;
  tz: PerfTimezoneKey;
  now: number;
}) {
  return (
    <section className="mb-12">
      <h2 className="font-bold text-lg font-mono purple-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
        Recent Requests
      </h2>
      <div className={`${surfaceBase} p-5`}>
        {requests.length === 0 ? (
          <p className="text-sm subtle-text" style={{ margin: 0 }}>
            No traced requests yet. Tracing is opt-in per route — see `requestPerf.server.ts` for which ones
            are wrapped today.
          </p>
        ) : (
          requests.map((r) => (
            <Link
              key={r._id}
              to={`/maker/performance/requests/${r._id}`}
              className="flex items-center justify-between flex-wrap gap-2 py-2"
              style={{
                borderBottom: "1px solid var(--midground)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="neutral">{r.app}</Badge>
                <span className="text-sm font-mono">
                  {r.method} {r.route}
                </span>
                {r.human_id && (
                  <span className="text-xs font-mono subtle-text">{humanNameById[r.human_id] ?? r.human_id}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono subtle-text">{formatPerfTimestamp(r.started_at, tz, now)}</span>
                <span className="text-xs font-mono subtle-text">{formatDuration(r.duration_ms)}</span>
                <RequestStatusBadge request={r} />
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerPerformance() {
  const { days, bucket, summary, recentRequests, humanNameById } = useLoaderData<typeof loader>();
  const [tz, setTz] = useTimezonePref();
  const now = Date.now();

  const maxRouteAvg = Math.max(1, ...summary.byRoute.map((r) => r.avgDurationMs));
  const activeBucketLabel = BUCKETS.find((b) => b.key === bucket)?.label ?? "All";

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <Link to="/maker" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Maker
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <TimezoneSelect value={tz} onChange={setTz} />
            <RangeToggle days={days} bucket={bucket} />
          </div>
        </div>

        <div className="mb-6">
          <BucketToggle bucket={bucket} days={days} />
        </div>

        <h1 className="font-bold text-2xl purple-text mb-6" style={{ margin: 0, marginBottom: "24px" }}>
          Performance
        </h1>

        {summary.requestCount === 0 ? (
          <p className="text-sm subtle-text">
            No traced requests in the last {days} days{bucket !== "all" ? ` for "${activeBucketLabel}"` : ""}.
          </p>
        ) : (
          <>
            <section className="mb-12">
              <div className="flex flex-wrap gap-4 mb-6">
                <StatCard label="Traced Requests" value={summary.requestCount} hint={`Last ${days} days`} />
                <StatCard
                  label="Avg Duration"
                  value={formatDuration(summary.avgDurationMs)}
                  hint={`p95: ${formatDuration(summary.p95DurationMs)}`}
                />
                <StatCard label="Slowest Request" value={formatDuration(summary.maxDurationMs)} />
                <StatCard label="Errors" value={summary.errorCount} hint={`of ${summary.requestCount} requests`} />
              </div>

              <h2 className="font-bold text-lg font-mono purple-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
                By Route
              </h2>
              <div className={`${surfaceBase} p-5`}>
                {summary.byRoute.map((r) => (
                  <BarRow
                    key={r.route}
                    label={r.route}
                    value={r.avgDurationMs}
                    max={maxRouteAvg}
                    detail={`avg ${formatDuration(r.avgDurationMs)} · worst ${formatDuration(r.maxDurationMs)} · ${r.requestCount} req`}
                  />
                ))}
              </div>
            </section>

            <RecentRequestsSection requests={recentRequests} humanNameById={humanNameById} tz={tz} now={now} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
