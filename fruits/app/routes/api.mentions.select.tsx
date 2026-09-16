// POST /api/mentions/select
//
// Records that a mention search result was actually picked — the write
// side of `mentionSearch.server.ts`'s empty-query "recently mentioned"
// behavior. Called from `OxEditor`'s `onMentionSelect` (see
// `oxmarkdown/mention.ts`), fire-and-forget from the client; a failure
// here only means the recency list doesn't update, never a broken mention
// (the link itself is already inserted client-side before this runs).
import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { recordMentionSelection } from "robustness-core/data/mentionHistory.server";

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as { name?: string; path?: string };
  const { name, path } = body;
  if (!name || !path) {
    return Response.json({ error: "name and path are required" }, { status: 400 });
  }

  await recordMentionSelection(user._id, { name, path });
  return Response.json({ success: true });
}
