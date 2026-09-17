/**
 * The readings `graph-project-view` hands the Efforts skill (see
 * `effortReadings.server.ts`). Every number the skill mentions is counted
 * here rather than by the model; these tests pin what each count means
 * on a small graph whose answers can be checked by hand.
 *
 * The fixture, with today = 2026-09-16:
 *
 *   Siding   A 2026-09-01#1 Gerald  "Siding crew starts Monday."     (15 days old)
 *            B 2026-09-10#1 Lucas   "Crew slipped a week?"  -> A     (6 days old)
 *            C 2026-09-10#2 Gerald  "Flashing at the window head"  -> A
 *   Windows  D 2026-08-20#1 Lucas   "When does the window order land?" -> A  (27 days old)
 */

import { describe, expect, it } from "vitest";
import {
  buildEffortsSidecar,
  buildReadingsBlock,
  computeEffortReadings,
  countPageWords,
  markChanges,
  PAGE_WORD_CEILING,
  parseEffortBlocks,
  questionInOwnWords,
  readEffortsSidecar,
  SECTION_WORD_BUDGETS,
  speedLabel,
  stripChangeTags,
  unknownThreadNames,
  withChangeTags,
  RECENT_WINDOW_DAYS,
} from "robustness-core/data/effortReadings.server";
import type { GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import type { ReadmeSection } from "robustness-core/data/project.types";

const TODAY = "2026-09-16";

function node(
  date: string,
  number: number,
  author: { name: string; id: string },
  quote: string,
  links: { date: string; number: number }[] = [],
): GraphLogNode {
  return {
    id: `${date}#${number}`,
    date,
    number,
    quote,
    authorName: author.name,
    authorHumanId: author.id,
    refLine: `:ref{name="${author.name}" human-id="${author.id}" datetime="${date}T12:00:00Z"}`,
    links,
  };
}

const gerald = { name: "Gerald", id: "h-gerald" };
const lucas = { name: "Lucas", id: "h-lucas" };

const A = node("2026-09-01", 1, gerald, "==Siding crew starts Monday.==");
const B = node("2026-09-10", 1, lucas, "==Crew slipped a week?==", [{ date: "2026-09-01", number: 1 }]);
const C = node("2026-09-10", 2, gerald, "==Flashing at the window head==", [{ date: "2026-09-01", number: 1 }]);
const D = node("2026-08-20", 1, lucas, "Lucas asked about lead times. ==When does the window order land?==", [
  { date: "2026-09-01", number: 1 },
]);

const sections: ReadmeSection[] = [
  { heading: "", content: "intro" },
  {
    heading: "Siding",
    content: [
      "Weight: 3 inbound links, 2 people · Status: active",
      "- 2026-09-01 Node 1 (Gerald) — crew start",
      "- 2026-09-10 Node 1 (Lucas) — slipped?",
      "- 2026-09-10 Node 2 (Gerald) — flashing",
    ].join("\n"),
  },
  { heading: "Windows", content: "Weight: no inbound links yet · Status: open\n- 2026-08-20 Node 1 (Lucas) — order" },
  { heading: "Unclustered", content: "" },
];

describe("effort readings: every number the Efforts skill mentions is counted by code", () => {
  const readings = computeEffortReadings(sections, [A, B, C, D], TODAY);
  const siding = readings.threads.find((t) => t.heading === "Siding")!;
  const windows = readings.threads.find((t) => t.heading === "Windows")!;

  it("skips the intro and Unclustered, and reads one thread per named section", () => {
    expect(readings.threads.map((t) => t.heading)).toEqual(["Siding", "Windows"]);
  });

  it("dates, quiet and span come from the thread's own nodes", () => {
    expect(siding.firstDate).toBe("2026-09-01");
    expect(siding.lastDate).toBe("2026-09-10");
    expect(siding.daysQuiet).toBe(6);
    expect(siding.daysSpanned).toBe(10);
    expect(windows.daysQuiet).toBe(27);
    expect(windows.daysSpanned).toBe(1);
  });

  it("speed compares the recent window against the one before it", () => {
    expect(RECENT_WINDOW_DAYS).toBe(14);
    expect(siding.recent).toBe(2);
    expect(siding.before).toBe(1);
    expect(siding.speed).toBe("rising");
    expect(windows.recent).toBe(0);
    expect(windows.before).toBe(1);
    expect(windows.speed).toBe("stopped");
    expect(speedLabel(2, 2)).toBe("steady");
    expect(speedLabel(1, 3)).toBe("falling");
    expect(speedLabel(0, 0)).toBe("stopped");
  });

  it("writers are counted by human id and a one-writer thread is flagged, never called unowned", () => {
    expect(siding.writers).toEqual([
      { name: "Gerald", count: 2 },
      { name: "Lucas", count: 1 },
    ]);
    expect(siding.singleWriter).toBe(false);
    expect(windows.singleWriter).toBe(true);
  });

  it("alignment counts links inside the thread and how many cross writers", () => {
    expect(siding.internalLinks).toBe(2);
    expect(siding.crossWriterLinks).toBe(1);
    expect(windows.internalLinks).toBe(0);
  });

  it("neighbors carry link direction only, both ways", () => {
    expect(siding.neighbors).toEqual([{ heading: "Windows", outbound: 0, inbound: 1 }]);
    expect(windows.neighbors).toEqual([{ heading: "Siding", outbound: 1, inbound: 0 }]);
  });

  it("the load picture lists every writer, with nothing recent shown as nothing", () => {
    expect(readings.load).toEqual([
      { name: "Gerald", threads: [{ heading: "Siding", count: 1 }] },
      { name: "Lucas", threads: [{ heading: "Siding", count: 1 }] },
    ]);
    const quietLucas = computeEffortReadings(sections, [A, C, D], TODAY).load;
    expect(quietLucas.find((p) => p.name === "Lucas")).toEqual({ name: "Lucas", threads: [] });
  });

  it("the question stand-in is a highlighted question mark with no node linking back", () => {
    expect(readings.openQuestions).toEqual([
      { id: "2026-08-20#1", author: "Lucas", date: "2026-08-20", line: "When does the window order land?" },
      { id: "2026-09-10#1", author: "Lucas", date: "2026-09-10", line: "Crew slipped a week?" },
    ]);
    // A question that something links back to is not listed.
    const answered = node("2026-09-11", 1, gerald, "==Yes, by Friday.==", [{ date: "2026-09-10", number: 1 }]);
    const withAnswer = computeEffortReadings(
      [...sections.slice(0, 2), { heading: "Siding", content: `${sections[1].content}\n- 2026-09-11 Node 1 (Gerald) — answer` }, ...sections.slice(2)],
      [A, B, C, D, answered],
      TODAY,
    );
    expect(withAnswer.openQuestions.map((q) => q.id)).toEqual(["2026-08-20#1"]);
    // Only the person's own highlighted words count, never the extractor's prose.
    expect(questionInOwnWords("Is this a question? ==No, a statement.==")).toBeNull();
    expect(questionInOwnWords("==Which one?== ==and this==")).toBe("Which one?");
  });

  it("the prompt block says what the model owns and carries every reading with its unit", () => {
    const block = buildReadingsBlock(readings)!;
    expect(block).toContain("counted, never estimated");
    expect(block).toContain("never stalled");
    expect(block).toContain(`"Siding": 3 nodes, 2026-09-01 to 2026-09-10 (10 days spanned), 6 days quiet; speed: rising (2 recent, 1 in the 14 days before); writers: Gerald 2, Lucas 1; links among its own nodes: 2, 1 across writers; links to other threads: <- "Windows" 1`);
    expect(block).toContain(`"Windows": 1 node, on 2026-08-20, 27 days quiet; speed: stopped (0 recent, 1 in the 14 days before); writers: Lucas 1 (one writer); links among its own nodes: 0; links to other threads: -> "Siding" 1`);
    expect(block).toContain("- Gerald: \"Siding\" 1");
    expect(block).toContain(`- 2026-09-10#1 (Lucas, 2026-09-10): "Crew slipped a week?"`);
    expect(buildReadingsBlock(computeEffortReadings([], [], TODAY))).toBeNull();
  });
});

describe("efforts on the page: the field line is read back by code", () => {
  const page = [
    "# Crouch",
    "",
    "Where we are.",
    "",
    "## On the bench",
    "",
    "### Siding",
    "Threads: Siding; Windows · Size: L · Posture: Accelerate · Direction: closing the west wall",
    "",
    "Prose about siding.",
    "",
    "### Landscaping",
    "",
    "No field line here, just prose.",
    "",
    "## Shelf",
    "",
    "### Permits",
    "Threads: Permit renewal",
    "",
    "## Notes on this view",
    "",
    "### not an effort",
  ].join("\n");

  it("parses every ### heading, its section, and the fields when the line is there", () => {
    const blocks = parseEffortBlocks(page);
    expect(blocks.map((b) => [b.name, b.section, b.hasFieldLine])).toEqual([
      ["Siding", "on the bench", true],
      ["Landscaping", "on the bench", false],
      ["Permits", "shelf", true],
      ["not an effort", "notes on this view", false],
    ]);
    expect(blocks[0]).toMatchObject({ threads: ["Siding", "Windows"], size: "L", posture: "accelerate", direction: "closing the west wall" });
    expect(blocks[2]).toMatchObject({ threads: ["Permit renewal"], size: null, posture: null, direction: null });
  });

  it("names the thread names that match nothing in the index, case-insensitively", () => {
    const headings = new Set(["siding", "windows"]);
    expect(unknownThreadNames(page, headings)).toEqual(["Permit renewal"]);
    expect(unknownThreadNames("### X\nThreads: SIDING", headings)).toEqual([]);
    expect(unknownThreadNames("### X\nThreads: a; b\n### Y\nThreads: b", headings)).toEqual(["a", "b"]);
  });

  it("the sidecar merges counted readings per effort and lists what no effort named", () => {
    const readings = computeEffortReadings(sections, [A, B, C, D], TODAY);
    const content = buildEffortsSidecar(
      { asOfGraphHash: "hash1", generatedAt: "2026-09-16T10:00:00.000Z", skillFingerprint: "feedfacefeedface" },
      parseEffortBlocks("## On the bench\n### Exterior\nThreads: Siding; Windows · Size: M · Posture: regroup · Direction: waiting on the order\n"),
      readings,
    );
    expect(content.startsWith("---\nasOfGraphHash: hash1\ngeneratedAt: 2026-09-16T10:00:00.000Z\nskillFingerprint: feedfacefeedface\n---\n")).toBe(true);
    const json = JSON.parse(content.slice(content.indexOf("```json\n") + 8, content.lastIndexOf("\n```")));
    expect(json.efforts).toHaveLength(1);
    const exterior = json.efforts[0];
    expect(exterior).toMatchObject({ name: "Exterior", section: "on the bench", size: "M", posture: "regroup", threadsNotInIndex: [] });
    expect(exterior.readings).toMatchObject({
      threads: ["Siding", "Windows"],
      nodeCount: 4,
      firstDate: "2026-08-20",
      lastDate: "2026-09-10",
      daysQuiet: 6,
      recent: 2,
      before: 2,
      speed: "steady",
      writers: [{ name: "Gerald", count: 2 }, { name: "Lucas", count: 2 }],
      internalLinks: 2,
      crossWriterLinks: 1,
      daysSpanned: 22,
      neighbors: [],
    });
    expect(json.threadsWithoutEffort).toEqual([]);
    const partial = JSON.parse(
      (() => {
        const c = buildEffortsSidecar(
          { asOfGraphHash: "h", generatedAt: "t", skillFingerprint: "f" },
          parseEffortBlocks("### Siding\nThreads: Siding; Roofing"),
          readings,
        );
        return c.slice(c.indexOf("```json\n") + 8, c.lastIndexOf("\n```"));
      })(),
    );
    expect(partial.efforts[0].threadsNotInIndex).toEqual(["Roofing"]);
    expect(partial.efforts[0].readings.neighbors).toEqual([{ heading: "Windows", outbound: 0, inbound: 1 }]);
    expect(partial.threadsWithoutEffort).toEqual(["Windows"]);
  });
});

describe("round 2: the page as a list", () => {
  it("a bench heading names the person, and the effort's lines are kept citation-free", () => {
    const [b] = parseEffortBlocks(
      "## On the bench\n### Gerald · Black locust cladding {moved}\nThreads: Siding · Size: L · Posture: accelerate · Direction: closing\n\n- Now: \"under 8 rows to go\" :ref{name=\"Gerald L\" human-id=\"super_1\"}\n- Next:   eaves, then the soffit\n",
    );
    expect(b.person).toBe("Gerald");
    expect(b.name).toBe("Black locust cladding");
    expect(b.lines).toEqual(['- Now: "under 8 rows to go"', "- Next: eaves, then the soffit"]);
    expect(parseEffortBlocks("### Plain effort\nThreads: X")[0]).toMatchObject({ person: null, name: "Plain effort" });
  });

  it("words are counted the way a reader reads them: citations and photos cost nothing, budgets sum to the ceiling", () => {
    const text = '- Now: "eight rows" :ref{name="G" human-id="x" datetime="2026-09-09T12:00:00Z"} left\n:::gallery{}\n![IMG_1.jpeg](/api/vault/view/abc)\n:::\n- Next: eaves';
    expect(countPageWords(text)).toBe(6);
    expect(Object.values(SECTION_WORD_BUDGETS).reduce((a, b) => a + b, 0)).toBe(PAGE_WORD_CEILING);
  });

  it("change marks match on shared threads, not names, and fire only when words or fields change", () => {
    const previous = readEffortsSidecar(
      buildEffortsSidecar(
        { asOfGraphHash: "h", generatedAt: "t", skillFingerprint: "f" },
        parseEffortBlocks(
          "## On the bench\n### Gerald · Cladding\nThreads: Siding · Size: L · Posture: accelerate · Direction: closing\n- Now: eight rows\n- Next: eaves\n### Lucas · Inside\nThreads: Windows · Size: S · Posture: regroup · Direction: waiting\n- Now: punch list\n",
        ),
        computeEffortReadings(sections, [A, B, C, D], TODAY),
      ),
    )!;
    expect(previous.map((p) => [p.person, p.name, p.threads])).toEqual([
      ["Gerald", "Cladding", ["Siding"]],
      ["Lucas", "Inside", ["Windows"]],
    ]);
    const current = parseEffortBlocks(
      "## On the bench\n### Gerald · Black locust cladding\nThreads: Siding · Size: L · Posture: accelerate · Direction: closing\n- Now: eight rows\n- Next: eaves\n### Lucas · Inside\nThreads: Windows · Size: S · Posture: regroup · Direction: waiting\n- Now: inspection called :ref{x}\n## Ready next\n### Metal skirt\nThreads: Roofing · Size: S\n- Now: nothing yet\n",
    );
    const marks = markChanges(previous, current);
    expect(marks.get("gerald · black locust cladding")).toEqual({ change: "unchanged", changedLines: [] });
    expect(marks.get("lucas · inside")).toEqual({ change: "moved", changedLines: ["- Now: inspection called"] });
    expect(marks.get(" · metal skirt")).toEqual({ change: "new", changedLines: ["- Now: nothing yet"] });
    expect(markChanges(null, current).size).toBe(0);
    // A changed field line is a move too.
    const resized = parseEffortBlocks("### Gerald · Cladding\nThreads: Siding · Size: M · Posture: accelerate · Direction: closing\n- Now: eight rows\n- Next: eaves\n");
    expect(markChanges(previous, resized).get("gerald · cladding")!.change).toBe("moved");
  });

  it("tags go onto marked headings and come off cleanly before the model sees the page", () => {
    const body = "## On the bench\n### Gerald · Cladding\n- Now: x\n### Lucas · Inside {new}\n- Now: y\n";
    const marks = new Map([
      ["gerald · cladding", { change: "moved" as const, changedLines: [] }],
      ["lucas · inside", { change: "unchanged" as const, changedLines: [] }],
    ]);
    const tagged = withChangeTags(body, marks);
    expect(tagged).toBe("## On the bench\n### Gerald · Cladding {moved}\n- Now: x\n### Lucas · Inside\n- Now: y\n");
    expect(stripChangeTags(tagged)).toBe("## On the bench\n### Gerald · Cladding\n- Now: x\n### Lucas · Inside\n- Now: y\n");
    expect(readEffortsSidecar("no block here")).toBeNull();
    expect(readEffortsSidecar(null)).toBeNull();
  });
});
