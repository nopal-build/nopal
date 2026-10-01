import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { readingDate, saveSteepReading } from "robustness-core/data/steepReadings.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";
import { isSteepPosition } from "robustness-core/data/steepScale";

/**
 * POST /api/steep — one tap on the Steep-o-meter, `{ projectFolderId,
 * position, date }`. Stores the reading and does nothing else: no email,
 * no event, no file, no mark (see `steepReadings.server.ts`). Anyone with
 * a role on the project may tap; only its Owners read other people's
 * readings (`dashboard.server.ts`).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    projectFolderId?: unknown;
    position?: unknown;
    date?: unknown;
  } | null;
  if (!body || typeof body.projectFolderId !== "string" || !isSteepPosition(body.position)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const folder = await getFolderById(body.projectFolderId);
  // 404 for anything the person is not on, so a tap can't probe which
  // project ids exist.
  if (!folder || !(await isProjectFolder(folder))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await getProjectRole(folder, user._id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (getProjectStatus(folder) !== "active") {
    return Response.json({ error: "This project isn't active" }, { status: 409 });
  }

  const reading = await saveSteepReading({
    humanId: user._id,
    projectFolderId: folder._id,
    position: body.position,
    date: readingDate(typeof body.date === "string" ? body.date : undefined),
  });
  if (!reading) return Response.json({ error: "Couldn't save that" }, { status: 500 });
  return Response.json({ position: reading.position, date: reading.date });
}
