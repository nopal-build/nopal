/**
 * Heading spacing: every reading surface defers to the file's OWN blank
 * lines, full stop, with no forced minimum before a heading (REVERSED
 * 2026-10-25 -- the original 2026-10-20 rule forced at least one line
 * above any heading even when the file ran straight into it; retired
 * outright after a real report that an eyebrow heading directly above a
 * title heading, with no blank line typed between them, was still getting
 * a forced spacer). "If there's no newline in the markdown, there's no
 * newline in the render." Saving still never adds a line nobody typed.
 * See `countBlankLines` (oxmarkdown-core) -- `blankLineUnits`, the
 * heading-forcing variant, no longer exists.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createEditor, $getRoot } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  countBlankLines,
  normalizeHeadingSpacing,
  parseOxDocument,
  serializeOxDocument,
  sourceBlankLineJoin,
} from "oxmarkdown-core";
import { joinReadmeSections, splitReadmeSections } from "robustness-core/data/project.types";
import OxRenderer from "../components/OxRenderer";
import { exportOxDocument, importOxDocument } from "../oxmarkdown/editingTransforms";

const SPACER = '<div class="ox-blank-line-spacer" aria-hidden="true"></div>';

/** The spacers between consecutive blocks, as a readable shape:
 * "p | h2 | p" means no spacer anywhere, "p _ h2 | p" one before the h2. */
function shape(markdown: string): string {
  const html = renderToStaticMarkup(<OxRenderer markdown={markdown} />);
  const inner = html.replace(/^.*?<div class="ox-dot-grid">/s, "");
  const tokens = inner.match(/<div class="ox-blank-line-spacer"[^>]*><\/div>|<(h[1-6]|p|ul)[ >]/g) ?? [];
  return tokens.map((t) => (t === SPACER ? "_" : t.replace(/[<> ]/g, ""))).join(" ");
}

describe("countBlankLines around headings -- no special-casing of any kind", () => {
  const blocks = (md: string) => parseOxDocument(md).children;

  it("a heading straight after text gets NO forced line -- literal zero, since none was typed", () => {
    const [p, h] = blocks("text\n## H");
    expect(countBlankLines(p, h)).toBe(0);
  });

  it("a line someone DID type above a heading is kept", () => {
    const [p, h] = blocks("text\n\n## H");
    expect(countBlankLines(p, h)).toBe(1);
  });

  it("two typed lines above a heading stay two", () => {
    const [p, h] = blocks("text\n\n\n## H");
    expect(countBlankLines(p, h)).toBe(2);
  });

  it("under a heading stays literal", () => {
    const [h, p] = blocks("## H\nbody");
    expect(countBlankLines(h, p)).toBe(0);
  });

  it("paragraph to paragraph is unchanged", () => {
    const [a, b] = blocks("a\n\nb");
    expect(countBlankLines(a, b)).toBe(1);
  });

  it("an eyebrow heading directly above a title heading gets NO forced line either", () => {
    const [h3, h1] = blocks("### Good Building\n# The Terrain");
    expect(countBlankLines(h3, h1)).toBe(0);
  });

  it("a line someone DID type between two headings is still kept", () => {
    const [h3, h1] = blocks("### Good Building\n\n# The Terrain");
    expect(countBlankLines(h3, h1)).toBe(1);
  });
});

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

  it("holds inside a list item too", () => {
    expect(shape("- item\n\n  text\n\n  ## H")).toContain("p _ h2");
  });

  it("an eyebrow heading directly above a title heading renders with no spacer between them", () => {
    expect(shape("### Good Building\n# The Terrain\nbody")).toBe("h3 h1 p");
  });
});

describe("saving keeps the file's own lines", () => {
  it("a checkbox click changes only the checkbox", () => {
    const source = "a\n\n\n- [ ] x\n## H\nbody\n";
    const doc = parseOxDocument(source);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = doc.children.find((n) => n.type === "list") as any;
    list.children[0].checked = true;
    expect(serializeOxDocument(doc, sourceBlankLineJoin)).toBe("a\n\n\n- [x] x\n## H\nbody\n");
  });

  function roundTrip(markdown: string): string {
    const editor = createEditor({ nodes: [HeadingNode, QuoteNode], onError: (e) => { throw e; } });
    let out = "";
    editor.update(
      () => {
        const { lexicalNodes, aside } = importOxDocument(parseOxDocument(markdown));
        $getRoot().clear().append(...lexicalNodes);
        const { doc, join } = exportOxDocument($getRoot(), aside);
        out = serializeOxDocument(doc, join);
      },
      { discrete: true },
    );
    return out;
  }

  it("the editor saves a heading with its body directly under it as written", () => {
    expect(roundTrip("## H\nbody\n")).toBe("## H\nbody\n");
  });

  it("the editor keeps a line someone typed under a heading", () => {
    expect(roundTrip("## H\n\nbody\n")).toBe("## H\n\nbody\n");
  });

  it("two paragraphs keep their one blank line", () => {
    expect(roundTrip("a\n\nb\n")).toBe("a\n\nb\n");
  });
});

describe("the Efforts writer", () => {
  it("drops a model's blank lines under headings and at the ends", () => {
    expect(normalizeHeadingSpacing("\n\nRegroup text\n")).toBe("Regroup text");
    expect(normalizeHeadingSpacing("lead\n### Austin · Deck · S\n\n- Now: x")).toBe("lead\n\n### Austin · Deck · S\n- Now: x");
    expect(normalizeHeadingSpacing("# Project\n\n\nOpening.")).toBe("# Project\nOpening.");
  });

  it("leaves a # inside fenced code alone", () => {
    const fenced = "```\n# not a heading\n\nstill code\n```";
    expect(normalizeHeadingSpacing(fenced)).toBe(fenced);
  });

  it("joins sections with one line above every ## and none below", () => {
    const body = joinReadmeSections([
      { heading: "", content: normalizeHeadingSpacing("# THH\n\nWhere we stand.") },
      { heading: "Regroup", content: normalizeHeadingSpacing("\n\nRegroup text\n") },
      { heading: "On the bench", content: normalizeHeadingSpacing("\n### Austin · Deck · S\n\n- Now: x\n") },
    ]);
    expect(body).toBe("# THH\nWhere we stand.\n\n## Regroup\nRegroup text\n\n## On the bench\n### Austin · Deck · S\n- Now: x");
  });

  it("a section that already ends on a blank line is not given a second", () => {
    const body = joinReadmeSections([
      { heading: "", content: "intro\n" },
      { heading: "A", content: "a" },
    ]);
    expect(body).toBe("intro\n\n## A\na");
    expect(splitReadmeSections(body).map((s) => s.heading)).toEqual(["", "A"]);
  });
});
