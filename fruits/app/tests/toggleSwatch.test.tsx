/**
 * `:::toggle{border="..." palette="..."}` — promoting the shared
 * `::swatch`/`::palette` cascade (`resolveSwatchRole`, already wired into
 * `OxRenderer.tsx` for `::box`/`:::section`) to the built-in Toggle List
 * directive too, per the "FAQ toggle design" garden seed. Static/
 * Interacting-mode only — `OxToggleNode` (Editing mode) deliberately does
 * not model these attributes at all, see that seed.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";

const THEME = `
::swatch{role="border" name="mint" light="var(--cactus-500)" dark="var(--cactus-300)"}
::palette{name="crisp" border="mint"}
`;

describe(":::toggle onto border=/palette=", () => {
  it("falls back to the ordinary accent token when no attribute is given", () => {
    const html = renderToStaticMarkup(
      <OxRenderer
        markdown={`
:::toggle
Q: Plain toggle?
A: Yes.
:::
`}
      />,
    );
    expect(html).toContain("--ox-toggle-accent:var(--ox-color-accent)");
  });

  it("resolves an explicit border= to the matching swatch variable", () => {
    const html = renderToStaticMarkup(
      <OxRenderer
        markdown={`${THEME}
:::toggle{border="mint"}
Q: Colored toggle?
A: Yes.
:::
`}
      />,
    );
    expect(html).toContain("--ox-swatch-border-mint: var(--cactus-500);");
    expect(html).toContain("--ox-toggle-accent:var(--ox-swatch-border-mint)");
  });

  it("resolves a palette= reference to the same swatch variable", () => {
    const html = renderToStaticMarkup(
      <OxRenderer
        markdown={`${THEME}
:::toggle{palette="crisp"}
Q: Palette toggle?
A: Yes.
:::
`}
      />,
    );
    expect(html).toContain("--ox-toggle-accent:var(--ox-swatch-border-mint)");
  });

  it("an unresolved border= name falls through to the ordinary accent token, not an error", () => {
    const html = renderToStaticMarkup(
      <OxRenderer
        markdown={`
:::toggle{border="does-not-exist"}
Q: Unresolved toggle?
A: Yes.
:::
`}
      />,
    );
    expect(html).toContain("--ox-toggle-accent:var(--ox-color-accent)");
  });
});
