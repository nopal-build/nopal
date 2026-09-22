// Regression tests for GraphLog's load-bearing behaviors (see 1.5 /
// docs/adr/ — kept out of the public repo, but each test below is named
// after the ADR it guards so the connection survives without the file).
//
// These exist so a future "harmless-looking" simplification (a link cap
// read as a knob, an author UNION replaced with a SUM, a heavier-but-
// unblocked thread beating a blocked one) fails loudly here instead of
// silently drifting in production, which is how every one of these
// behaviors would otherwise break.

import { afterEach, describe, it, expect } from "vitest";
import {
  capNodeLinks,
  listSplitBounce,
  MAX_LINKS_PER_NODE,
  classifyPassEnding,
  buildGraphLogContent,
  existingSourceHash,
  readSourceHash,
  stripDayFromStructure,
  unresolvedContributorIds,
  contributorNameOrThrow,
} from "robustness-core/data/syncGraph.server";
import {
  computeBacklinkIndex,
  extractDatesFromText,
  parseGraphLogNodes,
  stripRefVerbose,
  type GraphLogNode,
} from "robustness-core/data/graphNodeIndex.server";
import {
  sortClustersByWeight,
  parseClusterFields,
  pruneStaleMembership,
  hasFallenAway,
  withoutProjectViewMarker,
  summarizeClusterFields,
  refreshClusterWeight,
  reviewClusterWrite,
  MAX_NODES_PER_THREAD,
} from "robustness-core/data/graphStructure.server";
import {
  buildSystemPrompt,
  buildTargetedUserPrompt,
  buildUserPrompt,
  classifyViewPassEnding,
  computeCoverageReport,
  contentCarriesHeading,
  countCitations,
  coverageFromJobResult,
  describeUncited,
  extractReaderComments,
  introShouldWait,
  parseSectionShape,
  reorderSections,
  requiredThreads,
  resolveSectionOrder,
  unknownHeadings,
  type UncitedThread,
  readmeChangedFromJobResult,
} from "robustness-core/data/graphProjectView.server";
import {
  classifyStageSkill,
  composeStageSkill,
  isSkipInstruction,
  readSkillFingerprint,
  RESERVED_SKILL_FILE_NAMES,
  SKILL_FILE_NAMES,
  withVoiceFirst,
} from "robustness-core/data/projectN02.server";
import { DEFAULT_PROJECT_VIEW_SKILL } from "robustness-core/data/graphLogDefaults.server";
import {
  README_INCOMPLETE_BANNER_PREFIX,
  splitReadmeSections,
  stripIncompleteBanner,
  withIncompleteBanner,
  type ReadmeSection,
} from "robustness-core/data/project.types";
import { completedToolCalls, cutOffHeading, cutOffSourceIndex, headingText, planTurnToolCalls } from "robustness-core/data/llmProvider";
import { modelForStage } from "robustness-core/data/anthropicProvider.server";
import {
  formatSeconds,
  frameTimestamps,
  isHeicContentType,
  isVideoContentType,
  parseFfmpegDuration,
} from "robustness-core/data/attachmentFrames.server";

// ── Helpers ─────────────────────────────────────────────────────────────

function node(id: string, links: { date: string; number: number }[] = [], authorName = "Author"): GraphLogNode {
  const [date, number] = id.split("#");
  return {
    id,
    date,
    number: Number(number),
    quote: "",
    authorName,
    authorHumanId: null,
    refLine: `:ref{name="${authorName}" datetime="${date}T12:00:00Z" location="/x" verbose="true"}`,
    links: links.map((l) => ({ date: l.date, number: l.number })),
  };
}

function cluster(heading: string, weightLine: string, nodeIds: string[]): ReadmeSection {
  const lines = [weightLine, ...nodeIds.map((id) => {
    const [date, number] = id.split("#");
    return `- ${date} Node ${number} (Someone) — a gloss`;
  })];
  return { heading, content: lines.join("\n") };
}

// ── ADR-002 — a node may link to at most three others ───────────────────

describe("ADR-002: the three-link cap", () => {
  it("never lets a node end up with more than MAX_LINKS_PER_NODE links", () => {
    const { sameDay, backward, droppedCount } = capNodeLinks([1, 2, 3, 4, 5], []);
    expect(sameDay.length + backward.length).toBeLessThanOrEqual(MAX_LINKS_PER_NODE);
    expect(sameDay).toEqual([1, 2, 3]);
    expect(droppedCount).toBe(2);
  });

  it("keeps same-day links first when both kinds are offered", () => {
    const { sameDay, backward, droppedCount } = capNodeLinks([1, 2], ["2026-07-29#1", "2026-07-29#2"]);
    expect(sameDay).toEqual([1, 2]);
    expect(backward).toEqual(["2026-07-29#1"]);
    expect(droppedCount).toBe(1);
  });

  it("drops nothing when already within the cap", () => {
    const { sameDay, backward, droppedCount } = capNodeLinks([1], ["2026-07-29#1"]);
    expect(sameDay.length + backward.length).toBe(2);
    expect(droppedCount).toBe(0);
  });
});

// ── ADR-003 — rank by distinct people before raw link count ─────────────

describe("ADR-003: distinct authors before raw count", () => {
  it("computeBacklinkIndex counts distinct authors, not raw links", () => {
    const allNodes: GraphLogNode[] = [
      node("2026-08-01#1"), // target: 3 links from ONE author
      node("2026-08-02#1", [{ date: "2026-08-01", number: 1 }], "Alice"),
      node("2026-08-03#1", [{ date: "2026-08-01", number: 1 }], "Alice"),
      node("2026-08-04#1", [{ date: "2026-08-01", number: 1 }], "Alice"),

      node("2026-08-01#2"), // target: 2 links from TWO distinct authors
      node("2026-08-02#2", [{ date: "2026-08-01", number: 2 }], "Alice"),
      node("2026-08-03#2", [{ date: "2026-08-01", number: 2 }], "Bob"),
    ];
    const backlinks = computeBacklinkIndex(allNodes);
    const oneAuthor = backlinks.get("2026-08-01#1")!;
    const twoAuthors = backlinks.get("2026-08-01#2")!;
    expect(oneAuthor.count).toBe(3);
    expect(oneAuthor.fromAuthorIds.size).toBe(1);
    expect(twoAuthors.count).toBe(2);
    expect(twoAuthors.fromAuthorIds.size).toBe(2);
  });

  it("a two-author thread ranks above a heavier one-author thread", () => {
    const backlinks = computeBacklinkIndex([
      node("2026-08-01#1"),
      node("2026-08-02#1", [{ date: "2026-08-01", number: 1 }], "Alice"),
      node("2026-08-03#1", [{ date: "2026-08-01", number: 1 }], "Alice"),
      node("2026-08-04#1", [{ date: "2026-08-01", number: 1 }], "Alice"),

      node("2026-08-01#2"),
      node("2026-08-02#2", [{ date: "2026-08-01", number: 2 }], "Alice"),
      node("2026-08-03#2", [{ date: "2026-08-01", number: 2 }], "Bob"),
    ]);
    const sections = [
      cluster("Three from one author", "Weight: (recomputed) · Status: active", ["2026-08-01#1"]),
      cluster("Two from two authors", "Weight: (recomputed) · Status: active", ["2026-08-01#2"]),
    ];
    const sorted = sortClustersByWeight(sections, backlinks);
    expect(sorted.map((s) => s.heading)).toEqual(["Two from two authors", "Three from one author"]);
  });
});

// ── ADR-015 — a node names its author; counts key on the id ─────────────
//
// The failure this guards ran end to end without erroring: a contributor
// with no local `humans` row resolved to the literal "Unknown" at write
// time, so EVERY such contributor became the same author, and the two
// places that count people counted one.

describe("ADR-015: a node must name its author", () => {
  it("counts two ided-but-unnamed authors as two people, not one", () => {
    // Both names absent -- exactly the state a degraded pull produces.
    // Keyed on the name, this set is size 1 and the whole ADR-003 ranking
    // below it goes flat. Keyed on the id, it is 2.
    const unnamed = (id: string, humanId: string, links: { date: string; number: number }[]): GraphLogNode => {
      const [date, number] = id.split("#");
      return {
        id, date, number: Number(number), quote: "",
        authorName: null, authorHumanId: humanId,
        refLine: `:ref{name="" human-id="${humanId}" datetime="${date}T12:00:00Z" location="/x"}`,
        links,
      };
    };
    const target = { date: "2026-08-01", number: 1 };
    const backlinks = computeBacklinkIndex([
      node("2026-08-01#1"),
      unnamed("2026-08-02#1", "human_a", [target]),
      unnamed("2026-08-03#1", "human_b", [target]),
    ]);
    expect(backlinks.get("2026-08-01#1")!.fromAuthorIds.size).toBe(2);
  });

  it("never merges two authors with neither an id nor a name", () => {
    const anonymous = (id: string, links: { date: string; number: number }[]): GraphLogNode => {
      const [date, number] = id.split("#");
      return {
        id, date, number: Number(number), quote: "",
        authorName: null, authorHumanId: null, refLine: ":ref{}", links,
      };
    };
    const target = { date: "2026-08-01", number: 1 };
    const backlinks = computeBacklinkIndex([
      node("2026-08-01#1"),
      anonymous("2026-08-02#1", [target]),
      anonymous("2026-08-03#1", [target]),
    ]);
    expect(backlinks.get("2026-08-01#1")!.fromAuthorIds.size).toBe(2);
  });

  it("still shows real names where names are what is displayed", () => {
    const backlinks = computeBacklinkIndex([
      node("2026-08-01#1"),
      node("2026-08-02#1", [{ date: "2026-08-01", number: 1 }], "Alice"),
      node("2026-08-03#1", [{ date: "2026-08-01", number: 1 }], "Bob"),
    ]);
    expect([...backlinks.get("2026-08-01#1")!.fromAuthorNames].sort()).toEqual(["Alice", "Bob"]);
  });

  it("reports a known contributor id with no humans row as unresolved", () => {
    const known = new Map([["human_a", "Alice"]]);
    expect(unresolvedContributorIds(["human_a", "human_b"], known)).toEqual(["human_b"]);
    // A row with a BLANK name names nobody either -- `name=""` in a
    // citation is the same lie as "Unknown", just quieter.
    expect(unresolvedContributorIds(["human_c"], new Map([["human_c", "   "]]))).toEqual(["human_c"]);
    expect(unresolvedContributorIds(["human_a"], known)).toEqual([]);
  });

  it("raises rather than producing a node for a known id with no row", () => {
    const known = new Map([["human_a", "Alice"]]);
    expect(contributorNameOrThrow("human_a", known)).toBe("Alice");
    expect(() => contributorNameOrThrow("human_b", known)).toThrow(/humans:human_b/);
    // The point of the throw: no placeholder ever reaches a `:ref{}`.
    expect(() => contributorNameOrThrow("human_b", known)).not.toThrow(/Unknown/);
  });
});

// ── ADR-007 — Blocking names a consequence, never a rating ──────────────

describe("ADR-007: Blocking/Due must carry a real value", () => {
  it("treats a filled-in Due/Blocking as present", () => {
    const section = cluster(
      "Real thing",
      "Weight: (recomputed) · Status: active · Due: 2026-09-01 · Blocking: client onboarding",
      [],
    );
    const fields = parseClusterFields(section);
    expect(fields.hasDue).toBe(true);
    expect(fields.hasBlocking).toBe(true);
  });

  it("does not treat a leftover template placeholder as a real value", () => {
    const section = cluster(
      "Placeholder leftover",
      "Weight: (recomputed) · Status: active · Due: <date> · Blocking: <what it holds up>",
      [],
    );
    const fields = parseClusterFields(section);
    expect(fields.hasDue).toBe(false);
    expect(fields.hasBlocking).toBe(false);
  });
});

// ── ADR-008 — the structure file's order serves the next stages ─────────

describe("ADR-008: Blocking/Due outrank accumulated weight", () => {
  it("a thread carrying Blocking outranks a heavier thread that carries none", () => {
    // "Heavy" has real weight (three linking nodes); "Blocked" has none,
    // but names a real consequence.
    const heavyId = "2026-01-01#1";
    const backlinks = computeBacklinkIndex([
      node(heavyId),
      node("2026-01-02#1", [{ date: "2026-01-01", number: 1 }], "Alice"),
      node("2026-01-03#1", [{ date: "2026-01-01", number: 1 }], "Bob"),
      node("2026-01-04#1", [{ date: "2026-01-01", number: 1 }], "Carol"),
    ]);
    const sections = [
      cluster("Heavy but unblocked", "Weight: (recomputed) · Status: active", [heavyId]),
      cluster("Blocking real work", "Weight: (recomputed) · Status: active · Blocking: client onboarding", []),
    ];
    const sorted = sortClustersByWeight(sections, backlinks);
    expect(sorted.map((s) => s.heading)).toEqual(["Blocking real work", "Heavy but unblocked"]);
  });

  it("never drops a section — only reorders (ADR-004: quiet threads stay reachable)", () => {
    const sections = [
      cluster("A", "Weight: (recomputed) · Status: dormant", []),
      cluster("B", "Weight: (recomputed) · Status: active", []),
      { heading: "Unclustered", content: "Weight: (recomputed) · Status: active" },
    ];
    const sorted = sortClustersByWeight(sections, new Map());
    expect(sorted.map((s) => s.heading).sort()).toEqual(["A", "B", "Unclustered"].sort());
    // Unclustered always sorts last, regardless of weight.
    expect(sorted[sorted.length - 1].heading).toBe("Unclustered");
  });
});

// ── ADR-009 — silence drops a project thread ─────────────────────────────

describe("ADR-009: falling away", () => {
  it("a dormant thread with no Due/Blocking has fallen away", () => {
    const section = cluster("Quiet thread", "Weight: (recomputed) · Status: dormant", []);
    expect(hasFallenAway(section)).toBe(true);
  });

  it("a dormant thread that still names a Blocking does NOT fall away", () => {
    const section = cluster(
      "Quiet but blocking",
      "Weight: (recomputed) · Status: dormant · Blocking: the launch",
      [],
    );
    expect(hasFallenAway(section)).toBe(false);
  });

  it("an active thread never counts as fallen away", () => {
    const section = cluster("Live thread", "Weight: (recomputed) · Status: active", []);
    expect(hasFallenAway(section)).toBe(false);
  });
});

// ── extractDatesFromText — feeds the "dates found in a thread's own
// text" fact `graph-structure.md` now receives ──────────────────────────

describe("extractDatesFromText", () => {
  it("finds ISO dates", () => {
    expect(extractDatesFromText("shipping by 2026-09-01 for sure")).toContain("2026-09-01");
  });

  it("finds a month-name date", () => {
    expect(extractDatesFromText("let's talk again August 20")).toContain("August 20");
  });
});

// ── reset-project-view must be able to undo itself ──────────────────────
//
// Both idempotency markers live on `graph-structure.md`'s front matter,
// and `resetProjectView` deliberately leaves the `graph` folder alone. So
// clearing the README alone left `appliedByProjectView` still matching
// `asOfGraphHash`, `graph-project-view` skipped the very next run as
// "up to date", and the README stayed empty indefinitely -- a reset whose
// entire purpose is rebuilding the view, guaranteeing it could never be
// rebuilt. This was a live failure, not a reading of the code.
//
// The trap for a future edit is that dropping BOTH markers looks tidier
// and also "works": it just silently makes a project-view reset re-run
// the whole graph-structure stage as well.

describe("a stage's skill is fingerprinted, stamped, and reported, never a cache key", () => {
  // Every stage decides "up to date" from a hash of its inputs that never
  // includes the skill, so a rewritten skill produces nothing for
  // existing output (Crouch Casita, 2026-09-15). The fingerprint is
  // taken over exactly the text the model reads, stamped on what the
  // stage writes, and compared to report drift; a rebuild is a person's
  // choice (rerun-outputs, reset-graph), never automatic.
  const extras = [{ name: "VOICE.md", content: "Write plainly." }];

  it("reads the stamp back from a written file, and null from an unstamped one", () => {
    const stamped = buildGraphLogContent({ date: "2026-09-15", hash: "abc", body: "### Node 1\n:ref{}", skillFingerprint: "feedfacefeedface" });
    expect(readSkillFingerprint(stamped)).toBe("feedfacefeedface");
    expect(stamped).toContain("sourceHash: abc");
    const unstamped = buildGraphLogContent({ date: "2026-09-15", hash: "abc", body: "### Node 1\n:ref{}" });
    expect(readSkillFingerprint(unstamped)).toBeNull();
    expect(unstamped).not.toContain("skillFingerprint");
    expect(readSkillFingerprint("no front matter here")).toBeNull();
  });

  it("stamping never changes the source hash a day is judged current by", () => {
    const a = buildGraphLogContent({ date: "2026-09-15", hash: "abc", body: "x", skillFingerprint: "1111111111111111" });
    const b = buildGraphLogContent({ date: "2026-09-15", hash: "abc", body: "x", skillFingerprint: "2222222222222222" });
    expect(readSourceHash(a).hash).toBe("abc");
    expect(readSourceHash(b).hash).toBe("abc");
  });

  it("is stable for the same instructions", () => {
    const a = composeStageSkill("Do the thing.", "General.", extras);
    const b = composeStageSkill("Do the thing.", "General.", extras);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the stage skill, the general skill, or an extra file changes", () => {
    const base = composeStageSkill("Do the thing.", "General.", extras).fingerprint;
    expect(composeStageSkill("Do the thing, but thinner.", "General.", extras).fingerprint).not.toBe(base);
    expect(composeStageSkill("Do the thing.", "General, revised.", extras).fingerprint).not.toBe(base);
    expect(
      composeStageSkill("Do the thing.", "General.", [{ name: "VOICE.md", content: "Write tersely." }]).fingerprint,
    ).not.toBe(base);
  });

  it("composes the same prompt text the stages used to build inline", () => {
    const { content } = composeStageSkill("Stage.", null, extras);
    expect(content).toBe("Stage.\n\n## VOICE.md\n\nWrite plainly.");
  });

  // VOICE.md reaches one stage (graph-project-view) through
  // `withVoiceFirst`, and no stage through `listExtraSkillFiles`: every
  // seeded file name is reserved, and so is the pre-rename PROJECT_VIEW.md,
  // or a project not yet reseeded would feed its old README skill into
  // all four stages as an extra.
  it("the voice file is composed first into the view stage and is never an extra", () => {
    const { content } = composeStageSkill("Efforts.", "General.", withVoiceFirst("Plainly.", extras));
    expect(content).toBe("Efforts.\n\nGeneral.\n\n## VOICE.md\n\nPlainly.\n\n## VOICE.md\n\nWrite plainly.");
    expect(withVoiceFirst(null, extras)).toBe(extras);
    expect(withVoiceFirst("   ", extras)).toBe(extras);
    for (const name of Object.values(SKILL_FILE_NAMES)) expect(RESERVED_SKILL_FILE_NAMES.has(name.toLowerCase())).toBe(true);
    expect(RESERVED_SKILL_FILE_NAMES.has("project_view.md")).toBe(true);
    expect(RESERVED_SKILL_FILE_NAMES.has("skill.md")).toBe(true);
  });
});

describe("reset-project-view clears the applied marker and nothing else", () => {
  const content = [
    "---",
    "asOfGraphHash: abc123",
    "generatedAt: 2026-08-27T00:00:00.000Z",
    "skillFingerprint: feedfacefeedface",
    "appliedByProjectView: abc123",
    "appliedSkillFingerprint: 0123456789abcdef",
    "---",
    "",
    "## A thread",
    "Weight: 3 · Status: active",
  ].join("\n");

  it("drops appliedByProjectView and its skill fingerprint together", () => {
    const out = withoutProjectViewMarker(content);
    expect(out).not.toBeNull();
    expect(out).not.toContain("appliedByProjectView");
    expect(out).not.toContain("appliedSkillFingerprint");
  });

  it("leaves asOfGraphHash, generatedAt and graph-structure's own skillFingerprint alone", () => {
    const out = withoutProjectViewMarker(content)!;
    expect(out).toContain("asOfGraphHash: abc123");
    expect(out).toContain("generatedAt: 2026-08-27T00:00:00.000Z");
    expect(out).toContain("skillFingerprint: feedfacefeedface");
  });

  it("leaves the body untouched", () => {
    const out = withoutProjectViewMarker(content)!;
    expect(out).toContain("## A thread");
    expect(out).toContain("Weight: 3 · Status: active");
  });

  it("reports nothing to do when the marker was never set", () => {
    const never = ["---", "asOfGraphHash: abc123", "---", "", "## A thread"].join("\n");
    expect(withoutProjectViewMarker(never)).toBeNull();
  });
});

// ── ADR-013 — the runaway-loop guard must never be the content limit ────
//
// The per-turn write throttle is the enforcement half of that. Every tool
// call in one response is generated into that response's SINGLE output
// budget, and a write call's input carries real content, so several writes
// in one turn is several pieces of content against one `max_tokens`. This
// truncated a real `sync-graph` day, and later a real `graph-structure`
// batch at six `update_cluster` calls in one turn.
//
// The trap: this looks like needless serialization of calls the provider
// was happy to return together, and removing it makes runs finish in fewer
// turns. It does, right up until a graph gets large enough that one turn
// overflows, and then a whole batch (or a whole day of somebody's writing)
// is discarded. Reads are deliberately NOT throttled.

describe("ADR-013: at most one write call executed per turn", () => {
  const isWrite = (name: string) => name === "update_cluster" || name === "remove_cluster";

  it("executes the first write and rejects the rest", () => {
    const plan = planTurnToolCalls(
      [{ name: "update_cluster" }, { name: "update_cluster" }, { name: "remove_cluster" }],
      isWrite,
    );
    expect(plan.map((p) => p.execute)).toEqual([true, false, false]);
  });

  it("never throttles reads, however many arrive together", () => {
    const plan = planTurnToolCalls(
      [{ name: "get_node" }, { name: "get_node" }, { name: "get_node" }],
      isWrite,
    );
    expect(plan.every((p) => p.execute)).toBe(true);
  });

  it("lets reads through alongside the one permitted write", () => {
    const plan = planTurnToolCalls(
      [{ name: "get_node" }, { name: "update_cluster" }, { name: "get_node" }, { name: "update_cluster" }],
      isWrite,
    );
    expect(plan.map((p) => p.execute)).toEqual([true, true, true, false]);
  });

  it("rejects rather than drops -- every call still comes back for a tool result", () => {
    const calls = [{ name: "update_cluster" }, { name: "update_cluster" }];
    expect(planTurnToolCalls(calls, isWrite)).toHaveLength(calls.length);
  });

  it("throttles every call when every tool is a write (sync-graph's add_node)", () => {
    const plan = planTurnToolCalls([{ name: "add_node" }, { name: "add_node" }], () => true);
    expect(plan.map((p) => p.execute)).toEqual([true, false]);
  });
});

// ── ADR-006 — a node made it in iff its own :ref line is in the README ──
//
// The coverage report used to decide a thread was missing by substring-
// matching the thread's HEADING against the README. The model is told to
// write in its own voice with its own headings, so a thoroughly covered
// thread reported as missing on nearly every run, and a report that cries
// wolf every run is worse than no report.
//
// The trap for a future edit: the heading test is cheaper and needs no
// node map, so it reads like a harmless simplification. It measures a
// different thing.

describe("ADR-006: coverage is measured by citation, not by heading", () => {
  const REF = ':ref{name="Gerald L" datetime="2026-08-26T12:00:00Z" location="/x"}';

  function nodeWithRef(id: string, refLine: string, quote = ""): GraphLogNode {
    const [date, number] = id.split("#");
    return {
      id, date, number: Number(number), quote,
      authorName: "Gerald L", authorHumanId: null, refLine, links: [],
    };
  }

  const structure = ['## Scheduling', 'Weight: 1 · Status: active', '- 2026-08-26 Node 1 (Gerald L) — a gloss'].join("\n");

  it("counts a thread as covered when its node is cited, even under a different heading", () => {
    const readme = `## What we decided this week\n\nSomething happened. ${REF}\n`;
    const report = computeCoverageReport(structure, readme, new Map([["2026-08-26#1", nodeWithRef("2026-08-26#1", REF)]]));
    expect(report.missingThreads).toEqual([]);
  });

  it("counts a thread as missing when the heading appears but no node is cited", () => {
    const readme = "## Scheduling\n\nWe talked about scheduling.\n";
    const report = computeCoverageReport(structure, readme, new Map([["2026-08-26#1", nodeWithRef("2026-08-26#1", REF)]]));
    expect(report.missingThreads.map((t) => t.heading)).toEqual(["Scheduling"]);
  });

  it("matches across render modes -- a verbose graph-log ref cited inline still counts", () => {
    const verboseRef = ':ref{name="Gerald L" datetime="2026-08-26T12:00:00Z" location="/x" verbose="true"}';
    const readme = `## Anything\n\nA sentence. ${REF}\n`;
    const report = computeCoverageReport(structure, readme, new Map([["2026-08-26#1", nodeWithRef("2026-08-26#1", verboseRef)]]));
    expect(report.missingThreads).toEqual([]);
  });

  it("only reports a dropped file for a node that was actually featured", () => {
    const image = "![a photo](/api/vault/view/abc123)";
    const nodes = new Map([["2026-08-26#1", nodeWithRef("2026-08-26#1", REF, image)]]);
    // Not featured: its ref isn't in the README, so its file was never
    // being carried in and is not a miss.
    expect(computeCoverageReport(structure, "## Anything\n\nNo citations.\n", nodes).missingFiles).toEqual([]);
    // Featured but the image was dropped: that IS a miss.
    expect(
      computeCoverageReport(structure, `## Anything\n\nA sentence. ${REF}\n`, nodes).missingFiles,
    ).toEqual(["2026-08-26#1 (Scheduling)"]);
  });
});

// ── The judged-field counter, and the Weight line code owns ─────────────

describe("summarizeClusterFields counts what the model judged", () => {
  it("counts each status and the two mattering fields", () => {
    const sections = [
      cluster("A", "Weight: 1 · Status: active", []),
      cluster("B", "Weight: 1 · Status: dormant", []),
      cluster("C", "Weight: 1 · Status: settled, 2026-08-01", []),
      cluster("D", "Weight: 1 · Status: active · Due: 2026-09-01 · Blocking: the handoff", []),
    ];
    expect(summarizeClusterFields(sections)).toBe(
      "active 2, dormant 1, settled 1, superseded 0; Due 1, Blocking 1",
    );
  });
});

describe("refreshClusterWeight writes the Weight line when it is absent", () => {
  it("inserts one rather than skipping the cluster", () => {
    const section: ReadmeSection = { heading: "No weight line", content: "- 2026-08-26 Node 1 (Someone) — a gloss" };
    const out = refreshClusterWeight(section, new Map());
    expect(out.content.split("\n")[0]).toMatch(/^Weight: /);
    expect(out.content).toContain("- 2026-08-26 Node 1 (Someone) — a gloss");
  });

  it("preserves an existing Status suffix while replacing the numbers", () => {
    const section = cluster("Has one", "Weight: 99 inbound links, 9 people, 2020-01-01 → 2020-01-02 · Status: dormant", []);
    const out = refreshClusterWeight(section, new Map());
    expect(out.content).toContain("· Status: dormant");
    expect(out.content).not.toContain("99 inbound links");
  });
});

// ── ADR-013 / ADR-011 — a day is never discarded ────────────────────────
//
// This is the one place in the pipeline that can lose a person's actual
// writing, and it did. With one node added per turn, MAX_TURNS and "how
// many nodes a day may hold" were the same number, and a day that reached
// it had every node discarded before the write, logged as a retryable
// error, and retried into the identical wall forever.
//
// A day is now a loop of passes. These guard the two halves of that: the
// loop must be able to tell a FINISHED day from a STUCK one (both look
// like "a pass captured nothing"), and a day that ends early must still be
// written in a form that comes back.

describe("ADR-013: a pass ending is classified, not collapsed", () => {
  const base = { passesCompleted: 1, maxPasses: 8, maxTurns: 30 };

  it("keeps going while a pass is still productive", () => {
    expect(classifyPassEnding({ ...base, added: 4, truncated: false, hitMaxTurns: false }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("a productive pass that filled its turns is NOT a failure -- that is a full pass", () => {
    expect(classifyPassEnding({ ...base, added: 29, truncated: false, hitMaxTurns: true }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("stops clean when a pass adds nothing -- the sources are exhausted", () => {
    expect(classifyPassEnding({ ...base, added: 0, truncated: false, hitMaxTurns: false }))
      .toEqual({ stop: true, shortfall: null });
  });

  it("distinguishes STUCK from FINISHED, though both captured nothing", () => {
    const finished = classifyPassEnding({ ...base, added: 0, truncated: false, hitMaxTurns: false });
    const stuck = classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false });
    expect(finished.shortfall).toBeNull();
    expect(stuck.shortfall).not.toBeNull();
  });

  it("a cut-off pass that still captured a node is PRODUCTIVE, not stuck", () => {
    // The salvage case: a batched turn overran the limit, one complete
    // call was executed before the pass ended. The day keeps going and
    // the next pass picks up the rest; nothing here is a shortfall.
    expect(classifyPassEnding({ ...base, added: 1, truncated: true, hitMaxTurns: false, cutOffSource: 2 }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("a stuck pass says whether the model was mid-node or never started one", () => {
    // Two different next moves hide behind "cut off": mid-node is a size
    // problem, never-started is a prompt problem. The message has to
    // separate them or the person reading the run page cannot.
    const midNode = classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false, cutOffSource: 3 });
    expect(midNode.shortfall).toBe(
      "a pass was cut off by the model's own output limit while writing a node for Source 3, before capturing anything",
    );
    const neverStarted = classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false, cutOffSource: null });
    expect(neverStarted.shortfall).toBe(
      "a pass was cut off by the model's own output limit before it started any node",
    );
    // Callers that predate the field get the never-started wording, not a crash.
    expect(classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false }).shortfall)
      .toContain("before it started any node");
  });

  it("a stuck pass that thought to the limit says so", () => {
    // The shape a real day was lost to: thinking is on by default, its
    // tokens count against max_tokens, and the turn returned neither text
    // nor a call. "Before it started any node" was true and useless; the
    // fix for this is room to think or less effort, not a smaller node.
    const thought = classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false, cutOffSource: null, cutOffThinking: true });
    expect(thought.shortfall).toBe(
      "a pass was cut off by the model's own output limit after spending the whole limit thinking, before it started any node",
    );
    // A known source outranks the thinking wording: mid-node is mid-node.
    const midNode = classifyPassEnding({ ...base, added: 0, truncated: true, hitMaxTurns: false, cutOffSource: 2, cutOffThinking: true });
    expect(midNode.shortfall).toContain("while writing a node for Source 2");
  });

  it("reports the cap as a shortfall only when the last pass was still productive", () => {
    const atCapProductive = classifyPassEnding({ ...base, passesCompleted: 8, added: 5, truncated: false, hitMaxTurns: false });
    expect(atCapProductive).toEqual({ stop: true, shortfall: "still finding new nodes after 8 passes" });

    const atCapDone = classifyPassEnding({ ...base, passesCompleted: 8, added: 0, truncated: false, hitMaxTurns: false });
    expect(atCapDone.shortfall).toBeNull();
  });
});

describe("ADR-011: a partial day is written, and comes back", () => {
  const body = "### Node 1\nsomething someone wrote";

  it("a complete day stores its sourceHash", () => {
    const content = buildGraphLogContent({ date: "2026-08-19", hash: "abc123", body });
    expect(existingSourceHash(content)).toBe("abc123");
  });

  it("a partial day stores NO sourceHash, so the next run cannot skip it", () => {
    const content = buildGraphLogContent({
      date: "2026-08-19",
      hash: null,
      incompleteReason: "a pass hit its 30-turn limit before capturing anything",
      body,
    });
    // The up-to-date check compares a stored hash against a fresh one.
    // Null can never match, which is exactly what brings the day back.
    expect(existingSourceHash(content)).toBeNull();
    expect(content).toContain("incomplete:");
  });

  it("a partial day still contains the nodes that were captured", () => {
    const content = buildGraphLogContent({ date: "2026-08-19", hash: null, incompleteReason: "stuck", body });
    expect(content).toContain("### Node 1");
    expect(content).toContain("something someone wrote");
  });
});

// ── A stage that produces no human-facing output says why ───────────────
//
// Every "nothing to do" return in graph-project-view and graph-structure
// used to hand back `incomplete: []`, so a run that left the README
// blank because a skill file was never seeded, or because
// graph-structure.md carried no `asOfGraphHash`, was recorded as OK with
// nothing outstanding and rendered in the admin UI as a clean run. The
// durable telemetry said fine while the visible output was empty, which
// is the exact shape docs/adr/README.md exists to catch: nothing errors,
// the system just stops doing its job.
//
// `isSkipInstruction` folds "missing" and "skip" together, which is
// correct for CONTROL FLOW (neither runs) and wrong for REPORTING (one is
// a decision, the other is a broken project). The trap for a future edit
// is that `classifyStageSkill` looks like a redundant copy of
// `isSkipInstruction` and deleting it "works" -- it only takes the
// distinction back out of the run record.

describe("a stage's skill file: missing is not the same as skip", () => {
  it("treats both as do-not-run, so control flow is unchanged", () => {
    expect(isSkipInstruction(null)).toBe(true);
    expect(isSkipInstruction("")).toBe(true);
    expect(isSkipInstruction("skip")).toBe(true);
    expect(isSkipInstruction("Write the README.")).toBe(false);
  });

  it("separates them for reporting", () => {
    expect(classifyStageSkill(null)).toBe("missing");
    expect(classifyStageSkill(undefined)).toBe("missing");
    expect(classifyStageSkill("")).toBe("missing");
    expect(classifyStageSkill("skip")).toBe("skip");
    expect(classifyStageSkill("SKIP")).toBe("skip");
    expect(classifyStageSkill("\n\n  Skip  \n\nrest ignored")).toBe("skip");
  });

  it("reads a real skill file as instructions, not as either silence", () => {
    expect(classifyStageSkill("# PROJECT_VIEW\n\nWrite one section per thread.")).toBe("instructions");
    expect(classifyStageSkill("skipping the boring parts is fine")).toBe("instructions");
  });

  // The lockstep property, and the reason `classifyStageSkill` copies
  // `isSkipInstruction`'s odd first branch instead of tidying it: a
  // whitespace-only file is treated as instructions by BOTH, so this
  // split can never change which stages run. Fix that oddity in one
  // function without the other and this fails.
  it("agrees with isSkipInstruction on every input, whitespace included", () => {
    const inputs = [null, undefined, "", "  ", "   \n  ", "skip", " SKIP ", "do the thing", "skip the thing"];
    for (const input of inputs) {
      expect(isSkipInstruction(input)).toBe(classifyStageSkill(input) !== "instructions");
    }
  });
});

// ── ADR-013 — a cut-off turn is not an empty turn ───────────────────────
//
// A `max_tokens` response still carries every content block generated
// before the limit; only the LAST one can be half-finished. The loops
// used to discard the whole response, which was survivable on a README
// that already had content and silently fatal on one a reset had just
// emptied: turn one truncates, nothing commits, and the project's README
// stays blank while the run reports a stage issue that reads like a
// retry note rather than "your README is empty".
//
// The trap for a future edit is that keeping the last call looks like
// strictly more salvage. It is the one call that can be missing a field,
// and a truncated `update_section` whose `content` never arrived is
// exactly how you write an empty section over a real one.

describe("ADR-013: a truncated response keeps the calls it finished", () => {
  const calls = [{ name: "update_section" }, { name: "update_section" }, { name: "get_node" }];

  it("drops only the last call when the model hit its output limit", () => {
    expect(completedToolCalls(calls, "max_tokens")).toEqual([
      { name: "update_section" },
      { name: "update_section" },
    ]);
  });

  it("keeps every call on a normal stop", () => {
    expect(completedToolCalls(calls, "tool_use")).toEqual(calls);
    expect(completedToolCalls(calls, "end_turn")).toEqual(calls);
    expect(completedToolCalls(calls, "other")).toEqual(calls);
  });

  it("salvages nothing from a lone truncated call, rather than guessing", () => {
    expect(completedToolCalls([{ name: "update_section" }], "max_tokens")).toEqual([]);
    expect(completedToolCalls([], "max_tokens")).toEqual([]);
  });

  it("sync-graph salvages ONE node from a batched, cut-off turn", () => {
    // The real 2026-08-26 shape: several `add_node` calls in one turn,
    // the last one cut mid-JSON. `add_node` is the stage's only tool and
    // every call is a write, so the two rules leave exactly one to run.
    // One is enough: `classifyPassEnding` sees a productive pass and the
    // next pass captures the rest. Before this, the whole turn was
    // discarded and the day reported "captured nothing".
    const calls = [
      { name: "add_node", input: { sourceIndex: 0, blocks: [] } },
      { name: "add_node", input: { sourceIndex: 1, blocks: [] } },
      { name: "add_node", input: { sourceIndex: 2 } },
    ];
    const planned = planTurnToolCalls(completedToolCalls(calls, "max_tokens"), () => true);
    expect(planned.filter((p) => p.execute).map((p) => p.call.input.sourceIndex)).toEqual([0]);
  });

  it("still bounds the salvaged calls to one write, same as any other turn", () => {
    // The two rules compose: truncation decides which calls are INTACT,
    // the write throttle decides how many may RUN. A truncated turn that
    // finished three sections still commits one and leaves the rest for
    // the next run.
    const salvaged = completedToolCalls(
      [{ name: "update_section" }, { name: "update_section" }, { name: "get_node" }, { name: "update_section" }],
      "max_tokens",
    );
    const planned = planTurnToolCalls(salvaged, (n) => n === "update_section" || n === "remove_section");
    expect(planned.filter((p) => p.execute).map((p) => p.call.name)).toEqual(["update_section", "get_node"]);
  });
});

// ── An incomplete README says so itself, in bold, on line one ───────────
//
// The failure got QUIETER as it got better handled. A stage that ran out
// of output budget used to leave a blank README, which nobody could miss.
// Now it commits the sections it finished, so the same failure produces a
// page that reads perfectly well and is missing whole threads. The run
// report says so on an admin page nobody opens while the README looks
// fine, and the person reading the project is the one who needs to know.
//
// The trap for a future edit is that this looks like presentation and
// belongs to the model, which writes everything else in the file. It does
// not. A warning the model can reword, forget, or helpfully delete is not
// a warning, which is why the banner is stripped before the model is ever
// shown the README and reapplied by code afterward.

describe("an incomplete README carries its own warning", () => {
  const body = "# Casita\n\nWhere this stands.\n\n## Settled\n\nThe slab, poured 2026-08-01.\n";

  it("puts the notice first, in bold, and leaves the rest alone", () => {
    const out = withIncompleteBanner(body, ["graph-project-view: cut off by the output limit"]);
    expect(out.startsWith(README_INCOMPLETE_BANNER_PREFIX)).toBe(true);
    expect(out.split("\n")[0]).toContain("cut off by the output limit");
    expect(out).toContain("# Casita");
    expect(out).toContain("The slab, poured 2026-08-01.");
  });

  it("strips back to exactly what it started with", () => {
    const out = withIncompleteBanner(body, ["sync-knowledge: nothing described"]);
    expect(stripIncompleteBanner(out)).toBe(body);
  });

  it("replaces rather than stacks, however many runs warn", () => {
    let out = withIncompleteBanner(body, ["first"]);
    out = withIncompleteBanner(out, ["second"]);
    out = withIncompleteBanner(out, ["third"]);
    const banners = out.split("\n").filter((l) => l.startsWith(README_INCOMPLETE_BANNER_PREFIX));
    expect(banners).toHaveLength(1);
    expect(banners[0]).toContain("third");
    expect(banners[0]).not.toContain("first");
    expect(stripIncompleteBanner(out)).toBe(body);
  });

  // The half that matters most: the same call that raises the warning is
  // the one that takes it down, so a README that got fixed cannot keep
  // wearing a stale one.
  it("a clean run clears it", () => {
    const warned = withIncompleteBanner(body, ["something went wrong"]);
    expect(withIncompleteBanner(warned, [])).toBe(body);
  });

  it("leaves a body that never had one untouched", () => {
    expect(stripIncompleteBanner(body)).toBe(body);
    expect(withIncompleteBanner(body, [])).toBe(body);
    expect(stripIncompleteBanner("")).toBe("");
  });

  it("names a few reasons and counts the rest, rather than printing all of them", () => {
    const out = withIncompleteBanner(body, ["one", "two", "three", "four", "five"]);
    const line = out.split("\n")[0];
    expect(line).toContain("one");
    expect(line).toContain("three");
    expect(line).not.toContain("four");
    expect(line).toContain("2 more");
  });

  // The banner is prose at the top of the intro, not a section of its
  // own. If it ever parsed as one it would sort, get quarantined, or be
  // handed to the model as something to edit.
  it("does not become a section", () => {
    const warned = withIncompleteBanner(body, ["a reason"]);
    const sections = splitReadmeSections(warned);
    expect(sections[0].heading).toBe("");
    expect(sections[0].content).toContain(README_INCOMPLETE_BANNER_PREFIX);
    expect(sections.map((s) => s.heading)).toEqual(["", "Settled"]);
  });
});

// ── Coverage: not measured is not the same as clean ─────────────────────
//
// The coverage check runs ONLY on a clean finish, so a truncated,
// refused, turn-limited or skipped run produces none at all -- and those
// are exactly the runs whose coverage you would most want. Every layer
// that carries this has to keep "nothing was measured" apart from
// "measured, nothing wrong", or a run that never got far enough to check
// reads as a run that checked and passed. That is the same quiet failure
// the README banner exists to stop, one level down.
//
// The trap for a future edit is that `?? { uncitedThreads: [], ... }`
// looks like a tidy way to drop a null check.

describe("a no-op run says which README its coverage was measured against", () => {
  // The first no-op run on production read "graph-project-view never
  // reached a clean finish" because the up-to-date path returned null
  // coverage. Coverage is now measured against the README the run left
  // alone, and this flag is how the run page says so instead of "the
  // finished README", which would claim this run wrote it.
  it("reads the pipeline's lifted flag for a full run", () => {
    expect(readmeChangedFromJobResult("run", { readmeChanged: false, coverage: null })).toBe(false);
    expect(readmeChangedFromJobResult("run", { readmeChanged: true })).toBe(true);
  });

  it("reads the lone stage's own `changed` only for that stage's job", () => {
    expect(readmeChangedFromJobResult("graph-project-view", { changed: false })).toBe(false);
    // graph-structure's `changed` is about graph-structure.md, not the README.
    expect(readmeChangedFromJobResult("graph-structure", { changed: true })).toBeNull();
    expect(readmeChangedFromJobResult("reset", { changed: true })).toBeNull();
  });

  it("is null, never false, when the fact is absent", () => {
    expect(readmeChangedFromJobResult("run", {})).toBeNull();
    expect(readmeChangedFromJobResult("run", null)).toBeNull();
  });
});

describe("coverage: null means not measured, never clean", () => {
  const clean = { missingThreads: [], fellAway: [], missingFiles: [] };

  it("reads a full run's coverage off the top level", () => {
    const out = coverageFromJobResult({
      ok: true,
      incomplete: [],
      coverage: { ...clean, missingThreads: [{ heading: "Slab", rank: 2, of: 8, hasBlocking: true, hasDue: false }] },
    });
    expect(out).toEqual({ uncitedThreads: ["Slab (2/8, Blocking)"], threadsFellAway: [], droppedFiles: [] });
  });

  it("reads a single-stage job's coverage off the same field", () => {
    const out = coverageFromJobResult({ ok: true, changed: true, summary: [], coverage: clean });
    expect(out).toEqual({ uncitedThreads: [], threadsFellAway: [], droppedFiles: [] });
  });

  // The distinction the whole thing rests on: a measured-and-clean run
  // returns empty arrays, an unmeasured one returns null. They must not
  // collapse into each other.
  it("tells measured-and-clean apart from never-measured", () => {
    expect(coverageFromJobResult({ ok: true, coverage: clean })).toEqual({
      uncitedThreads: [],
      threadsFellAway: [],
      droppedFiles: [],
    });
    expect(coverageFromJobResult({ ok: true, coverage: null })).toBeNull();
    expect(coverageFromJobResult({ ok: true, incomplete: ["cut off"] })).toBeNull();
  });

  it("returns null for a job that never had a README to measure", () => {
    expect(coverageFromJobResult({ deletedFolders: ["Graph"] })).toBeNull();
    expect(coverageFromJobResult(null)).toBeNull();
    expect(coverageFromJobResult("done")).toBeNull();
  });

  // The whole point of recording rank: a count cannot become a rule,
  // because the skill says an empty section is honest signal and a minor
  // thread going uncited is correct. Which thread it was is what decides.
  it("names where an uncited thread ranked, and whether it was blocking", () => {
    expect(describeUncited({ heading: "Slab", rank: 1, of: 12, hasBlocking: true, hasDue: true })).toBe(
      "Slab (1/12, Blocking+Due)",
    );
    expect(describeUncited({ heading: "Paint", rank: 11, of: 12, hasBlocking: false, hasDue: false })).toBe(
      "Paint (11/12)",
    );
  });

  it("ranks by graph-structure's own order, so rank 1 is the most important thread", () => {
    const structure = [
      "## Slab schedule",
      "Weight: 1 · Status: active · Blocking: the framing crew",
      "- 2026-08-26 Node 1 (Gerald L) — a gloss",
      "",
      "## Paint colors",
      "Weight: 1 · Status: active",
      "- 2026-08-26 Node 2 (Gerald L) — a gloss",
    ].join("\n");
    const report = computeCoverageReport(structure, "## Nothing cited here\n", new Map());
    expect(report.missingThreads.map(describeUncited)).toEqual([
      "Slab schedule (1/2, Blocking)",
      "Paint colors (2/2)",
    ]);
  });

  it("does not mistake a half-shaped object for a report", () => {
    expect(coverageFromJobResult({ coverage: { fellAway: ["Slab"] } })).toBeNull();
    expect(coverageFromJobResult({ coverage: {} })).toBeNull();
  });

  it("drops non-string members rather than trusting the shape", () => {
    const out = coverageFromJobResult({
      coverage: {
        missingThreads: [{ heading: "Slab", rank: 1, of: 3, hasBlocking: false, hasDue: false }, 7, null],
        fellAway: "nope",
        missingFiles: ["a.jpg"],
      },
    });
    expect(out).toEqual({ uncitedThreads: ["Slab (1/3)"], threadsFellAway: [], droppedFiles: ["a.jpg"] });
  });
});

// ── graph-project-view: a run is a loop of passes ───────────────────────
//
// The README used to be one conversation. A section that overran the
// model's output limit was discarded, nothing was marked applied, and
// the next run re-entered with the identical prompt and identical budget,
// so the failure recurred forever while the run reported "will retry next
// run" (ADR-013's own "how you'd know"). Now a run is a loop of passes,
// and the remaining work is derived from the committed README by the
// coverage check rather than stored anywhere a reset could leave stale.
// These guard the rules that decide when the loop goes on.

describe("ADR-013: a view pass ending is classified on two measures", () => {
  const base = {
    cutOff: null,
    uncitedBefore: 4,
    uncitedAfter: 4,
    targeted: false,
    passesCompleted: 1,
    maxPasses: 3,
    maxTurns: 20,
  };
  const clean = { truncated: false, hitMaxTurns: false };

  it("a limited pass that WROTE sections is working, not stuck -- the next pass carries on", () => {
    expect(classifyViewPassEnding({ ...base, writes: 3, truncated: true, hitMaxTurns: false }))
      .toEqual({ stop: false, shortfall: null });
    expect(classifyViewPassEnding({ ...base, writes: 5, truncated: false, hitMaxTurns: true }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("a limited pass that wrote NOTHING is stuck, and the shortfall names the section", () => {
    const stuck = classifyViewPassEnding({ ...base, writes: 0, truncated: true, hitMaxTurns: false, cutOff: "What's carrying weight" });
    expect(stuck.stop).toBe(true);
    expect(stuck.shortfall).toContain('"What\'s carrying weight"');
    expect(stuck.shortfall).toContain("before writing anything");
  });

  it("degrades to 'a section' when the cut landed before the heading was readable", () => {
    const stuck = classifyViewPassEnding({ ...base, writes: 0, truncated: true, hitMaxTurns: false, cutOff: null });
    expect(stuck.shortfall).toContain("a section");
    const intro = classifyViewPassEnding({ ...base, writes: 0, truncated: true, hitMaxTurns: false, cutOff: "" });
    expect(intro.shortfall).toContain("(intro)");
  });

  it("stops clean the moment nothing is uncited", () => {
    expect(classifyViewPassEnding({ ...base, ...clean, writes: 5, uncitedAfter: 0 }))
      .toEqual({ stop: true, shortfall: null });
  });

  it("after pass 1, offers the uncited threads once even if pass 1 moved nothing", () => {
    // The first production run left four of ten threads uncited on a
    // CLEAN finish. This is the branch that catches it.
    expect(classifyViewPassEnding({ ...base, ...clean, writes: 1, uncitedBefore: 4, uncitedAfter: 4, targeted: false }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("a targeted pass that placed nothing is the model declining -- stop clean, do not nag", () => {
    expect(classifyViewPassEnding({ ...base, ...clean, writes: 0, uncitedBefore: 3, uncitedAfter: 3, targeted: true, passesCompleted: 2 }))
      .toEqual({ stop: true, shortfall: null });
  });

  it("a targeted pass that is still placing threads earns another pass", () => {
    expect(classifyViewPassEnding({ ...base, ...clean, writes: 2, uncitedBefore: 4, uncitedAfter: 2, targeted: true, passesCompleted: 2 }))
      .toEqual({ stop: false, shortfall: null });
  });

  it("reports the pass cap as a shortfall only when the last pass was still productive", () => {
    const atCapProductive = classifyViewPassEnding({ ...base, ...clean, writes: 2, uncitedBefore: 4, uncitedAfter: 2, targeted: true, passesCompleted: 3 });
    expect(atCapProductive).toEqual({ stop: true, shortfall: "still placing uncited threads after 3 passes" });

    const atCapDeclined = classifyViewPassEnding({ ...base, ...clean, writes: 0, uncitedBefore: 2, uncitedAfter: 2, targeted: true, passesCompleted: 3 });
    expect(atCapDeclined).toEqual({ stop: true, shortfall: null });

    const atCapCutOff = classifyViewPassEnding({ ...base, writes: 1, truncated: true, hitMaxTurns: false, targeted: true, passesCompleted: 3 });
    expect(atCapCutOff.stop).toBe(true);
    expect(atCapCutOff.shortfall).toContain("no passes left");
  });
});

describe("a cut-off add_node names its source, read before the call is dropped", () => {
  it("reads sourceIndex off a partial call whose blocks were cut", () => {
    expect(cutOffSourceIndex([{ input: { sourceIndex: 3, blocks: [{ kind: "paragraph" }] } }], "max_tokens")).toBe(3);
    expect(cutOffSourceIndex([{ input: { sourceIndex: 0 } }], "max_tokens")).toBe(0);
  });

  it("returns null when the cut landed before the index, or there was no call, or the stop was clean", () => {
    expect(cutOffSourceIndex([{ input: {} }], "max_tokens")).toBeNull();
    expect(cutOffSourceIndex([], "max_tokens")).toBeNull();
    expect(cutOffSourceIndex([{ input: { sourceIndex: 1, blocks: [] } }], "tool_use")).toBeNull();
  });

  it("names the LAST call, the only one that can be partial", () => {
    expect(cutOffSourceIndex([{ input: { sourceIndex: 0, blocks: [] } }, { input: { sourceIndex: 4 } }], "max_tokens")).toBe(4);
  });

  it("reads the index off the streamed JSON prefix when the API dropped the block", () => {
    // The final message omits a tool_use block that was cut off, so the
    // calls list is EMPTY on exactly the cut this exists for. The
    // provider streams the prefix; this is the only place the index
    // survives.
    expect(cutOffSourceIndex([], "max_tokens", '{"sourceIndex": 3, "blocks": [{"type":"paragraph","text":"Need to g')).toBe(3);
    expect(cutOffSourceIndex([], "max_tokens", '{"sourceInd')).toBeNull();
    expect(cutOffSourceIndex([], "max_tokens", null)).toBeNull();
    // A complete call in the list still wins over the prefix.
    expect(cutOffSourceIndex([{ input: { sourceIndex: 1 } }], "max_tokens", '{"sourceIndex": 9')).toBe(1);
  });
});

describe("a heading the model wrote is read as heading text", () => {
  it("strips leading markdown hashes, which two models added in the same test", () => {
    expect(headingText("## Siding install")).toBe("Siding install");
    expect(headingText("  ###   Toilet water line  ")).toBe("Toilet water line");
    expect(headingText("Siding install")).toBe("Siding install");
    expect(headingText("")).toBe("");
  });
});

describe("each stage runs on its measured model and effort", () => {
  // The grid of 2026-09-11 and the held-structure control of 2026-09-14
  // (see STAGE_DEFAULTS). Pinned so a change here is a decision, not a
  // drift.
  const saved = { ...process.env };
  afterEach(() => { for (const k of Object.keys(process.env)) if (k.startsWith("PHYLOG_ANTHROPIC")) delete process.env[k]; Object.assign(process.env, saved); });

  it("defaults: Sonnet medium for extraction, Sonnet high for structure, Fable high for the README", () => {
    for (const k of Object.keys(process.env)) if (k.startsWith("PHYLOG_ANTHROPIC")) delete process.env[k];
    expect(modelForStage("sync-graph")).toEqual({ model: "claude-sonnet-5", effort: "medium" });
    expect(modelForStage("graph-structure")).toEqual({ model: "claude-sonnet-5", effort: "high" });
    expect(modelForStage("graph-project-view")).toEqual({ model: "claude-fable-5-1", effort: "high" });
    expect(modelForStage("sync-knowledge")).toEqual({ model: "claude-sonnet-5" });
  });

  it("a per-stage env override beats the global one, which beats the table", () => {
    process.env.PHYLOG_ANTHROPIC_MODEL = "claude-haiku-4-5";
    expect(modelForStage("graph-project-view").model).toBe("claude-haiku-4-5");
    process.env.PHYLOG_ANTHROPIC_MODEL_GRAPH_PROJECT_VIEW = "claude-opus-5";
    expect(modelForStage("graph-project-view").model).toBe("claude-opus-5");
    expect(modelForStage("sync-graph").model).toBe("claude-haiku-4-5");
    process.env.PHYLOG_ANTHROPIC_EFFORT_SYNC_GRAPH = "low";
    expect(modelForStage("sync-graph").effort).toBe("low");
  });
});

describe("a cut-off write is named, read before the call is dropped", () => {
  it("reads the heading off a partial call whose content was cut", () => {
    expect(cutOffHeading([{ input: { heading: "Settled", content: "par" } }], "max_tokens")).toBe("Settled");
    expect(cutOffHeading([{ input: { heading: "Settled" } }], "max_tokens")).toBe("Settled");
  });

  it("keeps the intro's empty heading distinct from 'unknown'", () => {
    expect(cutOffHeading([{ input: { heading: "" } }], "max_tokens")).toBe("");
  });

  it("returns null when the cut landed inside the heading, or there was no call, or the stop was clean", () => {
    expect(cutOffHeading([{ input: {} }], "max_tokens")).toBeNull();
    expect(cutOffHeading([], "max_tokens")).toBeNull();
    expect(cutOffHeading([{ input: { heading: "Settled", content: "done" } }], "tool_use")).toBeNull();
    expect(cutOffHeading([{ input: { heading: "Settled", content: "done" } }], "end_turn")).toBeNull();
  });

  it("names the LAST call, which is the only one that can be partial", () => {
    expect(cutOffHeading([{ input: { heading: "Settled", content: "done" } }, { input: { heading: "Open questions" } }], "max_tokens"))
      .toBe("Open questions");
  });
});

describe("the intro is written last", () => {
  const notes = { heading: "Notes on this view", content: "*Comment freely below.*" };

  it("turns back an intro write while no body section has content", () => {
    expect(introShouldWait([notes], "")).toBe(true);
    expect(introShouldWait([notes, { heading: "Settled", content: "   " }], "")).toBe(true);
  });

  it("lets the intro through once any body section has content", () => {
    expect(introShouldWait([notes, { heading: "Settled", content: "Slab poured 8/12." }], "")).toBe(false);
  });

  it("never applies to a body section, and never counts the notes section as body", () => {
    expect(introShouldWait([notes], "settled")).toBe(false);
    expect(introShouldWait([{ ...notes, content: "a real comment" }], "")).toBe(true);
  });
});

describe("the graph lives in the system prompt; the pass mandate in the user message", () => {
  const run = {
    today: "2026-09-09",
    writersFact: "Distinct people who have written in this graph: 2 (A, B).",
    graphStructureBody: "## Slab schedule\n\nWeight: 3\n- 2026-08-01 Node 1",
    nodeTextBlock: "### Node 1\n\nthe slab is late",
  };

  it("the system prompt carries the structure body and node text, once per run", () => {
    const system = buildSystemPrompt("skill text", run);
    expect(system).toContain("skill text");
    expect(system).toContain(run.graphStructureBody);
    expect(system).toContain(run.nodeTextBlock);
    expect(system).toContain("Today's actual date: 2026-09-09");
  });

  it("the user prompt carries only what changes per pass", () => {
    const user = buildUserPrompt({ readmeContent: "# P\n\n## Settled\n\ndone", unstampedComments: ["fix the date"] });
    expect(user).toContain("## Settled");
    expect(user).toContain("fix the date");
    expect(user).not.toContain(run.graphStructureBody);
    expect(user).not.toContain("Today's actual date");
  });

  it("the targeted mandate lists exactly the uncited threads with rank and flags", () => {
    const uncited: UncitedThread[] = [
      { heading: "Slab schedule", rank: 2, of: 8, hasBlocking: true, hasDue: false },
      { heading: "Paint colors", rank: 7, of: 8, hasBlocking: false, hasDue: false },
    ];
    const user = buildTargetedUserPrompt({
      readmeContent: "# P",
      unstampedComments: [],
      uncited,
      uncitedNodeText: "### Node 4\n\nslab text",
      cutOff: null,
    });
    expect(user).toContain("- Slab schedule (2/8, Blocking)");
    expect(user).toContain("- Paint colors (7/8)");
    expect(user).toContain("slab text");
    expect(user).not.toContain("cut off");
  });

  it("the targeted mandate names the section the previous pass was cut off writing", () => {
    const named = buildTargetedUserPrompt({ readmeContent: "# P", unstampedComments: [], uncited: [], uncitedNodeText: null, cutOff: { heading: "What's carrying weight" } });
    expect(named).toContain('the section "What\'s carrying weight" was cut off');
    expect(named).toContain("NOT saved");
    const unknown = buildTargetedUserPrompt({ readmeContent: "# P", unstampedComments: [], uncited: [], uncitedNodeText: null, cutOff: { heading: null } });
    expect(unknown).toContain("one section was cut off");
    const intro = buildTargetedUserPrompt({ readmeContent: "# P", unstampedComments: [], uncited: [], uncitedNodeText: null, cutOff: { heading: "" } });
    expect(intro).toContain('"(intro)"');
  });
});

describe("ADR-005: a citation the model composed is counted, not trusted", () => {
  const a = node("2026-08-20#1");
  const b = node("2026-08-26#3");
  const nodes = new Map([[a.id, a], [b.id, b]]);

  it("matches a copied citation whether or not it kept verbose=\"true\"", () => {
    const body = `Said so (${a.refLine}).\n\nAnd again (${stripRefVerbose(b.refLine!)}).`;
    expect(countCitations(body, nodes)).toEqual({ citations: 2, matched: 2, unmatched: [] });
  });

  it("names a citation that matches no node -- a wrong date reads exactly like a right one", () => {
    const composed = a.refLine!.replace("2026-08-20T12:00:00Z", "2026-08-21T12:00:00Z");
    const body = `Real (${a.refLine}). Composed (${composed}). Composed again (${composed}).`;
    const result = countCitations(body, nodes);
    expect(result.citations).toBe(3);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toEqual([stripRefVerbose(composed)]);
  });

  it("a README with no citations at all is zero, not an error", () => {
    expect(countCitations("# P\n\n## Settled\n\nnothing cited", nodes)).toEqual({ citations: 0, matched: 0, unmatched: [] });
  });
});

// ── ADR-016: in-stage signal reaches a reader ────────────────────────────
//
// Each of these is a place where code correctly did the conservative
// thing (skip a malformed block, ignore a dangling link, treat corrupt
// front matter as "no hash", drop a duplicate heading) and then told
// nobody. The conservative move stays; the silence goes.

describe("ADR-016: a malformed node block is counted, not just skipped", () => {
  const good = `### Node 1\n==said a thing==\n:ref{name="A" datetime="2026-08-20T12:00:00Z" location="/x"}\n`;
  const bad = `### Node 2\n==no citation line at all==\n`;

  it("parses the good block, drops the bad one, and says so through diagnostics", () => {
    const diag = { malformed: 0 };
    const nodes = parseGraphLogNodes("2026-08-20", `${good}\n${bad}`, diag);
    expect(nodes.map((n) => n.number)).toEqual([1]);
    expect(diag.malformed).toBe(1);
  });

  it("is unchanged for callers that pass no diagnostics", () => {
    expect(parseGraphLogNodes("2026-08-20", `${good}\n${bad}`).length).toBe(1);
  });
});

describe("ADR-016: a dangling link is counted, and still carries no weight", () => {
  it("counts a link whose target is not in the graph without indexing it", () => {
    const a = node("2026-08-20#1", [{ date: "2026-08-19", number: 7 }, { date: "2026-08-20", number: 2 }]);
    const b = node("2026-08-20#2");
    const diag = { dangling: 0 };
    const index = computeBacklinkIndex([a, b], diag);
    expect(diag.dangling).toBe(1);
    expect(index.get("2026-08-20#2")?.count).toBe(1);
    expect(index.has("2026-08-19#7")).toBe(false);
  });
});

describe("ADR-016: corrupt front matter is named, not mistaken for 'never processed'", () => {
  it("reads a good hash", () => {
    expect(readSourceHash("---\nsourceHash: abc\n---\nbody")).toEqual({ hash: "abc", unreadable: false });
  });

  it("no front matter is simply no hash", () => {
    expect(readSourceHash("just a body")).toEqual({ hash: null, unreadable: false });
    expect(readSourceHash(null)).toEqual({ hash: null, unreadable: false });
  });

  it("front matter that cannot be parsed says so, and the old helper still returns null", () => {
    const corrupt = "---\nsourceHash: [unclosed\n  - : : bad\n---\nbody";
    expect(readSourceHash(corrupt).unreadable).toBe(true);
    expect(readSourceHash(corrupt).hash).toBeNull();
    expect(existingSourceHash(corrupt)).toBeNull();
  });
});

describe("ADR-016: the README's shape is enforced without losing content", () => {
  const notes = { heading: "Notes on this view", content: "*Comment freely below.*" };

  it("keeps BOTH sections under a duplicated canonical heading, in file order", () => {
    // A `## Settled` line inside a section's prose manufactures a second
    // "Settled" section; the second one's content used to vanish on the
    // next commit, contradicting the function's own doc.
    const out = reorderSections([
      { heading: "Settled", content: "first" },
      { heading: "Get shit done", content: "open" },
      { heading: "Settled", content: "second" },
      notes,
    ]);
    expect(out.map((s) => `${s.heading}:${s.content}`)).toEqual([
      "Get shit done:open",
      "Settled:first",
      "Settled:second",
      "Notes on this view:*Comment freely below.*",
    ]);
  });

  it("names a heading the model invented, and reorderSections keeps it before the notes", () => {
    const sections = [
      { heading: "", content: "intro" },
      { heading: "Settled", content: "done" },
      { heading: "Vendor shortlist", content: "invented" },
      notes,
    ];
    expect(unknownHeadings(sections)).toEqual(["Vendor shortlist"]);
    expect(reorderSections(sections).map((s) => s.heading)).toEqual(["", "Settled", "Vendor shortlist", "Notes on this view"]);
  });

  it("reports nothing for a README that follows the shape", () => {
    expect(unknownHeadings([{ heading: "", content: "i" }, { heading: "Settled", content: "d" }, notes])).toEqual([]);
  });
});

describe("the notes section is no longer created, and still protected where it exists", () => {
  it("adds nothing to a README that has no notes section", () => {
    const sections = [{ heading: "", content: "intro" }, { heading: "Settled", content: "done" }];
    const out = extractReaderComments(sections);
    expect(out.sections).toEqual(sections);
    expect(out.unstamped).toEqual([]);
    expect(out.stampAppliedDate("2026-09-09")).toEqual(sections);
  });

  it("still reads and stamps comments on a README that kept one", () => {
    const sections = [
      { heading: "Settled", content: "done" },
      { heading: "Notes on this view", content: "the slab date is wrong\nalready read → read 2026-09-01" },
    ];
    const out = extractReaderComments(sections);
    expect(out.unstamped).toEqual(["the slab date is wrong"]);
    const stamped = out.stampAppliedDate("2026-09-09");
    expect(stamped[1].content).toBe("the slab date is wrong → read 2026-09-09\nalready read → read 2026-09-01");
    expect(stamped[0]).toEqual(sections[0]);
  });
});

// ── A regenerated day must not see itself as already captured ────────────
//
// Found in a real run: three days whose sources had changed were
// re-extracted, the model was shown graph-structure.md with each day's
// previous nodes listed, and concluded "these already exist, nothing to
// add". Each day came back empty and lost every node it had. The README
// stage then spent a whole pass calling get_node on ids that no longer
// existed, because the structure still listed them.

describe("ADR-001: a regenerated day is shown the structure without its own previous nodes", () => {
  const body = [
    "## Cladding",
    "Weight: 3 inbound links",
    "- 2026-08-20 Node 1 (Austin T) — get it done before Cam is gone",
    "- 2026-08-26 Node 3 (Gerald L) — 21 boards up",
    "",
    "## Plumbing",
    "- 2026-08-20 Node 2 (Lucas J) — water line",
  ].join("\n");

  it("drops exactly that day's membership lines and nothing else", () => {
    const out = stripDayFromStructure(body, "2026-08-20");
    expect(out).not.toContain("2026-08-20 Node");
    expect(out).toContain("- 2026-08-26 Node 3");
    expect(out).toContain("## Plumbing");
    expect(out).toContain("Weight: 3 inbound links");
  });

  it("is a no-op for a day the structure does not list", () => {
    expect(stripDayFromStructure(body, "2026-09-01")).toBe(body);
  });
});

describe("graph-structure prunes membership lines whose node is gone", () => {
  it("drops the stale ids, keeps the live ones and the rest of the section, and names what it dropped", () => {
    const live = node("2026-08-26#3");
    const sections = [
      { heading: "Cladding", content: "Weight: 3\n- 2026-08-20 Node 1 (A) — gone\n- 2026-08-26 Node 3 (G) — here\nStatus: active" },
    ];
    const { sections: pruned, dropped } = pruneStaleMembership(sections, new Map([[live.id, live]]));
    expect(dropped).toEqual(["2026-08-20#1"]);
    expect(pruned[0].content).toBe("Weight: 3\n- 2026-08-26 Node 3 (G) — here\nStatus: active");
  });

  it("drops a thread that has no nodes, however long it has had none", () => {
    // It used to keep the heading with its gloss and its Blocking line
    // and no nodes at all. graph-project-view then read that as a
    // Blocking thread with no citation and wrote an honest line about it,
    // which is how an entry refiled to another project went on haunting
    // the project it left (seen in production, 2026-09-21).
    const live = node("2026-08-26#3");
    const sections = [
      { heading: "", content: "asOfGraphHash: abc" },
      { heading: "Cladding", content: "- 2026-08-26 Node 3 (G) — here" },
      // Loses its last node in this sweep.
      { heading: "HVAC and ERV system specs", content: "Status: open · Blocking: client approval\n- 2026-09-11 Node 1 (A) — moved away" },
      // Lost them on some earlier run, which is how the first one in
      // production survived the rule that only caught the transition.
      { heading: "Old thread", content: "Weight: no inbound links yet · Status: open" },
    ];
    const { sections: pruned, droppedThreads } = pruneStaleMembership(sections, new Map([[live.id, live]]));
    expect(droppedThreads).toEqual(["HVAC and ERV system specs", "Old thread"]);
    expect(pruned.map((p) => p.heading)).toEqual(["", "Cladding"]);
  });

  it("returns the same section objects when nothing is stale", () => {
    const live = node("2026-08-26#3");
    const sections = [{ heading: "Cladding", content: "- 2026-08-26 Node 3 (G) — here" }];
    const { sections: pruned, dropped } = pruneStaleMembership(sections, new Map([[live.id, live]]));
    expect(dropped).toEqual([]);
    expect(pruned[0]).toBe(sections[0]);
  });
});

// ── A list of several items is asked the unit question once ──────────────
//
// GRAPH.md shows a four-bullet section as four nodes and Sonnet, at medium
// and at high, still wrote it as one on every run. The tool result is the
// one channel a literal reader answers to, so the first add_node carrying
// a list of three or more items is bounced with the question and the same
// blocks sent again are accepted.

describe("a list of several items is bounced once with the unit question", () => {
  const list = (n: number) => [{ type: "paragraph", text: "Black Locust Cladding" }, { type: "list", items: Array.from({ length: n }, (_, i) => `item ${i}`) }];

  it("keys a list of three or more items and passes shorter lists and plain paragraphs through", () => {
    expect(listSplitBounce(list(4))?.items).toBe(4);
    expect(listSplitBounce([{ type: "list", items: ["a", "b", "c"] }])?.items).toBe(3);
    expect(listSplitBounce(list(2))).toBeNull();
    expect(listSplitBounce([{ type: "paragraph", text: "one thought" }])).toBeNull();
    expect(listSplitBounce(undefined)).toBeNull();
  });

  it("keys the same blocks the same way, so a resend is recognized", () => {
    expect(listSplitBounce(list(4))?.key).toBe(listSplitBounce(list(4))?.key);
    expect(listSplitBounce(list(4))?.key).not.toBe(listSplitBounce(list(3))?.key);
  });
});

// ── A Due is a date somebody wrote; a thread has a ceiling ───────────────
//
// Both rules were stated in GRAPH_STRUCTURE.md and enforced by nobody. A
// README reported a schedule "due 2026-10-20" that no node held (the model
// added two months to "in the next 2 months", written 8/20), and one
// 69-node graph came out as 3 threads on a run that never counted.

describe("a Due the model computed is dropped before the cluster is saved", () => {
  const written = { ...node("2026-08-20#1"), quote: "==Inspection is set for 2026-09-02 and Cam leaves October 20, 2026.==" };
  const nodes = new Map([[written.id, written]]);

  it("keeps a Due that a node in the cluster actually carries, either date form", () => {
    for (const due of ["2026-09-02", "October 20, 2026"]) {
      const section = { heading: "Schedule", content: `Weight: x · Status: open · Due: ${due} · Blocking: filming\n- 2026-08-20 Node 1 (A) — dates` };
      const { section: kept, notes } = reviewClusterWrite(section, nodes);
      expect(kept).toBe(section);
      expect(notes).toEqual([]);
    }
  });

  it("strips a Due no node carries, keeps the fields around it, and names what it dropped", () => {
    const section = { heading: "Schedule", content: "Weight: x · Status: open · Due: 2026-10-20 · Blocking: filming\n- 2026-08-20 Node 1 (A) — dates" };
    const { section: kept, notes } = reviewClusterWrite(section, nodes);
    expect(kept.content).toBe("Weight: x · Status: open · Blocking: filming\n- 2026-08-20 Node 1 (A) — dates");
    expect(parseClusterFields(kept).hasDue).toBe(false);
    expect(parseClusterFields(kept).hasBlocking).toBe(true);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Dropped "Due: 2026-10-20"');
  });

  it("strips a trailing Due cleanly and leaves a cluster with no Weight line alone", () => {
    const trailing = { heading: "Schedule", content: "Weight: x · Status: open · Due: next week\n- 2026-08-20 Node 1 (A) — dates" };
    expect(reviewClusterWrite(trailing, nodes).section.content).toBe("Weight: x · Status: open\n- 2026-08-20 Node 1 (A) — dates");
    const bare = { heading: "Schedule", content: "- 2026-08-20 Node 1 (A) — dates" };
    expect(reviewClusterWrite(bare, nodes)).toEqual({ section: bare, notes: [] });
  });
});

describe("a cluster over the thread ceiling is saved but told to split", () => {
  it("says nothing at the ceiling and names the overflow one past it", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `- 2026-08-20 Node ${i + 1} (A) — gloss`).join("\n");
    const nodes = new Map(Array.from({ length: MAX_NODES_PER_THREAD + 1 }, (_, i) => { const n = node(`2026-08-20#${i + 1}`); return [n.id, n] as const; }));
    const at = { heading: "Siding", content: `Weight: x · Status: active\n${lines(MAX_NODES_PER_THREAD)}` };
    expect(reviewClusterWrite(at, nodes).notes).toEqual([]);
    const over = { heading: "Siding", content: `Weight: x · Status: active\n${lines(MAX_NODES_PER_THREAD + 1)}` };
    const { section, notes } = reviewClusterWrite(over, nodes);
    expect(section).toBe(over);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(`${MAX_NODES_PER_THREAD + 1} nodes`);
  });
});

describe("a section's content holds only its body", () => {
  it("names the first h2 line the content carries", () => {
    expect(contentCarriesHeading("# Crouch\n\nintro\n\n## What's carrying weight\n\n## Settled")).toBe("## What's carrying weight");
  });

  it("allows h3 subheadings and plain prose", () => {
    expect(contentCarriesHeading("### Cladding\n\nprose with ## inside a sentence")).toBeNull();
    expect(contentCarriesHeading("just a body")).toBeNull();
  });
});

// ── A video is a few stills; a HEIC is a JPEG ────────────────────────────
//
// The vision model takes four image formats and no video. A phone
// produces the two things it cannot take, and both used to be reported
// as unsupported and tossed. The pure parts of turning them into
// something it can take are guarded here; the ffmpeg and decoder calls
// are exercised live.

describe("a video's frames are spaced through the clip, not bunched at the ends", () => {
  it("skips the first and last few percent and spreads the rest evenly", () => {
    expect(frameTimestamps(50, 4)).toEqual([2.5, 17.5, 32.5, 47.5]);
  });

  it("takes the middle of a clip when asked for one frame, and nothing from a clip with no length", () => {
    expect(frameTimestamps(10, 1)).toEqual([5]);
    expect(frameTimestamps(0, 4)).toEqual([]);
    expect(frameTimestamps(NaN, 4)).toEqual([]);
  });
});

describe("ffmpeg's banner is where the duration comes from", () => {
  it("reads hours, minutes, and fractional seconds", () => {
    expect(parseFfmpegDuration("Input #0, mov\n  Duration: 00:00:50.03, start: 0.000000, bitrate: 15582 kb/s")).toBeCloseTo(50.03);
    expect(parseFfmpegDuration("Duration: 01:02:03.5")).toBeCloseTo(3723.5);
  });

  it("is null when there is no banner to read", () => {
    expect(parseFfmpegDuration("At least one output file must be specified")).toBeNull();
  });

  it("formats seconds the way a person reads a clip length", () => {
    expect(formatSeconds(2.5)).toBe("0:03");
    expect(formatSeconds(75)).toBe("1:15");
  });
});

describe("content types that need converting are recognized", () => {
  it("HEIC and HEIF are the iPhone case; video is any video/*", () => {
    expect(isHeicContentType("image/heic")).toBe(true);
    expect(isHeicContentType("image/heif")).toBe(true);
    expect(isHeicContentType("image/jpeg")).toBe(false);
    expect(isVideoContentType("video/quicktime")).toBe(true);
    expect(isVideoContentType("image/jpeg")).toBe(false);
  });
});

// ── The README's shape comes from the skill ──────────────────────────────
//
// EFFORTS.md declared the sections in a fenced block and the code
// held a second copy of the same list. Two sources of truth, already
// drifted once. The code reads the skill now; the built-in list is a
// reported fallback. The migration test is the one that matters: the
// default skill must parse to exactly the shape the code used to hardcode.

describe("a targeted pass chases only Blocking and Due threads; the rest are off the page", () => {
  it("requiredThreads keeps a Blocking or Due thread and drops a plain one", () => {
    const threads = [
      { heading: "Occupancy", rank: 1, of: 3, hasBlocking: true, hasDue: false },
      { heading: "Landscaping", rank: 2, of: 3, hasBlocking: false, hasDue: false },
      { heading: "Permit", rank: 3, of: 3, hasBlocking: false, hasDue: true },
    ];
    expect(requiredThreads(threads).map((t) => t.heading)).toEqual(["Occupancy", "Permit"]);
    expect(requiredThreads([])).toEqual([]);
  });
});

describe("the section shape is read from EFFORTS.md", () => {
  it("the default EFFORTS.md declares the Efforts page's shape, and the protected heading stays last", () => {
    // The README's old shape (what's carrying weight, where we pull
    // apart, get shit done, settled, open questions) became the Efforts
    // page on 2026-09-16. The fence under `# The shape` is load-bearing:
    // `reorderSections` enforces whatever it declares on every write.
    expect(parseSectionShape(DEFAULT_PROJECT_VIEW_SKILL)).toEqual([
      "regroup",
      "on the bench",
      "ready next",
      "shelf",
      "drawer",
      "look-ahead",
    ]);
    expect(resolveSectionOrder(DEFAULT_PROJECT_VIEW_SKILL)).toEqual({
      order: ["regroup", "on the bench", "ready next", "shelf", "drawer", "look-ahead", "notes on this view"],
      reason: null,
    });
  });

  it("reads only the fenced block under '# The shape', never the skill's own prose headings", () => {
    const skill = [
      "# Before you write",
      "## Not a section",
      "# The shape",
      "prose",
      "```markdown",
      "# <Project>",
      "intro text",
      "## Now",
      "## Later",
      "```",
      "## On the two lanes",
      "more prose",
    ].join("\n");
    expect(parseSectionShape(skill)).toEqual(["now", "later"]);
  });

  it("a project can declare its own shape, and the protected heading is always last regardless", () => {
    const skill = "# The shape\n```\n## Notes on this view\n## Status\n## Decisions\n```";
    expect(resolveSectionOrder(skill).order).toEqual(["status", "decisions", "notes on this view"]);
  });

  it("falls back to the built-in shape, with a reason, when the skill declares none", () => {
    for (const skill of [null, "", "skip", "# The shape\n\nno fence here", "# The shape\n```\nno headings\n```"]) {
      const { order, reason } = resolveSectionOrder(skill);
      expect(order).toEqual(["what's carrying weight", "where we pull apart", "get shit done", "settled", "open questions", "notes on this view"]);
      expect(reason).toContain("built-in shape");
    }
  });

  it("reorderSections and unknownHeadings follow the given order", () => {
    const order = ["status", "decisions", "notes on this view"];
    const sections = [
      { heading: "Decisions", content: "d" },
      { heading: "Settled", content: "old shape" },
      { heading: "Status", content: "s" },
    ];
    expect(reorderSections(sections, order).map((s) => s.heading)).toEqual(["Status", "Decisions", "Settled"]);
    expect(unknownHeadings(sections, order)).toEqual(["Settled"]);
  });
});
