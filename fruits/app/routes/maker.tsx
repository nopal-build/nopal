// app/routes/maker.tsx
// The Maker: the way in to projects and humans (ADR-026), and for admins
// the stats, usage and scripts below. An admin and anyone guiding a
// project reach it; everyone else is refused, in the nav and on the
// server (Austin, 2026-09-28: "one place").
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  Link,
  data,
  redirect,
  useLoaderData,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { MakerErrorBoundary } from "../components/MakerErrorBoundary";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { useSchemePref } from "../hooks/useSchemePref";
import { getMakerStats, type MakerRangeDays } from "robustness-core/data/makerStats.server";
import { getGraphLogUsageSummary } from "robustness-core/data/graphLogMetrics.server";
import { guidesAny, listEveryProject, listProjectsFor, resolveRole } from "robustness-core/data/projectSharing.server";
import { getHumans } from "robustness-core/data/humans.server";
import { navFor } from "../data/nav.server";
import { isStaff } from "../data/projectPeople.server";
import stamp22cLight from "../images/stamps/22c-light.svg";
import stamp22cDark from "../images/stamps/22c-dark.svg";

export const meta: MetaFunction = () => [{ title: "O.No · Maker" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const staff = isStaff(user);
  const memberships = await listProjectsFor(user._id);
  if (!staff && !guidesAny(memberships)) {
    throw data("Forbidden", { status: 403 });
  }

  // The tile's numbers: every project and everyone for an admin; the
  // projects they guide for a Guide.
  const counts = staff
    ? { projects: (await listEveryProject()).length, people: ((await getHumans())?.data ?? []).length }
    : { projects: memberships.filter((m) => resolveRole(m.role).guiding).length, people: null };

  const url = new URL(request.url);
  // TODO: support a custom start/end range once there's demand for it —
  // for now this is a simple 7 vs 30 day toggle.
  const days: MakerRangeDays = url.searchParams.get("range") === "30" ? 30 : 7;

  // The stats and the usage are the admins'; a Guide's page never asks.
  const [stats, graphLogUsage] = staff
    ? await Promise.all([getMakerStats(days), getGraphLogUsageSummary(days)])
    : [null, null];

  return { user, staff, counts, days, stats, graphLogUsage, ...(await navFor(user._id, memberships)) };
}

export function ErrorBoundary() {
  return <MakerErrorBoundary />;
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
            to={`/maker?range=${option}`}
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
      to="/maker/stamps"
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

/** The way in: start a project, see who's on each, everyone's groups. */
function ProjectsAndHumansTile({ counts, staff }: { counts: { projects: number; people: number | null }; staff: boolean }) {
  const summary = staff
    ? `${counts.projects} ${counts.projects === 1 ? "project" : "projects"} · ${counts.people} ${counts.people === 1 ? "person" : "people"}`
    : `${counts.projects} ${counts.projects === 1 ? "project" : "projects"} you guide`;
  return (
    <Link
      to="/maker/projects"
      prefetch="intent"
      className={`${surfaceBase} ${sprinkles({ p: 5, display: "flex", flexDirection: "column", gap: 1 })}`}
      style={{ textDecoration: "none", color: "inherit" }}
      data-maker-tile="projects-and-humans"
    >
      <h3 className="font-bold text-lg purple-light-text" style={{ margin: 0 }}>
        Projects and humans
      </h3>
      <p className="text-sm subtle-text" style={{ margin: 0 }}>
        Projects, and who's on them.
      </p>
      <span className="text-sm font-mono purple-light-text">{summary} →</span>
    </Link>
  );
}

export default function FruitsMaker() {
  const { user, staff, counts, days, stats, graphLogUsage } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 py-12"
        style={{ maxWidth: "860px" }}
      >
        <section className="mb-12">
          <ProjectsAndHumansTile counts={counts} staff={staff} />
        </section>

        {staff && stats && graphLogUsage && (
          <>
        {/* ── General Stats ─────────────────────────────────────────────── */}
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

            {stats.unattributedInRange.length > 0 ? (
              <p className="text-sm subtle-text" style={{ marginBottom: "8px" }} title={stats.unattributedInRange.map((u) => u.humanId).join(", ")}>
                {(() => {
                  const n = stats.unattributedInRange.reduce((sum, u) => sum + u.logCount, 0);
                  return n === 1 ? "1 log in this range is from an account that no longer exists. It's in the count above, not this table." : `${n} logs in this range are from accounts that no longer exist. They're in the count above, not this table.`;
                })()}
              </p>
            ) : null}
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
            <Link
              to="/maker/graphlog"
              prefetch="intent"
              className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}
            >
              Full breakdown →
            </Link>
          </div>

          {graphLogUsage.pricingStale && (
            <div className="mb-3">
              <Badge variant="warning">
                Pricing table is {graphLogUsage.pricingAgeDays} days old. Check
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

        {/* ── Admin Scripts ─────────────────────────── */}
        {/* Super only -- these scripts can mutate arbitrary rows across
            the whole database in production, stricter than everything
            else on this Admin-or-Super page. Hidden entirely for Admins
            rather than shown as a dead link to a 403. */}
        {user.role === "Super" && (
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
                Admin Scripts
              </h2>
              <Link
                to="/maker/scripts"
                prefetch="intent"
                className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}
              >
                Run/view →
              </Link>
            </div>
            <p className="text-sm subtle-text" style={{ margin: 0 }}>
              Repair scripts, run in production by the worker. Super only.
            </p>
          </section>
        )}

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
          </>
        )}
      </div>
    </AppLayout>
  );
}
