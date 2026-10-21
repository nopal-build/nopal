/**
 * Making a deliverable (2026-10-21): a document brought from outside has
 * its local picture paths pointed at the uploaded pictures by name, and
 * the ones that matched nothing are named back; an upload is one
 * markdown file with pictures; a new one starts with a title.
 */
import { describe, expect, it } from "vitest";
import {
  deliverableFileName,
  newDeliverableContent,
  rewriteLocalImagePaths,
  splitUploadBundle,
} from "robustness-core/data/deliverables.server";

const pictures = [
  { name: "kitchen.jpg", fileId: "k1" },
  { name: "Attic Hatch.png", fileId: "a1" },
  { name: "kitchen.jpg", fileId: "k2" },
];

describe("rewriteLocalImagePaths", () => {
  it("points a plain, a nested, a URL-encoded and an angle-bracketed path at the uploaded picture, keeping alt and title", () => {
    const md = [
      "![the kitchen](kitchen.jpg)",
      "![hatch](./images/Attic%20Hatch.png)",
      "![hatch again](<images/Attic Hatch.png> \"before\")",
      "![upper](KITCHEN.JPG 'title')",
    ].join("\n");
    const { markdown, unmatched } = rewriteLocalImagePaths(md, pictures);
    expect(markdown).toBe(
      [
        "![the kitchen](/api/vault/view/k1)",
        "![hatch](/api/vault/view/a1)",
        "![hatch again](/api/vault/view/a1 \"before\")",
        "![upper](/api/vault/view/k1 'title')",
      ].join("\n"),
    );
    expect(unmatched).toEqual([]);
  });

  it("rewrites a reference definition too", () => {
    // A destination with a space has to sit in <>, as the spec says.
    const md = "![hatch][h]\n\n[h]: <./Attic Hatch.png>\n[k]: kitchen.jpg \"the kitchen\"";
    const { markdown } = rewriteLocalImagePaths(md, pictures);
    expect(markdown).toContain("[h]: /api/vault/view/a1");
    expect(markdown).toContain("[k]: /api/vault/view/k1 \"the kitchen\"");
  });

  it("leaves web, vault, data and anchor paths alone and does not report them", () => {
    const md = "![a](https://x.test/a.png)\n![b](/api/vault/view/abc)\n![c](data:image/png;base64,AAAA)\n![d](#top)\n![e](//cdn.test/e.png)";
    const { markdown, unmatched } = rewriteLocalImagePaths(md, pictures);
    expect(markdown).toBe(md);
    expect(unmatched).toEqual([]);
  });

  it("keeps a local path it cannot match as written and names it once", () => {
    const md = "![x](photos/porch.jpg)\n\n![x again](photos/porch.jpg)\n![y](roof.HEIC)";
    const { markdown, unmatched } = rewriteLocalImagePaths(md, pictures);
    expect(markdown).toBe(md);
    expect(unmatched).toEqual(["photos/porch.jpg", "roof.HEIC"]);
  });

  it("two pictures sharing a name match the first uploaded", () => {
    expect(rewriteLocalImagePaths("![k](kitchen.jpg)", pictures).markdown).toBe("![k](/api/vault/view/k1)");
  });
});

describe("splitUploadBundle", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });

  it("is one markdown file and its pictures, in any order", () => {
    const r = splitUploadBundle([file("a.png", "image/png"), file("doc.md", "text/markdown"), file("b.JPG", "")]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bundle.markdown.name).toBe("doc.md");
      expect(r.bundle.pictures.map((p) => p.name)).toEqual(["a.png", "b.JPG"]);
    }
  });

  it("refuses no markdown, two markdowns, and anything that isn't a picture", () => {
    expect(splitUploadBundle([file("a.png", "image/png")])).toMatchObject({ ok: false });
    expect(splitUploadBundle([file("a.md", "text/markdown"), file("b.md", "")])).toMatchObject({ ok: false });
    const r = splitUploadBundle([file("a.md", "text/markdown"), file("notes.docx", "application/octet-stream")]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("notes.docx");
  });
});

describe("a new deliverable", () => {
  it("starts with its title in front matter and as the heading the page opens on", () => {
    expect(newDeliverableContent(" Madison attic ")).toBe("---\ntitle: Madison attic\n---\n\n# Madison attic\n\n");
    expect(newDeliverableContent('Say "hi"')).toContain("title: Say 'hi'");
  });

  it("is named after its title, as a markdown file", () => {
    expect(deliverableFileName("Madison attic")).toBe("Madison attic.md");
    expect(deliverableFileName("notes.md")).toBe("notes.md");
    expect(deliverableFileName("a/b")).toBe("a-b.md");
    expect(deliverableFileName("  ")).toBe("Untitled.md");
  });
});
