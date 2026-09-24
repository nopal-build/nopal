/**
 * The files view inside the Vault: the Gallery folder is the Vault's own
 * gallery grid, a video is a real player with its poster (never a link
 * that downloads), and a file kept as a file says so.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ProjectFilesView } from "../components/ProjectFilesView";
import type { ProjectFileRow } from "robustness-core/data/fileFolders.server";

const base: Omit<ProjectFileRow, "fileId" | "serveId" | "name" | "contentType" | "folders" | "urls"> = {
  size: 1,
  date: "2026-08-19",
  authorHumanId: "admin_2",
  authorName: "Lucas J",
  caption: "",
  context: "",
  cardFileId: "card",
  cardCopyFileId: null,
  copyFileId: null,
  description: null,
  filing: null,
  filingSource: null,
  kind: "unfiled",
  kindSource: "none",
  reason: null,
  cost: null,
  nodes: [],
  threads: [],
  efforts: [],
  acts: [],
};
const urls = (id: string, video = false) => ({
  thumb: `/api/vault/rendition/${id}?size=thumb`,
  display: `/api/vault/rendition/${id}?size=display`,
  original: `/api/vault/view/${id}`,
  poster: video ? `/api/vault/rendition/${id}?size=poster` : null,
});
const photo: ProjectFileRow = { ...base, fileId: "p1", serveId: "c1", name: "IMG_1.jpeg", contentType: "image/jpeg", kind: "photo", kindSource: "model", folders: ["gallery"], urls: urls("c1"), caption: "northwest corner" };
const clip: ProjectFileRow = { ...base, fileId: "v1", serveId: "c2", name: "IMG_2.mov", contentType: "video/quicktime", kind: "video", kindSource: "model", folders: ["gallery"], urls: urls("c2", true) };
const zip: ProjectFileRow = { ...base, fileId: "z1", serveId: "c3", name: "OT L22 Type.zip", contentType: "application/zip", kind: "other", kindSource: "code", filingSource: "code", folders: ["unsorted"], urls: urls("c3"), reason: "A .zip file (application/zip), kept as a file; not read." };

const render = (search: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/vault?folder=p${search}`]}>
      <ProjectFilesView projectFolderId="p" rows={[photo, clip, zip]} folders={["gallery", "documents", "costs", "unsorted"]} kinds={["photo", "other"]} onOpen={() => {}} onChanged={() => {}} />
    </MemoryRouter>,
  );

describe("the files view in the Vault", () => {
  it("renders the Gallery folder as the Vault's gallery grid, with a real video player and its poster", () => {
    const html = render("");
    expect(html).toContain('class="vault-gallery-grid"');
    expect(html).toContain('src="/api/vault/rendition/c1?size=thumb"');
    expect(html).toMatch(/<video[^>]*poster="\/api\/vault\/rendition\/c2\?size=poster"[^>]*src="\/api\/vault\/view\/c2"/);
    expect(html).not.toMatch(/<a[^>]*href="\/api\/vault\/view\/c2"/);
  });

  it("counts each folder and shows a kept file in Unsorted as not read", () => {
    const html = render("&files=unsorted");
    expect(html).toContain("Gallery · 2");
    expect(html).toContain("Unsorted · 1");
    expect(html).toContain("OT L22 Type.zip");
    expect(html).toContain("kept as a file, not read");
  });
});
