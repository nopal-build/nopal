/**
 * Markable units (`oxmarkdown-core/src/markUnits.ts`): what a reader can
 * put a mark on, and nothing smaller. The fixture is the shape of the
 * local Crouch Efforts page on 2026-09-18, cut down.
 */

import { describe, expect, it } from "vitest";
import { computeMarkUnitsFromMarkdown, parseOxDocument, plainText, refFileId, splitSentences } from "oxmarkdown-core";
import type { Paragraph } from "mdast";

const ref = (name: string, id: string, date: string, file: string, prefix = "/fruits") =>
  `:ref{name="${name}" human-id="${id}" datetime="${date}T12:00:00Z" location="${prefix}/vault?file=${file}"}`;

const PAGE = `# Crouch

We are at the end of the climb. Nobody is logging the exterior after the cladding: eaves, then the metal skirt.

One ask: did the eaves start?
## Regroup
We meet at the final inspection with the eaves on ${ref("Lucas J", "admin_2", "2026-09-01", "b0j")}. Once Rob and Anna are in, the inside questions open again: "Closet and storage will be decided post occupancy." ${ref("Lucas J", "admin_2", "2026-09-01", "b0j")}
## On the bench
### Gerald · Black locust cladding and eaves · M

- Now: rows going on all the way around ${ref("Gerald L", "super_1", "2026-09-09", "meo", "")}
  - "last two rows went on the west wall this afternoon. Eaves start Monday." ${ref("Gerald L", "super_1", "2026-09-09", "meo", "")}
- Next: the eaves ${ref("Gerald L", "super_1", "2026-08-26", "tw2")}

:::gallery{}
![northwest corner progress
](/api/vault/view/ntfc5km0612jeex7fjiv)
![IMG_1722.jpeg](/api/vault/view/lhlapq5bg6as6fpo3nkz)
:::

### Austin · Mini-split and ERV spec · S

- Now: "System is mostly set." ${ref("austin@nopal.build", "admin_1", "2026-09-11", "7hth")}
- Next: the client's yes or no on the wall unit
## Shelf
- Landscaping (released) ${ref("Lucas J", "admin_2", "2026-08-26", "4po")}
`;

describe("markable units", () => {
  const units = computeMarkUnitsFromMarkdown(PAGE);
  const byKind = (kind: string) => units.filter((u) => u.kind === kind);

  it("marks every bullet, nested ones on their own, and nothing smaller", () => {
    expect(byKind("bullet").map((u) => u.text)).toEqual([
      "Now: rows going on all the way around",
      '"last two rows went on the west wall this afternoon. Eaves start Monday."',
      "Next: the eaves",
      'Now: "System is mostly set."',
      "Next: the client's yes or no on the wall unit",
      "Landscaping (released)",
    ]);
  });

  it("gives a bullet only its own citations, never its children's", () => {
    const now = byKind("bullet")[0];
    expect(now.refs).toEqual([{ name: "Gerald L", humanId: "super_1", date: "2026-09-09", fileId: "meo" }]);
    expect(byKind("bullet")[4].refs).toEqual([]);
  });

  it("marks ## and ### headings but not the page title", () => {
    expect(byKind("heading").map((u) => u.text)).toEqual([
      "Regroup",
      "On the bench",
      "Gerald · Black locust cladding and eaves · M",
      "Austin · Mini-split and ERV spec · S",
      "Shelf",
    ]);
  });

  it("gathers an effort heading's citations from its whole block", () => {
    const gerald = byKind("heading")[2];
    expect(gerald.refs.map((r) => `${r.date}/${r.fileId}`)).toEqual(["2026-09-09/meo", "2026-08-26/tw2"]);
    const austin = byKind("heading")[3];
    expect(austin.refs.map((r) => r.fileId)).toEqual(["7hth"]);
  });

  it("splits paragraphs into sentences and keeps a trailing citation with its sentence", () => {
    const sentences = byKind("sentence");
    expect(sentences.map((u) => u.text)).toEqual([
      "We are at the end of the climb.",
      "Nobody is logging the exterior after the cladding: eaves, then the metal skirt.",
      "One ask: did the eaves start?",
      "We meet at the final inspection with the eaves on.",
      'Once Rob and Anna are in, the inside questions open again: "Closet and storage will be decided post occupancy."',
    ]);
    expect(sentences[3].refs.map((r) => r.fileId)).toEqual(["b0j"]);
    expect(sentences[4].refs.map((r) => r.fileId)).toEqual(["b0j"]);
    expect(sentences[4].section).toBe("Regroup");
    expect(sentences[0].section).toBe("");
  });

  it("marks each gallery photo by its file", () => {
    const photos = byKind("photo");
    expect(photos.map((p) => p.attachmentId)).toEqual(["ntfc5km0612jeex7fjiv", "lhlapq5bg6as6fpo3nkz"]);
    expect(photos[0].text).toBe("northwest corner progress");
    expect(photos[0].effort).toBe("Gerald · Black locust cladding and eaves · M");
  });

  it("places every unit under its section and effort", () => {
    const next = byKind("bullet")[4];
    expect([next.section, next.effort]).toEqual(["On the bench", "Austin · Mini-split and ERV spec · S"]);
    const shelf = byKind("bullet")[5];
    expect([shelf.section, shelf.effort]).toEqual(["Shelf", ""]);
  });

  it("gives every unit a distinct key, and the same keys on a second parse", () => {
    const keys = units.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(computeMarkUnitsFromMarkdown(PAGE).map((u) => u.key)).toEqual(keys);
  });

  it("tells repeated text apart by occurrence", () => {
    const twice = computeMarkUnitsFromMarkdown("## A\n- same\n- same\n");
    expect(twice.filter((u) => u.kind === "bullet").map((u) => u.key.split(":")[2])).toEqual(["0", "1"]);
  });

  it("skips a paragraph the caller says is not a thought", () => {
    const withBanner = `**This README is incomplete.** The last build left work undone.\n\n${PAGE}`;
    const skipped = computeMarkUnitsFromMarkdown(withBanner, {
      skipParagraph: (t) => t.startsWith("This README is incomplete."),
    });
    expect(skipped.map((u) => u.key)).toEqual(units.map((u) => u.key));
  });
});

describe("sentences", () => {
  const split = (md: string) => {
    const para = parseOxDocument(md).children[0] as Paragraph;
    return splitSentences(para.children).map((s) => plainText(s));
  };

  it("never cuts inside bold or a highlight", () => {
    expect(split("First. **Bold. Still bold.** Then ==a quote. Kept whole== here. Last.")).toEqual([
      "First.",
      "Bold. Still bold. Then a quote. Kept whole here.",
      "Last.",
    ]);
  });

  it("leaves a paragraph with no ending punctuation whole", () => {
    expect(split("Sizes: XS an hour · S a day or two")).toEqual(["Sizes: XS an hour · S a day or two"]);
  });
});

describe("refFileId", () => {
  it("reads the file id from either location form", () => {
    expect(refFileId("/vault?file=abc")).toBe("abc");
    expect(refFileId("/fruits/vault?file=abc")).toBe("abc");
    expect(refFileId("/vault")).toBeNull();
  });
});
