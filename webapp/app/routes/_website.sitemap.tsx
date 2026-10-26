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

type SitemapGroup = { label: string; entries: WebsiteSitemapEntry[] };

/** Buckets a flat entry list by `section` — root-level pages (`section:
 * null`) always lead under the label "Pages", regardless of where the
 * walk happened to visit them first; every other section keeps whatever
 * order it first appeared in. */
function groupBySection(entries: WebsiteSitemapEntry[]): SitemapGroup[] {
  const order: string[] = [];
  const bySection = new Map<string, WebsiteSitemapEntry[]>();
  for (const entry of entries) {
    const key = entry.section ?? "Pages";
    if (!bySection.has(key)) {
      order.push(key);
      bySection.set(key, []);
    }
    bySection.get(key)!.push(entry);
  }
  const labels = ["Pages", ...order.filter((key) => key !== "Pages")];
  return labels.filter((label) => bySection.has(label)).map((label) => ({ label, entries: bySection.get(label)! }));
}

export default function SiteMap() {
  const { entries, footer } = useLoaderData<typeof loader>();
  const groups = groupBySection(entries);

  return (
    <>
      <div>
        <div className="simple-container p-4">
          <h1 className="text-4xl font-bold mt-8">Site Map</h1>
          <p className="purple-light-text text-xl mt-2">Every page on the site.</p>

          {groups.map((group) => (
            <div key={group.label} className="mt-8">
              <h2 className="text-2xl font-semibold green-text">{group.label}</h2>
              <ul className="mt-4 space-y-2">
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
        </div>
      </div>
      <WebsiteToolFooter footer={footer} />
    </>
  );
}
