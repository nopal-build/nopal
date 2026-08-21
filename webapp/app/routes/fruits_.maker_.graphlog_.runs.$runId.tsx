// app/routes/fruits_.maker_.graphlog_.runs.$runId.tsx
// One GraphLog run's own performance timeline — every API/LLM/function-
// call event that run produced, in the order it actually happened, each
// with a right-aligned duration bar. Linked from the "Recent Runs" list
// on /fruits/maker/graphlog/. Admin/Super only, same gate as
// every other Maker page. See `graphLogPerf.server.ts` for how this data
// is captured — every duration here is code-measured wall-clock time,
// never a number the model itself reports.
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
  getGraphLogRun,
  type GraphLogPerfEventType,
  type GraphLogRunEvent,
} from "robustness-core/data/graphLogPerf.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getHumansById } from "robustness-core/data/humans.server";

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireMakerAccess(request);
  const runId = params.runId;
  if (!runId) throw data("Missing run id", { status: 400 });

  const found = await getGraphLogRun(runId);
  if (!found) throw data("Run not found", { status: 404 });

  const [projectFolder, [human]] = await Promise.all([
    getFolderById(found.run.project_folder_id),
    getHumansById([found.run.human_id]),
  ]);

  return {
    run: found.run,
    events: found.events,
    projectName: projectFolder?.name ?? "(deleted project)",
    humanName: human?.name ?? found.run.human_id,
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
            <p className="text-sm subtle-text">
              GraphLog run timelines are only available to Admin and Super accounts.
            </p>
            <Link to="/fruits/maker/graphlog" className="link text-sm">
              ← Back to GraphLog
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
            <p className="text-sm subtle-text">
              This run may have been pruned, or the link is wrong.
            </p>
            <Link to="/fruits/maker/graphlog" className="link text-sm">
              ← Back to GraphLog
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
          <Link to="/fruits/maker/graphlog" className="link text-sm">
            ← Back to GraphLog
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Pinned to an explicit locale AND `timeZone: "UTC"` — never the
 * viewer's own — same fix `OxRenderer.tsx`'s `formatRefDatetime` already
 * uses, for the same SSR/hydration-mismatch reason (see the `graphlog`
 * skill). */
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

/** Milliseconds since the run itself started — lets the timeline read as
 * "T+0.4s", "T+2.1s", ... rather than repeating full timestamps on every
 * row. */
function formatOffset(iso: string, runStartedAt: string): string {
  const offsetMs = new Date(iso).getTime() - new Date(runStartedAt).getTime();
  if (!Number.isFinite(offsetMs) || offsetMs < 0) return "T+0s";
  return `T+${(offsetMs / 1000).toFixed(1)}s`;
}

// Bar-fill colors -- reuse the SAME hues `Badge`'s own already dark-mode-
// vetted variants use as backgrounds (root.css's `.badge-accent`/
// `.badge-success`/`.badge-warning`/`.badge-neutral`), so a bar and its
// row's own type badge always read as the same color, and neither needed
// a bespoke contrast check -- these hues are already proven to read fine
// in both color schemes with no dark-mode override (see root.css's own
// comment on `.badge-danger`).
const TYPE_BAR_COLOR: Record<GraphLogPerfEventType, string> = {
  llm: "var(--moon)",
  api: "var(--yellow)",
  fn: "var(--green-light)",
  other: "var(--midground)",
};

const TYPE_BADGE_VARIANT: Record<GraphLogPerfEventType, "accent" | "warning" | "success" | "neutral"> = {
  llm: "accent",
  api: "warning",
  fn: "success",
  other: "neutral",
};

const TYPE_LABEL: Record<GraphLogPerfEventType, string> = {
  llm: "LLM",
  api: "API",
  fn: "Fn",
  other: "Other",
};

function RunStatusBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Badge variant="warning">Running…</Badge>;
  if (ok) return <Badge variant="success">OK</Badge>;
  return <Badge variant="danger">Failed</Badge>;
}

function TypeBadge({ type }: { type: GraphLogPerfEventType }) {
  return <Badge variant={TYPE_BADGE_VARIANT[type]}>{TYPE_LABEL[type]}</Badge>;
}

/** Splits out `params.text` (the model's own plain narration for that
 * call, when present -- see `graphLogPerf.server.ts`'s callers) from
 * everything else, since it's often long enough to need its own block
 * rather than being squeezed into the compact inline params string. */
function splitParams(params: Record<string, unknown> | null): {
  text: string | null;
  rest: Record<string, unknown> | null;
} {
  if (!params) return { text: null, rest: null };
  const { text, ...rest } = params;
  return { text: typeof text === "string" && text ? text : null, rest };
}

function formatParams(params: Record<string, unknown> | null): string | null {
  if (!params) return null;
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}

/**
 * One event row — the label side (process/type/name/params/offset) grows
 * to fill the row; the duration bar is right-aligned in a track that maxes
 * out at 33% of the row's own width, filled to `duration / maxDuration`
 * of that track — the single longest event in the run is the only one
 * that ever fills the full 33%.
 */
function EventRow({
  event,
  runStartedAt,
  maxDurationMs,
}: {
  event: GraphLogRunEvent;
  runStartedAt: string;
  maxDurationMs: number;
}) {
  const pct = maxDurationMs > 0 ? Math.max(2, Math.round((event.duration_ms / maxDurationMs) * 100)) : 0;
  const { text, rest } = splitParams(event.params);
  const paramsText = formatParams(rest);
  return (
    <div className="flex flex-col gap-1 py-2" style={{ borderBottom: "1px solid var(--midground)" }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
          <span className="text-xs font-mono subtle-text" style={{ minWidth: "62px" }}>
            {formatOffset(event.started_at, runStartedAt)}
          </span>
          <Badge variant="neutral">{event.process}</Badge>
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
      {text && (
        <details style={{ marginLeft: "70px" }}>
          <summary className="text-xs font-mono subtle-text" style={{ cursor: "pointer" }}>
            {text.length.toLocaleString()} character(s) of model text — click to expand
          </summary>
          <pre
            className="text-xs"
            style={{
              margin: "6px 0 0 0",
              padding: "10px",
              maxHeight: "320px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              background: "var(--midground)",
              borderRadius: "6px",
            }}
          >
            {text}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerGraphLogRun() {
  const { run, events, projectName, humanName } = useLoaderData<typeof loader>();

  const maxDurationMs = Math.max(1, ...events.map((e) => e.duration_ms));

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "960px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <Link to="/fruits/maker/graphlog" className="link text-sm font-mono">
            ← GraphLog
          </Link>
        </div>

        <div className={`${surfaceBase} p-5 mb-8`}>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="accent">{run.job_name}</Badge>
              <span className="font-bold text-lg">{projectName}</span>
            </div>
            <RunStatusBadge ok={run.ok} />
          </div>
          <div className="text-xs font-mono subtle-text flex flex-wrap gap-3">
            <span>By {humanName}</span>
            <span>Started {formatDatetime(run.started_at)}</span>
            <span>Duration {formatDuration(run.duration_ms)}</span>
            <span>{events.length} event(s)</span>
          </div>
          {run.error && (
            <p className="text-sm mt-3" style={{ margin: 0, marginTop: "12px", color: "var(--red)" }}>
              {run.error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="font-bold text-lg font-mono purple-text" style={{ margin: 0 }}>
            Timeline
          </h2>
          <span className="text-xs font-mono subtle-text">
            in order · bar length relative to this run's longest event ({formatDuration(maxDurationMs)})
          </span>
        </div>
        <div className={`${surfaceBase} p-5`}>
          {events.length === 0 ? (
            <p className="text-sm subtle-text" style={{ margin: 0 }}>
              {run.ok === null
                ? "Still running — no events recorded yet."
                : "No events were recorded for this run."}
            </p>
          ) : (
            events.map((event) => (
              <EventRow
                key={event._id}
                event={event}
                runStartedAt={run.started_at}
                maxDurationMs={maxDurationMs}
              />
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
