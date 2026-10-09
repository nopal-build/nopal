/**
 * KNOWN, PERMANENTLY ACCEPTED LIMITATION, confirmed by this test (the
 * "Oxmarkdown Colors" garden seed, rounds 15-16): a `::swatch`/
 * `::palette` defined in a file pulled in via `::include-ox{file="..."}`
 * does NOT resolve for the INCLUDING (parent) page's own consuming
 * directives. `includeOxHandler` (`websiteDirectives.tsx`) mounts the
 * included file as a genuinely separate, freshly-parsed `<OxRenderer>`
 * instance — its own `collectSwatchRegistry` call only ever sees that
 * nested document's own top-level children, building a registry the
 * PARENT's `OxTreeRenderer` never reaches. This means a "shared
 * `_theme.md` included near the top of every page" doesn't work for
 * colors the way it does for a footer — round 16 confirmed this is NOT
 * worth fixing (the core/website-boundary engineering it would need);
 * a real page defines its own `::swatch`/`::palette` INLINE at its own
 * top level instead (proven to work; see `websiteDirectivesColors.test.tsx`).
 * Pinned here as a permanent regression test, not an open question — if
 * this assertion ever starts failing, someone changed the underlying
 * behavior; update this test and the garden seed deliberately, don't
 * just delete it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";

describe("::swatch defined in an ::include-ox'd file (known limitation)", () => {
  it("does not resolve for the including page's own consuming directives", () => {
    const registry = buildWebsiteDirectiveRegistry({
      dailyLogEntries: {},
      includes: { "./_theme.md": '::swatch{role="color" name="green" light="var(--green)" dark="var(--green-light)"}\n' },
    });
    const html = renderToStaticMarkup(
      <OxRenderer
        markdown={`::include-ox{file="./_theme.md"}\n\n:::section-title{color="green"}\n## Heading\n:::`}
        directives={registry}
      />,
    );
    // The swatch DOES get generated -- just scoped to the included file's
    // own nested, independent OxRenderer instance, not reachable by the
    // parent's own section-title. If this assertion ever starts failing,
    // it means the gap got fixed -- update this test (and the garden
    // seed's round 15 entry) to confirm the NEW, working behavior instead
    // of deleting it.
    expect(html).not.toContain("style=\"color:var(--ox-swatch-color-green)");
  });
});
