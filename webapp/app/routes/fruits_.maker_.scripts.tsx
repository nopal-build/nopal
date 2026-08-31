// app/routes/fruits_.maker_.scripts.tsx
// Admin Scripts — repair/maintenance scripts registered in
// `adminScriptsRegistry.server.ts`, runnable instead of locally against a
// `fly proxy` tunnel (see that registry's own module doc for why). Super
// only. This index page leads with Recent Runs (the thing you're usually
// here to check) and a button to start a new one
// (/fruits/maker/scripts/new, `fruits_.maker_.scripts_.new.tsx`) — every
// run's outcome is permanently recorded to `admin_script_runs`
// (`adminScriptRuns.server.ts`) and viewable at
// /fruits/maker/scripts/runs/:runId.
import type { LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { listRecentAdminScriptRuns } from "robustness-core/data/adminScriptRuns.server";
import { isAnyAdminScriptRunning } from "robustness-core/data/adminScriptsQueue.server";
import { getHumansById } from "robustness-core/data/humans.server";

// Super only, NOT the usual Admin-or-Super Maker bar -- unlike GraphLog's
// own staff override (which only ever touches ONE project's own data),
// these scripts can mutate arbitrary rows across the whole database in
// production. Keep this stricter than `requireMakerAccess` elsewhere.
async function requireAdminScriptsAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminScriptsAccess(request);

  const [recentRuns, running] = await Promise.all([listRecentAdminScriptRuns(20), isAnyAdminScriptRunning()]);

  const humanIds = Array.from(new Set(recentRuns.map((r) => r.human_id)));
  const humans = await getHumansById(humanIds);
  const humanNameById = new Map(humans.map((h) => [h._id, h.name]));

  return {
    recentRuns,
    running,
    humanNameById: Object.fromEntries(humanNameById),
  };
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
            <p className="text-sm subtle-text">Admin Scripts are only available to Super accounts.</p>
            <Link to="/fruits/maker" className={`${link} ${textSize.sm}`}>
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
          <Link to="/fruits/maker" className={`${link} ${textSize.sm}`}>
            ← Back to Maker
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function RunStatusBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Badge variant="warning">Running…</Badge>;
  if (!ok) return <Badge variant="danger">Failed</Badge>;
  return <Badge variant="success">OK</Badge>;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerScripts() {
  const { recentRuns, running, humanNameById } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/fruits/maker" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Maker
          </Link>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
          <h1 className="font-bold text-xl" style={{ margin: 0 }}>
            Admin Scripts
          </h1>
          <Link
            to="/fruits/maker/scripts/new"
            prefetch="intent"
            className="text-sm font-mono rounded"
            style={{
              padding: "6px 14px",
              textDecoration: "none",
              border: "1px solid var(--purple)",
              background: "var(--purple)",
              color: "var(--farground)",
            }}
          >
            Run a script →
          </Link>
        </div>
        <p className="text-sm subtle-text mb-6" style={{ maxWidth: "620px" }}>
          Repair/maintenance scripts, run against production data by the worker (no local
          credentials needed). Runs are serialized — only one at a time across every script.
        </p>

        {running && (
          <div className="mb-6">
            <Badge variant="warning">A script is currently running — wait for it to finish before starting another.</Badge>
          </div>
        )}

        <section>
          <h2 className="font-bold text-lg font-mono purple-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
            Recent Runs
          </h2>
          {recentRuns.length === 0 ? (
            <p className="text-sm subtle-text">No scripts have been run yet.</p>
          ) : (
            <div className={`${surfaceBase} p-5`}>
              {recentRuns.map((run) => (
                <Link
                  key={run._id}
                  to={`/fruits/maker/scripts/runs/${run._id}`}
                  className="flex items-center justify-between flex-wrap gap-2 py-2"
                  style={{ borderBottom: "1px solid var(--midground)", textDecoration: "none", color: "inherit" }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="accent">{run.script_name}</Badge>
                    {run.dry_run && <Badge variant="neutral">dry run</Badge>}
                    <RunStatusBadge ok={run.ok} />
                    {run.args.length > 0 && (
                      <span className="text-xs font-mono subtle-text">({run.args.join(", ")})</span>
                    )}
                    <span className="text-xs font-mono subtle-text">
                      by {humanNameById[run.human_id] ?? run.human_id}
                    </span>
                  </div>
                  <span className="text-xs font-mono subtle-text">{formatDatetime(run.started_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
