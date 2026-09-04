// Regression tests for GraphLog's load-bearing behaviors (see 1.5 /
// docs/adr/ — kept out of the public repo, but each test below is named
// after the ADR it guards so the connection survives without the file).
//
// These exist so a future "harmless-looking" simplification (a link cap
// read as a knob, an author UNION replaced with a SUM, a heavier-but-
// unblocked thread beating a blocked one) fails loudly here instead of
// silently drifting in production, which is how every one of these
// behaviors would otherwise break.

import { describe, it, expect } from "vitest";
import {
  capNodeLinks,
  MAX_LINKS_PER_NODE,
  classifyPassEnding,
  buildGraphLogContent,
  existingSourceHash,
  unresolvedContributorIds,
  contributorNameOrThrow,
} from "robustness-core/data/syncGraph.server";
import { computeBacklinkIndex, extractDatesFromText, type GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import {
  sortClustersByWeight,
  parseClusterFields,
  hasFallenAway,
  withoutProjectViewMarker,
  summarizeClusterFields,
  refreshClusterWeight,
} from "robustness-core/data/graphStructure.server";
import { computeCoverageReport } from "robustness-core/data/graphProjectView.server";
import type { ReadmeSection } from "robustness-core/data/project.types";
import { planTurnToolCalls } from "robustness-core/data/llmProvider";

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

describe("reset-project-view clears the applied marker and nothing else", () => {
  const content = [
    "---",
    "asOfGraphHash: abc123",
    "generatedAt: 2026-08-27T00:00:00.000Z",
    "appliedByProjectView: abc123",
    "---",
    "",
    "## A thread",
    "Weight: 3 · Status: active",
  ].join("\n");

  it("drops appliedByProjectView", () => {
    const out = withoutProjectViewMarker(content);
    expect(out).not.toBeNull();
    expect(out).not.toContain("appliedByProjectView");
  });

  it("leaves asOfGraphHash and generatedAt alone", () => {
    const out = withoutProjectViewMarker(content)!;
    expect(out).toContain("asOfGraphHash: abc123");
    expect(out).toContain("generatedAt: 2026-08-27T00:00:00.000Z");
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
    expect(report.missingThreads).toEqual(["Scheduling"]);
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
