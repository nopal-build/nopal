/**
 * PORTED from fruits/app/tests/headingSpacing.test.tsx — the renderer half
 * only, against this copy of `OxRenderer`. Every reading surface defers to
 * the file's OWN blank lines, full stop, with no forced minimum before a
 * heading (REVERSED 2026-10-25 — see fruits' own copy of this file, or
 * `oxmarkdown-core`'s `document.ts`, for the full history). "If there's no
 * newline in the markdown, there's no newline in the render."
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";

const SPACER = '<div class="ox-blank-line-spacer" aria-hidden="true"></div>';

function shape(markdown: string): string {
  const html = renderToStaticMarkup(<OxRenderer markdown={markdown} />);
  const inner = html.replace(/^.*?<div class="ox-dot-grid">/s, "");
  const tokens = inner.match(/<div class="ox-blank-line-spacer"[^>]*><\/div>|<(h[1-6]|p|ul)[ >]/g) ?? [];
  return tokens.map((t) => (t === SPACER ? "_" : t.replace(/[<> ]/g, ""))).join(" ");
}

describe("OxRenderer around headings", () => {
  it("text running straight into a heading: no spacer, since none was typed", () => {
    expect(shape("intro\n## H\nbody")).toBe("p h2 p");
  });

  it("a line someone typed above a heading still shows", () => {
    expect(shape("intro\n\n## H\nbody")).toBe("p _ h2 p");
  });

  it("a line someone typed under a heading still shows", () => {
    expect(shape("## H\n\nbody")).toBe("h2 _ p");
  });

  it("a heading that opens the page gets nothing above it", () => {
    expect(shape("# Title\nopening")).toBe("h1 p");
  });

  it("an eyebrow heading directly above a title heading renders with no spacer between them", () => {
    expect(shape("### Good Building\n# The Terrain\nbody")).toBe("h3 h1 p");
  });
});
