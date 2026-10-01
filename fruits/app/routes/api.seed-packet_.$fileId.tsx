import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { getPacketFile } from "robustness-core/data/seedPackets.server";

/**
 * GET /api/seed-packet/:fileId (route file `api.seed-packet_.$fileId`: the
 * underscore keeps it from nesting under the packet route)
 *
 * Opens one file from a seed packet. Only the person who added it and
 * the project's Guides (Austin, 2026-09-30): another Client, a Crafter
 * or an Observer on the same project gets the same 404 as a file that
 * isn't there. This is the only route that serves a packet's bytes; the
 * Vault's file routes never see them, because a packet file is not a
 * Vault file.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const file = params.fileId ? await getPacketFile(params.fileId) : null;
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  if (file.human_id !== user._id) {
    const folder = await getFolderById(file.project_folder_id);
    const role = folder ? await getProjectRole(folder, user._id) : null;
    if (!role?.guiding) return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (typeof file.content === "string") {
    return new Response(file.content, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  if (!file.s3_key) return Response.json({ error: "Not found" }, { status: 404 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
