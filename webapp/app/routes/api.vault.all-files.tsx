import type { LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getAllFileListingsForHuman } from "../data/vault.server";

/**
 * GET /api/vault/all-files
 *
 * Every file *metadata* listing (never content) across the signed-in
 * human's OWN vault, in one request — used by the Vault page
 * (`fruits_.vault.tsx`) to warm its per-folder children cache for every
 * folder at once shortly after the page mounts, so opening any of the
 * viewer's own folders (sidebar or main view) feels instant instead of
 * waiting on a fresh per-folder fetch the first time.
 *
 * Deliberately scoped to folders the viewer OWNS: a folder someone else
 * shared with them still lazy-loads via the existing
 * `/api/vault/folders/:folderId/children` (that one resolves against the
 * folder's OWNER, not the viewer — a single human_id-scoped query like
 * this one can't do that in one shot for every shared owner at once).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const files = await getAllFileListingsForHuman(user._id);
  return Response.json({ files });
}
