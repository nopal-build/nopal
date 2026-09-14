import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { getGraphLogProjectStatus } from "robustness-core/data/graphLogQueue.server";
import { reseedProjectN02Skills } from "robustness-core/data/projectN02.server";

/**
 * POST /api/graphlog/reseed-skills
 *
 * Overwrites this project's `skills/KNOWLEDGE.md` / `GRAPH.md` /
 * `GRAPH_STRUCTURE.md` / `PROJECT_VIEW.md` with the CURRENT effective
 * defaults (`reseedProjectN02Skills`, `projectN02.server.ts`) — the
 * Vault's own "More Actions" → Reseed GraphLog Skills entry
 * (`fruits_.vault.tsx`), so a default-skill change no longer requires
 * running `scripts/reseed-graphlog-skills.ts` by hand against a named
 * project. Deterministic and fast (plain file writes, no LLM call), so
 * like `daily-log-sync` this is a single synchronous request/response,
 * not enqueue-then-poll. A file already on the current default is left
 * untouched; the response reports which files actually changed.
 *
 * Body:
 *   projectFolderId — required.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as { projectFolderId?: string };
  const { projectFolderId } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  // Same "staff override" gate as Run/Reset — see `api.graphlog.reset.tsx`.
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!role?.isOwner && !isStaff) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Same running-job backstop as reset/run — reseeding mid-run could
  // change a skill file a still-active pipeline stage is about to read.
  const status = await getGraphLogProjectStatus(projectFolderId);
  if (status.running) {
    return Response.json(
      { error: "GraphLog is already running for this project. Stop it first, or wait for it to finish." },
      { status: 409 },
    );
  }

  try {
    const results = await reseedProjectN02Skills(folder);
    return Response.json({ results });
  } catch (err) {
    console.error("GraphLog reseed-skills error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to reseed skills" },
      { status: 500 },
    );
  }
}
