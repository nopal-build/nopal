import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { changeBudgetLine, startBudget } from "robustness-core/data/budget.server";
import { parseBudgetTable } from "robustness-core/data/budgetLines";
import { markDate } from "robustness-core/data/graphLogMarks.server";

/**
 * POST /api/budget — the Budget's two writes (`budget.server.ts`):
 *
 *   { act: "start", projectFolderId, asOf, table }
 *       The first values, copied once from the estimate's markdown table
 *       and dated the estimate's own day. 409 when a budget exists.
 *   { act: "change", projectFolderId, key, estimate?, confidence?, date? }
 *       One line's new estimate and/or confidence, kept with its date and
 *       who made it.
 *
 * Only the `budget` feature writes (Guides; admins through their group,
 * ADR-024): 404 for anyone not on the project, so ids can't be probed,
 * 403 for a member without it.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.projectFolderId !== "string" || (body.act !== "start" && body.act !== "change")) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !(await isProjectFolder(folder))) return Response.json({ error: "Not found" }, { status: 404 });
  const role = await getProjectRole(folder, user._id);
  if (!role) return Response.json({ error: "Not found" }, { status: 404 });
  if (!role.features.includes("budget")) {
    return Response.json({ error: "The budget is the guides'." }, { status: 403 });
  }

  if (body.act === "start") {
    if (typeof body.table !== "string" || typeof body.asOf !== "string") {
      return Response.json({ error: "Paste the estimate's table and give its date." }, { status: 400 });
    }
    const parsed = parseBudgetTable(body.table);
    if (parsed.unknown.length > 0 || parsed.unreadable.length > 0) {
      const problems = [
        parsed.unknown.length ? `not on the list: ${parsed.unknown.join(", ")}` : null,
        parsed.unreadable.length ? `numbers I couldn't read: ${parsed.unreadable.join(", ")}` : null,
      ].filter(Boolean);
      return Response.json({ error: `Some rows didn't fit (${problems.join("; ")}).` }, { status: 400 });
    }
    const result = await startBudget({ projectFolderId: folder._id, authorHumanId: user._id, asOf: body.asOf, lines: parsed.lines });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ budget: result.budget }, { status: 201 });
  }

  if (typeof body.key !== "string") return Response.json({ error: "Which line?" }, { status: 400 });
  const estimate = body.estimate === undefined || body.estimate === null ? undefined : Number(body.estimate);
  const confidence = body.confidence === undefined || body.confidence === null ? undefined : Number(body.confidence);
  const result = await changeBudgetLine({
    projectFolderId: folder._id,
    authorHumanId: user._id,
    key: body.key,
    estimate,
    confidence,
    date: markDate(typeof body.date === "string" ? body.date : undefined),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ budget: result.budget });
}
