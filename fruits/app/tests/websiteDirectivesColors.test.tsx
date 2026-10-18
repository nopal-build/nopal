/**
 * `:::section{surface=...}`/`:::section-title{color=... h-color=...}`/
 * `::line`/`::path`/`:line-word`/`::trail`'s `color=` attribute — Effort 4
 * of the "Oxmarkdown Colors" garden seed (`garden/growing/
 * oxmarkdown-colors.md`): the real, shipped website directives migrated
 * off `bg=`/`data-website-color=`/the hardcoded `red`/`green`/`purple`
 * enum, onto the shared `::swatch`/`::palette` cascade. A hard cutover
 * (round 11), confirmed here: the OLD attribute names/values no longer
 * mean anything on their own.
 */
import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectSwatchRegistry, parseOxDocument, resolveSwatchRole, type SwatchRole } from "oxmarkdown-core";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";

const THEME = `
::swatch{role="surface" name="mint" light="var(--cactus-100)" dark="var(--cactus-800)"}
::swatch{role="color" name="red" light="var(--red)" dark="var(--red-light)"}
::swatch{role="color" name="green" light="var(--green)" dark="var(--green-light)"}
::palette{name="crisp" surface="mint" color="green"}
`;

function render(markdown: string) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return renderToStaticMarkup(<OxRenderer markdown={markdown} directives={registry} />);
}

/** `WavyLine` (`::line`/`::path`/`:line-word`/`::trail`'s shared
 * primitive) only renders its actual `<svg>`/`stroke` once a REAL
 * client-measured size exists (`ResizeObserver`, never fires during
 * `renderToStaticMarkup`) -- a pre-existing characteristic of that
 * component, not something this migration changed. So these directives'
 * own `color=` resolution is checked by calling the registry handler
 * directly and inspecting the `<WavyLine color={...} />` element it
 * returns, rather than hunting for `stroke="..."` in rendered HTML. */
function themeRegistry() {
  return collectSwatchRegistry(parseOxDocument(THEME));
}
function boundResolve() {
  const registry = themeRegistry();
  return (opts: { role: SwatchRole; explicit?: string; palette?: string; fallback?: string }) =>
    resolveSwatchRole({ ...opts, registry });
}

describe(":::section onto surface=/palette=", () => {
  it("resolves surface= to the matching swatch variable", () => {
    const html = render(`${THEME}
:::section{surface="mint"}
content
:::`);
    expect(html).toContain("--ox-swatch-surface-mint: var(--cactus-100);");
    expect(html).toContain("background:var(--ox-swatch-surface-mint)");
  });

  it("resolves palette= to the palette's own surface value", () => {
    const html = render(`${THEME}
:::section{palette="crisp"}
content
:::`);
    expect(html).toContain("background:var(--ox-swatch-surface-mint)");
  });

  it("sets no background at all with neither given — matches today's real default", () => {
    const html = render(`${THEME}
:::section{}
content
:::`);
    expect(html).not.toContain("background:");
  });

  it("the OLD bg= attribute is retired — no longer has any effect (hard cutover)", () => {
    const html = render(`${THEME}
:::section{bg="mint"}
content
:::`);
    expect(html).not.toContain("background:");
    expect(html).not.toContain("website-bg-mint");
  });
});

describe(":::section-title onto color=/h-color=/palette=", () => {
  it("color= sets a base color that reaches the heading via the private override variable", () => {
    const html = render(`${THEME}
:::section-title{color="red"}
## Heading
:::`);
    expect(html).toMatch(/style="color:var\(--ox-swatch-color-red\);--website-section-title-h-color:var\(--ox-swatch-color-red\)"/);
  });

  it("h-color= overrides JUST the heading, independent of the base color=", () => {
    const html = render(`${THEME}
:::section-title{color="red" h-color="green"}
## Heading
:::`);
    expect(html).toMatch(/style="color:var\(--ox-swatch-color-red\);--website-section-title-h-color:var\(--ox-swatch-color-green\)"/);
  });

  it("palette= can feed the base color=, same cascade as :::section", () => {
    const html = render(`${THEME}
:::section-title{palette="crisp"}
## Heading
:::`);
    expect(html).toContain("color:var(--ox-swatch-color-green)");
  });

  it("the OLD data-website-color attribute is retired — no longer rendered at all", () => {
    const html = render(`${THEME}
:::section-title{color="red"}
## Heading
:::`);
    expect(html).not.toContain("data-website-color");
  });
});

describe("::line/::path/:line-word/::trail onto color=/palette=, sharing the SAME registry section-title reads", () => {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  const resolveSwatchRole = boundResolve();

  it("::line passes the resolved swatch variable straight through as WavyLine's color prop", () => {
    const el = registry.line({ attrs: { points: "0,0 10,10", color: "green" }, label: null, resolveSwatchRole }) as ReactElement<{ color?: string }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.props.color).toBe("var(--ox-swatch-color-green)");
  });

  it("a heading and a line sharing the SAME swatch name stay in sync by construction", () => {
    const html = render(`${THEME}
:::section-title{color="green"}
## Heading
:::`);
    // The heading reads --ox-swatch-color-green via its private override
    // property; ::line below resolves the SAME variable name for the
    // SAME swatch -- literally one real registration, not two
    // independently-hardcoded tokens that merely happen to agree.
    expect(html).toContain("color:var(--ox-swatch-color-green)");
    const el = registry.line({ attrs: { points: "0,0 10,10", color: "green" }, label: null, resolveSwatchRole }) as ReactElement<{ color?: string }>;
    expect(el.props.color).toBe("var(--ox-swatch-color-green)");
  });

  it("an unresolved color name resolves to undefined, falling through to WavyLine's own currentColor default", () => {
    const el = registry.line({ attrs: { points: "0,0 10,10", color: "not-a-real-swatch" }, label: null, resolveSwatchRole }) as ReactElement<{ color?: string }>;
    expect(el.props.color).toBeUndefined();
  });

  it("::path/:line-word/::trail all resolve color= the same way", () => {
    const pathEl = registry.path({ attrs: { points: "0,0 10,-15", color: "red" }, label: null, resolveSwatchRole }) as ReactElement<{ color?: string }>;
    expect(pathEl.props.color).toBe("var(--ox-swatch-color-red)");

    const lineWordEl = registry["line-word"]({ attrs: { text: "jacket", points: "0,0 10,10", color: "red" }, label: null, resolveSwatchRole }) as ReactElement;
    // `:line-word` wraps WavyLine in its own <span> -- the color lands on
    // the nested element, not the outer wrapper.
    const nestedWavyLine = (lineWordEl.props as { children: ReactElement[] }).children[1] as ReactElement<{ color?: string }>;
    expect(nestedWavyLine.props.color).toBe("var(--ox-swatch-color-red)");

    const trailEl = registry.trail({ attrs: { waypoints: "p1,p2", color: "red" }, label: null, resolveSwatchRole }) as ReactElement<{ color?: string }>;
    expect(trailEl.props.color).toBe("var(--ox-swatch-color-red)");
  });
});
