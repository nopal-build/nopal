/**
 * Photos from a run of `::file` lines read as one grid the width of the
 * text, not a row each down the page (2026-10-02): the Logbook, a Card,
 * the log in the pen.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";

const photo = (id: string) => `::file{name="${id}.jpeg" caption fileId="${id}" contentType="image/jpeg"}`;
const CARD = `Framing went up today.

${photo("a")}
${photo("b")}

${photo("c")}
::file{name="plans.pdf" caption fileId="pdf1" contentType="application/pdf"}
${photo("d")}
`;

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("photos on a Card", () => {
  const html = renderToStaticMarkup(<OxRenderer markdown={CARD} servedFileIds={{ a: "copyA", b: "copyB", c: "copyC", d: "copyD", pdf1: "copyPdf" }} />);

  it("photos next to each other share one grid, a blank line between them included", () => {
    expect(count(html, "ox-file-photos")).toBe(2);
    expect(count(html, "<figure")).toBe(4);
  });

  it("a file that isn't a photo keeps its own row and splits the grid", () => {
    expect(count(html, "ox-file-directive")).toBe(1);
  });

  it("each photo loads the project's copy, as a thumbnail", () => {
    expect(html).toContain("/api/vault/rendition/copyA");
    expect(html).not.toContain("/api/vault/view/a");
  });
});
