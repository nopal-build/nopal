/**
 * A picture landing in the split editor's text goes in as its own block
 * where the cursor is (`insertAtSelection`, 2026-10-21).
 */
import { describe, expect, it } from "vitest";
import { insertAtSelection } from "../oxmarkdown/insertAtSelection";

const IMG = "![hatch](/api/vault/view/a1)";

describe("insertAtSelection", () => {
  it("at the start of an empty document: the text and one line after", () => {
    expect(insertAtSelection("", 0, 0, IMG)).toEqual({ body: `${IMG}\n`, cursor: IMG.length + 1 });
  });

  it("in the middle of a paragraph: a blank line on each side", () => {
    const body = "Air seal first.\nThen baffles.";
    const r = insertAtSelection(body, 15, 15, IMG);
    expect(r.body).toBe(`Air seal first.\n\n${IMG}\n\nThen baffles.`);
  });

  it("after a blank line and before one: nothing doubled", () => {
    const body = "One.\n\n\n\nTwo.";
    const r = insertAtSelection(body, 6, 6, IMG);
    expect(r.body).toBe(`One.\n\n${IMG}\n\nTwo.`);
  });

  it("at the end: a blank line before, one line after", () => {
    const r = insertAtSelection("Done.", 5, 5, IMG);
    expect(r.body).toBe(`Done.\n\n${IMG}\n`);
    expect(r.cursor).toBe(r.body.length);
  });

  it("replaces a selection", () => {
    expect(insertAtSelection("keep DROP keep", 5, 9, IMG).body).toBe(`keep \n\n${IMG}\n\n keep`);
  });
});
