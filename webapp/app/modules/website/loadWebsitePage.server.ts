/**
 * Shared loader logic for every public `/v2/*` page route (`routes/v2._index.tsx`,
 * `routes/v2.$.tsx`) — resolves the path against the one `website` project
 * backing `/v2` today (see `website.server.ts`'s `getPrimaryWebsiteFolder`).
 *
 * KNOWN REGRESSION from the marketing/app split (see
 * docs/marketing-app-split-plan.md): this used to let a shared collaborator
 * preview an unpublished draft page here by checking their session
 * (`getUser` + `canViewFileRef`) -- but webapp has NO session/auth code at
 * all now (login lives entirely on the app, o.nopal.build, with no shared
 * cookie domain -- see the plan's resolved open questions), so there's no
 * session left here to check. Every unpublished page now 404s for
 * everyone, including the people who used to be able to preview it --
 * fail-closed rather than silently trusting an unauthenticated request.
 * Restoring real preview access needs a cross-service-safe mechanism (a
 * signed preview link/token minted by the app, most likely) -- deliberately
 * not designed or built as part of this migration.
 */

import { data } from "react-router";
import {
  getPrimaryWebsiteFolder,
  resolveWebsitePageByPath,
} from "robustness-core/data/website.server";

export type LoadedWebsitePage = {
  body: string;
  title: string | null;
  description: string | null;
  /** Always false today -- see this module's own header comment. Kept in
   * the return shape so `WebsitePageView`'s "Draft" banner keeps working
   * unmodified whenever real preview access comes back. */
  isDraftPreview: boolean;
};

export async function loadWebsitePage(
  _request: Request,
  segments: string[],
): Promise<LoadedWebsitePage> {
  const siteFolder = await getPrimaryWebsiteFolder();
  if (!siteFolder) throw data("Not found", { status: 404 });

  const resolved = await resolveWebsitePageByPath(siteFolder, segments);
  if (!resolved) throw data("Not found", { status: 404 });

  if (resolved.meta.publish !== "published") {
    throw data("Not found", { status: 404 });
  }

  return {
    body: resolved.body,
    title: resolved.meta.title,
    description: resolved.meta.description,
    isDraftPreview: false,
  };
}
