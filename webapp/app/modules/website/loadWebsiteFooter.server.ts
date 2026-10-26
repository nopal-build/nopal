/**
 * Resolves the website project's shared `_footer.md` for pages that don't
 * go through `loadWebsitePage.server.ts` (real app routes — the tools/
 * waiver pages — not Vault-backed markdown content) but still want the
 * same shared footer every markdown `/v2/*` page gets via its own
 * `::include-ox{file="./_footer.md"}` (see `website.server.ts`'s
 * `resolveWebsiteIncludes`). Reuses that exact mechanism against a
 * synthetic one-line body, resolved relative to the website project's OWN
 * root (`siteFolder._id` — the same folder `_footer.md` itself lives in),
 * since these code routes have no "containing folder" of their own the
 * way a markdown page does.
 */
import {
  getPrimaryWebsiteFolder,
  resolveWebsiteIncludes,
  resolveWebsiteDailyLogEntries,
  type ResolvedWebsiteDailyLogEntry,
} from "robustness-core/data/website.server";

const FOOTER_FILE = "./_footer.md";
const FOOTER_INCLUDE_BODY = `::include-ox{file="${FOOTER_FILE}"}`;

export type LoadedWebsiteFooter = {
  body: string | null;
  dailyLogEntries: Record<string, ResolvedWebsiteDailyLogEntry>;
};

export async function loadWebsiteFooter(): Promise<LoadedWebsiteFooter> {
  const siteFolder = await getPrimaryWebsiteFolder();
  if (!siteFolder) return { body: null, dailyLogEntries: {} };

  const includes = await resolveWebsiteIncludes(siteFolder, siteFolder._id, FOOTER_INCLUDE_BODY);
  const body = includes[FOOTER_FILE] ?? null;
  if (!body) return { body: null, dailyLogEntries: {} };

  const dailyLogEntries = await resolveWebsiteDailyLogEntries(siteFolder, body);
  return { body, dailyLogEntries };
}
