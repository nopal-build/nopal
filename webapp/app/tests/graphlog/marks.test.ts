/**
 * Marks and moves (`graphLogMarks.server.ts`, `graphLogMoves.server.ts`,
 * and what the page run and sync-graph do with them).
 *
 * The load-bearing ones are the identities: with no marks and no moves,
 * the page run's prompt and tools, and daily-log-sync's content, are
 * exactly what they were before annotations existed. Efforts is live;
 * nothing here may change a page nobody marked.
 */

import { describe, expect, it } from "vitest";
import {
  MOVED_MARK_PLACEHOLDER,
  readableMark,
  buildMarksFileContent,
  fileActText,
  isInsideMarkText,
  isPageMark,
  markContextLine,
  moveTraceLine,
  parseMarkTexts,
  refLineFileId,
  type MarkUnitSnapshot,
} from "robustness-core/data/graphLogMarks.server";
import {
  addChunk,
  cardChunks,
  findChunk,
  matchProject,
  removeChunk,
  removeExactText,
} from "robustness-core/data/graphLogMoves.server";
import {
  buildMarksBlock,
  namesAnotherProject,
  buildTargetedUserPrompt,
  buildUserPrompt,
  viewTools,
  type PromptMark,
} from "robustness-core/data/graphProjectView.server";
import { marksNotCaptured, renderQuoteBlocks } from "robustness-core/data/syncGraph.server";

// The local Crouch Card for 2026-09-11, as synced: the HVAC spec that
// belongs to the Coronado ADU. One `##` section with a `###` inside it.
const CROUCH_0911 = `## hvac
System is mostly set, waiting on client approval for using a wall mounted ductless unit (potential visual concerns).  Took a deep dive&#x20;
- Indoor: MSZ-FX06NL-U1
- Outdoor: MUZ-FX06NLHZ-U1
ERV
Panasonic 11ES1 for the ERV.
### Ductwork for the ERV
Potential of sizing up to 8" ductwork from the ERV out for noise.
- 110 CFM in 8": about 315 FPM`;

const unit: MarkUnitSnapshot = {
  key: "bullet:abc:0",
  kind: "bullet",
  section: "On the bench",
  effort: "Austin · Mini-split and ERV spec · S",
  text: 'Now: "System is mostly set, waiting on client approval."',
  refs: [{ name: "austin@nopal.build", humanId: "admin_1", date: "2026-09-11", fileId: "7hth9b3eezqacscvt2ju" }],
  attachmentId: null,
};

describe("the marks file sync-graph reads", () => {
  const content = buildMarksFileContent([
    { unit, text: "The wall unit was approved on Friday." },
    { unit: { ...unit, kind: "heading", text: "Regroup", section: "Regroup", effort: "", refs: [] }, text: "Love this." },
  ]);

  it("keeps each mark's record in words: the passage, where it sat, whose day it cites", () => {
    expect(content).toContain('On the Efforts page, at the line "Now: "System is mostly set');
    expect(content).toContain("On the bench · Austin · Mini-split and ERV spec · S");
    expect(content).toContain("it cites austin@nopal.build's 2026-09-11 entry");
    expect(content).not.toMatch(/2026-09-11#\d/); // never a node id
  });

  it("gives sync-graph back only the marker's own words", () => {
    expect(parseMarkTexts(content)).toEqual(["The wall unit was approved on Friday.", "Love this."]);
  });

  it("is the same file every time for the same marks", () => {
    expect(buildMarksFileContent([{ unit, text: "x" }])).toBe(buildMarksFileContent([{ unit, text: "x" }]));
  });

  it("replaces a moved mark's own words with a trace that never names where it went", () => {
    const trace = moveTraceLine({
      authorName: "Austin T", date: "2026-09-11", section: "hvac",
      markerName: "Austin T", markedOn: "2026-09-18", status: "applied",
    });
    expect(trace).toContain('Austin T\'s 2026-09-11 entry, the section "hvac"');
    expect(trace).toContain("another project");
    expect(trace).not.toMatch(/Coronado/);
    // The marker names the project in their own words, so the words stay
    // out of this project's graph entirely and only the trace goes in.
    const file = buildMarksFileContent([], [trace]);
    expect(parseMarkTexts(file)).toEqual([]);
    expect(file).not.toMatch(/Coronado/);
  });

  it("is the whole file when a refile carried no words at all", () => {
    // Refiling your own entry from the margin needs no mark, so the trace
    // is the only thing that says the entry left. It has to stand on its
    // own in the file sync-graph reads.
    const trace = moveTraceLine({
      authorName: "Austin T", date: "2026-09-11", section: "hvac",
      markerName: "Austin T", markedOn: "2026-09-21", status: "applied",
    });
    const file = buildMarksFileContent([], [trace]);
    expect(file.trim()).toBe(trace);
    expect(parseMarkTexts(file)).toEqual([]);
  });

  it("says a request is a request, and still names nobody", () => {
    const asked = moveTraceLine({
      authorName: "Gerald L", date: "2026-09-11", section: "hvac",
      markerName: "Lucas J", markedOn: "2026-09-18", status: "requested",
    });
    expect(asked).toContain("Lucas J has asked its author to move it to another project");
  });

  it("says what kind of thought a mark sat on", () => {
    expect(markContextLine({ ...unit, kind: "photo", text: "" })).toMatch(/^On the Efforts page, at the photo \(/);
  });
});

describe("a mark on a file (2026-09-22): a person's act, recorded like any mark", () => {
  const fileUnit: MarkUnitSnapshot = {
    key: "file:airp11soh9796uf13xp8",
    kind: "file",
    section: "",
    effort: "",
    text: "IMG_6959.jpeg",
    refs: [{ name: "Lucas J", humanId: "admin_2", date: "2026-08-19", fileId: "7hth9b3eezqacscvt2ju" }],
    attachmentId: "airp11soh9796uf13xp8",
  };

  it("has a context line that names the file and the entry it came with", () => {
    expect(markContextLine(fileUnit)).toBe('On the file "IMG_6959.jpeg" (attached to Lucas J\'s 2026-08-19 entry):');
  });

  it("writes the tapped sentence in the person's name", () => {
    expect(fileActText({ kind: "file-as", fileKind: "receipt" })).toBe("Filed as receipt.");
    expect(
      fileActText({ kind: "confirm-cost", verdict: "correct", of: "h", vendor: "Ace Hardware", amount: "25.16", currency: "USD", date: "2026-06-19" }),
    ).toBe("Confirmed correct: Ace Hardware, 25.16 USD, 2026-06-19.");
    expect(fileActText({ kind: "confirm-cost", verdict: "accepted", of: "h", vendor: "ACME", amount: "10.00", currency: "USD", date: null })).toBe(
      "Accepted: ACME, 10.00 USD, no date.",
    );
  });

  it("is highlighted and guaranteed a node the way a page mark is", () => {
    const file = buildMarksFileContent([
      { unit, text: "The wall unit was approved on Friday." },
      { unit: fileUnit, text: "Confirmed correct: Ace Hardware, 25.16 USD, 2026-06-19." },
    ]);
    expect(parseMarkTexts(file)).toEqual(["The wall unit was approved on Friday.", "Confirmed correct: Ace Hardware, 25.16 USD, 2026-06-19."]);
    expect(marksNotCaptured([parseMarkTexts(file)], ["The wall unit was approved on Friday."])).toEqual([
      { text: "Confirmed correct: Ace Hardware, 25.16 USD, 2026-06-19.", sourceIndex: 0 },
    ]);
  });

  it("is a file mark by its missing page hash, and never a page mark", () => {
    expect(isPageMark({ page_hash: "abc" })).toBe(true);
    expect(isPageMark({ page_hash: null })).toBe(false);
  });
});

describe("ADR-012 for marks: only the marker's words are highlighted", () => {
  const texts = ["The wall unit was approved on Friday."];
  const predicate = (t: string) => isInsideMarkText(t, texts);

  it("highlights a quotation of the mark and nothing from the page", () => {
    const quote = renderQuoteBlocks(
      [
        { type: "paragraph", text: "The wall unit was approved on Friday." },
        { type: "paragraph", text: 'Now: "System is mostly set, waiting on client approval."' },
      ],
      predicate,
    );
    expect(quote).toBe('==The wall unit was approved on Friday.==\n\nNow: "System is mostly set, waiting on client approval."');
  });

  it("still highlights a Card's text exactly as before", () => {
    expect(renderQuoteBlocks([{ type: "paragraph", text: "rows on" }])).toBe("==rows on==");
    expect(renderQuoteBlocks([{ type: "paragraph", text: "rows on" }], false)).toBe("rows on");
  });

  it("reads a node's cited file", () => {
    expect(refLineFileId(':ref{name="A" datetime="2026-09-11T12:00:00Z" location="/vault?file=abc123" verbose="true"}')).toBe("abc123");
  });
});

describe("a mark always becomes a node", () => {
  const marks = ["The wall unit was approved on Friday.", "Do we have the birch plywood on site yet?"];

  it("names the marks the extraction passed over", () => {
    const captured = ['### Node 1\n==The wall unit was approved on Friday.==\n:ref{name="Lucas J"}'];
    expect(marksNotCaptured([marks], captured)).toEqual([
      { text: "Do we have the birch plywood on site yet?", sourceIndex: 0 },
    ]);
  });

  it("counts a mark as captured through highlighting, a setup line and rewrapping", () => {
    const captured = [
      '### Node 1\nAustin, on the page:\n\n==Do we have the birch\nplywood on site yet?==\n:ref{name="James W"}',
    ];
    expect(marksNotCaptured([["Do we have the birch plywood on site yet?"]], captured)).toEqual([]);
  });

  it("says nothing about a source that is not a marks file", () => {
    expect(marksNotCaptured([null, null], [])).toEqual([]);
  });

  it("carries the source index, so the node cites the right file", () => {
    expect(marksNotCaptured([null, ["Eaves started Monday."]], [])).toEqual([
      { text: "Eaves started Monday.", sourceIndex: 1 },
    ]);
  });
});

describe("refiling a misfiled chunk", () => {
  it("splits a Card into its ## sections and keeps ### inside them", () => {
    const chunks = cardChunks(CROUCH_0911);
    expect(chunks.map((c) => c.heading)).toEqual(["hvac"]);
    expect(chunks[0].text).toContain("### Ductwork for the ERV");
    expect(chunks[0].text).toBe(CROUCH_0911);
  });

  it("keeps an intro before the first ## as its own chunk", () => {
    const card = "Morning on site.\n\n## hvac\nspec\n## framing\nwalls";
    expect(cardChunks(card).map((c) => c.heading)).toEqual(["", "hvac", "framing"]);
  });

  it("takes one section out and leaves the rest as written", () => {
    const card = "## framing\nwalls up\n\n## hvac\nspec here\n### Ductwork\n6 inch";
    expect(removeChunk(card, { kind: "section", heading: "HVAC", occurrence: 0 })).toBe("## framing\nwalls up");
  });

  it("empties the Card when the whole entry moves, and keeps the card itself", () => {
    expect(removeChunk(CROUCH_0911, { kind: "whole", heading: "", occurrence: 0 })).toBe("");
    expect(removeChunk(CROUCH_0911, { kind: "section", heading: "hvac", occurrence: 0 })).toBe("");
  });

  it("moves the words verbatim into the other project's Card", () => {
    const chunk = findChunk(CROUCH_0911, { kind: "section", heading: "hvac", occurrence: 0 })!.text;
    expect(chunk).toBe(CROUCH_0911);
    expect(addChunk("", chunk)).toBe(CROUCH_0911);
    expect(addChunk("## site\nslab poured", chunk)).toBe(`## site\nslab poured\n\n${CROUCH_0911}`);
  });

  it("changes nothing when the section is not there", () => {
    expect(removeChunk("## a\nx", { kind: "section", heading: "missing", occurrence: 0 })).toBe("## a\nx");
  });

  it("tells two sections with the same heading apart", () => {
    const card = "## notes\nfirst\n## notes\nsecond";
    expect(cardChunks(card).map((c) => c.occurrence)).toEqual([0, 1]);
    expect(removeChunk(card, { kind: "section", heading: "notes", occurrence: 1 })).toBe("## notes\nfirst");
    expect(findChunk(card, { kind: "section", heading: "notes", occurrence: 1 })!.text).toBe("## notes\nsecond");
  });
});

describe("putting a refiled entry back", () => {
  const moved = "## hvac\nMitsubishi MSZ-FX06NL-U1.";

  it("takes out only the words that moved, leaving what was already there", () => {
    // The destination usually has its own day. Asking for "the chunk"
    // there would take the whole Card, which is how an undo duplicates or
    // deletes somebody else's writing.
    expect(removeExactText(`## site\nSlab poured.\n\n${moved}`, moved)).toBe("## site\nSlab poured.");
    expect(removeExactText(`${moved}\n\n## site\nSlab poured.`, moved)).toBe("## site\nSlab poured.");
    expect(removeExactText(moved, moved)).toBe("");
  });

  it("leaves behind what somebody added there, because they wrote it there", () => {
    expect(removeExactText(`${moved}\n\nApproved Friday.`, moved)).toBe("Approved Friday.");
  });

  it("refuses when the moved words themselves were edited, rather than guessing", () => {
    expect(removeExactText("## hvac\nMitsubishi MSZ-FX06NL-U2.", moved)).toBeNull();
    expect(removeExactText("## site\nSlab poured.", moved)).toBeNull();
  });
});

describe("which project a mark names", () => {
  const projects = [
    { _id: "crouch", name: "Crouch Casita" },
    { _id: "coronado", name: "Coronado ADU" },
    { _id: "cor2", name: "Coronado Garage" },
    { _id: "ono", name: "O.No" },
  ];
  it("matches exactly, then by a unique part of the name", () => {
    expect(matchProject(projects, "o.no", "crouch")?._id).toBe("ono");
    expect(matchProject(projects, "Coronado ADU", "crouch")?._id).toBe("coronado");
    expect(matchProject(projects, "adu", "crouch")?._id).toBe("coronado");
  });
  it("never guesses between two, and never picks the project it came from", () => {
    expect(matchProject(projects, "Coronado", "crouch")).toBeNull();
    expect(matchProject(projects, "Crouch", "crouch")).toBeNull();
    expect(matchProject(projects, "", "crouch")).toBeNull();
  });
});

describe("a page run with no marks sees exactly what it always did", () => {
  it("offers the same tools, the same array", () => {
    expect(viewTools(false)).toBe(viewTools(false));
    expect(viewTools(false).map((t) => t.name)).toEqual(["update_section", "remove_section", "describe_effort", "get_node"]);
    expect(viewTools(true).map((t) => t.name)).toEqual([
      "update_section",
      "remove_section",
      "describe_effort",
      "get_node",
      "read_mark",
      "propose_move",
    ]);
  });

  it("asks for the name to come off only when the page says it", () => {
    const base = { readmeContent: "# Crouch\n\nThe spec is Coronado ADU's.", unstampedComments: [] };
    expect(buildUserPrompt({ ...base, namedProject: null })).toBe(buildUserPrompt(base));
    const asked = buildUserPrompt({ ...base, namedProject: "Coronado ADU" });
    expect(asked).toContain('This page names another project ("Coronado ADU")');
    expect(asked).toContain("logged here by mistake and belongs to another project");
  });

  it("builds the same prompts with no marks and with an empty list", () => {
    const base = { readmeContent: "---\nx: 1\n---\n# Crouch\n\nThe read.", unstampedComments: [] };
    expect(buildUserPrompt({ ...base, marks: [] })).toBe(buildUserPrompt(base));
    const targeted = { ...base, uncited: [], uncitedNodeText: null, cutOff: null };
    expect(buildTargetedUserPrompt({ ...targeted, marks: [] })).toBe(buildTargetedUserPrompt(targeted));
    expect(buildUserPrompt(base)).not.toMatch(/mark/i);
  });

  it("adds the marks block only when there are marks", () => {
    const mark: PromptMark = {
      id: "m1",
      authorName: "Lucas J",
      date: "2026-09-18",
      unitKind: "line",
      unitText: unit.text,
      section: unit.section,
      effort: unit.effort,
      cites: [{ label: "austin@nopal.build's 2026-09-11 entry", fileId: "7hth9b3eezqacscvt2ju", sections: ["hvac"] }],
      earlierVersion: false,
      text: "The wall unit was approved.\nRob said yes.",
    };
    const prompt = buildUserPrompt({ readmeContent: "# Crouch", unstampedComments: [], marks: [mark] });
    expect(prompt).toContain(buildMarksBlock([mark]));
    expect(prompt).toContain("mark:m1 · Lucas J · 2026-09-18");
    expect(prompt).toContain('[file 7hth9b3eezqacscvt2ju; its sections: "hvac"]');
    expect(prompt).toContain("Their words: The wall unit was approved. / Rob said yes.");
  });
});
