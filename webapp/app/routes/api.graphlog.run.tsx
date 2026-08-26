import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/run
 *
 * Enqueues GraphLog's full pipeline for one project, in order:
 * daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view
 * (`graphLogAgent.server.ts`'s `runGraphLogPipeline`) — see the
 * `graphlog` skill. Thin client: `nopal graphlog run`.
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
  // An Admin/Super may trigger this against ANY project or personal space,
  // not just ones they own or hold an owner-tier Sharing Role on -- the
  // Vault's own "More Actions" → Run GraphLog entry is gated the same way
  // client-side (see `fruits_.vault.tsx`). Same "staff override" pattern
  // `api.legal-documents.view.$docId.tsx` already uses.
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!role?.isOwner && !isStaff) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const jobId = await enqueueGraphLogJob("run", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog run enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue run" },
      { status: 500 },
    );
  }
}
