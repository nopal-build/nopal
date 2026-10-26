import { Link, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { loadWebsiteFooter } from "../modules/website/loadWebsiteFooter.server";
import { WebsiteToolFooter } from "../components/WebsiteToolFooter";

export async function loader() {
  return { footer: await loadWebsiteFooter() };
}

export const meta: MetaFunction = () => [
  { title: "Construction Tools | Nopal" },
  {
    name: "description",
    content: "Construction tools and calculators for the job site",
  },
];

export interface Tool {
  name: string;
  description: string;
  href: string;
  inDevelopment?: boolean;
}

export interface Doc {
  name: string;
  description: string;
  href: string;
}

// Exported (not just module-local) so `/sitemap` (`_website.sitemap.tsx`)
// can list every real tool/doc route too, straight from this one real
// source of truth -- these aren't Vault-backed pages
// `listWebsiteSitemapEntries` can discover on its own (they're real app
// routes, not markdown files), so the sitemap's "Tools" section would
// otherwise need its own hand-kept copy of this exact list, silently
// drifting the moment a tool is added/renamed here and not there.
export const TOOLS: Tool[] = [
  {
    name: "Print a DO NOT USE list",
    description:
      "Print or customize your own DO NOT USE list for your building.",
    href: "/tools/do-not-use",
  },
  {
    name: "Building Envelope",
    description:
      "Evaluate your building envelope — air tightness, ventilation, and fresh air strategy — and see where your home lands on the health vs efficiency quadrant.",
    href: "/tools/building-envelope",
  },
  {
    name: "Fresh Air Calculator",
    description:
      "Size your balanced ventilation system (ERV/HRV) based on occupancy. Calculate supply and exhaust tube counts, design base flow, boost flow, and get Zehnder and Brink unit recommendations.",
    href: "/tools/erv-calculator",
    inDevelopment: true,
  },
  {
    name: "Volume Calculator by Frames",
    description:
      "Calculate backfill volumes along a linear run using cross-section frames. Supports multiple materials with weight estimation.",
    href: "/tools/frames-volume-calc",
    inDevelopment: true,
  },
  {
    name: "Grade Differential",
    description:
      "Set elevations across a grid, build multiple grade layers, and calculate cut & fill volumes between any two surfaces. Auto-interpolates unset points using inverse-distance weighting.",
    href: "/tools/grade-differential",
    inDevelopment: true,
  },
  {
    name: "Medium Timber Framing",
    description: "Size and generate takeoffs for MTF",
    href: "/tools/mtf",
    inDevelopment: true,
  },
  {
    name: "Thermal Inertia",
    description:
      "Compare thermal diffusivity of common insulation and structural materials. Understand how thermal inertia affects real-world comfort beyond R-values alone.",
    href: "/tools/thermal-inertia",
    inDevelopment: true,
  },
];

export const DOCS: Doc[] = [
  {
    name: "AZ Independent Contractor Workers' Comp Acknowledgment",
    description:
      "Arizona Independent Contractor Workers' Compensation Acknowledgment and Responsibility form.",
    href: "/docs/wc-waiver",
  },
];

export default function ToolsIndex() {
  const { footer } = useLoaderData<typeof loader>();
  return (
    <>
    <div>
      <div className="simple-container p-4">
        <h1 className="text-4xl font-bold mt-8">Construction Tools</h1>
        <p className="purple-light-text text-xl mt-2">
          Calculators and utilities for the job site
        </p>

        <div className="mt-8 space-y-4">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              to={tool.href}
              prefetch="intent"
              className="block border border-gray-300 dark:border-[var(--dark-midground)] rounded-lg p-6 hover:border-[var(--green)] dark:hover:border-[var(--green)] transition-colors"
            >
              <h2 className="text-2xl font-semibold green-text">
                {tool.name}
                {tool.inDevelopment && (
                  <span className="ml-3 align-middle inline-block text-xs font-medium px-2 py-0.5 rounded-full border border-yellow-500 text-yellow-600 dark:text-yellow-400">
                    In Development
                  </span>
                )}
              </h2>
              <p className="mt-2 opacity-80">{tool.description}</p>
            </Link>
          ))}
        </div>

        <h2 className="text-3xl font-bold mt-16">Documents</h2>
        <p className="purple-light-text text-xl mt-2">
          Forms and legal documents
        </p>

        <div className="mt-8 space-y-4">
          {DOCS.map((doc) => (
            <Link
              key={doc.href}
              to={doc.href}
              prefetch="intent"
              className="block border border-gray-300 dark:border-[var(--dark-midground)] rounded-lg p-6 hover:border-[var(--green)] dark:hover:border-[var(--green)] transition-colors"
            >
              <h2 className="text-2xl font-semibold green-text">
                {doc.name}
              </h2>
              <p className="mt-2 opacity-80">{doc.description}</p>
            </Link>
          ))}
        </div>

        <p className="mt-12 text-sm opacity-70">
          More tools coming soon. Have a suggestion?{" "}
          <a href="mailto:human@nopal.build" className="underline">
            Let us know
          </a>
          .
        </p>
      </div>
    </div>
    <WebsiteToolFooter footer={footer} />
    </>
  );
}
