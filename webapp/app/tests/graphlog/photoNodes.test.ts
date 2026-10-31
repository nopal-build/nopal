/**
 * A photo is a node of its own, linked to the words it belongs to, and it
 * never re-reads its day (2026-10-30). The work for a photo is done once:
 * its link is decided by code when its Card paragraph says, by one small
 * model call otherwise, and kept against the photo's hash and the linked
 * node's words.
 */
import { describe, expect, it } from "vitest";
import {
  PHOTO_NODES_MARKER,
  planPhotoNodes,
  photoNodeIdsOf,
  readPhotoLinks,
  splitPhotoSection,
  withPhotoNodes,
  type ChooseNode,
  type DayMedia,
} from "robustness-core/data/photoNodes.server";
import { placeLinkedPhotoNodes } from "robustness-core/data/graphStructure.server";
import { parseGraphLogNodes } from "robustness-core/data/graphNodeIndex.server";
import { withSourceHash } from "robustness-core/data/syncGraph.server";

const DATE = "2026-10-29";
const PROVENANCE = "*Written from an AI description of this file. Not a quotation, and not anyone's words.*";
const ref = (who: string) => `:ref{name="${who}" datetime="${DATE}T12:00:00Z" location="/vault?file=x" verbose="true"}`;

const textBody = [
  "### Node 1",
  "==Poured the footing for the north wall this morning, forms came off clean.==",
  ref("Lucas J"),
  "",
  "### Node 2",
  "==The HVAC condenser pad is cracked along the east edge and needs replacing.==",
  ref("Lucas J"),
].join("\n");

const photo = (over: Partial<DayMedia> = {}): DayMedia => ({
  fileId: "img1",
  name: "IMG_1.HEIC",
  hash: "h1",
  caption: null,
  description: "A cracked concrete pad under an outdoor condenser unit.",
  context: null,
  citation: ref("Lucas J"),
  mediaLine: "![IMG_1.HEIC](/api/vault/view/img1)",
  ...over,
});

function counting(answer: number | null): { choose: ChooseNode; calls: () => number } {
  let calls = 0;
  return {
    choose: async (_m, nodes) => {
      calls++;
      return answer === null ? null : nodes.find((n) => n.number === answer) ?? null;
    },
    calls: () => calls,
  };
}

describe("photo nodes", () => {
  it("a photo under a Card paragraph links to the node quoting it, with no model call", async () => {
    const model = counting(1);
    const plan = await planPhotoNodes({
      date: DATE,
      textBody,
      media: [photo({ context: "The HVAC condenser pad is cracked along the east edge and needs replacing." })],
      links: {},
      descriptionOnlyProvenance: PROVENANCE,
      chooseByModel: model.choose,
    });
    expect(model.calls()).toBe(0);
    expect(plan.linkedByCode).toBe(1);
    expect(plan.section).toContain("### Node 3");
    expect(plan.section).toContain(`- [${DATE} Node 2](./graph-log-${DATE}.md#node-2)`);
    expect(plan.links.img1.by).toBe("code");
  });

  it("without a paragraph the model is asked once; its answer, none included, is not asked again", async () => {
    const first = counting(null);
    const plan = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: first.choose });
    expect(first.calls()).toBe(1);
    expect(plan.links.img1).toEqual({ hash: "h1", quote: null, by: "model" });

    const again = counting(2);
    const second = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: plan.links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: again.choose });
    expect(again.calls()).toBe(0);
    expect(second.section).toBe(plan.section);

    const changed = counting(2);
    await planPhotoNodes({ date: DATE, textBody, media: [photo({ hash: "h2" })], links: plan.links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: changed.choose });
    expect(changed.calls()).toBe(1);
  });

  it("a failed call is linked to nothing and not stored, so it is asked next run", async () => {
    const plan = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: async () => undefined });
    expect(plan.links.img1).toBeUndefined();
    expect(plan.section).toContain("### Node 3");
  });

  it("after the day's words re-extract and renumber, the link follows the words, not the number", async () => {
    const first = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: counting(2).choose });
    const renumbered = [
      "### Node 1",
      "==Framing inspection passed.==",
      ref("Lucas J"),
      "",
      "### Node 2",
      "==Poured the footing for the north wall this morning, forms came off clean.==",
      ref("Lucas J"),
      "",
      "### Node 3",
      "==The HVAC condenser pad is cracked along the east edge and needs replacing.==",
      ref("Lucas J"),
    ].join("\n");
    const model = counting(1);
    const after = await planPhotoNodes({ date: DATE, textBody: renumbered, media: [photo()], links: first.links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: model.choose });
    expect(model.calls()).toBe(0);
    expect(after.section).toContain("### Node 4");
    expect(after.section).toContain(`- [${DATE} Node 3](./graph-log-${DATE}.md#node-3)`);
  });

  it("a caption carries the photo as a person's words; a description is marked as not anyone's", async () => {
    const plan = await planPhotoNodes({
      date: DATE,
      textBody,
      media: [photo({ fileId: "a", name: "A.jpg", caption: "Cracked pad, east side" }), photo({ fileId: "b", name: "B.jpg" })],
      links: {},
      descriptionOnlyProvenance: PROVENANCE,
      chooseByModel: counting(null).choose,
    });
    const nodes = parseGraphLogNodes(DATE, plan.section);
    expect(nodes.map((n) => n.number)).toEqual([3, 4]);
    expect(nodes[0].quote).toContain("==Cracked pad, east side==");
    expect(nodes[1].quote).not.toContain("==");
    expect(nodes[1].quote).toContain(PROVENANCE);
  });

  it("a photo a text node already carries gets no node of its own", async () => {
    const carried = `${textBody}\n\n### Node 3\n==Pad photo==\n\n![x](/api/vault/view/img1)\n${ref("Lucas J")}`;
    const plan = await planPhotoNodes({ date: DATE, textBody: carried, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: counting(1).choose });
    expect(plan.section).toBe("");
  });
});

describe("the day file", () => {
  const dayFile = `---\ndate: ${DATE}\nsourceHash: abc\n---\n\n${textBody}\n`;

  it("photo nodes go after the marker, links in the front matter, the words and their hash untouched", async () => {
    const plan = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: counting(2).choose });
    const next = withPhotoNodes({ date: DATE, existingContent: dayFile, section: plan.section, links: plan.links })!;
    expect(next).toContain("sourceHash: abc");
    expect(next).toContain(PHOTO_NODES_MARKER);
    expect(splitPhotoSection(next.split("---\n\n")[1]).text).toBe(textBody);
    expect(readPhotoLinks(next).img1.quote).toContain("hvac condenser pad");
    expect([...photoNodeIdsOf(DATE, next.split("---\n\n")[1])]).toEqual([`${DATE}#3`]);
    // Nothing changed: no rewrite.
    expect(withPhotoNodes({ date: DATE, existingContent: next, section: plan.section, links: plan.links })).toBeNull();
  });

  it("the legacy rebase moves the stored hash and keeps everything else", () => {
    const rebased = withSourceHash(dayFile, "new");
    expect(rebased).toContain("sourceHash: new");
    expect(rebased).toContain(textBody);
  });
});

describe("graph-structure", () => {
  it("a photo node linked to a note joins that note's thread with no model; an unlinked one is left", () => {
    const sections = [
      { heading: "", content: "intro" },
      { heading: "Site work", content: `Weight: 2 inbound links\n- ${DATE} Node 2 (Lucas J) — condenser pad cracked` },
    ];
    const linked = parseGraphLogNodes(DATE, `### Node 3\nA cracked pad.\n${ref("Lucas J")}\n- [${DATE} Node 2](./graph-log-${DATE}.md#node-2)`)[0];
    const loose = parseGraphLogNodes(DATE, `### Node 4\nA truck.\n${ref("Lucas J")}`)[0];
    const { sections: out, placed } = placeLinkedPhotoNodes(sections, [linked, loose]);
    expect([...placed]).toEqual([`${DATE}#3`]);
    expect(out[1].content.split("\n")[2]).toMatch(new RegExp(`^- ${DATE} Node 3 \\(Lucas J\\) — photo: A cracked pad\\.`));
  });
});

describe("which paragraph says what a photo shows", () => {
  it("a few photos under a sentence keep it; a dump of photos after the last sentence does not", async () => {
    const { photoContexts } = await import("robustness-core/data/photoNodes.server");
    const dump = Array.from({ length: 35 }, (_, i) => ({ name: `IMG_${i}.jpeg`, context: "Need to adjust footprint of additions for tree." }));
    const few = [{ name: "pad.jpeg", context: "The condenser pad is cracked." }, { name: "pad2.jpeg", context: "The condenser pad is cracked." }];
    const contexts = photoContexts([...few, ...dump]);
    expect(contexts.get("pad.jpeg")).toBe("The condenser pad is cracked.");
    expect(contexts.has("IMG_0.jpeg")).toBe(false);
  });
});
