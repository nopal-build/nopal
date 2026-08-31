// app/routes/fruits_.maker_.scripts_.new.tsx
// Start a new Admin Script run. Lists registered scripts NEWEST first
// (`listAdminScripts()` returns them chronologically, oldest first — see
// `adminScriptsRegistry.server.ts`'s own module doc — so this just
// reverses it), with deprecated ones broken out into their own
// de-emphasized section rather than mixed in or hidden. Super only, same
// gate as `fruits_.maker_.scripts.tsx`.
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
import { listAdminScripts, getAdminScript } from "robustness-core/data/adminScriptsRegistry.server";
import { isAnyAdminScriptRunning, enqueueAdminScriptJob } from "robustness-core/data/adminScriptsQueue.server";

// Same gate as `fruits_.maker_.scripts.tsx` -- duplicated rather than
// imported, matching every other Maker sub-page's own local
// `requireMakerAccess` copy (e.g. `fruits_.maker_.graphlog_.runs.$runId.tsx`).
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

  const running = await isAnyAdminScriptRunning();
  // Newest first -- see this file's own module doc.
  const scripts = [...listAdminScripts()].reverse();

  return {
    scripts: scripts.map(({ name, label, description, argLabel, argRequired, deprecated }) => ({
      name,
      label,
      description,
      argLabel,
      argRequired,
      deprecated: deprecated ?? null,
    })),
    running,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireAdminScriptsAccess(request);

  const form = await request.formData();
  const scriptName = form.get("scriptName");
  const dryRun = form.get("dryRun") === "on";
  const argValue = form.get("arg");
  if (typeof scriptName !== "string" || !scriptName) {
    return data({ error: "Missing scriptName" }, { status: 400 });
  }

  const script = getAdminScript(scriptName);
  if (!script) {
    return data({ error: `Unknown script: "${scriptName}"` }, { status: 400 });
  }

  const arg = typeof argValue === "string" ? argValue.trim() : "";
  if (script.argRequired && !arg) {
    return data({ error: `"${script.argLabel ?? "argument"}" is required.` }, { status: 400 });
  }

  if (await isAnyAdminScriptRunning()) {
    return data({ error: "Another admin script is already running — wait for it to finish first." }, { status: 409 });
  }

  const jobId = await enqueueAdminScriptJob({
    actingHumanId: user._id,
    scriptName,
    dryRun,
    args: arg ? [arg] : [],
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
            <p className="text-sm subtle-text">Admin Scripts are only available to Super accounts.</p>
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

type ScriptListItem = ReturnType<typeof useLoaderData<typeof loader>>["scripts"][number];

function ScriptCard({
  script,
  running,
  submitting,
}: {
  script: ScriptListItem;
  running: boolean;
  submitting: boolean;
}) {
  const disabled = running || submitting;
  return (
    <div className={`${surfaceBase} p-5`} style={script.deprecated ? { opacity: 0.7 } : undefined}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm font-mono">{script.label}</span>
          {script.deprecated && <Badge variant="warning">Deprecated</Badge>}
        </div>
      </div>
      <p className="text-sm subtle-text" style={{ margin: 0, marginBottom: script.deprecated ? "6px" : "12px" }}>
        {script.description}
      </p>
      {script.deprecated && (
        <p className="text-xs font-mono subtle-text" style={{ margin: 0, marginBottom: "12px" }}>
          Why deprecated: {script.deprecated.reason}
        </p>
      )}
      <Form method="post" className="flex items-center gap-4 flex-wrap">
        <input type="hidden" name="scriptName" value={script.name} />
        {script.argLabel && (
          <label className="flex items-center gap-2 text-sm font-mono subtle-text">
            {script.argLabel}
            <input
              type="text"
              name="arg"
              required={script.argRequired ?? false}
              className="text-sm font-mono rounded"
              style={{
                padding: "4px 8px",
                border: "1px solid var(--midground)",
                background: "transparent",
                color: "inherit",
                minWidth: "160px",
              }}
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm font-mono subtle-text">
          <input type="checkbox" name="dryRun" defaultChecked />
          Dry run
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="text-sm font-mono rounded"
          style={{
            padding: "6px 14px",
            border: "1px solid var(--purple)",
            background: disabled ? "var(--midground)" : "var(--purple)",
            color: disabled ? "var(--purple-light)" : "var(--farground)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          Run
        </button>
      </Form>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerScriptsNew() {
  const { scripts, running } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const active = scripts.filter((s) => !s.deprecated);
  const deprecated = scripts.filter((s) => s.deprecated);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/fruits/maker/scripts" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
            ← Admin Scripts
          </Link>
        </div>

        <h1 className="font-bold text-xl mb-2">Run a script</h1>
        <p className="text-sm subtle-text mb-6" style={{ maxWidth: "620px" }}>
          Newest first. Runs are serialized — only one at a time across every script.
        </p>

        {running && (
          <div className="mb-6">
            <Badge variant="warning">A script is currently running — wait for it to finish before starting another.</Badge>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {active.map((script) => (
            <ScriptCard key={script.name} script={script} running={running} submitting={submitting} />
          ))}
          {active.length === 0 && <p className="text-sm subtle-text">No scripts are registered yet.</p>}
        </div>

        {deprecated.length > 0 && (
          <section className="mt-10">
            <hr style={{ borderColor: "currentColor", opacity: 0.12, margin: "0 0 20px" }} />
            <h2 className="font-bold text-sm font-mono subtle-text mb-4" style={{ margin: 0, marginBottom: "16px" }}>
              Deprecated ({deprecated.length})
            </h2>
            <div className="flex flex-col gap-4">
              {deprecated.map((script) => (
                <ScriptCard key={script.name} script={script} running={running} submitting={submitting} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
