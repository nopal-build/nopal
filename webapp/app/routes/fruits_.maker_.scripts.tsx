// app/routes/fruits_.maker_.scripts.tsx
// Admin Scripts — repair/maintenance scripts registered in
// `adminScriptsRegistry.server.ts`, runnable here instead of locally
// against a `fly proxy` tunnel (see that registry's own module doc for
// why). Admin/Super only, same gate as every other Maker page. Enqueues
// onto the worker's "admin-scripts" queue (`adminScriptsQueue.server.ts`);
// every run's outcome is permanently recorded to `admin_script_runs`
// (`adminScriptRuns.server.ts`) and viewable at
// /fruits/maker/scripts/runs/:runId.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Form,
  data,
  redirect,
  useLoaderData,
  useNavigation,
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
import { listAdminScripts } from "robustness-core/data/adminScriptsRegistry.server";
import { listRecentAdminScriptRuns } from "robustness-core/data/adminScriptRuns.server";
import { isAnyAdminScriptRunning, enqueueAdminScriptJob } from "robustness-core/data/adminScriptsQueue.server";
import { getHumansById } from "robustness-core/data/humans.server";

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireMakerAccess(request);

  const [scripts, recentRuns, running] = await Promise.all([
    listAdminScripts(),
    listRecentAdminScriptRuns(20),
    isAnyAdminScriptRunning(),
  ]);

  const humanIds = Array.from(new Set(recentRuns.map((r) => r.human_id)));
  const humans = await getHumansById(humanIds);
  const humanNameById = new Map(humans.map((h) => [h._id, h.name]));

  return {
    scripts: scripts.map(({ name, label, description }) => ({ name, label, description })),
    recentRuns,
    running,
    humanNameById: Object.fromEntries(humanNameById),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireMakerAccess(request);

  const form = await request.formData();
  const scriptName = form.get("scriptName");
  const dryRun = form.get("dryRun") === "on";
  if (typeof scriptName !== "string" || !scriptName) {
    return data({ error: "Missing scriptName" }, { status: 400 });
  }

  if (await isAnyAdminScriptRunning()) {
    return data({ error: "Another admin script is already running — wait for it to finish first." }, { status: 409 });
  }

  const jobId = await enqueueAdminScriptJob({
    actingHumanId: user._id,
    scriptName,
    dryRun,
  });

  return redirect(`/fruits/maker/scripts/runs/${jobId}`);
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
            <p className="text-sm subtle-text">Admin Scripts are only available to Admin and Super accounts.</p>
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
  const { scripts, recentRuns, running, humanNameById } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/fruits/maker" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Maker
          </Link>
        </div>

        <h1 className="font-bold text-xl mb-2">Admin Scripts</h1>
        <p className="text-sm subtle-text mb-6" style={{ maxWidth: "620px" }}>
          Repair/maintenance scripts, run against production data by the worker (no local
          credentials needed). Runs are serialized — only one at a time across every script.
        </p>

        {running && (
          <div className="mb-4">
            <Badge variant="warning">A script is currently running — wait for it to finish before starting another.</Badge>
          </div>
        )}

        <section className="mb-12">
          <h2 className="font-bold text-lg font-mono purple-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
            Run a script
          </h2>
          <div className="flex flex-col gap-4">
            {scripts.map((script) => (
              <div key={script.name} className={`${surfaceBase} p-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                  <span className="font-bold text-sm font-mono">{script.label}</span>
                </div>
                <p className="text-sm subtle-text" style={{ margin: 0, marginBottom: "12px" }}>
                  {script.description}
                </p>
                <Form method="post" className="flex items-center gap-4 flex-wrap">
                  <input type="hidden" name="scriptName" value={script.name} />
                  <label className="flex items-center gap-2 text-sm font-mono subtle-text">
                    <input type="checkbox" name="dryRun" defaultChecked />
                    Dry run
                  </label>
                  <button
                    type="submit"
                    disabled={running || submitting}
                    className="text-sm font-mono rounded"
                    style={{
                      padding: "6px 14px",
                      border: "1px solid var(--purple)",
                      background: running || submitting ? "var(--midground)" : "var(--purple)",
                      color: running || submitting ? "var(--purple-light)" : "var(--farground)",
                      cursor: running || submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Run
                  </button>
                </Form>
              </div>
            ))}
            {scripts.length === 0 && (
              <p className="text-sm subtle-text">No scripts are registered yet.</p>
            )}
          </div>
        </section>

        <section>
          <hr style={{ borderColor: "currentColor", opacity: 0.12, margin: "0 0 24px" }} />
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
