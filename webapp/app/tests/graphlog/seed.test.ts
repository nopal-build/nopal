/**
 * Seeding (2026-09-29): a project's history before it logged in O.No,
 * taken in as seed. Pins what code decides: a day splits into one source
 * per section, `- src:` lines are provenance and not words, the noted
 * section is nobody's words, a name links to an account by first name
 * and only when one person matches, the day's hash carries the links it
 * was written with, and a wipe removes only what the seed alone fed.
 * See `seed.server.ts`.
 */

import { describe, expect, it } from "vitest";
import { buildRefDirectiveMarkdown, parseRefAttrs } from "oxmarkdown-core";
import {
  buildSeedDaySources,
  buildSeedDocumentSource,
  isSeedDayFileName,
  isSeedInstructionFileName,
  linkSeedNames,
  mergeSeedDay,
  moveNotedToSpeaker,
  parseSeedDay,
  parseSeedDayDoc,
  renderSeedDayDoc,
  parseSeedDocument,
  parseSeedPeople,
  SEED_NOTED_NAME,
  classifyPreparedSeedFile,
  mergePreparedSeedDay,
  wipeDecisions,
  withoutDatesInStructure,
  withoutSourceHash,
} from "robustness-core/data/seed.server";
import { parseGraphLogNodes } from "robustness-core/data/graphNodeIndex.server";

// Campbell's 2026-07-20, as the seed folder holds it.
const DAY = `---
date: 2026-07-20
project: This Healthy House
kind: seed
source: vault cards (This Healthy House cards.md)
---

## Austin

- It feels like we are finally getting a direction under control with permitting. The general path is emerging for historic and general permitting but still needs more steps to finalize.
- I need to sign contracts for our electrical and structural engineers today.
  - src: daily note

- I have started a back-and-forth email with the head of the historic department. So far good news.
- We need to remove all of the ceilings to see the critical structure for engineering.
  - src: "This Healthy House" client thread

- 1. Ceiling demo / 2. Video and photos to the engineer / 3. Basic engineering and a verdict on the floors / 4. Demo permit / 5. Expose everything else needed and remove the floors / 6. Full permit submission during demo.
  - src: demo-contractor thread

## Beaudy

- We talked about floors being the next step but were curious if the engineer had anything to say about that due to the floor acting as a sheathing. Maybe we just keep a 18″ perimeter of the floor in place to keep the joists locked in.
  - src: demo-contractor thread

## Noted (not anyone's words)

- Ceiling demo priced at $11,700 by Beaudy (verbal ~$9,500 via Lucas, plus Beaudy's project-management markup). Austin: "That feels fair and fits within our original guesses on demo and remediation."
- Demo scheduled to start 7/21, 2–3 days, Dallas on standby. Clients signed the demo contract and left a 50% deposit.
- The historic-registry intake form for the house surfaced (Erica: "Arthur c Roger house").
- Schedule given to the design team: Austin back full time August 1; Nopal's side, including HVAC/mechanical design, mostly done the first half of August; engineers' input and permit drawings at the end of August.
- Michelle Meisenbach (M5) signed her contract.
`;

const PEOPLE = `---
project: This Healthy House
kind: seed-people
---

One line per name used in the seed files.

- Austin — Nopal, guide
- Lucas — Nopal, guide
- Beaudy — demo contractor, then GC
- Michelle Meisenbach — M5
`;

const members = [
  { humanId: "h_austin", name: "Austin Trautman", email: "austin@nopal.build" },
  { humanId: "h_lucas", name: "Lucas Lee", email: "lucas@nopal.build" },
];

describe("a seed day is split by code", () => {
  const day = parseSeedDay(DAY);

  it("one section per person, the noted section apart, kind read from the front matter", () => {
    expect(day.kind).toBe("seed");
    expect(day.sections.map((s) => s.speaker)).toEqual(["Austin", "Beaudy"]);
    expect(day.noted?.bullets).toHaveLength(5);
    expect(day.noted?.bullets[0]).toMatch(/^Ceiling demo priced at \$11,700/);
  });

  it("src lines are provenance, lifted out of the words and kept in order", () => {
    const austin = day.sections[0];
    expect(austin.sources).toEqual(["daily note", '"This Healthy House" client thread', "demo-contractor thread"]);
    expect(austin.text).not.toMatch(/src:/);
    expect(austin.text).toMatch(/sign contracts for our electrical/);
    expect(day.sections[1].sources).toEqual(["demo-contractor thread"]);
  });

  it("the people file gives roles by name", () => {
    const roles = parseSeedPeople(PEOPLE);
    expect(roles.get("Beaudy")).toBe("demo contractor, then GC");
    expect(roles.get("Michelle Meisenbach")).toBe("M5");
    expect(roles.size).toBe(4);
  });

  it("only YYYY-MM-DD.md is a day; underscored files are the intake's", () => {
    expect(isSeedDayFileName("2026-07-20.md")).toBe(true);
    expect(isSeedDayFileName("2026-07-20-h123.md")).toBe(false);
    expect(isSeedDayFileName("_people.md")).toBe(false);
    expect(isSeedInstructionFileName("_attachments.md")).toBe(true);
    expect(isSeedInstructionFileName("2026-07-20.md")).toBe(false);
  });
});

describe("a name links to an account by first name, and only when one person matches", () => {
  it("Austin and Lucas link; Beaudy and a full name nobody has stay names", () => {
    const { links, ambiguous } = linkSeedNames(["Austin", "Beaudy", "Lucas", "Michelle Meisenbach"], members);
    expect(links.get("Austin")).toBe("h_austin");
    expect(links.get("Lucas")).toBe("h_lucas");
    expect(links.get("Beaudy")).toBeNull();
    expect(links.get("Michelle Meisenbach")).toBeNull();
    expect(ambiguous).toEqual([]);
  });

  it("two members sharing a first name link to nobody, and it is reported", () => {
    const twoLucases = [...members, { humanId: "h_lucas2", name: "Lucas Vega", email: "lv@x.com" }];
    const { links, ambiguous } = linkSeedNames(["Lucas", "Austin"], twoLucases);
    expect(links.get("Lucas")).toBeNull();
    expect(links.get("Austin")).toBe("h_austin");
    expect(ambiguous).toEqual(["Lucas"]);
  });

  it("a member with no name goes by the part of their email before the @", () => {
    const { links } = linkSeedNames(["Gerald"], [{ humanId: "h_g", name: "", email: "gerald@nopal.build" }]);
    expect(links.get("Gerald")).toBe("h_g");
  });
});

describe("what sync-graph reads from a seed day", () => {
  const day = parseSeedDay(DAY);
  const { links } = linkSeedNames(day.sections.map((s) => s.speaker), members);
  const sources = buildSeedDaySources({
    date: "2026-07-20",
    fileId: "seedfile",
    day,
    links,
    memberNames: new Map(members.map((m) => [m.humanId, m.name])),
    roles: parseSeedPeople(PEOPLE),
  });

  it("one source per spoken section, then the noted one last", () => {
    expect(sources).toHaveLength(3);
    expect(sources[0].humanAuthored).toBe(true);
    expect(sources[1].humanAuthored).toBe(true);
    expect(sources[2].humanAuthored).toBe(false);
    expect(sources[2].verbatimFallback).toHaveLength(5);
  });

  it("a linked speaker is cited under the account's name with its id; an unlinked one under the seed's name with none", () => {
    const austin = parseRefAttrs({ type: "textDirective", name: "ref", attributes: attrsOf(sources[0].ref) } as never);
    expect(austin).toMatchObject({ name: "Austin Trautman", humanId: "h_austin", origin: "seed", datetime: "2026-07-20T12:00:00Z" });
    const beaudy = sources[1].ref;
    expect(beaudy.name).toBe("Beaudy");
    expect(beaudy.humanId).toBeUndefined();
    expect(beaudy.origin).toBe("seed");
    expect(sources[1].label).toMatch(/demo contractor, then GC/);
    expect(sources[1].label).toMatch(/seeded history/);
  });

  it("the noted section is cited as Seed, never a person, and says so to the model", () => {
    expect(sources[2].ref.name).toBe(SEED_NOTED_NAME);
    expect(sources[2].ref.humanId).toBeUndefined();
    expect(sources[2].ref.origin).toBe("seed-noted");
    expect(sources[2].label).toMatch(/nobody said/);
  });

  it("a heading that only says Noted, in any case, is still the noted section and never a speaker", () => {
    const loose = parseSeedDay(DAY.replace("## Noted (not anyone's words)", "## noted"));
    expect(loose.sections.map((s) => s.speaker)).not.toContain("noted");
    expect(loose.noted?.bullets.length).toBe(parseSeedDay(DAY).noted?.bullets.length);
  });

  it("the citation round-trips through the node index with its origin", () => {
    const refLine = buildRefDirectiveMarkdown(sources[2].ref);
    const nodes = parseGraphLogNodes("2026-07-20", `### Node 1\nCeiling demo priced at $11,700.\n\n*Noted when this history was seeded. Not a quotation, and not anyone's words.*\n${refLine}\n`);
    expect(nodes[0]).toMatchObject({ authorName: "Seed", authorHumanId: null, origin: "seed-noted" });
    const spoken = parseGraphLogNodes("2026-07-20", `### Node 1\n==floors==\n${buildRefDirectiveMarkdown(sources[1].ref)}\n`);
    expect(spoken[0]).toMatchObject({ authorName: "Beaudy", authorHumanId: null, origin: "seed" });
    const live = parseGraphLogNodes("2026-07-20", `### Node 1\n==x==\n:ref{name="Austin" human-id="h_austin" datetime="2026-07-20T12:00:00Z" location="/vault?file=a" verbose="true"}\n`);
    expect(live[0].origin).toBeNull();
  });

  it("the day's hash carries who each name was linked to, so joining later re-extracts that day and a role edit does not", () => {
    const before = sources.map((s) => s.hashPart);
    expect(before).toEqual(["seedlink:Austin=h_austin", "seedlink:Beaudy=none", "seednoted"]);
    const joined = buildSeedDaySources({
      date: "2026-07-20",
      fileId: "seedfile",
      day,
      links: new Map([...links, ["Beaudy", "h_beaudy"]]),
      memberNames: new Map([...members.map((m) => [m.humanId, m.name] as const), ["h_beaudy", "Beaudy Ortiz"]]),
      roles: new Map(),
    });
    expect(joined.map((s) => s.hashPart)).toEqual(["seedlink:Austin=h_austin", "seedlink:Beaudy=h_beaudy", "seednoted"]);
    expect(joined[1].ref).toMatchObject({ name: "Beaudy Ortiz", humanId: "h_beaudy" });
  });
});

describe("a seed document", () => {
  const DOC = `---
date: 2026-04-22
project: This Healthy House
kind: seed-document
destination: costs (first build estimate)
author: Austin
---

| line item | cost estimate | confidence |
|---|---|---|
| HVAC | $75,000 | 0.8 |
`;

  it("is one source under its author, linked when the author is on the project", () => {
    const meta = parseSeedDocument(DOC);
    expect(meta).toMatchObject({ kind: "seed-document", date: "2026-04-22", author: "Austin" });
    const { links } = linkSeedNames(["Austin"], members);
    const source = buildSeedDocumentSource({ fileId: "doc1", name: "2026-04-22 Estimate.md", meta, links, memberNames: new Map([["h_austin", "Austin Trautman"]]) });
    expect(source.ref).toMatchObject({ name: "Austin Trautman", humanId: "h_austin", origin: "seed", datetime: "2026-04-22T12:00:00Z" });
    expect(source.humanAuthored).toBe(true);
    expect(source.content).toMatch(/HVAC/);
  });

  it("with no author is nobody's words", () => {
    const meta = parseSeedDocument(DOC.replace("author: Austin\n", ""));
    const source = buildSeedDocumentSource({ fileId: "doc1", name: "x.md", meta, links: new Map(), memberNames: new Map() });
    expect(source.ref).toMatchObject({ name: SEED_NOTED_NAME, origin: "seed-noted" });
    expect(source.humanAuthored).toBe(false);
  });

  it("with no date in its front matter takes the file's own day, never an empty one", () => {
    const meta = parseSeedDocument(DOC.replace("date: 2026-04-22\n", ""));
    const source = buildSeedDocumentSource({ fileId: "doc1", name: "x.md", meta, links: new Map(), memberNames: new Map(), fileDate: "2026-04-23" });
    expect(source.ref.datetime).toBe("2026-04-23T12:00:00Z");
  });
});

describe("a prepared seed file in a packet is placed by code, never read by the model (the fold, 2026-10-01)", () => {
  it("`kind: seed` is a day, dated by its name or its front matter", () => {
    expect(classifyPreparedSeedFile("2026-07-20.md", DAY)).toEqual({ kind: "day", date: "2026-07-20", byShape: false });
    expect(classifyPreparedSeedFile("campbell week.md", DAY)).toEqual({ kind: "day", date: "2026-07-20", byShape: false });
    const undated = DAY.replace("date: 2026-07-20\n", "");
    expect(classifyPreparedSeedFile("week.md", undated)).toMatchObject({ kind: "refused" });
    expect(classifyPreparedSeedFile("2026-07-20.md", "---\nkind: seed\n---\n\nnothing here\n")).toMatchObject({ kind: "refused" });
  });

  it("a day named for its date and shaped like one is prepared even with no front matter, and says so", () => {
    const bare = DAY.replace(/^---\n[\s\S]*?\n---\n/, "");
    expect(classifyPreparedSeedFile("2026-07-20.md", bare)).toEqual({ kind: "day", date: "2026-07-20", byShape: true });
    // A raw thread is neither named for a day nor shaped: the model's.
    expect(classifyPreparedSeedFile("campbell-attic-thread.txt", "8/5 Erica: Do the beams have to come down?\n8/5 Austin: Yes.\n")).toBeNull();
    expect(classifyPreparedSeedFile("2026-07-20.md", "8/5 Erica: Do the beams have to come down?\n")).toBeNull();
  });

  it("a document needs its date; the people file is the people file; a helper file is refused", () => {
    expect(classifyPreparedSeedFile("Estimate.md", "---\nkind: seed-document\ndate: 2026-04-22\nauthor: Austin\n---\n\nHVAC $40k\n")).toEqual({ kind: "document", date: "2026-04-22" });
    expect(classifyPreparedSeedFile("Estimate.md", "---\nkind: seed-document\n---\n\nHVAC $40k\n")).toMatchObject({ kind: "refused" });
    expect(classifyPreparedSeedFile("_people.md", "---\nkind: seed-people\n---\n\n- Beaudy — GC\n")).toEqual({ kind: "people" });
    expect(classifyPreparedSeedFile("_people.md", "- Beaudy — GC\n")).toEqual({ kind: "people" });
    expect(classifyPreparedSeedFile("_attachments.md", "---\nkind: seed-attachments\n---\n\n- a list\n")).toMatchObject({ kind: "refused", reason: expect.stringContaining("seed-attachments") });
  });

  it("a prepared day adds to the day already there, keeping its own src lines, and never writes a line twice", () => {
    const first = mergePreparedSeedDay(null, DAY);
    expect(first.content).toBe(DAY);
    expect(first.added).toBeGreaterThan(0);
    const again = mergePreparedSeedDay(DAY, DAY);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(first.added);
    const more = `---\ndate: 2026-07-20\nkind: seed\n---\n\n## Erica\n\n- Arthur c Roger house. Maybe it's new name.\n  - src: the client thread\n\n## Austin\n\n- A brand new line from a second file.\n  - src: the second file\n`;
    const merged = mergePreparedSeedDay(DAY, more);
    expect(merged.added).toBe(2);
    expect(merged.content).toMatch(/## Erica\n\n- Arthur c Roger house/);
    expect(merged.content).toMatch(/- src: the second file/);
    expect(parseSeedDay(merged.content).sections.map((s) => s.speaker)).toEqual([...parseSeedDay(DAY).sections.map((s) => s.speaker), "Erica"]);
  });
});

describe("a wipe removes only what the seed alone fed", () => {
  it("a date only the seed fed is removed; a date live entries also fed is re-extracted", () => {
    expect(wipeDecisions(["2026-07-20", "2026-09-14", "2026-07-20"], new Set(["2026-09-14", "2026-09-15"]))).toEqual({
      remove: ["2026-07-20"],
      reextract: ["2026-09-14"],
    });
  });

  it("the index forgets a wiped date's lines, and a thread that held nothing else", () => {
    const structure = "---\nasOfGraphHash: abc\n---\n\n## Demo\nWeight: 2 · Status: active\n- 2026-07-20 Node 1 (Austin) — ceilings\n- 2026-09-10 Node 1 (Lucas) — slipped\n\n## Only seed\nWeight: 1 · Status: dormant\n- 2026-07-29 Node 3 (Erica) — arch\n";
    const next = withoutDatesInStructure(structure, new Set(["2026-07-20", "2026-07-29"]));
    expect(next).toMatch(/asOfGraphHash: abc/);
    expect(next).toMatch(/2026-09-10 Node 1/);
    expect(next).not.toMatch(/2026-07-20 Node 1/);
    expect(next).not.toMatch(/Only seed/);
    expect(withoutDatesInStructure(structure, new Set(["2020-01-01"]))).toBe(structure);
  });

  it("dropping the source hash leaves the rest of the front matter and the body", () => {
    const content = "---\ndate: 2026-09-14\nsourceHash: abc123\nskillFingerprint: fp\ngeneratedAt: 2026-09-29T00:00:00.000Z\n---\n\n### Node 1\n==x==\n";
    const next = withoutSourceHash(content);
    expect(next).not.toMatch(/sourceHash/);
    expect(next).toMatch(/skillFingerprint: fp/);
    expect(next).toMatch(/### Node 1/);
    expect(withoutSourceHash("no front matter")).toBe("no front matter");
  });
});

function attrsOf(ref: Parameters<typeof buildRefDirectiveMarkdown>[0]): Record<string, string> {
  const md = buildRefDirectiveMarkdown(ref);
  const out: Record<string, string> = {};
  for (const m of md.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

describe("adding to a seed day without overwriting it (seed packets, 2026-09-30)", () => {
  it("a day read as groups and written back reads the same to the graph", () => {
    const doc = parseSeedDayDoc(DAY);
    expect(doc.sections.map((s) => [s.speaker, s.groups.map((g) => [g.bullets.length, g.src])])).toEqual([
      ["Austin", [[2, "daily note"], [2, '"This Healthy House" client thread'], [1, "demo-contractor thread"]]],
      ["Beaudy", [[1, "demo-contractor thread"]]],
    ]);
    expect(doc.noted).toHaveLength(5);
    const again = parseSeedDay(renderSeedDayDoc(doc));
    const before = parseSeedDay(DAY);
    expect(again.kind).toBe("seed");
    expect(again.sections.map((s) => [s.speaker, s.sources, s.text.replace(/\s+/g, " ")])).toEqual(before.sections.map((s) => [s.speaker, s.sources, s.text.replace(/\s+/g, " ")]));
    expect(again.noted?.bullets).toEqual(before.noted?.bullets);
  });

  it("a packet's lines go under their speaker with the packet's own source, and what was there stays", () => {
    const merged = mergeSeedDay(DAY, "2026-07-20", {
      lines: [
        { speaker: "Erica", text: "Do the beams upstairs have to come down too?", src: "Erica's packet: thread.txt" },
        { speaker: "austin", text: "I need to sign contracts for our electrical and structural engineers today.", src: "Erica's packet: thread.txt" },
        { speaker: "Austin", text: "The engineers want to see both ceilings.", src: "Erica's packet: thread.txt" },
      ],
      noted: ["Michelle Meisenbach (M5) signed her contract.", "The deposit was 50%."],
    });
    expect(merged).toMatchObject({ added: 3, skipped: 2 });
    const day = parseSeedDay(merged.content);
    expect(day.sections.map((s) => s.speaker)).toEqual(["Austin", "Beaudy", "Erica"]);
    expect(day.sections[0].sources).toEqual(["daily note", '"This Healthy House" client thread', "demo-contractor thread", "Erica's packet: thread.txt"]);
    expect(day.sections[0].text).toMatch(/sign contracts for our electrical/);
    expect(day.sections[0].text.match(/sign contracts/g)).toHaveLength(1);
    expect(day.noted?.bullets).toHaveLength(6);
    // Merging the same packet again changes nothing.
    expect(mergeSeedDay(merged.content, "2026-07-20", { lines: [{ speaker: "Erica", text: "Do the beams upstairs have to come down too?", src: "x" }], noted: [] })).toMatchObject({ added: 0, skipped: 1, content: merged.content });
  });

  it("a day that does not exist yet is made in the seed shape", () => {
    const made = mergeSeedDay(null, "2026-08-02", { lines: [{ speaker: "Beaudy", text: "Bid attached.", src: "Beaudy's packet: bids.eml" }], noted: ["The bid was $18,400."] });
    const day = parseSeedDay(made.content);
    expect(day.kind).toBe("seed");
    expect(day.sections).toEqual([{ speaker: "Beaudy", text: "- Bid attached.", sources: ["Beaudy's packet: bids.eml"] }]);
    expect(day.noted?.bullets).toEqual(["The bid was $18,400."]);
  });

  it("a guide's yes moves one noted line under the person, and only that line", () => {
    const withNoted = mergeSeedDay(DAY, "2026-07-20", { lines: [], noted: ["keep the perimeter till the engineer rules"] }).content;
    const moved = moveNotedToSpeaker(withNoted, "keep the perimeter till the engineer rules", "Beaudy", "demo-contractor thread");
    const day = parseSeedDay(moved);
    expect(day.noted?.bullets).toHaveLength(5);
    expect(day.sections[1].text).toMatch(/keep the perimeter till the engineer rules/);
    expect(moveNotedToSpeaker(moved, "keep the perimeter till the engineer rules", "Beaudy", null)).toBe(moved);
  });
});
