// app/routes/fruits_.maker_.phylog_.defaults.tsx
// Review/edit UI for PhyLog's default skill content (pre-capture/capture/
// post-capture) — split out from /fruits/maker/phylog (linked from there)
// since three full-height textareas made that usage dashboard feel
// dominated by an editor rather than stats. Admin/Super only, same gate.
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
  getAllEffectiveDefaultSkills,
  setDefaultSkillOverride,
  type PhylogDefaultStage,
} from "robustness-core/data/phylogDefaults.server";

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
  const defaultSkills = await getAllEffectiveDefaultSkills();
  return { defaultSkills };
}

const VALID_STAGES = new Set<PhylogDefaultStage>(["preCapture", "capture", "postCapture"]);

/**
 * Saves or resets one stage's default-skill override -- see
 * `phylogDefaults.server.ts` for what this actually changes (a brand new
 * project's seed content going forward, never an existing project's own
 * already-seeded file). Re-checks Admin/Super here independently of the
 * loader's own gate, since an action is a separate entry point.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await requireMakerAccess(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const stage = String(form.get("stage") ?? "") as PhylogDefaultStage;
  if (!VALID_STAGES.has(stage)) {
    return data({ ok: false, intent, stage, error: "Unknown stage" }, { status: 400 });
  }

  if (intent === "save-default-skill") {
    const content = String(form.get("content") ?? "");
    await setDefaultSkillOverride(stage, content, user._id);
    return { ok: true, intent, stage };
  }
  if (intent === "reset-default-skill") {
    await setDefaultSkillOverride(stage, null, user._id);
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
              PhyLog's default prompts are only available to Admin and Super accounts.
            </p>
            <Link to="/fruits/maker/phylog" className="link text-sm">
              ← Back to PhyLog Usage
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
          <Link to="/fruits/maker/phylog" className="link text-sm">
            ← Back to PhyLog Usage
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STAGE_META: Record<PhylogDefaultStage, { title: string; file: string; blurb: string }> = {
  preCapture: {
    title: "Pre-Capture",
    file: "skills/PRE_CAPTURE.md",
    blurb: "Seeded into a brand new project's PRE_CAPTURE.md. Defaults to \"skip\" (pre-capture writes no summaries until a project owner replaces it).",
  },
  capture: {
    title: "Capture",
    file: "skills/CAPTURE.md",
    blurb: "Seeded into a brand new project's CAPTURE.md, and the runtime fallback capture.server.ts uses if a project's own file is ever missing.",
  },
  postCapture: {
    title: "Post-Capture",
    file: "skills/POST_CAPTURE.md",
    blurb: "Seeded into a brand new project's POST_CAPTURE.md. Defaults to \"skip\" (post-capture is a placeholder stage today).",
  },
};

/**
 * One stage's default prompt: reviewable and editable, but NEVER
 * retroactive -- saving here only changes (a) what a brand new project
 * gets seeded with from this point on, and (b) `capture`'s rare
 * missing-file fallback. An existing project's own `skills/*.md` is
 * untouched, since that's the one place a human is meant to edit
 * directly (see the `vault`/`phylog` skills).
 */
function DefaultSkillEditor({
  stage,
  initialContent,
  overridden,
}: {
  stage: PhylogDefaultStage;
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

export default function FruitsMakerPhylogDefaults() {
  const { defaultSkills } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "860px" }}>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
          <Link to="/fruits/maker/phylog" className="link text-sm font-mono">
            ← PhyLog Usage
          </Link>
        </div>
        <div className="mb-8">
          <h1 className="font-bold text-2xl" style={{ margin: 0 }}>
            Default Prompts
          </h1>
          <p className="text-sm subtle-text mt-2" style={{ margin: 0, marginTop: "8px" }}>
            These are the default `skills/*.md` contents PhyLog seeds every BRAND NEW
            project with, and (for Capture) the runtime fallback if a project's own
            file is ever missing. Editing here never touches an existing project's
            own skill files -- those stay whatever that project's owner already set.
            Saved to the database, so this survives every deploy/restart just like any
            other app data -- it's not reset by redeploying `webapp`/`worker`.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <DefaultSkillEditor
            stage="preCapture"
            initialContent={defaultSkills.preCapture.content}
            overridden={defaultSkills.preCapture.overridden}
          />
          <DefaultSkillEditor
            stage="capture"
            initialContent={defaultSkills.capture.content}
            overridden={defaultSkills.capture.overridden}
          />
          <DefaultSkillEditor
            stage="postCapture"
            initialContent={defaultSkills.postCapture.content}
            overridden={defaultSkills.postCapture.overridden}
          />
        </div>
      </div>
    </AppLayout>
  );
}
