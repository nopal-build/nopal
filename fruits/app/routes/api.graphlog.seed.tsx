import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { applySeed, type SeedPayload } from "robustness-core/data/seed.server";

/**
 * POST /api/graphlog/seed
 *
 * Takes a project's seed (its history before it logged here, built by
 * hand in the vault) into `Syncs/Seed/` — see `seed.server.ts`. A plain
 * write with no model call, so one synchronous request, the same shape
 * as `daily-log-sync`. Thin client: `nopal graphlog seed`. A second push
 * of the same files changes nothing; a changed file is replaced by name.
 *
 * Body:
 *   projectFolderId — required.
 *   days            — [{ date: "YYYY-MM-DD", content }] (`kind: seed`).
 *   documents       — [{ name, content }] (`kind: seed-document`).
 *   people          — the `_people.md` text, optional.
 *   from, to        — optional YYYY-MM-DD; only days in range are taken.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILES = 500;

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json().catch(() => null)) as
    | (Partial<SeedPayload> & { projectFolderId?: unknown; from?: unknown; to?: unknown })
    | null;
  if (!body || typeof body.projectFolderId !== "string") {
    return Response.json({ error: "projectFolderId is required" }, { status: 400 });
  }
  const from = typeof body.from === "string" ? body.from : null;
  const to = typeof body.to === "string" ? body.to : null;
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return Response.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }
  const days = Array.isArray(body.days) ? body.days : [];
  const documents = Array.isArray(body.documents) ? body.documents : [];
  if (days.length + documents.length > MAX_FILES) {
    return Response.json({ error: `At most ${MAX_FILES} files in one push` }, { status: 400 });
  }
  for (const d of days) {
    if (!d || typeof d.date !== "string" || !DATE_RE.test(d.date) || typeof d.content !== "string") {
      return Response.json({ error: "each day needs a YYYY-MM-DD date and its content" }, { status: 400 });
    }
  }
  for (const d of documents) {
    if (!d || typeof d.name !== "string" || !d.name.trim() || typeof d.content !== "string") {
      return Response.json({ error: "each document needs a name and its content" }, { status: 400 });
    }
  }

  const folder = await getFolderById(body.projectFolderId);
  if (!folder) return Response.json({ error: "Project not found" }, { status: 404 });
  // A project's history is its Guides' to bring in (admins through their
  // group, like any view); a Crafter, who may run a stage, may not. The
  // same 404 as a project they can't see.
  const role = await getProjectRole(folder, user._id);
  if (!role?.guiding) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const report = await applySeed(
      folder,
      { days, documents, people: typeof body.people === "string" ? body.people : null },
      { from, to },
    );
    return Response.json(report);
  } catch (err) {
    console.error("seed error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "seed failed" }, { status: 500 });
  }
}
