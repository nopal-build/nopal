// app/routes/fruits_.maker_.graphlog_.defaults.tsx
// Review/edit UI for GraphLog's default skill content (knowledge/graph/
// project-view) — mirrors fruits_.maker_.phylog_.defaults.tsx exactly,
// split out from /fruits/maker/graphlog for the same reason PhyLog's own
// defaults editor is split from its usage dashboard. Admin/Super only,
// same gate.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Link,
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { useEffect, useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "../components/Badge";
import {
  getAllEffectiveGraphLogDefaultSkills,
  setGraphLogDefaultSkillOverride,
  type GraphLogDefaultStage,
} from "robustness-core/data/graphLogDefaults.server";

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
  const defaultSkills = await getAllEffectiveGraphLogDefaultSkills();
  return { defaultSkills };
}

const VALID_STAGES = new Set<GraphLogDefaultStage>(["knowledge", "graph", "graphStructure", "projectView"]);

/**
 * Saves or resets one stage's default-skill override -- see
 * `graphLogDefaults.server.ts` for what this actually changes (a brand
 * new project's seed content going forward, never an existing project's
 * own already-seeded file). Re-checks Admin/Super here independently of
 * the loader's own gate, since an action is a separate entry point.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await requireMakerAccess(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const stage = String(form.get("stage") ?? "") as GraphLogDefaultStage;
  if (!VALID_STAGES.has(stage)) {
    return data({ ok: false, intent, stage, error: "Unknown stage" }, { status: 400 });
  }

  if (intent === "save-default-skill") {
    const content = String(form.get("content") ?? "");
    await setGraphLogDefaultSkillOverride(stage, content, user._id);
    return { ok: true, intent, stage };
  }
  if (intent === "reset-default-skill") {
    await setGraphLogDefaultSkillOverride(stage, null, user._id);
    return { ok: true, intent, stage };
  }
  return data({ ok: false, intent, stage, error: "Unknown intent" }, { status: 400 });
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
          <div className="good-box p-6 flex flex-col gap-3">
            <Badge variant="danger">403</Badge>
            <h1 className="font-bold text-xl">Access Denied</h1>
            <p className="text-sm subtle-text">
              GraphLog's default prompts are only available to Admin and Super accounts.
            </p>
            <Link to="/fruits/maker/graphlog" className="link text-sm">
              ← Back to GraphLog Usage
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
        <div className="good-box p-6 flex flex-col gap-3">
          <h1 className="font-bold text-xl">Something went wrong</h1>
          <p className="text-sm subtle-text">
            {isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred."}
          </p>
          <Link to="/fruits/maker/graphlog" className="link text-sm">
            ← Back to GraphLog Usage
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STAGE_META: Record<GraphLogDefaultStage, { title: string; file: string; blurb: string }> = {
  knowledge: {
    title: "Knowledge",
    file: "skills/KNOWLEDGE.md",
    blurb: "Seeded into a brand new project's KNOWLEDGE.md. Defaults to \"skip\" (sync-knowledge writes no sidecars until a project owner replaces it).",
  },
  graph: {
    title: "Graph",
    file: "skills/GRAPH.md",
    blurb: "Seeded into a brand new project's GRAPH.md — sync-graph's own real starter instructions (not \"skip\"), extracting citable nodes into Graph/graph-log-*.md.",
  },
  graphStructure: {
    title: "Graph Structure",
    file: "skills/GRAPH_STRUCTURE.md",
    blurb: "Seeded into a brand new project's GRAPH_STRUCTURE.md — graph-structure's own real starter instructions, organizing the whole graph into Graph/graph-structure.md.",
  },
  projectView: {
    title: "Project View",
    file: "skills/PROJECT_VIEW.md",
    blurb: "Seeded into a brand new project's PROJECT_VIEW.md — graph-project-view's own real starter instructions, synthesizing graph-structure.md into README.md.",
  },
};

/**
 * One stage's default prompt: reviewable and editable, but NEVER
 * retroactive -- saving here only changes what a brand new project gets
 * seeded with from this point on. An existing project's own
 * `skills/*.md` is untouched, since that's the one place a human is meant
 * to edit directly (see the `vault`/`graphlog` skills).
 */
function DefaultSkillEditor({
  stage,
  initialContent,
  overridden,
}: {
  stage: GraphLogDefaultStage;
  initialContent: string;
  overridden: boolean;
}) {
  const meta = STAGE_META[stage];
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState(initialContent);

  // Loader data refreshes after a successful save/reset (fetcher
  // submissions revalidate the route), so re-sync the draft to whatever
  // just became the new effective content -- otherwise a reset would
  // save server-side but leave the textarea showing the just-cleared
  // override until a manual page reload.
  useEffect(() => {
    setDraft(initialContent);
  }, [initialContent]);

  const dirty = draft !== initialContent;
  const busy = fetcher.state !== "idle";

  return (
    <div className="good-box p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{meta.title}</span>
          <span className="text-xs font-mono subtle-text">{meta.file}</span>
        </div>
        <Badge variant={overridden ? "warning" : "neutral"}>
          {overridden ? "Admin override" : "Built-in default"}
        </Badge>
      </div>
      <p className="text-xs subtle-text" style={{ margin: 0 }}>
        {meta.blurb}
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        style={{
          minHeight: "220px",
          resize: "vertical",
          fontFamily: "monospace",
          fontSize: "12px",
          lineHeight: 1.5,
          padding: "10px",
          borderRadius: "8px",
          border: "1px solid var(--midground)",
          background: "var(--farground)",
          color: "inherit",
        }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() =>
            fetcher.submit(
              { intent: "save-default-skill", stage, content: draft },
              { method: "post" },
            )
          }
          className="text-sm font-mono rounded"
          style={{
            padding: "6px 14px",
            border: "1px solid var(--purple)",
            background: dirty ? "var(--purple)" : "transparent",
            color: dirty ? "var(--farground)" : "var(--purple-light)",
            cursor: !dirty || busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy && fetcher.formData?.get("intent") === "save-default-skill" ? "Saving…" : "Save"}
        </button>
        {overridden && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              fetcher.submit(
                { intent: "reset-default-skill", stage },
                { method: "post" },
              )
            }
            className="text-sm font-mono rounded"
            style={{
              padding: "6px 14px",
              border: "1px solid var(--midground)",
              background: "transparent",
              color: "var(--purple-light)",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy && fetcher.formData?.get("intent") === "reset-default-skill" ? "Resetting…" : "Reset to built-in default"}
          </button>
        )}
        {dirty && !busy && (
          <span className="text-xs font-mono subtle-text">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function FruitsMakerGraphLogDefaults() {
  const { defaultSkills } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
          <Link to="/fruits/maker/graphlog" className="link text-sm font-mono">
            ← GraphLog Usage
          </Link>
        </div>
        <div className="mb-8">
          <h1 className="font-bold text-2xl" style={{ margin: 0 }}>
            Default Prompts
          </h1>
          <p className="text-sm subtle-text mt-2" style={{ margin: 0, marginTop: "8px" }}>
            These are the default `skills/*.md` contents GraphLog seeds every BRAND NEW
            project-n02 space with. Editing here never touches an existing project's own
            skill files -- those stay whatever that project's owner already set. Saved to
            the database, so this survives every deploy/restart just like any other app
            data -- it's not reset by redeploying `webapp`/`worker`.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <DefaultSkillEditor
            stage="knowledge"
            initialContent={defaultSkills.knowledge.content}
            overridden={defaultSkills.knowledge.overridden}
          />
          <DefaultSkillEditor
            stage="graph"
            initialContent={defaultSkills.graph.content}
            overridden={defaultSkills.graph.overridden}
          />
          <DefaultSkillEditor
            stage="graphStructure"
            initialContent={defaultSkills.graphStructure.content}
            overridden={defaultSkills.graphStructure.overridden}
          />
          <DefaultSkillEditor
            stage="projectView"
            initialContent={defaultSkills.projectView.content}
            overridden={defaultSkills.projectView.overridden}
          />
        </div>
      </div>
    </AppLayout>
  );
}
