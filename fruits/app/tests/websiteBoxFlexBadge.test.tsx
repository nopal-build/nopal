/**
 * `:::box{surface=... border=... palette=...}`/`:::flex{justify=...}`/
 * `::badge{position=... height=...}` — Effort 1 of the "Box Directive +
 * Pricing Card UI Fix" garden seed (`garden/3-growing/
 * box-directive-pricing-card.md`): the generic container + row-layout +
 * badge-positioning half of that seed, independent of the shared
 * form-selection state (Effort 2).
 */
import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectSwatchRegistry, parseOxDocument, resolveSwatchRole, type SwatchRole } from "oxmarkdown-core";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { WebsiteBadge } from "../oxmarkdown/websiteBadge";

const THEME = `
::swatch{role="surface" name="mint" light="var(--cactus-100)" dark="var(--cactus-800)"}
::swatch{role="border" name="forest" light="var(--green)" dark="var(--green-light)"}
`;

function render(markdown: string) {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  return renderToStaticMarkup(<OxRenderer markdown={markdown} directives={registry} />);
}

function themeRegistry() {
  return collectSwatchRegistry(parseOxDocument(THEME));
}
function boundResolve() {
  const registry = themeRegistry();
  return (opts: { role: SwatchRole; explicit?: string; palette?: string; fallback?: string }) =>
    resolveSwatchRole({ ...opts, registry });
}

describe(":::box{...}", () => {
  it("falls back to the same neutral card look :::pricing-card already has, with neither surface nor border given", () => {
    const html = render(`:::box{}
content
:::`);
    expect(html).toContain('class="website-box"');
    expect(html).toContain("background:var(--color-surface-card)");
    expect(html).toContain("border-color:var(--color-surface-border)");
  });

  it("resolves surface=/border= through the same swatch cascade :::section already uses", () => {
    const html = render(`${THEME}
:::box{surface="mint" border="forest"}
content
:::`);
    expect(html).toContain("--ox-swatch-surface-mint: var(--cactus-100);");
    expect(html).toContain("background:var(--ox-swatch-surface-mint)");
    expect(html).toContain("border-color:var(--ox-swatch-border-forest)");
  });

  it("renders its children inside the box", () => {
    const html = render(`:::box{}
Some real content here.
:::`);
    expect(html).toContain("Some real content here.");
  });

  it("margin= sets an inline top/bottom margin, same formula :::section{margin=...} uses", () => {
    const html = render(`:::box{margin="0.5"}
content
:::`);
    expect(html).toContain("margin-top:calc(0.5 * var(--ox-grid, 41px))");
    expect(html).toContain("margin-bottom:calc(0.5 * var(--ox-grid, 41px))");
  });

  it("omitting margin= sets no margin at all -- the pre-existing default is unchanged", () => {
    const html = render(`:::box{}
content
:::`);
    expect(html).not.toContain("margin-top");
    expect(html).not.toContain("margin-bottom");
  });

  it("scale= sets an inline zoom factor, scaling the whole box's subtree (not just --ox-grid)", () => {
    const html = render(`:::box{scale="0.75"}
content
:::`);
    expect(html).toContain("zoom:0.75");
  });

  it("omitting scale= sets no zoom at all -- renders at ordinary 1:1 size", () => {
    const html = render(`:::box{}
content
:::`);
    expect(html).not.toContain("zoom");
  });

  it("a non-positive or unparseable scale= is ignored, same as an absent one", () => {
    const zero = render(`:::box{scale="0"}
content
:::`);
    const negative = render(`:::box{scale="-1"}
content
:::`);
    const garbage = render(`:::box{scale="not-a-number"}
content
:::`);
    expect(zero).not.toContain("zoom");
    expect(negative).not.toContain("zoom");
    expect(garbage).not.toContain("zoom");
  });

  it("disabled=\"true\" grays out a selectable box and drops it from the tab order", () => {
    const html = render(`:::box{form-id="plan" select-group="tier" value="self-guide" disabled="true"}
content
:::`);
    expect(html).toContain("website-box-disabled");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("tabindex");
  });

  it("omitting disabled= (or disabled=\"false\") leaves a selectable box fully interactive", () => {
    const withoutDisabled = render(`:::box{form-id="plan" select-group="tier" value="self-guide"}
content
:::`);
    expect(withoutDisabled).not.toContain("website-box-disabled");
    expect(withoutDisabled).not.toContain("aria-disabled");
    expect(withoutDisabled).toContain('tabindex="0"');

    const withFalse = render(`:::box{form-id="plan" select-group="tier" value="self-guide" disabled="false"}
content
:::`);
    expect(withFalse).not.toContain("website-box-disabled");
    expect(withFalse).toContain('tabindex="0"');
  });

  it("disabled=\"true\" on a plain, non-selectable box still grays it out, with nothing else to disable", () => {
    const html = render(`:::box{disabled="true"}
content
:::`);
    expect(html).toContain("website-box-disabled");
    expect(html).not.toContain("website-box-selectable");
  });
});

describe(":::flex{...}", () => {
  it("defaults justify-content to space-between (resolved question 2's scope)", () => {
    const html = render(`:::flex{}
### Title

A price.
:::`);
    expect(html).toContain('class="website-flex"');
    expect(html).toContain("justify-content:space-between");
  });

  it("justify= overrides the default", () => {
    const html = render(`:::flex{justify="center"}
A
:::`);
    expect(html).toContain("justify-content:center");
  });
});

describe("::badge{position=... height=...}", () => {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });
  const resolveSwatchRole = boundResolve();

  it("renders a plain, unpositioned badge exactly as before when position is omitted", () => {
    const el = registry.badge({ attrs: { text: "Coming Soon" }, label: null, resolveSwatchRole }) as ReactElement<{
      text: string;
      position?: unknown;
      height?: number;
    }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(WebsiteBadge);
    expect(el.props.text).toBe("Coming Soon");
    expect(el.props.position).toBeUndefined();
    expect(el.props.height).toBeUndefined();
  });

  it("parses position= with the EXACT SAME grammar ::icon{position=...} uses", () => {
    const el = registry.badge({
      attrs: { text: "Coming Soon", position: "R10,T-10" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ position?: unknown }>;
    expect(el.props.position).toBeDefined();
  });

  it("parses height= into a real number, passed straight through so it SETS the rendered box", () => {
    const el = registry.badge({
      attrs: { text: "Coming Soon", position: "R10,T-10", height: "20" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ height?: number }>;
    expect(el.props.height).toBe(20);
  });

  it("an unparseable height is dropped, not passed through as NaN", () => {
    const el = registry.badge({
      attrs: { text: "Coming Soon", position: "R10,T-10", height: "not-a-number" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ height?: number }>;
    expect(el.props.height).toBeUndefined();
  });

  // TWO real bugs, found during human review:
  //   1. `height` used to wrap `<Badge>` in an `inline-flex` container
  //      with a `height` style -- which only CENTERS the child within
  //      that box, never actually shrinks `Badge`'s own intrinsic size
  //      (~20px from its own padding/line-height), so the wrapper's
  //      height was a silent no-op.
  //   2. The next attempt set `lineHeight` equal to `height` on an
  //      `inline-block` element, which does NOT vertically center text
  //      (that's not what `line-height` does on a non-replaced inline
  //      element -- confirmed by a real repro: the background resized
  //      but the text stayed fixed at the top).
  // These tests render the REAL output (not just prop-passing) to pin
  // the actual fix: `height` lands on the pill's OWN rendered style (not
  // an invisible ancestor), and `display: inline-flex` + `alignItems:
  // "center"` -- not line-height arithmetic -- is what centers the text.
  it("height= sets the pill's OWN real rendered CSS height and vertically centers its text via flex", () => {
    const html = renderToStaticMarkup(<WebsiteBadge text="Coming Soon" variant="danger" height={20} />);
    expect(html).toMatch(/style="height:20px;display:inline-flex;align-items:center;padding:0 8px;box-sizing:border-box"/);
    // Exactly ONE span wraps the text -- no second, separate centering
    // wrapper around a plain <Badge> (the original bug's own shape).
    expect(html.match(/<span/g)?.length).toBe(1);
  });

  it("a plain badge with no height= is completely unaffected (still just <Badge>)", () => {
    const html = renderToStaticMarkup(<WebsiteBadge text="Coming Soon" variant="danger" />);
    expect(html).not.toContain("height");
    expect(html).not.toContain("line-height:20px");
  });
});

describe("the seed's own motivating example: a badge INSIDE a box", () => {
  it("renders end to end with no crash — box provides the position: relative ancestor the badge needs", () => {
    // Badge moved INSIDE the box (round 2's own proposed direction,
    // part 2) -- `:::box{}` is the `position: relative` ancestor the
    // badge's own `position="..."` resolves against, same relationship
    // `.website-section-inner` already has for a bare `::icon{position=...}`.
    const html = render(`:::box{}
::badge{text="Coming Soon" variant="danger" position="R10,T-10" height="20"}

### Self-Guide
**$99/mo**
:::`);
    // The badge itself is client-only (same `ResizeObserver`-gated
    // contract WavyLine/::icon already have — never fires during
    // `renderToStaticMarkup`), so it renders nothing visible here; this
    // confirms composition doesn't crash and the box's own content still
    // renders, not the badge's real positioned pixel output.
    expect(html).toContain('class="website-box"');
    expect(html).toContain("Self-Guide");
  });
});
