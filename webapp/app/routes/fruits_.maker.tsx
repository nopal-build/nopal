// app/routes/fruits_.maker.tsx
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  data,
  redirect,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { useSchemePref } from "../hooks/useSchemePref";
import { getMakerStats, type MakerRangeDays } from "robustness-core/data/makerStats.server";
import { getGraphLogUsageSummary } from "robustness-core/data/graphLogMetrics.server";
import stamp22cLight from "../images/stamps/22c-light.svg";
import stamp22cDark from "../images/stamps/22c-dark.svg";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  // TODO: support a custom start/end range once there's demand for it —
  // for now this is a simple 7 vs 30 day toggle.
  const days: MakerRangeDays = url.searchParams.get("range") === "30" ? 30 : 7;

  const [stats, graphLogUsage] = await Promise.all([
    getMakerStats(days),
    getGraphLogUsageSummary(days),
  ]);

  return { user, days, stats, graphLogUsage };
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <div
          className="container mx-auto px-4 py-12"
          style={{ maxWidth: "480px" }}
        >
          <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
            <Badge variant="danger">403</Badge>
            <h1 className="font-bold text-xl">Access Denied</h1>
            <p className="text-sm subtle-text">
              The Maker dashboard is only available to Admin and Super
              accounts.
            </p>
            <Link to="/fruits" className="link text-sm">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 py-12"
        style={{ maxWidth: "480px" }}
      >
        <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
          <h1 className="font-bold text-xl">Something went wrong</h1>
          <p className="text-sm subtle-text">
            {isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred."}
          </p>
          <Link to="/fruits" className="link text-sm">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className={`${surfaceBase} p-5 flex flex-col gap-1`} style={{ minWidth: "180px" }}>
      <div className="text-xs font-mono subtle-text uppercase tracking-wide">
        {label}
      </div>
      <div className="font-bold text-2xl purple-text">{value}</div>
      {hint && <div className="text-xs font-mono subtle-text">{hint}</div>}
    </div>
  );
}

function RangeToggle({ days }: { days: MakerRangeDays }) {
  return (
    <div className="flex gap-2">
      {([7, 30] as const).map((option) => {
        const isActive = option === days;
        return (
          <Link
            key={option}
            to={`/fruits/maker?range=${option}`}
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

function StampsPromoCard() {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";

  return (
    <Link
      to="/fruits/styles"
      prefetch="intent"
      className="flex items-center gap-5 hover:opacity-80 transition-opacity"
      style={{
        textDecoration: "none",
        color: "inherit",
        width: "fit-content",
      }}
    >
      <img
        src={isDark ? stamp22cDark : stamp22cLight}
        alt=""
        style={{ width: "100px", height: "auto", flexShrink: 0, display: "block" }}
      />
      <div className="flex flex-col gap-1">
        <h3
          className="font-bold text-lg"
          style={{ color: isDark ? "var(--pink)" : "var(--purple-light)" }}
        >
          Stamps
        </h3>
        <p className="text-sm subtle-text" style={{ margin: 0 }}>
          Our design system and style reference
        </p>
        <span className="text-sm font-mono purple-light-text">View →</span>
      </div>
    </Link>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMaker() {
  const { days, stats, graphLogUsage } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 py-12"
        style={{ maxWidth: "860px" }}
      >
        {/* ── General Stats ─────────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <h2
              className="font-bold text-lg font-mono purple-text"
              style={{ margin: 0 }}
            >
              General Stats
            </h2>
            <RangeToggle days={days} />
          </div>

          <div className="flex flex-wrap gap-4 mb-6">
            <StatCard
              label="Total Active Humans"
              value={stats.totalActiveHumans}
              hint="All time"
            />
            <StatCard
              label="Total Invited Humans"
              value={stats.totalInvitedHumans}
              hint="All time"
            />
            <StatCard
              label="Daily Logs Written"
              value={stats.dailyLogCountInRange}
              hint={`Last ${days} days`}
            />
          </div>

          <div className={`${surfaceBase} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-mono subtle-text uppercase tracking-wide">
                Humans active in range
              </div>
              <Badge variant="neutral">Last {days} days</Badge>
            </div>

            {stats.humansInRange.length === 0 ? (
              <p className="text-sm subtle-text">
                No daily logs were written in this range.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {stats.humansInRange.map(({ human, logCount, lastLogDate }) => (
                  <div
                    key={human._id}
                    className="flex items-center justify-between flex-wrap gap-2 py-2"
                    style={{ borderBottom: "1px solid var(--midground)" }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{human.name}</span>
                      <span className="text-xs font-mono subtle-text">
                        {human.email}
                      </span>
                      <Badge variant="neutral">{human.role}</Badge>
                    </div>
                    <div className="text-xs font-mono subtle-text">
                      {logCount} {logCount === 1 ? "log" : "logs"} · last{" "}
                      {lastLogDate}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── GraphLog Usage ────────────────────── */}
        <section className="mb-12">
          <hr
            style={{
              borderColor: "currentColor",
              opacity: 0.12,
              margin: "0 0 24px",
            }}
          />
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <h2
              className="font-bold text-lg font-mono purple-text"
              style={{ margin: 0 }}
            >
              GraphLog Usage
            </h2>
            <Link to="/fruits/maker/graphlog" prefetch="intent" className="link text-sm font-mono">
              Full breakdown →
            </Link>
          </div>

          {graphLogUsage.pricingStale && (
            <div className="mb-3">
              <Badge variant="warning">
                Pricing table is {graphLogUsage.pricingAgeDays} days old — verify against
                platform.claude.com/docs/en/about-claude/pricing
              </Badge>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <StatCard
              label="Pipeline Calls"
              value={graphLogUsage.callCount}
              hint={`Last ${days} days`}
            />
            <StatCard
              label="Est. Cost"
              value={`$${graphLogUsage.estimatedCostUsd.toFixed(2)}`}
              hint="baseline gauge, not billing"
            />
            <StatCard
              label="Input Tokens"
              value={graphLogUsage.inputTokens.toLocaleString()}
              hint={`Last ${days} days`}
            />
            <StatCard
              label="Output Tokens"
              value={graphLogUsage.outputTokens.toLocaleString()}
              hint={`Last ${days} days`}
            />
            <StatCard
              label="Avg Duration"
              value={`${(graphLogUsage.avgDurationMs / 1000).toFixed(1)}s`}
              hint={`worst: ${(graphLogUsage.maxDurationMs / 1000).toFixed(1)}s`}
            />
            <StatCard
              label="Errors"
              value={graphLogUsage.errorCount}
              hint={`of ${graphLogUsage.callCount} calls`}
            />
          </div>
        </section>

        {/* ── Stamps ─────────────────────────── */}
        <section>
          <hr
            style={{
              borderColor: "currentColor",
              opacity: 0.12,
              margin: "0 0 24px",
            }}
          />
          <StampsPromoCard />
        </section>
      </div>
    </AppLayout>
  );
}
