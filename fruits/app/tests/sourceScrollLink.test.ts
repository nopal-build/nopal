/**
 * The split editor's Markdown lined up with what is drawn beside it
 * (`components/sourceScrollLink.ts`; Austin, 2026-11-21: matching by
 * fraction of length "gets increasingly off with more images"). The
 * arithmetic is code's and is checked here; the feel is Austin's to judge
 * on the page.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { anchorLineFor, buildScrollMap, convertPosition, lineAtOffset } from "../components/sourceScrollLink";
import OxRenderer from "../components/OxRenderer";

describe("the scroll map", () => {
  // Three paragraphs 100 apart in the source. A picture after the first
  // makes the second start 600 further down the drawn page.
  const anchors = [
    { line: 1, source: 0, drawn: 0 },
    { line: 3, source: 100, drawn: 150 },
    { line: 5, source: 200, drawn: 900 },
    { line: 7, source: 300, drawn: 1050 },
  ];
  const map = buildScrollMap(anchors, 400, 1200);

  it("a picture stretches only the stretch it is in; nothing adds up after it", () => {
    // By fraction of length the third paragraph (source 200 of 400) would land at 600: mid-picture.
    expect(convertPosition(map, 200, "source")).toBe(900);
    expect(convertPosition(map, 900, "drawn")).toBe(200);
    // And the paragraph after the picture is exact too.
    expect(convertPosition(map, 300, "source")).toBe(1050);
    // Halfway down the picture is halfway between the lines around it.
    expect(convertPosition(map, 525, "drawn")).toBe(150);
  });

  it("holds at both ends and goes both ways through the same places", () => {
    expect(convertPosition(map, -50, "drawn")).toBe(0);
    expect(convertPosition(map, 5000, "drawn")).toBe(400);
    expect(convertPosition(map, 5000, "source")).toBe(1200);
    for (const y of [0, 75, 150, 400, 900, 1000, 1200]) {
      expect(convertPosition(map, convertPosition(map, y, "drawn"), "source")).toBeCloseTo(y, 6);
    }
  });

  it("with no anchors it is the fraction of length; an anchor that goes backwards is dropped", () => {
    const ends = buildScrollMap([], 400, 1200);
    expect(convertPosition(ends, 600, "drawn")).toBe(200);
    // Blocks side by side in a grid: the second starts no lower than the first.
    const sideBySide = buildScrollMap([...anchors, { line: 6, source: 250, drawn: 880 }], 400, 1200);
    expect(sideBySide.map((a) => a.line)).not.toContain(6);
    expect(convertPosition(sideBySide, 300, "source")).toBe(1050);
  });

  it("finds the cursor's line and the block that line belongs to", () => {
    const text = "# Title\n\nFirst.\nstill first\n\nSecond.";
    expect(lineAtOffset(text, 0)).toBe(1);
    expect(lineAtOffset(text, text.indexOf("still"))).toBe(4);
    expect(lineAtOffset(text, text.length)).toBe(6);
    expect(anchorLineFor([1, 3, 6], 4)).toBe(3);
    expect(anchorLineFor([1, 3, 6], 5)).toBe(3);
    expect(anchorLineFor([3, 6], 1)).toBe(null);
  });
});

describe("the renderer's source anchors", () => {
  const markdown = "# Title\n\nFirst paragraph.\n\n- one\n- two\n\n![alt](/api/vault/view/abc)\n";

  it("marks each block with its source line only when asked, and adds nothing otherwise", () => {
    const plain = renderToStaticMarkup(createElement(OxRenderer, { markdown }));
    expect(plain).not.toContain("data-source-line");
    const anchored = renderToStaticMarkup(createElement(OxRenderer, { markdown, sourceAnchors: true }));
    expect(anchored).toMatch(/<h1[^>]*data-source-line="1"/);
    expect(anchored).toMatch(/<p[^>]*data-source-line="3"/);
    expect(anchored).toContain('data-source-line="5"');
    expect(anchored).toContain('data-source-line="8"');
    // Lines come out in the order they are drawn.
    const lines = [...anchored.matchAll(/data-source-line="(\d+)"/g)].map((m) => Number(m[1]));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    // The anchors are attributes and empty markers: the words drawn are the same.
    const strip = (html: string) => html.replace(/ data-source-line="\d+"/g, "").replace(/<div style="height:0" aria-hidden="true"><\/div>/g, "");
    expect(strip(anchored)).toBe(plain);
  });
});
