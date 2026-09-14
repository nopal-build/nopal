import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob, getGraphLogProjectStatus } from "robustness-core/data/graphLogQueue.server";

/**
 * POST /api/graphlog/reset
 *
 * Enqueues GraphLog's full reset for one project, in order:
 * reset-project-view -> reset-graph -> reset-knowledge
 * (`resetProjectAll`, `graphLogReset.server.ts`) — see the `graphlog`
 * skill. Returns immediately with a job id; poll
 * `GET /api/graphlog/jobs/:jobId`. Thin client: `nopal graphlog reset`.
 * Destructive and NOT run implicitly by anything else — always an
 * explicit, separate call. The individual `reset-project-view`/
 * `reset-graph`/`reset-knowledge` routes remain useful for resetting just
 * one depth.
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
  // Vault's own "More Actions" → Reset GraphLog entry is gated the same way
  // client-side (see `fruits_.vault.tsx`). Same "staff override" pattern
  // `api.legal-documents.view.$docId.tsx` already uses.
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!role?.isOwner && !isStaff) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Same running-job backstop as `api.graphlog.run.tsx` -- see its own
  // comment. Resetting mid-run would delete state a still-active pipeline
  // is reading from/writing to.
  const status = await getGraphLogProjectStatus(projectFolderId);
  if (status.running) {
    return Response.json(
      { error: "GraphLog is already running for this project. Stop it first, or wait for it to finish." },
      { status: 409 },
    );
  }

  try {
    const jobId = await enqueueGraphLogJob("reset", {
      actingHumanId: user._id,
      projectFolderId,
    });
    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("GraphLog reset enqueue error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue reset" },
      { status: 500 },
    );
  }
}
