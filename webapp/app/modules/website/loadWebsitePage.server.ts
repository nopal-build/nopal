/**
 * Shared loader logic for every public `/v2/*` page route (`routes/v2._index.tsx`,
 * `routes/v2.$.tsx`) — resolves the path against the one `website` project
 * backing `/v2` today (see `website.server.ts`'s `getPrimaryWebsiteFolder`),
 * and gates an unpublished page behind the same view-access check the rest
 * of Vault uses (`canViewFileRef`), so a shared collaborator can preview a
 * draft without needing a platform Admin/Super role.
 */

import { data } from "react-router";
import { canViewFileRef } from "robustness-core/data/vault.server";
import {
  getPrimaryWebsiteFolder,
  resolveWebsitePageByPath,
} from "robustness-core/data/website.server";
import { getUser } from "../auth/auth.server";

export type LoadedWebsitePage = {
  body: string;
  title: string | null;
  description: string | null;
  /** True when this render is only visible because the viewer has access
   * to an otherwise-unpublished page — drives the "Draft" banner. */
  isDraftPreview: boolean;
};

export async function loadWebsitePage(
  request: Request,
  segments: string[],
): Promise<LoadedWebsitePage> {
  const siteFolder = await getPrimaryWebsiteFolder();
  if (!siteFolder) throw data("Not found", { status: 404 });

  const resolved = await resolveWebsitePageByPath(siteFolder, segments);
  if (!resolved) throw data("Not found", { status: 404 });

  let isDraftPreview = false;
  if (resolved.meta.publish !== "published") {
    const user = await getUser(request);
    const canView = user ? await canViewFileRef(user._id, resolved.file) : false;
    if (!canView) throw data("Not found", { status: 404 });
    isDraftPreview = true;
  }

  return {
    body: resolved.body,
    title: resolved.meta.title,
    description: resolved.meta.description,
    isDraftPreview,
  };
}
