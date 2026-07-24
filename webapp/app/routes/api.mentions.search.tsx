// GET /api/mentions/search?q=<query>
//
// The real, vault-backed `@` mention search — see `data/mentionSearch.
// server.ts` for the actual behavior (empty query → recent-or-projects,
// non-empty → closest-match search). This route is deliberately thin: auth
// + param parsing only, all real logic lives server-side in that module so
// it can be reused by future routes (Vault, ProjectView) without another
// HTTP hop.
import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { searchMentions } from "../data/mentionSearch.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const items = await searchMentions(user._id, q);
  return Response.json({ items });
}
