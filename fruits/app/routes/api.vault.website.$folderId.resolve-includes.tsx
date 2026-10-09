import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { canViewFolder, getFolderAncestry, getFolderById } from "robustness-core/data/vault.server";
import { findWebsiteAnchor, resolveWebsiteIncludes } from "robustness-core/data/website.server";

/**
 * POST /api/vault/website/:folderId/resolve-includes — resolves every
 * `::include-ox{file="..."}` reference in a BODY of markdown the caller
 * supplies directly (not yet saved — the live, still-being-typed body in
 * `WebsitePageSplitEditor`'s own preview pane), relative to `:folderId`
 * (the page's own containing folder, same as `loadWebsitePage.server.ts`
 * passes the real public `/v2/*` renderer). Without this, the Vault's own
 * live preview had no way to resolve `::include-ox{...}` at all (it needs
 * real vault/DB access `OxRenderer` never has on its own, and the body
 * being previewed may not even be saved yet, so the loader's own
 * server-rendered `includes` is no use here either) — see
 * `oxmarkdown/websiteDirectives.tsx`'s own header comment on this
 * directive, which used to call this an accepted, permanently-deferred
 * gap before this route existed.
 *
 * Read-only (`canViewFolder`, not `canActAsProjectOwner`) — a non-writing
 * shared viewer reaches this exact same split-editor UI (just rendered
 * `editable={false}`, see `vault.tsx`), and still gets a live preview.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { folderId } = params;
  if (!folderId) {
    return Response.json({ error: "folderId required" }, { status: 400 });
  }

  const folder = await getFolderById(folderId);
  if (!folder || !(await canViewFolder(user._id, folder))) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const ancestry = await getFolderAncestry(folderId);
  const siteFolder = findWebsiteAnchor(ancestry);
  // Not actually inside a `website` project (shouldn't happen -- this
  // route is only ever called from `WebsitePageSplitEditor` -- but fail
  // soft with an empty map rather than a 400, matching every OTHER
  // `::include-ox{...}` failure mode, which also just renders nothing).
  if (!siteFolder) {
    return Response.json({ includes: {} });
  }

  const body = (await request.json().catch(() => null)) as { body?: string } | null;
  const includes = await resolveWebsiteIncludes(siteFolder, folderId, body?.body ?? "");
  return Response.json({ includes });
}
