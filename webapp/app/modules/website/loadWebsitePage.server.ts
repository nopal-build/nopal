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
  resolveWebsiteDailyLogEntries,
  resolveWebsiteIncludes,
  type ResolvedWebsiteDailyLogEntry,
} from "robustness-core/data/website.server";
// Server request-performance tracing (see the `fruits-performance-
// monitoring` garden seed) -- `/v2/*` is the pilot route for `webapp`,
// the same way `vault.tsx` is for `fruits`. Both `v2._index.tsx` and
// `v2.$.tsx` call THIS function for their entire loader body, so wrapping
// it here traces every `/v2/*` content request from one place rather
// than duplicating the wrap in both route files. `humanId` is always
// `null` -- webapp has no session/auth code at all (see this file's own
// header comment).
import { withRequestPerf } from "robustness-core/data/requestPerf.server";
import { timeRequestPerf } from "robustness-core/data/requestPerfContext.server";

export type LoadedWebsitePage = {
  body: string;
  title: string | null;
  description: string | null;
  /** Always false today -- see this module's own header comment. Kept in
   * the return shape so `WebsitePageView`'s "Draft" banner keeps working
   * unmodified whenever real preview access comes back. */
  isDraftPreview: boolean;
  /** Resolved `::daily-log{date="..." project="..."}` references found in
   * this page's own body -- see `website.server.ts`'s
   * `resolveWebsiteDailyLogEntries` and `oxmarkdown/websiteDirectives.tsx`.
   * Empty for a page that doesn't use the directive at all. */
  dailyLogEntries: Record<string, ResolvedWebsiteDailyLogEntry>;
  /** Resolved `::include-ox{file="..."}` references found in this page's
   * own body -- see `website.server.ts`'s `resolveWebsiteIncludes` and
   * `oxmarkdown/websiteDirectives.tsx`. Keyed by the literal `file="..."`
   * string, each value the included file's own markdown body. Empty for a
   * page that doesn't use the directive at all. */
  includes: Record<string, string>;
};

export async function loadWebsitePage(
  request: Request,
  segments: string[],
): Promise<LoadedWebsitePage> {
  const url = new URL(request.url);
  return withRequestPerf(
    { app: "webapp", route: url.pathname, method: request.method, humanId: null },
    () => loadWebsitePageBody(segments),
  );
}

async function loadWebsitePageBody(segments: string[]): Promise<LoadedWebsitePage> {
  const siteFolder = await timeRequestPerf("fn", "getPrimaryWebsiteFolder", null, () =>
    getPrimaryWebsiteFolder(),
  );
  if (!siteFolder) throw data("Not found", { status: 404 });

  const resolved = await timeRequestPerf("fn", "resolveWebsitePageByPath", { segments }, () =>
    resolveWebsitePageByPath(siteFolder, segments),
  );
  if (!resolved) throw data("Not found", { status: 404 });

  // `"archived"` is PUBLICLY VISIBLE, same as `"published"` -- only a real
  // `"draft"` 404s. See `website.server.ts`'s `WebsitePublishStatus` for
  // why archiving a page isn't the same as hiding it.
  if (resolved.meta.publish === "draft") {
    throw data("Not found", { status: 404 });
  }

  const dailyLogEntries = await timeRequestPerf("fn", "resolveWebsiteDailyLogEntries", null, () =>
    resolveWebsiteDailyLogEntries(siteFolder, resolved.body),
  );
  const includes = await timeRequestPerf(
    "fn",
    "resolveWebsiteIncludes",
    { folderId: resolved.file.folder_id },
    () => resolveWebsiteIncludes(siteFolder, resolved.file.folder_id, resolved.body),
  );

  return {
    body: resolved.body,
    title: resolved.meta.title,
    description: resolved.meta.description,
    isDraftPreview: false,
    dailyLogEntries,
    includes,
  };
}
