// app/routes/api.vault.camps.tsx
//
// GET /api/vault/camps?anchor=<folderId> — every camp under that anchor
// (an Organization root, a project, or Personal), in sequence order.
// POST /api/vault/camps — creates the next sequential camp under an
// anchor (body: `{ anchorFolderId, statement, targetArrival }`),
// provisioning its `Camps` folder on first use.
//
// See garden/3-growing/camps-and-log-books.md. Write access mirrors
// every other `api.vault.*` write route: `canActAsProjectOwner` already
// covers all three anchor kinds at once (project Sharing Role, org Guide
// for an `org`-rooted anchor, or plain ownership for Personal) — see its
// own doc in `projectSharing.server.ts`.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById, canViewFolderOrgAware } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { createCamp, listCampsForAnchor } from "robustness-core/data/camps.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const anchorFolderId = url.searchParams.get("anchor");
  if (!anchorFolderId) return Response.json({ error: "anchor is required" }, { status: 400 });

  const anchor = await getFolderById(anchorFolderId);
  if (!anchor) return Response.json({ error: "Anchor folder not found" }, { status: 404 });
  if (!(await canViewFolderOrgAware(user._id, anchor))) {
    return Response.json({ error: "Anchor folder not found" }, { status: 404 });
  }

  const camps = await listCampsForAnchor(anchor);
  return Response.json({ camps });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await request.json()) as {
    anchorFolderId?: string;
    statement?: string;
    targetArrival?: string;
  };
  if (!body.anchorFolderId) return Response.json({ error: "anchorFolderId is required" }, { status: 400 });
  if (!body.statement?.trim()) return Response.json({ error: "statement is required" }, { status: 400 });
  if (!body.targetArrival?.trim()) return Response.json({ error: "targetArrival is required" }, { status: 400 });

  const anchor = await getFolderById(body.anchorFolderId);
  if (!anchor) return Response.json({ error: "Anchor folder not found" }, { status: 404 });
  if (!(await canActAsProjectOwner(user._id, anchor.human_id, anchor._id))) {
    return Response.json({ error: "Anchor folder not found" }, { status: 404 });
  }

  const folder = await createCamp(anchor, body.statement.trim(), body.targetArrival.trim());
  return Response.json({ folder }, { status: 201 });
}
