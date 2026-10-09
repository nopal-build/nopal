/**
 * Sharing a project's Efforts page by link (`newspaperShare.server.ts`,
 * Austin 2026-10-05): staff only, the Efforts page only, read only. What
 * leaves the server is a fixed set of fields; citations are gone; the
 * only files served are the ones the page names.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseOxDocument } from "oxmarkdown-core";
import {
  publicEffortsBody,
  setNewspaperShared,
  sharedEffortsPage,
  sharedFileIds,
} from "robustness-core/data/newspaperShare.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
import { ProjectView } from "../components/ProjectView";
import { posterUrl, renditionUrl } from "../oxmarkdown/mediaUrls";

const FOLDER = "proj1abc";
const ref = (name: string, location: string) =>
  `:ref{name="${name}" human-id="h7x9" datetime="2026-09-09T12:00:00Z" location="${location}"}`;
const PAGE = `# Crouch

We are at the end of the climb. ${ref("Gerald L", "/vault?file=meo")}

- Now: rows going on ${ref("Gerald L", "/daily-logs/{odd}")}

:::gallery{}
![northwest corner](/api/vault/view/ntfc5km0612jeex7fjiv)
[walkthrough](/api/vault/view/vid42?type=video)
:::

[the drawings](/api/vault/view/pdf9)

::file{fileId="filedirective1" name="receipt.jpg"}
`;
const GALLERIES = {
  progress: [{ url: "/api/vault/view/gal1", name: "a.jpg" }],
};

function walk(node: { type: string; name?: string; children?: unknown[] }, seen: string[]) {
  if (node.type === "textDirective" && node.name === "ref") seen.push("ref");
  for (const child of (node.children ?? []) as (typeof node)[]) walk(child, seen);
  return seen;
}

describe("the shared body", () => {
  const body = publicEffortsBody(PAGE, FOLDER);

  it("carries no citation: no names, ids, dates or log paths", () => {
    expect(walk(parseOxDocument(body), [])).toEqual([]);
    expect(body).not.toContain("h7x9");
    expect(body).not.toContain("Gerald");
    expect(body).not.toContain("daily-logs");
    expect(body).toContain("We are at the end of the climb.");
  });

  it("points every file at the folder's own route", () => {
    expect(body).not.toContain("/api/vault/view/");
    expect(body).toContain(`/api/newspaper/${FOLDER}/view/ntfc5km0612jeex7fjiv`);
    expect(body).toContain(`/api/newspaper/${FOLDER}/view/vid42?type=video`);
  });

  it("asks for browser-sized renditions through the same route", () => {
    expect(renditionUrl(`/api/newspaper/${FOLDER}/view/ntfc5km0612jeex7fjiv`, "display")).toBe(
      `/api/newspaper/${FOLDER}/rendition/ntfc5km0612jeex7fjiv?size=display`,
    );
    expect(posterUrl(`/api/newspaper/${FOLDER}/view/vid42?type=video`)).toBe(`/api/newspaper/${FOLDER}/rendition/vid42?size=poster`);
  });
});

describe("the files the link serves", () => {
  const ids = sharedFileIds(PAGE, GALLERIES);

  it("are exactly the ones the page names", () => {
    expect([...ids].sort()).toEqual(["gal1", "ntfc5km0612jeex7fjiv", "pdf9", "vid42"]);
  });

  it("never include a ::file directive's file, which draws without its picture", () => {
    expect(ids.has("filedirective1")).toBe(false);
    const html = renderToStaticMarkup(<ProjectView body={publicEffortsBody(PAGE, FOLDER)} servedFileIds={{}} />);
    expect(html).not.toContain("filedirective1");
  });
});

describe("what leaves the server", () => {
  it("is a fixed set of fields", () => {
    const page = sharedEffortsPage(
      { _id: FOLDER, name: "Crouch" },
      { manifest: {}, body: PAGE, galleryFolders: GALLERIES },
      "2026-10-03T08:00:00Z",
      "https://o.nopal.build",
    );
    expect(Object.keys(page).sort()).toEqual(["body", "galleryFolders", "title", "updated", "url"]);
    expect(page.updated).toBe("Oct 3, 2026");
    expect(page.url).toBe(`https://o.nopal.build/public/newspaper/${FOLDER}`);
    expect(page.galleryFolders.progress[0].url).toBe(`/api/newspaper/${FOLDER}/view/gal1`);
  });
});

describe("who can share", () => {
  const project = { _id: FOLDER, vault_root_key: "personal", parent_folder_id: "p" } as VaultFolder;

  it("refuses anyone who isn't Admin or Super", async () => {
    for (const role of ["Member", "Guide", null]) {
      expect(await setNewspaperShared({ role } as never, project, true)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("refuses a folder that isn't a project", async () => {
    expect(await setNewspaperShared({ role: "Admin" }, project, true)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("read only", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const routes = [
    "public.newspaper.$folderId.tsx",
    "api.newspaper.$folderId.view.$fileId.tsx",
    "api.newspaper.$folderId.rendition.$fileId.tsx",
  ];

  it("the public routes take no writes", () => {
    for (const file of routes) {
      const src = readFileSync(path.join(here, "../routes", file), "utf8");
      expect(src, file).not.toMatch(/export\s+(async\s+)?(function|const)\s+action\b/);
    }
  });

  it("the page renders with no pen, no form and nothing editable", () => {
    const src = readFileSync(path.join(here, "../routes/public.newspaper.$folderId.tsx"), "utf8");
    expect(src).not.toMatch(/annotations=|interactive=/);
    const html = renderToStaticMarkup(<ProjectView body={publicEffortsBody(PAGE, FOLDER)} galleryFolders={GALLERIES} servedFileIds={{}} />);
    expect(html).not.toMatch(/<form|<button|<input|<textarea|contenteditable="true"|data-mark-unit/);
  });
});
