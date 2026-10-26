// app/routes/_website.sitemap.tsx — `/sitemap`, linked from `_footer.md`.
// Deliberately a REAL route, not an OxMarkdown Vault page, per the garden
// seed's own ask: a hand-authored page listing every other page would
// silently drift the moment one is added/renamed/(un)published, exactly
// the failure mode a sitemap exists to prevent. The Vault-backed content
// half comes from `listWebsiteSitemapEntries` (website.server.ts), which
// walks the site's own folder tree fresh (well, cached — see that
// function's own comment); the "Tools" section below reuses the real
// `TOOLS`/`DOCS` arrays from `_website.tools._index.tsx` directly, since
// those are real app routes, not Vault files `listWebsiteSitemapEntries`
// could ever discover on its own.
//
// Three fixed sections, in this fixed order (2026-10-25, human ask):
// Pages, Tools, Archive. "Pages" is the odd one out -- rather than a plain
// alphabetical/category list, four real pages (Home, Terrain, Stories,
// Guides) always lead it in that exact order, with everything else in the
// section (a folder-nested page, or any other root page) falling into a
// category subheading below them -- see `MAIN_PAGE_PATHS` and
// `groupByCategory`. "Archive" is entirely category-subheadinged (by
// folder name) and sorted newest-first within each category — see
// `sortByDateThenTitle`.
import { Link, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import {
  getPrimaryWebsiteFolder,
  listWebsiteSitemapEntries,
  type WebsiteSitemapEntry,
} from "robustness-core/data/website.server";
import { loadWebsiteFooter } from "../modules/website/loadWebsiteFooter.server";
import { WebsiteToolFooter } from "../components/WebsiteToolFooter";
import { TOOLS, DOCS } from "./_website.tools._index";

export async function loader() {
  const siteFolder = await getPrimaryWebsiteFolder();
  const [entries, footer] = await Promise.all([
    siteFolder ? listWebsiteSitemapEntries(siteFolder) : Promise.resolve([]),
    loadWebsiteFooter(),
  ]);
  return { entries, footer };
}

export const meta: MetaFunction = () => [
  { title: "Site Map | Nopal" },
  { name: "description", content: "Every page on the Nopal website." },
];

type SitemapCategoryGroup = { label: string; entries: WebsiteSitemapEntry[] };

/** The handful of pages that always lead the "Pages" section, in this
 * exact order, by their real (resolvable) path -- NOT by title text, which
 * is free to change without breaking this list. Everything else in
 * "Pages" falls through to `groupByCategory` below instead. */
const MAIN_PAGE_PATHS = ["/", "/terrain", "/stories", "/guides"];

/** Splits the flat entry list `listWebsiteSitemapEntries` returns into the
 * two sections it ever actually produces -- `entry.section === "Archive"`,
 * or everything else (`null`, meaning "Pages"). "Tools" is never a
 * possible `section` value (see `WebsiteSitemapEntry.section`'s own
 * comment) -- it's sourced from `TOOLS`/`DOCS` below instead. */
function splitBySection(entries: WebsiteSitemapEntry[]): {
  pages: WebsiteSitemapEntry[];
  archive: WebsiteSitemapEntry[];
} {
  const pages: WebsiteSitemapEntry[] = [];
  const archive: WebsiteSitemapEntry[] = [];
  for (const entry of entries) {
    (entry.section === "Archive" ? archive : pages).push(entry);
  }
  return { pages, archive };
}

/** Buckets entries by `category` (a folder's humanized name) for display
 * as a subheading within a section -- entries with no category (a
 * root-level page) fall into a shared "Other" bucket instead of rendering
 * bare, so a section is always either "just a flat list" (no categories at
 * all) or "every entry has a heading," never a mix of the two. Categories
 * sort alphabetically; "Other" always sorts last, since it's a leftover
 * bucket rather than a real content grouping. */
function groupByCategory(entries: WebsiteSitemapEntry[]): SitemapCategoryGroup[] {
  const order: string[] = [];
  const byCategory = new Map<string, WebsiteSitemapEntry[]>();
  for (const entry of entries) {
    const key = entry.category ?? "Other";
    if (!byCategory.has(key)) {
      order.push(key);
      byCategory.set(key, []);
    }
    byCategory.get(key)!.push(entry);
  }
  const labels = [...order].sort((a, b) => {
    if (a === "Other") return b === "Other" ? 0 : 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });
  return labels.map((label) => ({ label, entries: byCategory.get(label)! }));
}

function sortAlphabetically(entries: WebsiteSitemapEntry[]): WebsiteSitemapEntry[] {
  return [...entries].sort((a, b) => a.title.localeCompare(b.title));
}

/** Newest first (by `WebsiteSitemapEntry.date`); same-date ties break
 * alphabetically by title -- the Archive section's own sort (2026-10-25,
 * human ask). */
function sortByDateThenTitle(entries: WebsiteSitemapEntry[]): WebsiteSitemapEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

function CategoryList({ groups }: { groups: SitemapCategoryGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mt-6">
          <h3 className="text-lg font-semibold mb-1">{group.label}</h3>
          <ul className="space-y-2">
            {group.entries.map((entry) => (
              <li key={entry.path}>
                <Link to={entry.path} prefetch="intent" className="underline">
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export default function SiteMap() {
  const { entries, footer } = useLoaderData<typeof loader>();
  const { pages, archive } = splitBySection(entries);

  const mainPages = MAIN_PAGE_PATHS.map((path) => pages.find((e) => e.path === path)).filter(
    (e): e is WebsiteSitemapEntry => Boolean(e),
  );
  const mainPagePaths = new Set(mainPages.map((e) => e.path));
  const otherPageGroups = groupByCategory(pages.filter((e) => !mainPagePaths.has(e.path))).map((group) => ({
    ...group,
    entries: sortAlphabetically(group.entries),
  }));

  const archiveGroups = groupByCategory(archive).map((group) => ({
    ...group,
    entries: sortByDateThenTitle(group.entries),
  }));

  return (
    <>
      <div>
        <div className="simple-container p-4">
          <h1 className="text-4xl font-bold mt-8">Site Map</h1>
          <p className="purple-light-text text-xl mt-2">Every page on the site.</p>

          <div className="mt-8">
            <h2 className="text-2xl font-semibold green-text">Pages</h2>
            <ul className="mt-4 space-y-2">
              {mainPages.map((entry) => (
                <li key={entry.path}>
                  <Link to={entry.path} prefetch="intent" className="underline">
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
            <CategoryList groups={otherPageGroups} />
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-semibold green-text">Tools</h2>
            <ul className="mt-4 space-y-2">
              {TOOLS.map((tool) => (
                <li key={tool.href}>
                  <Link to={tool.href} prefetch="intent" className="underline">
                    {tool.name}
                  </Link>
                </li>
              ))}
              {DOCS.map((doc) => (
                <li key={doc.href}>
                  <Link to={doc.href} prefetch="intent" className="underline">
                    {doc.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-semibold green-text">Archive</h2>
            <CategoryList groups={archiveGroups} />
          </div>
        </div>
      </div>
      <WebsiteToolFooter footer={footer} />
    </>
  );
}
