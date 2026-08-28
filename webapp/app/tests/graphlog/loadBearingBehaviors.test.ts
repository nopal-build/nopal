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
import { capNodeLinks, MAX_LINKS_PER_NODE } from "robustness-core/data/syncGraph.server";
import { computeBacklinkIndex, extractDatesFromText, type GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import { sortClustersByWeight, parseClusterFields, hasFallenAway } from "robustness-core/data/graphStructure.server";
import type { ReadmeSection } from "robustness-core/data/project.types";

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
    expect(oneAuthor.fromAuthors.size).toBe(1);
    expect(twoAuthors.count).toBe(2);
    expect(twoAuthors.fromAuthors.size).toBe(2);
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
