import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole, isProjectFolder } from "robustness-core/data/projectSharing.server";
import { enqueueGraphLogJob } from "robustness-core/data/graphLogQueue.server";
import { currentSeedRound, endSeedRound, listPacketFiles, openSeedRound } from "robustness-core/data/seedPackets.server";

/**
 * POST /api/seed-round — { projectFolderId, act: "open" | "end" }
 *
 * A seeding round is when a project takes in a backlog: a new project
 * opens with one, and a Guide opens another when a new person, a new
 * phase or a big batch of information calls for it
 * (`seedPackets.server.ts`). While it is open everyone on the project has
 * a seed packet.
 *
 * Ending the round closes the packets at once (nobody adds after this
 * returns) and sows whatever is still waiting, as a job whose id comes
 * back when there was anything to sow. The raw files stay, for the
 * uploader and the Guides, through the packet route.
 *
 * Guides only; anyone else gets the 404 of a project that isn't there.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { projectFolderId?: unknown; act?: unknown } | null;
  if (!body || typeof body.projectFolderId !== "string" || (body.act !== "open" && body.act !== "end")) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const folder = await getFolderById(body.projectFolderId);
  if (!folder || !(await isProjectFolder(folder)) || !(await getProjectRole(folder, user._id))?.guiding) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (body.act === "open") {
    const round = await openSeedRound(folder._id, user._id);
    return Response.json({ round: round.round, open: true });
  }

  const open = await currentSeedRound(folder._id);
  if (!open) return Response.json({ error: "No seeding round is open." }, { status: 409 });
  await endSeedRound(folder._id, user._id);
  const waiting = (await listPacketFiles(folder._id)).filter((f) => !f.sown_at).length;
  let jobId: string | null = null;
  if (waiting > 0) {
    try {
      jobId = await enqueueGraphLogJob("sow", { actingHumanId: user._id, projectFolderId: folder._id });
    } catch (err) {
      // The round is closed either way; what is left stays waiting and a
      // Guide can press Sow.
      console.error("seed-round end: sow enqueue failed:", err);
    }
  }
  return Response.json({ round: open.round, open: false, jobId, waiting });
}
