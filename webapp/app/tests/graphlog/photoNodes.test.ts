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
  chooseNodeByModel,
  findPhotoNodes,
  planPhotoNodes,
  photoNodeIdsOf,
  readPhotoLinks,
  splitPhotoSection,
  withPhotoNodes,
  type ChooseNode,
  type DayMedia,
} from "robustness-core/data/photoNodes.server";
import { placeLinkedPhotoNodes, withoutPhotoNodes } from "robustness-core/data/graphStructure.server";
import { parseGraphLogNodes } from "robustness-core/data/graphNodeIndex.server";
import { withSourceHash } from "robustness-core/data/syncGraph.server";
import type { LlmProvider } from "robustness-core/data/llmProvider";
import { createReadmeExecutors } from "robustness-core/data/graphProjectView.server";

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
    expect(plan.links.img1).toMatchObject({ hash: "h1", quote: null, by: "model", rule: 2 });

    const again = counting(2);
    const second = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: plan.links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: again.choose });
    expect(again.calls()).toBe(0);
    expect(second.section).toBe(plan.section);

    const changed = counting(2);
    await planPhotoNodes({ date: DATE, textBody, media: [photo({ hash: "h2" })], links: plan.links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: changed.choose });
    expect(changed.calls()).toBe(1);
  });

  it("a model's link from an older rule is asked once more, and the new one is kept through the day file", async () => {
    const old = { img1: { hash: "h1", quote: null, by: "model" as const } };
    const model = counting(2);
    const plan = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: old, descriptionOnlyProvenance: PROVENANCE, chooseByModel: model.choose });
    expect(model.calls()).toBe(1);
    const file = withPhotoNodes({ date: DATE, existingContent: `---\ndate: ${DATE}\n---\n\n${textBody}\n`, section: plan.section, links: plan.links })!;
    const again = counting(1);
    await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: readPhotoLinks(file), descriptionOnlyProvenance: PROVENANCE, chooseByModel: again.choose });
    expect(again.calls()).toBe(0);
    const code = { img1: { hash: "h1", quote: null, by: "code" as const } };
    const kept = counting(1);
    await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: code, descriptionOnlyProvenance: PROVENANCE, chooseByModel: kept.choose });
    expect(kept.calls()).toBe(0);
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

describe("a stored link is asked again when what it was decided from changes, once", () => {
  const ask = async (media: DayMedia, links: Record<string, any>, body = textBody, answer: number | null = null) => {
    const model = counting(answer);
    const plan = await planPhotoNodes({ date: DATE, textBody: body, media: [media], links, descriptionOnlyProvenance: PROVENANCE, chooseByModel: model.choose });
    return { calls: model.calls(), links: plan.links };
  };

  it("a caption added to a photo stored as none asks once, then not again", async () => {
    const first = await ask(photo(), {});
    expect(first.calls).toBe(1);
    expect((await ask(photo(), first.links)).calls).toBe(0);
    const captioned = await ask(photo({ caption: "Condenser pad, east edge" }), first.links, textBody, 2);
    expect(captioned.calls).toBe(1);
    expect(captioned.links.img1.quote).toContain("hvac condenser pad");
    expect((await ask(photo({ caption: "Condenser pad, east edge" }), captioned.links)).calls).toBe(0);
  });

  it("a new note on the photo's day asks its none photos once; the same notes again do not", async () => {
    const first = await ask(photo(), {});
    const grown = `${textBody}\n\n### Node 3\n==Swapped the condenser pad for a new one.==\n${ref("Lucas J")}`;
    const after = await ask(photo(), first.links, grown, 3);
    expect(after.calls).toBe(1);
    expect((await ask(photo(), after.links, grown)).calls).toBe(0);
  });

  it("a linked photo is not asked again when an unrelated note is added", async () => {
    const first = await ask(photo(), {}, textBody, 2);
    const grown = `${textBody}\n\n### Node 3\n==Ordered trim.==\n${ref("Lucas J")}`;
    expect((await ask(photo(), first.links, grown)).calls).toBe(0);
  });

  it("a record written before fingerprints existed is kept unless its rule is old", async () => {
    expect((await ask(photo(), { img1: { hash: "h1", quote: null, by: "model", rule: 2 } })).calls).toBe(0);
    expect((await ask(photo(), { img1: { hash: "h1", quote: null, by: "model" } })).calls).toBe(1);
  });
});

describe("finding photos by their words", () => {
  const photoNode = (n: number, date: string, words: string) =>
    parseGraphLogNodes(date, `### Node ${n}\n${words}\n\n${PROVENANCE}\n\n![p](/api/vault/view/p${n})\n${ref("Lucas J")}`)[0];
  const photos = [
    photoNode(3, "2026-10-28", "Stucco cracking along the roof line where the gable meets the lower roof."),
    photoNode(4, "2026-10-29", "A white vanity with a quartz countertop, no faucet yet."),
    photoNode(5, "2026-10-29", "Close view of stucco cracking under a window corner."),
    ...Array.from({ length: 10 }, (_, i) => photoNode(10 + i, "2026-10-20", `Stucco wall, view ${i}.`)),
  ];

  it("finds unlinked photos by what they show, best match first, within the dates, at most 8", () => {
    const found = findPhotoNodes(photos, "stucco cracking at the roof line");
    expect(found[0].id).toBe("2026-10-28#3");
    expect(found.length).toBe(8);
    expect(findPhotoNodes(photos, "stucco cracking", { from: "2026-10-29" }).map((n) => n.id)).toEqual(["2026-10-29#5"]);
    expect(findPhotoNodes(photos, "kitchen island")).toEqual([]);
    // The provenance line and the image line are not what a photo shows.
    expect(findPhotoNodes(photos, "description quotation")).toEqual([]);
  });

  it("the Efforts writer can fetch a photo that is in no thread, and still not a made-up id", async () => {
    const all = [...parseGraphLogNodes(DATE, textBody), ...photos];
    const { executors } = createReadmeExecutors({
      projectFolder: {} as any,
      log: () => {},
      initialContent: "",
      initialFileId: undefined,
      allNodesById: new Map(all.map((n) => [n.id, n])),
      validNodeIds: new Set([`${DATE}#1`]),
      photoNodeIds: new Set(photos.map((n) => n.id)),
      today: "2026-10-31",
      sectionOrder: [],
      descriptions: new Map(),
      writerFirstNames: [],
    });
    expect(await executors.find_photos({ words: "vanity quartz countertop" })).toMatch(/^\[2026-10-29#4\] 2026-10-29 — A white vanity/);
    expect(await executors.get_node({ nodeId: "2026-10-29#4" })).toContain("/api/vault/view/p4");
    expect(await executors.get_node({ nodeId: "2026-10-29#99" })).toMatch(/^Error/);
    expect(await executors.get_node({ nodeId: `${DATE}#2` })).toMatch(/^Error/);
  });
});

describe("the link model's answer", () => {
  const nodes = parseGraphLogNodes(DATE, textBody);
  const answering = (text: string | null, stopReason = "end_turn"): LlmProvider =>
    ({ complete: async () => ({ text, toolCalls: [], thinking: { blocks: 0, text: null }, partialToolCall: null, stopReason, usage: { inputTokens: 1, outputTokens: 1 }, model: "fake" }) }) as unknown as LlmProvider;

  it("a number on the list links, none links nothing", async () => {
    expect((await chooseNodeByModel(answering("2"), photo(), nodes)).node?.number).toBe(2);
    expect((await chooseNodeByModel(answering("Note 1"), photo(), nodes)).node?.number).toBe(1);
    expect((await chooseNodeByModel(answering("None"), photo(), nodes)).node).toBeNull();
  });

  it("an empty, cut-off or off-list answer is not an answer, so it is not stored as none", async () => {
    for (const reply of [answering(null, "max_tokens"), answering(""), answering("7"), answering("the second one")]) {
      const out = await chooseNodeByModel(reply, photo(), nodes);
      expect(out.node).toBeUndefined();
      expect(out.unreadable).toBeTruthy();
    }
    const plan = await planPhotoNodes({ date: DATE, textBody, media: [photo()], links: {}, descriptionOnlyProvenance: PROVENANCE, chooseByModel: async () => undefined });
    expect(plan.links.img1).toBeUndefined();
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

describe("graph-structure, photos by code only", () => {
  it("a photo the model once threaded comes out when it links to nothing, and a relinked one moves to its note", () => {
    const sections = [
      { heading: "", content: "intro" },
      { heading: "Kitchen", content: `Weight: 1\n- ${DATE} Node 1 (Lucas J) — footing\n- ${DATE} Node 3 (Lucas J) — photo: pad\n- ${DATE} Node 4 (Lucas J) — photo: truck` },
      { heading: "Site work", content: `Weight: 2\n- ${DATE} Node 2 (Lucas J) — condenser pad cracked` },
    ];
    const relinked = parseGraphLogNodes(DATE, `### Node 3\nA cracked pad.\n${ref("Lucas J")}\n- [${DATE} Node 2](./graph-log-${DATE}.md#node-2)`)[0];
    const loose = parseGraphLogNodes(DATE, `### Node 4\nA truck.\n${ref("Lucas J")}`)[0];
    const stripped = withoutPhotoNodes(sections, new Set([relinked.id, loose.id]));
    const { sections: out } = placeLinkedPhotoNodes(stripped, [relinked, loose]);
    expect(out[1].content).not.toMatch(/Node [34] /);
    expect(out[2].content).toContain(`${DATE} Node 3 (Lucas J) — photo:`);
    expect(out.map((s) => s.content).join("\n")).not.toContain("Node 4 ");
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
