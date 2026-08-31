// app/routes/fruits_.maker_.scripts_.runs.$runId.tsx
// One Admin Script run's own record — reads the permanent audit row
// (`admin_script_runs`, `adminScriptRuns.server.ts`) plus, while still
// running, live log lines tailed straight from the BullMQ job itself
// (`adminScriptsQueue.server.ts`) since the audit row's own `log` isn't
// filled in until the worker finishes. Auto-refreshes every 2s while
// running. Admin/Super only, same gate as every other Maker page.
import type { LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import {
  Link,
  data,
  redirect,
  useLoaderData,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { getAdminScriptRun } from "robustness-core/data/adminScriptRuns.server";
import { getAdminScriptJobLog } from "robustness-core/data/adminScriptsQueue.server";
import { getHumansById } from "robustness-core/data/humans.server";

// Super only -- see `fruits_.maker_.scripts.tsx`'s own doc on why this is
// stricter than the usual Admin-or-Super Maker bar.
async function requireAdminScriptsAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminScriptsAccess(request);
  const runId = params.runId;
  if (!runId) throw data("Missing run id", { status: 400 });

  const run = await getAdminScriptRun(runId);
  if (!run) throw data("Run not found", { status: 404 });

  const [human] = await getHumansById([run.human_id]);

  // The audit row's own `log` is only filled in once the worker finishes
  // (`finishAdminScriptRun`) -- while `ok` is still null, tail the live
  // BullMQ job instead so the page isn't just blank while running.
  const liveLog = run.ok === null ? await getAdminScriptJobLog(runId) : null;

  return {
    run,
    humanName: human?.name ?? run.human_id,
    liveState: liveLog?.state ?? null,
    log: run.ok !== null ? run.log : liveLog?.log ?? [],
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
            <p className="text-sm subtle-text">Admin Script runs are only available to Super accounts.</p>
            <Link to="/fruits/maker/scripts" className={`${link} ${textSize.sm}`}>
              ← Back to Admin Scripts
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
          <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
            <Badge variant="warning">404</Badge>
            <h1 className="font-bold text-xl">Run Not Found</h1>
            <p className="text-sm subtle-text">This run may have never existed, or the link is wrong.</p>
            <Link to="/fruits/maker/scripts" className={`${link} ${textSize.sm}`}>
              ← Back to Admin Scripts
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
          <Link to="/fruits/maker/scripts" className={`${link} ${textSize.sm}`}>
            ← Back to Admin Scripts
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
    second: "2-digit",
    timeZone: "UTC",
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function RunStatusBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Badge variant="warning">Running…</Badge>;
  if (!ok) return <Badge variant="danger">Failed</Badge>;
  return <Badge variant="success">OK</Badge>;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const POLL_MS = 2000;

export default function FruitsMakerScriptsRun() {
  const { run, humanName, liveState, log } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Auto-refresh while still running -- same "poll until settled" idiom
  // the Vault's own GraphLog status line uses (`fruits_.vault.tsx`'s
  // `refreshGraphLogStatus`), just via a full loader revalidation instead
  // of a bespoke fetch, since this page has nothing else live on it.
  useEffect(() => {
    if (run.ok !== null) return;
    const interval = setInterval(() => revalidator.revalidate(), POLL_MS);
    return () => clearInterval(interval);
  }, [run.ok, revalidator]);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/fruits/maker/scripts" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Admin Scripts
          </Link>
        </div>

        <div className={`${surfaceBase} p-5 mb-8`}>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="accent">{run.script_name}</Badge>
              {run.dry_run && <Badge variant="neutral">dry run</Badge>}
            </div>
            <RunStatusBadge ok={run.ok} />
          </div>
          <div className="text-xs font-mono subtle-text flex flex-wrap gap-3">
            <span>By {humanName}</span>
            <span>Started {formatDatetime(run.started_at)}</span>
            <span>Duration {formatDuration(run.duration_ms)}</span>
            {run.args.length > 0 && <span>Args: {run.args.join(", ")}</span>}
            {liveState && <span>Job state: {liveState}</span>}
          </div>
          {run.summary && (
            <p className="text-sm mt-3" style={{ margin: 0, marginTop: "12px" }}>
              {run.summary}
            </p>
          )}
          {run.error && (
            <p className="text-sm mt-3" style={{ margin: 0, marginTop: "12px", color: "var(--red)" }}>
              {run.error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="font-bold text-lg font-mono purple-text" style={{ margin: 0 }}>
            Log
          </h2>
          <span className="text-xs font-mono subtle-text">{log.length} line(s)</span>
        </div>
        <div className={`${surfaceBase} p-5`}>
          {log.length === 0 ? (
            <p className="text-sm subtle-text" style={{ margin: 0 }}>
              {run.ok === null ? "Still running — no log lines yet." : "No log lines were recorded for this run."}
            </p>
          ) : (
            <pre
              className="text-xs"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                maxHeight: "560px",
                overflowY: "auto",
              }}
            >
              {log.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
