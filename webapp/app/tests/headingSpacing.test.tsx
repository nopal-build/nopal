/**
 * PORTED from fruits/app/tests/headingSpacing.test.tsx — the renderer half
 * only, against this copy of `OxRenderer`: one line above a heading, none
 * under it unless somebody typed one (`blankLineUnits`, oxmarkdown-core).
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
  it("text running into a heading: one line above, none below", () => {
    expect(shape("intro\n## H\nbody")).toBe("p _ h2 p");
  });

  it("a line someone typed under a heading still shows", () => {
    expect(shape("## H\n\nbody")).toBe("h2 _ p");
  });

  it("a heading that opens the page gets nothing above it", () => {
    expect(shape("# Title\nopening")).toBe("h1 p");
  });
});
