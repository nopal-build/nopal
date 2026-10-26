/**
 * `::svg{src="..." width="N" alt="..." id="..."}` — renders an arbitrary,
 * already-designed SVG FILE verbatim, with no registry entry needed first
 * (unlike `::icon{name="..."}`, see `websiteDirectives.tsx`'s own doc
 * comment for the full reasoning). Added for genuinely one-off,
 * page-specific illustrations (first use: `guides.md`'s camps-trail
 * diagram).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";

function render(markdown: string) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return renderToStaticMarkup(<OxRenderer markdown={markdown} directives={registry} />);
}

describe("::svg{...}", () => {
  it("renders a plain <img> pointed at src=, with the shared website-svg class", () => {
    const html = render(`::svg{src="/guides/guides-camps-trail.svg"}`);
    expect(html).toContain('src="/guides/guides-camps-trail.svg"');
    expect(html).toContain('class="website-svg"');
  });

  it("missing src= renders nothing, same convention ::badge{text=...} uses for a missing required attribute", () => {
    const html = render(`::svg{alt="no src given"}`);
    expect(html).not.toContain("website-svg");
    expect(html).not.toContain("<img");
  });

  it("alt= is passed straight through; omitted alt= defaults to empty (decorative)", () => {
    const withAlt = render(`::svg{src="/guides/guides-camps-trail.svg" alt="A winding trail connecting four camps"}`);
    expect(withAlt).toContain('alt="A winding trail connecting four camps"');

    const withoutAlt = render(`::svg{src="/guides/guides-camps-trail.svg"}`);
    expect(withoutAlt).toContain('alt=""');
  });

  it("width= sets a literal pixel width with auto height; omitted width= sets no inline size at all", () => {
    const withWidth = render(`::svg{src="/guides/guides-camps-trail.svg" width="300"}`);
    expect(withWidth).toContain("width:300px");
    expect(withWidth).toContain("height:auto");

    const withoutWidth = render(`::svg{src="/guides/guides-camps-trail.svg"}`);
    expect(withoutWidth).not.toContain("style=");
  });

  it("an unparseable width= is ignored, same as an absent one", () => {
    const html = render(`::svg{src="/guides/guides-camps-trail.svg" width="not-a-number"}`);
    expect(html).not.toContain("style=");
  });

  it("id= doubles as a waypoint, same convention ::icon{id=...}/::stamp{id=...} use", () => {
    const html = render(`::svg{src="/guides/guides-camps-trail.svg" id="trail"}`);
    expect(html).toContain('data-waypoint-id="trail"');
  });

  it("float=left/right adds the matching class; omitted float= (or inline) adds no float class at all", () => {
    const left = render(`::svg{src="/guides/guides-camps-trail.svg" float="left"}`);
    expect(left).toContain('class="website-svg website-svg-float-left"');

    const right = render(`::svg{src="/guides/guides-camps-trail.svg" float="right"}`);
    expect(right).toContain('class="website-svg website-svg-float-right"');

    const inline = render(`::svg{src="/guides/guides-camps-trail.svg" float="inline"}`);
    expect(inline).toContain('class="website-svg"');
    expect(inline).not.toContain("website-svg-float");

    const omitted = render(`::svg{src="/guides/guides-camps-trail.svg"}`);
    expect(omitted).toContain('class="website-svg"');
    expect(omitted).not.toContain("website-svg-float");
  });

  it("an unrecognized float= value falls back to inline, same as an absent one", () => {
    const html = render(`::svg{src="/guides/guides-camps-trail.svg" float="center"}`);
    expect(html).toContain('class="website-svg"');
    expect(html).not.toContain("website-svg-float");
  });
});
