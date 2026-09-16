import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { runDailyLogSync } from "robustness-core/data/dailyLogSync.server";

/**
 * POST /api/graphlog/daily-log-sync
 *
 * Runs GraphLog's `daily-log-sync` stage for one project — see the
 * `graphlog` skill. Deterministic and fast (a plain Card→project copy, no
 * LLM call), so unlike PhyLog's own stages this is a single synchronous
 * request/response, not an enqueue-then-poll job — same shape as
 * `POST /api/daily-log/sort`. Thin client: `nopal graphlog daily-log-sync`.
 *
 * Body:
 *   projectFolderId — required.
 *   date            — optional, YYYY-MM-DD. Omit to sync every day this
 *                      project has ever had a Card for.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => ({}))) as {
    projectFolderId?: string;
    date?: string;
  };
  const { projectFolderId, date } = body;
  if (!projectFolderId) {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const folder = await getFolderById(projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  // Same trigger gate as PhyLog's own stages (see the `phylog` skill) —
  // an owner-tier Sharing Role, or being the project/personal owner.
  const role = await getProjectRole(folder, user._id);
  if (!role?.isOwner) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const result = await runDailyLogSync(projectFolderId, { date });
    return Response.json(result);
  } catch (err) {
    console.error("daily-log-sync error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "daily-log-sync failed" },
      { status: 500 },
    );
  }
}
