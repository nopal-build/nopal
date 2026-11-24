/**
 * A plain picture in a page (`![alt](/api/vault/view/<id>)`) loads its
 * browser-sized copy, not the original (2026-11-24): a phone's HEIC
 * original is one Chrome can't draw, and the page showed the alt text
 * ("IMG_2051") where the photo should be. The stored text is unchanged.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";

const srcOf = (markdown: string) => /<img[^>]*src="([^"]*)"/.exec(renderToStaticMarkup(<OxRenderer markdown={markdown} />))?.[1].replace(/&amp;/g, "&");

describe("a plain picture", () => {
  it("asks for the display copy of a vault file, by whichever route the page serves it", () => {
    expect(srcOf("![IMG_2051](/api/vault/view/abc123)")).toBe("/api/vault/rendition/abc123?size=display");
    expect(srcOf("![IMG_2051](/api/letter/l1/view/abc123)")).toBe("/api/letter/l1/rendition/abc123?size=display");
    expect(srcOf("![x][p]\n\n[p]: /api/vault/view/abc123")).toBe("/api/vault/rendition/abc123?size=display");
  });

  it("leaves any other address alone", () => {
    expect(srcOf("![logo](https://example.com/a.png)")).toBe("https://example.com/a.png");
  });
});
