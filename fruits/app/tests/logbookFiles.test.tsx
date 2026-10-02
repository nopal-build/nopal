/**
 * The Logbook's photos (2026-10-01). A Card's markdown names its writer's
 * originals, which nobody else can open once the sync has copied them
 * into the project; the Photos tab loads the copies. With `servedFileIds`
 * the renderer loads a Card's files by the same ids the file tabs do, and
 * never asks for an id the reader was not given.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";

const CARD = `Found some areas where we need to adjust assumptions.

::file{name="IMG_7834.jpeg" caption fileId="orig7834" contentType="image/jpeg"}

- and one in a list
  ::file{name="IMG_7833.jpeg" caption fileId="orig7833" contentType="image/jpeg"}
`;

describe("a Card's files in the Logbook", () => {
  it("loads the id the Card names when no ids are given (the writer's own Daily Log)", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={CARD} />);
    expect(html).toContain('src="/api/vault/rendition/orig7834?size=thumb"');
    expect(html).toContain('src="/api/vault/rendition/orig7833?size=thumb"');
  });

  it("loads the project's copy, at any depth, and never the original", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={CARD} servedFileIds={{ orig7834: "copy7834", orig7833: "copy7833" }} />);
    expect(html).toContain('src="/api/vault/rendition/copy7834?size=thumb"');
    expect(html).toContain('src="/api/vault/rendition/copy7833?size=thumb"');
    expect(html).not.toContain("orig7834");
    expect(html).not.toContain("orig7833");
  });

  it("asks for nothing when the reader has no id for a file", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={CARD} servedFileIds={{ orig7834: "copy7834" }} />);
    expect(html.match(/<img /g)?.length).toBe(1);
    expect(html).not.toContain("orig7833");
    // The file still shows as a file, by name.
    expect(html).toContain('title="IMG_7833.jpeg"');
  });

  it("looks an id up as its own key only", () => {
    const typed = `::file{name="x.jpeg" caption fileId="constructor" contentType="image/jpeg"}`;
    const html = renderToStaticMarkup(<OxRenderer markdown={typed} servedFileIds={{}} />);
    expect(html).not.toContain("<img ");
  });
});
