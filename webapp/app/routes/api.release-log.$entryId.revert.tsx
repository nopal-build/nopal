import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { revertReleaseLogEntry } from "robustness-core/data/releaseLog.server";

/**
 * POST /api/release-log/:entryId/revert
 *
 * Reverts one structured Release Log entry (see `releaseLog.server.ts`'s
 * module doc) — same authenticated-tool-surface pattern every
 * `api.vault.*`/`api.daily-log.*` route already uses (a real browser
 * session, or the CLI's bearer token — `nopal release-log revert`).
 *
 * Deliberately NOT exposed anywhere in the web UI yet — built now so the
 * mechanism exists before it's needed, not because it's meant to be
 * discovered by a human clicking around today.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { entryId } = params;
  if (!entryId) {
    return Response.json({ error: "entryId required" }, { status: 400 });
  }

  try {
    const result = await revertReleaseLogEntry(entryId, user._id);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ success: true });
  } catch (err) {
    console.error("Release log revert error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Revert failed" },
      { status: 500 },
    );
  }
}
