/**
 * Deliverables (`deliverables.server.ts`, Austin 2026-10-06 and
 * 2026-10-21): a Guide uploads a markdown page for the client, flips its
 * link, and anyone with the link reads the finished page with no login.
 * What leaves the server is a fixed set of fields; the only files served
 * are the ones the page names; the page takes no writes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bodyOpensWithTitle,
  canManageDeliverables,
  deliverableFileIds,
  deliverablePage,
  deliverableShareRefusal,
  deliverableTitle,
  isDeliverablesFolder,
  publicDeliverableBody,
} from "robustness-core/data/deliverables.server";
import { resolveRole } from "robustness-core/data/projectSharing.server";
import { featuresOf } from "robustness-core/data/features";
import { tabsFor } from "robustness-core/data/projectView.server";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { DeliverablesView, pdfLine } from "../components/DeliverablesView";
import { preparingPage } from "robustness-core/data/deliverablePdf.server";

const FILE = "d3l1v3r4bl3";
const PAGE = `---
title: Madison attic
description: What to do first
---
# Madison attic

Air seal before insulation.

![the hatch](/api/vault/view/ntfc5km0612jeex7fjiv)

[walkthrough](/api/vault/view/vid42?type=video)

::file{fileId="filedirective1" name="receipt.jpg"}
`;

describe("the public body", () => {
  const body = publicDeliverableBody(PAGE, FILE);

  it("drops the front matter and keeps the page", () => {
    expect(body).not.toContain("title: Madison attic");
    expect(body.startsWith("# Madison attic")).toBe(true);
    expect(body).toContain("Air seal before insulation.");
  });

  it("points every file at the deliverable's own route", () => {
    expect(body).not.toContain("/api/vault/view/");
    expect(body).toContain(`/api/deliverable/${FILE}/view/ntfc5km0612jeex7fjiv`);
    expect(body).toContain(`/api/deliverable/${FILE}/view/vid42?type=video`);
  });

  it("serves exactly the ids the page names; a ::file directive draws without its picture", () => {
    expect([...deliverableFileIds(PAGE)].sort()).toEqual(["ntfc5km0612jeex7fjiv", "vid42"]);
    const html = renderToStaticMarkup(
      <WebsitePageContent>
        <OxRenderer markdown={body} directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })} servedFileIds={{}} className="ox-no-dots ox-no-heading-marks website-page-ox" />
      </WebsitePageContent>,
    );
    expect(html).not.toContain("filedirective1");
  });

  it("a body that opens with its own heading carries the title; the page header then shows none", () => {
    expect(bodyOpensWithTitle(publicDeliverableBody(PAGE, FILE))).toBe(true);
    expect(bodyOpensWithTitle("Air seal first.\n\n# Later heading")).toBe(false);
    expect(bodyOpensWithTitle("#hashtag not a heading")).toBe(false);
  });

  it("the title is the front matter's, else the file name without .md", () => {
    expect(deliverableTitle({ name: "madison-attic.md", content: PAGE })).toBe("Madison attic");
    expect(deliverableTitle({ name: "madison-attic.md", content: "# no front matter" })).toBe("madison-attic");
  });
});

describe("what leaves the server", () => {
  it("is a fixed set of fields, the link keyed by the file's own id", () => {
    const page = deliverablePage({ _id: FILE, name: "madison-attic.md", content: PAGE, updated_at: "2026-10-21T08:00:00Z" }, "https://o.nopal.build");
    expect(Object.keys(page).sort()).toEqual(["body", "downloadUrl", "fileName", "pdfUrl", "title", "updated", "url"]);
    expect(page.url).toBe(`https://o.nopal.build/public/deliverable/${FILE}`);
    expect(page.downloadUrl).toBe(`/api/deliverable/${FILE}/download`);
    expect(page.pdfUrl).toBe(`/api/deliverable/${FILE}/pdf`);
    expect(page.updated).toBe("Oct 21, 2026");
    expect(page.title).toBe("Madison attic");
  });
});

describe("who manages: upload, replace, the switch", () => {
  const human = { role: null };
  it("a Guide on the project, or staff; never a Client, Crafter or Observer", () => {
    expect(canManageDeliverables(human, resolveRole("Guide"))).toBe(true);
    expect(canManageDeliverables(human, resolveRole("Owner"))).toBe(true);
    expect(canManageDeliverables({ role: "Admin" }, null)).toBe(true);
    expect(canManageDeliverables({ role: "Super" }, null)).toBe(true);
    for (const group of ["Client", "Crafter", "Observer"]) expect(canManageDeliverables(human, resolveRole(group))).toBe(false);
    expect(canManageDeliverables(human, null)).toBe(false);
  });

  it("the switch refuses a file outside the Deliverables folder, a non-markdown file, and a non-manager, in that order", () => {
    expect(deliverableShareRefusal({ manages: true, inDeliverables: false, isMarkdown: true })).toMatchObject({ status: 400 });
    expect(deliverableShareRefusal({ manages: true, inDeliverables: true, isMarkdown: false })).toMatchObject({ status: 400 });
    expect(deliverableShareRefusal({ manages: false, inDeliverables: true, isMarkdown: true })).toMatchObject({ status: 403 });
    expect(deliverableShareRefusal({ manages: true, inDeliverables: true, isMarkdown: true })).toBeNull();
  });

  it("a Deliverables folder is the type's root, not a folder that merely inherits the type", () => {
    expect(isDeliverablesFolder({ folder_type: "deliverables", is_folder_type_root: true })).toBe(true);
    expect(isDeliverablesFolder({ folder_type: "deliverables", is_folder_type_root: false })).toBe(false);
    expect(isDeliverablesFolder({ folder_type: "skills", is_folder_type_root: true })).toBe(false);
    expect(isDeliverablesFolder(null)).toBe(false);
  });
});

describe("the tab", () => {
  it("every group reads it, a Client included, second after Efforts", () => {
    expect(tabsFor(featuresOf("Client")).slice(0, 2)).toEqual(["efforts", "deliverables"]);
    expect(tabsFor(featuresOf("Guide")).slice(0, 2)).toEqual(["efforts", "deliverables"]);
    expect(tabsFor(featuresOf("Observer"))).toContain("deliverables");
  });

  const rows = [
    { fileId: FILE, name: "madison-attic.md", title: "Madison attic", updatedAt: "2026-10-21T08:00:00Z", size: 10, sharedAt: "2026-10-21T09:00:00Z", contentHash: "h1", pdf: { state: "failed" as const, reason: "the public page answered 500", at: "2026-10-21T09:01:00Z" } },
    { fileId: "draft1", name: "draft.md", title: "Draft", updatedAt: "2026-10-20T08:00:00Z", size: 10, sharedAt: null, contentHash: "h2", pdf: null },
  ];

  it("a reader sees the list and no controls; a shared page is the client's link, an unshared one is not a link", () => {
    const html = renderToStaticMarkup(<DeliverablesView projectFolderId="proj1" rows={rows} manage={false} openInVault={false} onChanged={() => {}} />);
    expect(html).toContain(`href="/public/deliverable/${FILE}"`);
    expect(html).not.toContain('href="/public/deliverable/draft1"');
    expect(html).not.toContain("/vault?file=");
    expect(html).not.toMatch(/Upload a deliverable|Share link|Stop sharing|Replace/);
    expect(html).toContain("Shared");
    expect(html).not.toContain("PDF");
  });

  it("a manager reads what became of a shared file's PDF, in the worker's own words", () => {
    const html = renderToStaticMarkup(<DeliverablesView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    expect(html).toContain("PDF couldn&#x27;t be made: the public page answered 500");
    expect(html).toContain('data-pdf-state="failed"');
    expect(pdfLine({ state: "ready" })).toBe("PDF ready");
    expect(pdfLine({ state: "preparing" })).toBe("PDF preparing");
    expect(pdfLine({ state: "none" })).toMatch(/not made yet/);
  });

  it("a manager gets Upload, and per page the switch, Replace and Edit in Vault", () => {
    const html = renderToStaticMarkup(<DeliverablesView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    expect(html).toContain("Upload a deliverable");
    expect(html).toContain("Stop sharing");
    expect(html).toContain("Share link");
    expect((html.match(/>Replace</g) ?? []).length).toBe(2);
    expect((html.match(/>Edit in Vault</g) ?? []).length).toBe(2);
  });

  it("the title opens what the client sees: the public page when the link is on, the Vault only for a manager when it is off", () => {
    const html = renderToStaticMarkup(<DeliverablesView projectFolderId="proj1" rows={rows} manage={true} openInVault={true} onChanged={() => {}} />);
    // The title is the base-size link; "Edit in Vault" is the xs one.
    expect(html).toContain(`<a href="/public/deliverable/${FILE}" class="typography_textSize_base`);
    expect(html).not.toContain(`<a href="/vault?file=${FILE}" class="typography_textSize_base`);
    expect(html).toContain(`<a href="/vault?file=draft1" class="typography_textSize_base`);
    const reader = renderToStaticMarkup(<DeliverablesView projectFolderId="proj1" rows={rows} manage={false} openInVault={true} onChanged={() => {}} />);
    expect(reader).toContain(`<a href="/public/deliverable/${FILE}"`);
    expect(reader).not.toContain("/vault?file=draft1");
    expect(reader).not.toContain("Edit in Vault");
  });
});

describe("read only", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const routes = [
    "public.deliverable.$fileId.tsx",
    "api.deliverable.$fileId.view.$id.tsx",
    "api.deliverable.$fileId.rendition.$id.tsx",
    "api.deliverable.$fileId.download.tsx",
    "api.deliverable.$fileId.pdf.tsx",
  ];

  it("the public routes take no writes", () => {
    for (const file of routes) {
      const src = readFileSync(path.join(here, "../routes", file), "utf8");
      expect(src, file).not.toMatch(/export\s+(async\s+)?(function|const)\s+action\b/);
    }
  });

  it("the PDF route serves nothing unless the link is on, and its waiting page has no script", () => {
    const src = readFileSync(path.join(here, "../routes/api.deliverable.$fileId.pdf.tsx"), "utf8");
    expect(src).toContain("resolveSharedDeliverable(");
    const html = preparingPage();
    expect(html).toMatch(/<meta http-equiv="refresh" content="\d+">/);
    expect(html).not.toMatch(/<script|<form|<button|<a /);
  });

  it("the PDF is the page printed: both download links sit in the wrapper the print rules hide", () => {
    const src = readFileSync(path.join(here, "../routes/public.deliverable.$fileId.tsx"), "utf8");
    expect(src).toContain('className="deliverable-actions"');
    expect(src).toContain("deliverable.css");
    const css = readFileSync(path.join(here, "../styles/deliverable.css"), "utf8");
    expect(css).toMatch(/@media print \{[^}]*\.deliverable-actions \{\s*display: none;/);
  });

  it("the page renders with no pen, no form and nothing editable, and hands the renderer no served ids", () => {
    const src = readFileSync(path.join(here, "../routes/public.deliverable.$fileId.tsx"), "utf8");
    expect(src).not.toMatch(/annotations=|interactive=/);
    expect(src).toContain("servedFileIds={{}}");
    const html = renderToStaticMarkup(
      <WebsitePageContent>
        <OxRenderer markdown={publicDeliverableBody(PAGE, FILE)} directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })} servedFileIds={{}} className="ox-no-dots ox-no-heading-marks website-page-ox" />
      </WebsitePageContent>,
    );
    expect(html).not.toMatch(/<form|<button|<input|<textarea|contenteditable="true"|data-mark-unit/);
  });
});
