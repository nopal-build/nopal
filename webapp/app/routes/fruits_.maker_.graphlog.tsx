// app/routes/fruits_.maker_.graphlog.tsx
// GraphLog usage deep-dive — linked from /fruits/maker's summary section.
// Mirrors fruits_.maker_.phylog.tsx exactly, against GraphLog's own
// tables/stage set. Admin/Super only, same gate as the parent Maker
// dashboard.
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
import {
  getGraphLogUsageSummary,
  type GraphLogStage,
} from "robustness-core/data/graphLogMetrics.server";
import { listRecentGraphLogRuns, type GraphLogRun } from "robustness-core/data/graphLogPerf.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getHumansById } from "robustness-core/data/humans.server";

const RECENT_RUNS_LIMIT = 20;

type MakerRangeDays = 7 | 30;

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
  const days: MakerRangeDays = url.searchParams.get("range") === "30" ? 30 : 7;
  const usage = await getGraphLogUsageSummary(days);

  const recentRuns = await listRecentGraphLogRuns(RECENT_RUNS_LIMIT);

  const projectFolderIds = new Set([
    ...usage.byProject.map((p) => p.projectFolderId),
    ...recentRuns.map((r) => r.project_folder_id),
  ]);
  const humanIds = new Set([
    ...usage.byHuman.map((h) => h.humanId),
    ...recentRuns.map((r) => r.human_id),
  ]);
  const [projectFolders, humans] = await Promise.all([
    Promise.all([...projectFolderIds].map((id) => getFolderById(id))),
    getHumansById([...humanIds]),
  ]);
  const projectFolderIdList = [...projectFolderIds];
  const projectNameById: Record<string, string> = {};
  projectFolders.forEach((folder, i) => {
    projectNameById[projectFolderIdList[i]] = folder?.name ?? "(deleted project)";
  });
  const humanById: Record<string, { name: string; email: string }> = {};
  humans.forEach((h) => {
    humanById[h._id] = { name: h.name, email: h.email };
  });

  return { user, days, usage, recentRuns, projectNameById, humanById };
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
          <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
            <Badge variant="danger">403</Badge>
            <h1 className="font-bold text-xl">Access Denied</h1>
            <p className="text-sm subtle-text">
              GraphLog usage stats are only available to Admin and Super accounts.
            </p>
            <Link to="/fruits/maker" className="link text-sm">
              ← Back to Maker
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
        <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
          <h1 className="font-bold text-xl">Something went wrong</h1>
          <p className="text-sm subtle-text">
            {isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred."}
          </p>
          <Link to="/fruits/maker" className="link text-sm">
            ← Back to Maker
          </Link>
        </div>
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

function RangeToggle({ days }: { days: MakerRangeDays }) {
  return (
    <div className="flex gap-2">
      {([7, 30] as const).map((option) => {
        const isActive = option === days;
        return (
          <Link
            key={option}
            to={`/fruits/maker/graphlog?range=${option}`}
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

const STAGE_LABELS: Record<GraphLogStage, string> = {
  "sync-knowledge": "Sync Knowledge",
  "sync-graph": "Sync Graph",
  "graph-structure": "Graph Structure",
  "graph-project-view": "Graph Project View",
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-bold text-lg font-mono purple-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
      {children}
    </h2>
  );
}

function BarRow({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
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

// ─── Recent Runs ────────────────────────────────────────────────────────────
// A performance timeline lives per run — `graphLogPerf.server.ts` — tracing
// real, code-measured API/LLM/function-call durations, never a number the
// model itself reports. This list is the entry point into an individual
// run's own full timeline (`/fruits/maker/graphlog/runs/$runId`).

/** Pinned to an explicit locale AND `timeZone: "UTC"` — never the viewer's
 * own — same fix `OxRenderer.tsx`'s `formatRefDatetime` already uses, for
 * the same SSR/hydration-mismatch reason (see the `graphlog` skill). */
function formatRunDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

function formatRunDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RunStatusBadge({ run }: { run: GraphLogRun }) {
  if (run.ok === null) return <Badge variant="warning">Running…</Badge>;
  if (run.ok) return <Badge variant="success">OK</Badge>;
  return <Badge variant="danger">Failed</Badge>;
}

function RecentRunsSection({
  runs,
  projectNameById,
  humanNameById,
}: {
  runs: GraphLogRun[];
  projectNameById: Record<string, string>;
  humanNameById: Record<string, string>;
}) {
  return (
    <section className="mb-12">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <SectionHeader>Recent Runs</SectionHeader>
        <Link to="/fruits/maker/graphlog/defaults" className="link text-xs font-mono">
          Default Prompts →
        </Link>
      </div>
      <div className={`${surfaceBase} p-5`}>
        {runs.length === 0 ? (
          <p className="text-sm subtle-text" style={{ margin: 0 }}>
            No GraphLog runs recorded yet.
          </p>
        ) : (
          runs.map((run) => (
            <Link
              key={run._id}
              to={`/fruits/maker/graphlog/runs/${run._id}`}
              className="flex items-center justify-between flex-wrap gap-2 py-2"
              style={{
                borderBottom: "1px solid var(--midground)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="neutral">{run.job_name}</Badge>
                <span className="text-sm font-mono">
                  {projectNameById[run.project_folder_id] ?? run.project_folder_id}
                </span>
                <span className="text-xs font-mono subtle-text">
                  {humanNameById[run.human_id] ?? run.human_id}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono subtle-text">{formatRunDatetime(run.started_at)}</span>
                <span className="text-xs font-mono subtle-text">{formatRunDuration(run.duration_ms)}</span>
                <RunStatusBadge run={run} />
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerGraphLog() {
  const { days, usage, recentRuns, projectNameById, humanById } = useLoaderData<typeof loader>();
  const humanNameById: Record<string, string> = Object.fromEntries(
    Object.entries(humanById).map(([id, h]) => [id, h.name]),
  );

  const maxDateCalls = Math.max(1, ...usage.byDate.map((d) => d.callCount));
  const maxProjectCalls = Math.max(1, ...usage.byProject.map((p) => p.callCount));
  const maxHumanCalls = Math.max(1, ...usage.byHuman.map((h) => h.callCount));

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
          <Link to="/fruits/maker" className="link text-sm font-mono">
            ← Maker
          </Link>
          <Link to="/fruits/maker/graphlog/defaults" className="link text-sm font-mono">
            Default Prompts →
          </Link>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
          <h1 className="font-bold text-2xl" style={{ margin: 0 }}>
            GraphLog Usage
          </h1>
          <RangeToggle days={days} />
        </div>

        <RecentRunsSection
          runs={recentRuns}
          projectNameById={projectNameById}
          humanNameById={humanNameById}
        />

        {/* ── Overview ──────────────────────── */}
        {/* ── Overview ────────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader>Overview</SectionHeader>
          {usage.pricingStale && (
            <div className="mb-3">
              <Badge variant="warning">
                Pricing table is {usage.pricingAgeDays} days old — verify against
                platform.claude.com/docs/en/about-claude/pricing and bump PRICING_AS_OF in llmPricing.ts
              </Badge>
            </div>
          )}
          <div className="flex flex-wrap gap-4 mb-4">
            <StatCard label="Calls" value={usage.callCount} hint={`Last ${days} days`} />
            <StatCard label="Success" value={usage.successCount} />
            <StatCard label="Skipped" value={usage.skippedCount} />
            <StatCard label="Errors" value={usage.errorCount} />
          </div>
          <div className="flex flex-wrap gap-4">
            <StatCard label="Est. Cost" value={`$${usage.estimatedCostUsd.toFixed(2)}`} hint="baseline gauge, not billing" />
            <StatCard label="Input Tokens" value={usage.inputTokens.toLocaleString()} />
            <StatCard label="Output Tokens" value={usage.outputTokens.toLocaleString()} />
            <StatCard label="Avg Duration" value={`${(usage.avgDurationMs / 1000).toFixed(1)}s`} />
            <StatCard label="Worst Duration" value={`${(usage.maxDurationMs / 1000).toFixed(1)}s`} hint="single call, in-range" />
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <StatCard
              label="Cache Read Tokens"
              value={usage.cacheReadTokens.toLocaleString()}
              hint="billed at ~10% of input price"
            />
            <StatCard
              label="Cache Write Tokens"
              value={usage.cacheWriteTokens.toLocaleString()}
              hint="billed at ~125% of input price"
            />
            <StatCard
              label="Cache Hit Rate"
              value={
                usage.cacheReadTokens + usage.cacheWriteTokens + usage.inputTokens > 0
                  ? `${Math.round(
                      (usage.cacheReadTokens /
                        (usage.cacheReadTokens + usage.cacheWriteTokens + usage.inputTokens)) *
                        100,
                    )}%`
                  : "n/a"
              }
              hint="share of input-side tokens served from cache"
            />
          </div>
        </section>

        {/* ── By stage ───────────────────────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader>By Stage</SectionHeader>
          <div className={`${surfaceBase} p-5`}>
            {(Object.keys(STAGE_LABELS) as GraphLogStage[]).map((stage) => {
              const s = usage.byStage[stage];
              return (
                <div
                  key={stage}
                  className="flex items-center justify-between flex-wrap gap-2 py-2"
                  style={{ borderBottom: "1px solid var(--midground)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{STAGE_LABELS[stage]}</span>
                    <Badge variant="neutral">{s.callCount} calls</Badge>
                  </div>
                  <div className="text-xs font-mono subtle-text">
                    {s.inputTokens.toLocaleString()} in / {s.outputTokens.toLocaleString()} out ·{" "}
                    {(s.durationMs / 1000).toFixed(1)}s total · ${s.estimatedCostUsd.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Trend ──────────────────────────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader>Calls Per Day</SectionHeader>
          <div className={`${surfaceBase} p-5`}>
            {usage.byDate.length === 0 ? (
              <p className="text-sm subtle-text">No GraphLog activity in this range.</p>
            ) : (
              usage.byDate.map((d) => (
                <BarRow
                  key={d.date}
                  label={d.date}
                  value={d.callCount}
                  max={maxDateCalls}
                  detail={`${d.callCount} calls · ${(d.inputTokens + d.outputTokens).toLocaleString()} tokens · $${d.estimatedCostUsd.toFixed(2)}`}
                />
              ))
            )}
          </div>
        </section>

        {/* ── By project ─────────────────────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader>By Project</SectionHeader>
          <div className={`${surfaceBase} p-5`}>
            {usage.byProject.length === 0 ? (
              <p className="text-sm subtle-text">No GraphLog activity in this range.</p>
            ) : (
              usage.byProject.map((p) => (
                <BarRow
                  key={p.projectFolderId}
                  label={projectNameById[p.projectFolderId] ?? p.projectFolderId}
                  value={p.callCount}
                  max={maxProjectCalls}
                  detail={`${p.callCount} calls · ${(p.inputTokens + p.outputTokens).toLocaleString()} tokens · $${p.estimatedCostUsd.toFixed(2)}`}
                />
              ))
            )}
          </div>
        </section>

        {/* ── By human ────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader>By Human</SectionHeader>
          <div className={`${surfaceBase} p-5`}>
            {usage.byHuman.length === 0 ? (
              <p className="text-sm subtle-text">No GraphLog activity in this range.</p>
            ) : (
              usage.byHuman.map((h) => {
                const human = humanById[h.humanId];
                return (
                  <BarRow
                    key={h.humanId}
                    label={human ? `${human.name} (${human.email})` : h.humanId}
                    value={h.callCount}
                    max={maxHumanCalls}
                    detail={`${h.callCount} calls · ${(h.inputTokens + h.outputTokens).toLocaleString()} tokens · $${h.estimatedCostUsd.toFixed(2)}`}
                  />
                );
              })
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
