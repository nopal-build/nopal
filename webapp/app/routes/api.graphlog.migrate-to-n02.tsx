import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/migrate-to-n02
 *
 * Enqueues the `project-n01` -> `project-n02` migration
 * (`migrateToN02.server.ts`'s `migrateProjectToN02`) — see the `graphlog`
 * skill's "Planned: migration" section. Destructive; the CLI requires an
 * explicit `--yes` before ever calling this. Deterministic/free (no LLM
 * calls) but potentially slow for a project with a lot of history, so
 * this follows the same enqueue-then-poll shape as GraphLog's agentic
 * stages rather than blocking on one request. Thin client:
 * `nopal graphlog migrate-to-n02`.
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
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const jobId = await enqueueGraphLogJob("migrate-to-n02", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog migrate-to-n02 enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue migrate-to-n02" },
      { status: 500 },
    );
  }
}
