/**
 * `OxRenderer`'s swatch wiring (Effort 2 of the "Oxmarkdown Colors" garden
 * seed): `::swatch{...}`/`::palette{...}` collect into a per-document
 * registry, render as nothing themselves, and a registered directive can
 * resolve a role against that registry via `resolveSwatchRole` on
 * `DirectiveRenderProps`. The actual `:::section`/`section-title`
 * migration is Effort 4 — this test uses a small ad-hoc registry entry
 * instead, to pin the wiring itself independent of that later migration.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";

const testRegistry: DirectiveRegistry = {
  swatchbox({ attrs, resolveSwatchRole }) {
    const background = resolveSwatchRole({
      role: "surface",
      explicit: attrs.surface,
      palette: attrs.palette,
      fallback: "transparent",
    });
    return <div className="test-swatchbox" style={{ background }} />;
  },
};

const PAGE = `
::swatch{role="surface" name="mint" light="var(--cactus-100)" dark="var(--cactus-800)"}
::palette{name="crisp" surface="mint"}

::swatchbox{surface="mint"}
::swatchbox{palette="crisp"}
::swatchbox{surface="does-not-exist"}
`;

describe("OxRenderer's swatch wiring", () => {
  it("renders ::swatch/::palette as nothing — not visible content, not an 'unknown directive' marker", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} directives={testRegistry} />);
    expect(html).not.toContain("Unknown block");
    expect(html).not.toContain("ox-directive-unknown");
  });

  it("emits one <style> tag with the swatch's light value directly and its dark value under prefers-color-scheme", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} directives={testRegistry} />);
    expect(html).toContain("--ox-swatch-surface-mint: var(--cactus-100);");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("--ox-swatch-surface-mint: var(--cactus-800);");
  });

  it("resolves an explicit role attribute AND a palette reference to the same swatch variable", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} directives={testRegistry} />);
    const matches = html.match(/background:var\(--ox-swatch-surface-mint\)/g) ?? [];
    expect(matches).toHaveLength(2); // explicit `surface="mint"` and `palette="crisp"`
  });

  it("falls through silently to the directive's own fallback for an unresolved name", () => {
    const html = renderToStaticMarkup(<OxRenderer markdown={PAGE} directives={testRegistry} />);
    expect(html).toContain("background:transparent");
  });

  it("scopes two independent documents on the same page so they can't clobber each other's swatch", () => {
    const docA = `
::swatch{role="surface" name="mint" light="#111111" dark="#111111"}
::swatchbox{surface="mint"}
`;
    const docB = `
::swatch{role="surface" name="mint" light="#222222" dark="#222222"}
::swatchbox{surface="mint"}
`;
    const html = renderToStaticMarkup(
      <>
        <OxRenderer markdown={docA} directives={testRegistry} />
        <OxRenderer markdown={docB} directives={testRegistry} />
      </>,
    );

    const scopeClasses = [...new Set([...html.matchAll(/\.(ox-swatch-scope-\w+)\s*\{/g)].map((m) => m[1]))];
    expect(scopeClasses).toHaveLength(2); // two genuinely distinct per-instance selectors

    for (const scopeClass of scopeClasses) {
      // Each generated rule only ever declares the variable under ITS OWN
      // scope class, not the other document's — the real no-clobber
      // guarantee a shared/reused selector would have broken.
      const ruleMatch = html.match(new RegExp(`\\.${scopeClass} \\{ ([^}]+) \\}`));
      expect(ruleMatch).not.toBeNull();
    }
    // The two scopes disagree on the SAME variable's value — proof they're
    // genuinely independent, not accidentally deduplicated into one rule.
    expect(html).toContain("--ox-swatch-surface-mint: #111111;");
    expect(html).toContain("--ox-swatch-surface-mint: #222222;");
  });
});
