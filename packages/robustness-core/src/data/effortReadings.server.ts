/**
 * The readings `graph-project-view` hands the model beside
 * `graph-structure.md` (see `EFFORTS.md`, "What it reads", and the
 * 2026-09-16 Efforts guide in the vault, section 9): every number the
 * Efforts skill mentions, counted by code, so the model spends its
 * judgment on what the numbers mean and never on arithmetic.
 *
 * Pure functions over what the pipeline already parses: the structure
 * file's sections (`splitReadmeSections`), the graph's nodes
 * (`parseGraphLogNodes`), and the reverse link index
 * (`computeBacklinkIndex`). Nothing here reads a file or calls a model.
 *
 * Two of these readings are STAND-INS, and the prompt text says so:
 *
 *   - "no owner" is not a thing the graph stores (a node has an author
 *     and a date and nothing else), so the countable neighbor is "one
 *     person has written into this thread".
 *   - "unanswered question" is a judgment, so the countable neighbor is
 *     "a node whose own highlighted words carry a question mark and that
 *     no node links back to".
 *
 * Direction on links is LINK direction only: "A's node points at B's
 * node". Whether A waits on B or feeds it is not recorded anywhere and
 * is the model's to read from the nodes.
 */

import type { ReadmeSection } from "./project.types";
import { daysBetween, nodeIdsInSection } from "./graphStructure.server";
import { computeBacklinkIndex, stripRefVerbose, type GraphLogNode } from "./graphNodeIndex.server";
import { hasFallenAway } from "./graphStructure.server";

/** "Recent" everywhere in these readings: the last N days ending today,
 * compared against the N days before that. One constant so speed and
 * the load picture agree about what recent means. */
export const RECENT_WINDOW_DAYS = 14;

export type SpeedLabel = "rising" | "steady" | "falling" | "stopped";

export type ThreadReading = {
  heading: string;
  nodeCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Days from the last node to today. A reading, never a flag on its
   * own (Bujo posture: urgency comes from a written date, not from age). */
  daysQuiet: number | null;
  /** Nodes dated within the last `RECENT_WINDOW_DAYS` days. */
  recent: number;
  /** Nodes dated in the `RECENT_WINDOW_DAYS` days before that. */
  before: number;
  speed: SpeedLabel;
  /** Distinct writers by human id, shown by name, most nodes first. */
  writers: { name: string; count: number }[];
  singleWriter: boolean;
  /** Links whose source and target are both in this thread. */
  internalLinks: number;
  /** Of those, links where the two nodes have different authors. */
  crossWriterLinks: number;
  /** First to last node, inclusive. */
  daysSpanned: number | null;
  /** Other threads this one links to (`outbound`) or is linked from
   * (`inbound`), most connected first. */
  neighbors: { heading: string; outbound: number; inbound: number }[];
};

export type PersonLoad = {
  name: string;
  /** Threads this person wrote into in the recent window, most nodes first. */
  threads: { heading: string; count: number }[];
};

export type OpenQuestion = {
  id: string;
  author: string;
  date: string;
  /** The first highlighted segment carrying a question mark, trimmed. */
  line: string;
};

export type EffortReadings = {
  today: string;
  threads: ThreadReading[];
  load: PersonLoad[];
  openQuestions: OpenQuestion[];
};

/** Same identity ladder as `computeBacklinkIndex` and `describeWriters`
 * (ADR-015): count by human id, fall back to the name, then to the node's
 * own id so two unattributable nodes never merge into one person. */
function writerId(node: GraphLogNode): string {
  return node.authorHumanId ?? node.authorName ?? node.id;
}

function writerName(node: GraphLogNode): string {
  return node.authorName ?? "Unknown";
}

/** The name a bench heading uses: the first word of a display name, or
 * the part before `@` of an email, capitalized. The graph's `:ref` names
 * arrive as whatever the humans row holds ("Gerald L",
 * "austin@nopal.build"), and a page for people uses first names. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Unknown";
  const local = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  const first = local.split(/[\s._-]+/).filter(Boolean)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function isNamedThread(section: ReadmeSection): boolean {
  return section.heading !== "" && section.heading.toLowerCase() !== "unclustered";
}

export function speedLabel(recent: number, before: number): SpeedLabel {
  if (recent === 0) return "stopped";
  if (recent > before) return "rising";
  if (recent < before) return "falling";
  return "steady";
}

const HIGHLIGHT_RE = /==([^=]+?)==/g;
const QUESTION_LINE_MAX = 160;

/** The first `==highlighted==` segment of a node's quote that carries a
 * question mark, or null. Only highlighted text counts: those are the
 * person's own words; the prose around them is the extractor's. */
export function questionInOwnWords(quote: string): string | null {
  for (const match of quote.matchAll(HIGHLIGHT_RE)) {
    const segment = match[1].replace(/\s+/g, " ").trim();
    if (segment.includes("?")) {
      return segment.length > QUESTION_LINE_MAX ? `${segment.slice(0, QUESTION_LINE_MAX - 1)}…` : segment;
    }
  }
  return null;
}

export function computeEffortReadings(
  sections: ReadmeSection[],
  allNodes: GraphLogNode[],
  today: string,
): EffortReadings {
  const allNodesById = new Map(allNodes.map((n) => [n.id, n]));
  const backlinks = computeBacklinkIndex(allNodes);

  // Thread membership, node id -> heading. A node in two sections (the
  // structure stage should never do this, but nothing enforces it) keeps
  // its first home so every link is counted once.
  const homeOf = new Map<string, string>();
  const named = sections.filter(isNamedThread);
  for (const section of named) {
    for (const id of nodeIdsInSection(section)) {
      if (!homeOf.has(id)) homeOf.set(id, section.heading);
    }
  }

  // Cross-thread link counts, computed once for all threads from every
  // node's outbound list joined against membership.
  const outboundByThread = new Map<string, Map<string, number>>();
  const inboundByThread = new Map<string, Map<string, number>>();
  const bump = (index: Map<string, Map<string, number>>, from: string, to: string) => {
    const row = index.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + 1);
    index.set(from, row);
  };
  for (const node of allNodes) {
    const home = homeOf.get(node.id);
    if (!home) continue;
    for (const link of node.links) {
      const targetHome = homeOf.get(`${link.date}#${link.number}`);
      if (!targetHome || targetHome === home) continue;
      bump(outboundByThread, home, targetHome);
      bump(inboundByThread, targetHome, home);
    }
  }

  const threads: ThreadReading[] = [];
  for (const section of named) {
    const ids = nodeIdsInSection(section);
    const nodes = ids.map((id) => allNodesById.get(id)).filter((n): n is GraphLogNode => !!n);
    if (nodes.length === 0) continue;
    const idSet = new Set(nodes.map((n) => n.id));

    let firstDate: string | null = null;
    let lastDate: string | null = null;
    let recent = 0;
    let before = 0;
    const writerCounts = new Map<string, { name: string; count: number }>();
    let internalLinks = 0;
    let crossWriterLinks = 0;
    for (const node of nodes) {
      if (!firstDate || node.date < firstDate) firstDate = node.date;
      if (!lastDate || node.date > lastDate) lastDate = node.date;
      const age = daysBetween(node.date, today);
      if (age < RECENT_WINDOW_DAYS) recent += 1;
      else if (age < RECENT_WINDOW_DAYS * 2) before += 1;
      const id = writerId(node);
      const entry = writerCounts.get(id) ?? { name: writerName(node), count: 0 };
      entry.count += 1;
      writerCounts.set(id, entry);
      for (const link of node.links) {
        const targetId = `${link.date}#${link.number}`;
        if (!idSet.has(targetId)) continue;
        internalLinks += 1;
        const target = allNodesById.get(targetId);
        if (target && writerId(target) !== id) crossWriterLinks += 1;
      }
    }
    const writers = [...writerCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const neighborHeadings = new Set<string>([
      ...(outboundByThread.get(section.heading)?.keys() ?? []),
      ...(inboundByThread.get(section.heading)?.keys() ?? []),
    ]);
    const neighbors = [...neighborHeadings]
      .map((heading) => ({
        heading,
        outbound: outboundByThread.get(section.heading)?.get(heading) ?? 0,
        inbound: inboundByThread.get(section.heading)?.get(heading) ?? 0,
      }))
      .sort((a, b) => b.outbound + b.inbound - (a.outbound + a.inbound) || a.heading.localeCompare(b.heading));

    threads.push({
      heading: section.heading,
      nodeCount: nodes.length,
      firstDate,
      lastDate,
      daysQuiet: lastDate ? daysBetween(lastDate, today) : null,
      recent,
      before,
      speed: speedLabel(recent, before),
      writers,
      singleWriter: writers.length === 1,
      internalLinks,
      crossWriterLinks,
      daysSpanned: firstDate && lastDate ? daysBetween(firstDate, lastDate) + 1 : null,
      neighbors,
    });
  }

  // The load picture: every writer in the graph, with the threads they
  // wrote into recently. A writer with nothing recent is listed with an
  // empty list on purpose: "quiet" is a reading the page may need.
  const loadById = new Map<string, { name: string; threads: Map<string, number> }>();
  for (const node of allNodes) {
    const id = writerId(node);
    const entry = loadById.get(id) ?? { name: writerName(node), threads: new Map<string, number>() };
    loadById.set(id, entry);
    const home = homeOf.get(node.id);
    if (!home || daysBetween(node.date, today) >= RECENT_WINDOW_DAYS) continue;
    entry.threads.set(home, (entry.threads.get(home) ?? 0) + 1);
  }
  const load: PersonLoad[] = [...loadById.values()]
    .map((entry) => ({
      name: entry.name,
      threads: [...entry.threads.entries()]
        .map(([heading, count]) => ({ heading, count }))
        .sort((a, b) => b.count - a.count || a.heading.localeCompare(b.heading)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openQuestions: OpenQuestion[] = [];
  for (const node of [...allNodes].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)) {
    if (backlinks.has(node.id)) continue;
    const line = questionInOwnWords(node.quote);
    if (!line) continue;
    openQuestions.push({ id: node.id, author: writerName(node), date: node.date, line });
  }

  return { today, threads, load, openQuestions };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The prompt text for one run's readings, or null when the graph has
 * nothing to read. Every line is a number with its unit; the two-line
 * lead says what the model owns. */
export type ReadingsContext = {
  /** The date the previous page was written for, from its sidecar. */
  sinceDate: string | null;
  /** Threads that gained nodes after `sinceDate`, with counts. */
  arrivedSince: { heading: string; count: number }[];
  /** Threads the index marks dormant with no Due and no Blocking. */
  fellAway: string[];
  /** Threads the previous page left without an effort. */
  offPage: string[];
};

/** What arrived since a date, per thread: the nodes dated after it,
 * grouped by home thread. */
export function arrivedSince(sections: readonly ReadmeSection[], allNodes: readonly GraphLogNode[], sinceDate: string | null): { heading: string; count: number }[] {
  if (!sinceDate) return [];
  const homeOf = new Map<string, string>();
  for (const section of sections) {
    if (!isNamedThread(section)) continue;
    for (const id of nodeIdsInSection(section)) if (!homeOf.has(id)) homeOf.set(id, section.heading);
  }
  const counts = new Map<string, number>();
  for (const node of allNodes) {
    if (node.date <= sinceDate) continue;
    const home = homeOf.get(node.id);
    if (home) counts.set(home, (counts.get(home) ?? 0) + 1);
  }
  return [...counts.entries()].map(([heading, count]) => ({ heading, count })).sort((a, b) => b.count - a.count || a.heading.localeCompare(b.heading));
}

export function fallenAwayThreads(sections: readonly ReadmeSection[]): string[] {
  return sections.filter((s) => isNamedThread(s) && hasFallenAway(s)).map((s) => s.heading);
}

export function buildReadingsBlock(readings: EffortReadings, context?: ReadingsContext): string | null {
  if (readings.threads.length === 0) return null;
  const lines: string[] = [];
  lines.push(
    `Readings computed by code. Every number below is counted, never estimated; what it means is yours to decide. Speed is a reading, not a verdict; days quiet means unobserved, never stalled; "one writer" is the closest the graph gets to "unowned" (it stores no owner); the questions list is a stand-in for "unanswered" (a question is one someone highlighted with a question mark that no node links back to). "Recent" is the last ${RECENT_WINDOW_DAYS} days.`,
  );
  lines.push("");
  lines.push("Per thread:");
  for (const t of readings.threads) {
    const span = t.firstDate && t.lastDate
      ? t.firstDate === t.lastDate
        ? `on ${t.firstDate}`
        : `${t.firstDate} to ${t.lastDate} (${plural(t.daysSpanned ?? 0, "day")} spanned)`
      : "undated";
    const quiet = t.daysQuiet === null ? "" : `, ${plural(t.daysQuiet, "day")} quiet`;
    const speed = `speed: ${t.speed} (${t.recent} recent, ${t.before} in the ${RECENT_WINDOW_DAYS} days before)`;
    const writers = t.writers.map((w) => `${w.name} ${w.count}`).join(", ");
    const writerNote = t.singleWriter ? " (one writer)" : "";
    const links = `links among its own nodes: ${t.internalLinks}${t.internalLinks > 0 ? `, ${t.crossWriterLinks} across writers` : ""}`;
    const neighbors = t.neighbors.length === 0
      ? "links to other threads: none"
      : `links to other threads: ${t.neighbors
          .map((n) => [n.outbound > 0 ? `-> "${n.heading}" ${n.outbound}` : null, n.inbound > 0 ? `<- "${n.heading}" ${n.inbound}` : null].filter(Boolean).join(", "))
          .join("; ")}`;
    lines.push(`- "${t.heading}": ${plural(t.nodeCount, "node")}, ${span}${quiet}; ${speed}; writers: ${writers}${writerNote}; ${links}; ${neighbors}`);
  }
  if (readings.load.length > 0) {
    lines.push("");
    lines.push(
      `Who has written where in the last ${RECENT_WINDOW_DAYS} days (a load picture, never an assignment). These are the people who log and read this page, and the only names a bench heading may carry, as first names: ${readings.load.map((p) => firstName(p.name)).join(", ")}.`,
    );
    for (const p of readings.load) {
      lines.push(
        p.threads.length === 0
          ? `- ${firstName(p.name)}: nothing in the last ${RECENT_WINDOW_DAYS} days`
          : `- ${firstName(p.name)}: ${p.threads.map((t) => `"${t.heading}" ${t.count}`).join(", ")}`,
      );
    }
  }
  if (readings.openQuestions.length > 0) {
    lines.push("");
    lines.push("Questions in someone's own words that no node links back to (which of these are open is yours to judge):");
    for (const q of readings.openQuestions) lines.push(`- ${q.id} (${q.author}, ${q.date}): "${q.line}"`);
  }
  if (context) {
    lines.push("");
    if (context.sinceDate) {
      lines.push(
        context.arrivedSince.length === 0
          ? `Since the page was last written (${context.sinceDate}): nothing new landed in the graph.`
          : `Since the page was last written (${context.sinceDate}), new entries landed in: ${context.arrivedSince.map((a) => `"${a.heading}" ${a.count}`).join(", ")}. Say what moved in the opening only when it is worth a reader's attention.`,
      );
    } else {
      lines.push("No previous page to compare; nothing to say about what moved.");
    }
    const loose = [...new Set([...context.fellAway, ...context.offPage])];
    if (loose.length > 0) {
      lines.push(
        `Threads with no decision recorded, candidates for the drawer as loose ends (fell away: ${context.fellAway.length ? context.fellAway.map((t) => `"${t}"`).join(", ") : "none"}; left off the last page: ${context.offPage.length ? context.offPage.map((t) => `"${t}"`).join(", ") : "none"}). Their text is not handed over; call get_node before proposing a line.`,
      );
    }
  }
  return lines.join("\n");
}

// ─── Efforts on the page ─────────────────────────────────────────────────
//
// An effort is the page's unit (see `EFFORTS.md`, "The unit: one effort"):
// a `###` heading whose first line names the threads it gathers and the
// two readings only the model makes. Code reads that line back for two
// reasons: to tell the model, in the tool result, when a thread name
// matches nothing in the index (`unknownThreadNames`), and to write the
// efforts and their counted readings as data beside the page
// (`buildEffortsSidecar`) for a layout that draws rather than reads.

export type EffortBlock = {
  name: string;
  /** The person on a bench heading (`### <Person> · <Effort>`), or null. */
  person: string | null;
  /** The third heading segment (`### <Person> · <Effort> · M`), the
   * t-shirt size as written on the page, or null. */
  sizeWords: string | null;
  /** The `## ` section the effort sits in, lowercased; "" for the intro. */
  section: string;
  threads: string[];
  size: string | null;
  posture: string | null;
  direction: string | null;
  /** The effort's own lines, citations stripped and whitespace
   * normalized: what the change marks compare. */
  lines: string[];
  /** The same lines as written, citations intact, so the threads behind
   * the effort can be read off what it cites (`assignEffortThreads`). */
  rawLines: string[];
};

/** What the model reports about an effort through `describe_effort`:
 * never on the page, only in the sidecar for a layout. */
export type EffortDescription = { size: string | null; posture: string | null; direction: string | null };

const H2_RE = /^##\s+(.+?)\s*$/;
const H3_RE = /^###\s+(.+?)\s*$/;
const FIELD_LINE_RE = /^threads:/i;
const REF_RE = /:ref\{[^}]*\}/g;
/** A code-owned change mark at the end of an effort heading. */
const CHANGE_TAG_RE = /\s*\{(new|moved)\}\s*$/;
const HEADING_SPLIT = " · ";

/** `Person · Effort · how big, in words` on a heading. One segment is
 * the name; two are person and name; three add the size in words (the
 * letter for the layout comes through `describe_effort`). */
export function splitHeading(raw: string): { person: string | null; name: string; sizeWords: string | null } {
  const text = raw.replace(CHANGE_TAG_RE, "").trim();
  const parts = text.split(HEADING_SPLIT).map((p) => p.trim());
  if (parts.length === 1) return { person: null, name: parts[0], sizeWords: null };
  if (parts.length === 2) return { person: parts[0] || null, name: parts[1], sizeWords: null };
  return { person: parts[0] || null, name: parts[1], sizeWords: parts.slice(2).join(HEADING_SPLIT) || null };
}

export function normalizeLine(line: string): string {
  return line.replace(REF_RE, "").replace(/\s+/g, " ").trim();
}

function parseFieldLine(line: string): Pick<EffortBlock, "threads" | "size" | "posture" | "direction"> {
  const fields: Record<string, string> = {};
  for (const part of line.split("·")) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(part);
    if (m) fields[m[1].toLowerCase()] = m[2];
  }
  const threads = (fields.threads ?? "")
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return {
    threads,
    size: fields.size?.trim() || null,
    posture: fields.posture?.trim().toLowerCase() || null,
    direction: fields.direction?.trim() || null,
  };
}

/** Every `###` effort on a README body (or one section's content), with
 * its field line parsed when it has one. Line-based like everything else
 * that reads a README; a fenced block is not special-cased because the
 * page never carries one. */
export function parseEffortBlocks(body: string): EffortBlock[] {
  const blocks: EffortBlock[] = [];
  let section = "";
  let open: EffortBlock | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const h2 = H2_RE.exec(line);
    if (h2) {
      section = h2[1].toLowerCase();
      open = null;
      continue;
    }
    const h3 = H3_RE.exec(line);
    if (h3) {
      const { person, name, sizeWords } = splitHeading(h3[1]);
      open = { name, person, sizeWords, section, threads: [], size: null, posture: null, direction: null, lines: [], rawLines: [] };
      blocks.push(open);
      continue;
    }
    if (!open || line.length === 0) continue;
    // A field line on a page written before round 4 carries what the
    // sidecar now gets from citations and `describe_effort`; it is read
    // for its threads once (so change marks bridge the two) and never
    // treated as a line of the effort.
    if (FIELD_LINE_RE.test(line) && open.lines.length === 0 && open.threads.length === 0) {
      Object.assign(open, parseFieldLine(line));
      continue;
    }
    open.lines.push(normalizeLine(line));
    open.rawLines.push(line);
  }
  return blocks;
}

/** Sets each effort's threads from the nodes its lines cite: a citation
 * is a node, a node has a home thread in the index, so the effort is
 * made of the threads its evidence comes from. Nothing on the page
 * declares it. An effort whose lines cite nothing keeps whatever a
 * legacy field line gave it, else no threads. */
export function assignEffortThreads(
  blocks: EffortBlock[],
  allNodes: readonly GraphLogNode[],
  sections: readonly ReadmeSection[],
): void {
  const homeOf = new Map<string, string>();
  for (const section of sections) {
    if (!isNamedThread(section)) continue;
    for (const id of nodeIdsInSection(section)) if (!homeOf.has(id)) homeOf.set(id, section.heading);
  }
  const homeByRef = new Map<string, string>();
  for (const node of allNodes) {
    const home = homeOf.get(node.id);
    if (node.refLine && home) homeByRef.set(stripRefVerbose(node.refLine).trim(), home);
  }
  for (const block of blocks) {
    const threads: string[] = [];
    for (const raw of block.rawLines) {
      for (const ref of stripRefVerbose(raw).match(/:ref\{[^}]*\}/g) ?? []) {
        const home = homeByRef.get(ref.trim());
        if (home && !threads.includes(home)) threads.push(home);
      }
    }
    if (threads.length > 0) block.threads = threads;
  }
}

/** Applies `describe_effort` reports (keyed by lowercased effort name) to
 * the parsed efforts. An effort the model did not re-describe this run
 * keeps what the previous sidecar said about it (matched by person and
 * name, then by name): on a run that changes nothing the model calls
 * nothing, and an empty description must not read as a move. A report
 * for an effort not on the page is dropped. */
export function applyEffortDescriptions(
  blocks: EffortBlock[],
  descriptions: ReadonlyMap<string, EffortDescription>,
  previous: readonly PreviousEffort[] | null = null,
): void {
  for (const block of blocks) {
    const fresh = descriptions.get(block.name.toLowerCase());
    const carried =
      fresh ??
      previous?.find((p) => effortKey(p) === effortKey(block)) ??
      previous?.find((p) => p.name.toLowerCase() === block.name.toLowerCase()) ??
      null;
    const headingLetter = block.sizeWords && /^(?:XS|S|M|L|XL)$/i.test(block.sizeWords) ? block.sizeWords.toUpperCase() : null;
    if (!carried) {
      if (headingLetter) block.size = headingLetter;
      continue;
    }
    block.size = headingLetter ?? carried.size;
    block.posture = carried.posture;
    block.direction = carried.direction;
  }
}

// ─── Length ──────────────────────────────────────────────────────────────
//
// The page is read on a phone: ten seconds for the opening, the ask and
// the bench headings; a minute for Regroup and each effort's Now and
// Next; rarely past five minutes for the whole. The skill says the same
// numbers; code holds them. Budgets are per section so a bounce can name
// the section and its count, and they sum to the page ceiling.

export const PAGE_WORD_CEILING = 1000;

/** Per-section word budgets, keyed by lowercased heading ("" is the
 * intro). Citations and gallery/image lines cost nothing (`countPageWords`). */
export const SECTION_WORD_BUDGETS: Record<string, number> = {
  "": 60,
  regroup: 80,
  "on the bench": 450,
  "ready next": 150,
  shelf: 120,
  drawer: 60,
  "look-ahead": 80,
};

const MEDIA_LINE_RE = /^\s*(:::gallery\{[^}]*\}|:::|!?\[[^\]]*\]\([^)]*\))\s*$/;

/** Words in one bullet outside its quoted phrases, above which the
 * bullet is two facts or too long. A soft line; the note names it. */
export const BULLET_WORD_LIMIT = 20;
/** Quoted phrases one effort may carry before it reads as a wall. */
export const EFFORT_QUOTE_LIMIT = 3;
/** Items a label (Now, Next, …) may hold under one effort. */
export const LABEL_ITEM_LIMIT = 3;

const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** The size on the page is the t-shirt letter on a bench heading's third
 * segment (Austin, 2026-09-18: a scale to scan, not prose to read). A
 * `Size:` field, or a heading segment that is prose instead of the
 * letter, is a note. A lone letter in prose ("the S wall") is left alone. */
const SIZE_FIELD_RE = /\bSize:\s*/;
const SIZE_LETTER_ONLY_RE = /^(?:XS|S|M|L|XL)$/i;
const EM_DASH_RE = /—/;
const ARROW_OR_CURLY_RE = /[→←⇒⇐↔“”‘’]/;
const UNDERLINE_RE = /<u>/i;
const LABEL_RE = /^([A-Z][A-Za-z' ]{1,24}):\s/;
const QUOTED_RE = /"[^"\n]{2,}"|“[^”\n]{2,}”/g;

/** The shape rules code holds for one section as it is written, as
 * plain notes for the tool result: empty when the section is in shape.
 * Every number the skill mentions is counted here, never by the model:
 * the section's word budget, quoted phrases per effort, a label repeated
 * in one effort or holding too many items, a bullet carrying two facts
 * (a semicolon) or running long outside its quote, and a bench heading
 * naming someone who does not log, or by more than a first name. */
export function sectionShapeNotes(
  heading: string,
  content: string,
  writerFirstNames: readonly string[] = [],
): string[] {
  const notes: string[] = [];
  const key = heading.toLowerCase();
  const budget = SECTION_WORD_BUDGETS[key];
  const words = countPageWords(content);
  if (budget !== undefined && words > budget) notes.push(`${words} words against a budget of ${budget} (citations and photos not counted)`);

  // Per effort: quotes, labels, bullets. Lines before the first `###`
  // (a section with no efforts, like Ready next or the shelf) are checked
  // as one unnamed block so a bullet rule holds on every bullet.
  const efforts: { name: string; person: string | null; lines: string[] }[] = [];
  let open: { name: string; person: string | null; lines: string[] } | null = null;
  const loose: { name: string; person: string | null; lines: string[] } = { name: heading || "the intro", person: null, lines: [] };
  for (const raw of content.split("\n")) {
    const h3 = H3_RE.exec(raw.trim());
    if (h3) {
      const { person, name } = splitHeading(h3[1]);
      open = { name, person, lines: [] };
      efforts.push(open);
      continue;
    }
    (open ?? loose).lines.push(raw);
  }
  if (loose.lines.some((l) => BULLET_RE.test(l))) efforts.unshift(loose);
  // Mechanical voice rules, code's by Austin's test (checkable without
  // meaning): em dashes, arrows and curly quotes outside a quoted phrase
  // or citation, underline, every bullet opening bold, a size letter.
  // Straight-quoted phrases are someone's own words and are left as
  // written; a curly-quoted phrase is the model's own typing and counts.
  const outsideQuotes = content.replace(REF_RE, " ").replace(/"[^"\n]{2,}"/g, " ");
  if (EM_DASH_RE.test(outsideQuotes)) notes.push("an em dash; use a comma, a colon, parentheses, or a full stop and a short next sentence");
  if (ARROW_OR_CURLY_RE.test(outsideQuotes)) notes.push("a unicode arrow or curly quote; type what a person would type");
  if (UNDERLINE_RE.test(content)) notes.push("underline; use italics for emphasis");
  const bullets = content.split("\n").map((l) => BULLET_RE.exec(l)?.[1] ?? null).filter((b): b is string => b !== null);
  const boldOpeners = bullets.filter((b) => /^\*\*/.test(b.trim())).length;
  if (bullets.length >= 3 && boldOpeners * 2 > bullets.length) notes.push(`${boldOpeners} of ${bullets.length} bullets open with a bolded phrase; bold is for the biggest idea, not every line`);
  for (const line of content.split("\n")) {
    const h3 = H3_RE.exec(line.trim());
    const bullet = BULLET_RE.exec(line)?.[1] ?? null;
    const probe = h3 ? h3[1] : bullet;
    if (probe === null) continue;
    const clean = probe.replace(REF_RE, " ").replace(QUOTED_RE, " ");
    const segment = h3 ? splitHeading(h3[1]).sizeWords : null;
    const proseOnHeading = segment !== null && !SIZE_LETTER_ONLY_RE.test(segment);
    if (SIZE_FIELD_RE.test(clean) || proseOnHeading) {
      notes.push(`a size written out ("${probe.slice(0, 50)}${probe.length > 50 ? "…" : ""}"); size is the t-shirt letter, XS to XL, as the heading's third segment, never Size: and never a phrase`);
      break;
    }
  }
  const allowed = new Set(writerFirstNames.map((n) => n.toLowerCase()));
  for (const e of efforts) {
    const text = e.lines.join("\n");
    const quotes = (text.replace(REF_RE, "").match(QUOTED_RE) ?? []).length;
    if (e !== loose && quotes > EFFORT_QUOTE_LIMIT) notes.push(`"${e.name}" carries ${quotes} quoted phrases; ${EFFORT_QUOTE_LIMIT} is the most an effort holds`);
    const labelCounts = new Map<string, number>();
    let labelItems = 0;
    let lastLabel: string | null = null;
    for (const raw of e.lines) {
      const bullet = BULLET_RE.exec(raw);
      if (!bullet) continue;
      const body = bullet[1].replace(REF_RE, "").trim();
      const indented = /^\s{2,}/.test(raw);
      const label = LABEL_RE.exec(body)?.[1] ?? null;
      if (label && !indented) {
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        lastLabel = label;
        labelItems = 0;
      } else if (indented && lastLabel) {
        labelItems += 1;
        if (labelItems === LABEL_ITEM_LIMIT + 1) notes.push(`"${e.name}" has more than ${LABEL_ITEM_LIMIT} items under ${lastLabel}`);
      }
      const outsideQuotes = body.replace(QUOTED_RE, " ");
      if (outsideQuotes.includes(";")) notes.push(`a bullet in "${e.name}" carries a semicolon, which is two facts: "${body.slice(0, 60)}${body.length > 60 ? "…" : ""}"`);
      // The label is not content: "Not logged:" costs nothing.
      const wordCount = outsideQuotes.replace(LABEL_RE, "").split(/\s+/).filter(Boolean).length;
      if (wordCount > BULLET_WORD_LIMIT) notes.push(`a bullet in "${e.name}" runs ${wordCount} words outside its quote (about ${BULLET_WORD_LIMIT} is the line): "${body.slice(0, 60)}${body.length > 60 ? "…" : ""}"`);
    }
    for (const [label, count] of labelCounts) {
      if (count > 1) notes.push(`"${e.name}" repeats the label ${label} ${count} times; each label once, with the items under it`);
    }
    if (e.lines.some((l) => FIELD_LINE_RE.test(l.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "")))) {
      notes.push(`"${e.name}" carries a Threads/Size/Posture line; the page carries no fields (describe_effort takes size, posture and direction; threads are read from the citations)`);
    }
    if (e.person) {
      const bare = e.person.toLowerCase();
      const asFirst = firstName(e.person).toLowerCase();
      if (allowed.size > 0 && !allowed.has(bare) && !allowed.has(asFirst)) {
        notes.push(`"${e.name}" names "${e.person}", who is not one of the people logging here (${writerFirstNames.join(", ")}); a bench heading names only them, by first name`);
      } else if (bare !== asFirst) {
        notes.push(`"${e.name}" names "${e.person}"; bench headings use a first name (${firstName(e.person)})`);
      }
    }
  }
  return notes;
}

/** Words a reader reads: citations stripped, gallery fences and image or
 * link-only lines dropped, list markers not counted, then
 * whitespace-separated tokens. */
export function countPageWords(text: string): number {
  const lines = text
    .split("\n")
    .filter((l) => !MEDIA_LINE_RE.test(l))
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
  return lines.join("\n").replace(REF_RE, " ").split(/\s+/).filter(Boolean).length;
}

// ─── Change marks ────────────────────────────────────────────────────────
//
// What moved since the last page, decided by code from the previous
// sidecar and the new page. An effort is "the same" when it shares a
// thread with a previous effort (names move between runs; threads do
// not), "new" when nothing shares a thread or a name, and "moved" when
// its field line or any of its lines changed. Marks live in the sidecar
// as data and on the page as a `{new}` / `{moved}` tag at the end of the
// effort heading, added after the clean finish and stripped before the
// model sees the page again (the incomplete banner's pattern).

export type EffortChange = { change: "new" | "moved" | "unchanged"; changedLines: string[] };

export type PreviousEffort = {
  name: string;
  person: string | null;
  threads: string[];
  size: string | null;
  posture: string | null;
  direction: string | null;
  lines: string[];
};

function effortKey(e: { person: string | null; name: string }): string {
  return `${e.person ?? ""} · ${e.name}`.toLowerCase();
}

/** What counts as the effort's fields having moved: size and posture.
 * Direction is a free phrase the model rewords every run, and threads
 * are read off citations that shift with a re-extraction, so neither is
 * a signal that the work moved. */
function fieldSignature(e: { size: string | null; posture: string | null }): string {
  return JSON.stringify([e.size, e.posture]);
}

/** Marks keyed by `effortKey`. A null `previous` (no sidecar yet) marks
 * nothing: there is no last page to have moved from. */
export function markChanges(previous: PreviousEffort[] | null, current: EffortBlock[]): Map<string, EffortChange> {
  const marks = new Map<string, EffortChange>();
  if (!previous) return marks;
  for (const effort of current) {
    const own = new Set(effort.threads.map((t) => t.toLowerCase()));
    let best: PreviousEffort | null = null;
    let bestShared = 0;
    for (const prev of previous) {
      const shared = prev.threads.filter((t) => own.has(t.toLowerCase())).length;
      if (shared > bestShared) {
        best = prev;
        bestShared = shared;
      }
    }
    if (!best) best = previous.find((p) => p.name.toLowerCase() === effort.name.toLowerCase()) ?? null;
    if (!best) {
      marks.set(effortKey(effort), { change: "new", changedLines: [...effort.lines] });
      continue;
    }
    const before = new Set(best.lines);
    const changedLines = effort.lines.filter((l) => !before.has(l));
    const fieldsMoved = fieldSignature(best) !== fieldSignature(effort);
    const linesMoved = changedLines.length > 0 || best.lines.length !== effort.lines.length;
    marks.set(effortKey(effort), {
      change: fieldsMoved || linesMoved ? "moved" : "unchanged",
      changedLines,
    });
  }
  return marks;
}

/** Previous efforts that match nothing on the new page (no shared thread
 * and no shared name): what left the page this run, for the sidecar and
 * the log. A reader correction that takes an effort off the bench shows
 * up here, which is how the Coronado case is checked. */
export function removedEfforts(previous: PreviousEffort[] | null, current: EffortBlock[]): string[] {
  if (!previous) return [];
  const threads = new Set(current.flatMap((e) => e.threads.map((t) => t.toLowerCase())));
  const names = new Set(current.map((e) => e.name.toLowerCase()));
  return previous
    .filter((p) => !p.threads.some((t) => threads.has(t.toLowerCase())) && !names.has(p.name.toLowerCase()))
    .map((p) => (p.person ? `${p.person} · ${p.name}` : p.name));
}

/** The read (the intro's first paragraph) and the one ask, off the page
 * body, for the sidecar. Null when the page has no intro yet. */
export function parseRead(body: string): { read: string | null; ask: string | null } {
  const intro = body.split(/^## /m)[0] ?? "";
  const paragraphs = intro
    .split(/\n\s*\n/)
    .map((p) => p.replace(REF_RE, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0 && !p.startsWith("#") && !p.startsWith("**This README is incomplete.**"));
  const askIndex = paragraphs.findIndex((p) => /^one ask:/i.test(p));
  const ask = askIndex === -1 ? null : paragraphs[askIndex].replace(/^one ask:\s*/i, "");
  const read = paragraphs.find((p, i) => i !== askIndex) ?? null;
  return { read, ask };
}

/** The page with a `{new}` / `{moved}` tag on each marked effort heading. */
export function withChangeTags(body: string, marks: Map<string, EffortChange>): string {
  return body
    .split("\n")
    .map((raw) => {
      const h3 = H3_RE.exec(raw.trim());
      if (!h3) return raw;
      const bare = raw.trimEnd().replace(CHANGE_TAG_RE, "");
      const mark = marks.get(effortKey(splitHeading(h3[1])));
      return mark && mark.change !== "unchanged" ? `${bare} {${mark.change}}` : bare;
    })
    .join("\n");
}

/** The inverse: every effort heading without its tag. Always safe. */
export function stripChangeTags(body: string): string {
  return body
    .split("\n")
    .map((raw) => (H3_RE.test(raw.trim()) ? raw.trimEnd().replace(CHANGE_TAG_RE, "") : raw))
    .join("\n");
}

/** The date a previously written `Graph/efforts.md` was written for, and
 * the threads it left without an effort, or null when unreadable. What
 * the readings block turns into "since the page was last written" and
 * the loose-end candidates. */
export function readSidecarMeta(content: string | null | undefined): { today: string | null; threadsWithoutEffort: string[] } | null {
  if (!content) return null;
  const start = content.indexOf("```json\n");
  const end = content.lastIndexOf("\n```");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(content.slice(start + 8, end)) as { today?: unknown; threadsWithoutEffort?: unknown };
    return {
      today: typeof data.today === "string" ? data.today : null,
      threadsWithoutEffort: Array.isArray(data.threadsWithoutEffort) ? data.threadsWithoutEffort.filter((t): t is string => typeof t === "string") : [],
    };
  } catch {
    return null;
  }
}

/** The efforts a previously written `Graph/efforts.md` recorded, or null
 * when there is none or it cannot be read. */
export function readEffortsSidecar(content: string | null | undefined): PreviousEffort[] | null {
  if (!content) return null;
  const start = content.indexOf("```json\n");
  const end = content.lastIndexOf("\n```");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(content.slice(start + 8, end)) as { efforts?: unknown };
    if (!Array.isArray(data.efforts)) return null;
    return data.efforts
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        name: typeof e.name === "string" ? e.name : "",
        person: typeof e.person === "string" ? e.person : null,
        threads: Array.isArray(e.threads) ? e.threads.filter((t): t is string => typeof t === "string") : [],
        size: typeof e.size === "string" ? e.size : null,
        posture: typeof e.posture === "string" ? e.posture : null,
        direction: typeof e.direction === "string" ? e.direction : null,
        lines: Array.isArray(e.lines) ? e.lines.filter((l): l is string => typeof l === "string") : [],
      }));
  } catch {
    return null;
  }
}

/** Thread names on the efforts in `content` that match no heading in the
 * structure (case-insensitive), in order of first appearance. */
export function unknownThreadNames(content: string, threadHeadings: Set<string>): string[] {
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const block of parseEffortBlocks(content)) {
    for (const thread of block.threads) {
      const key = thread.toLowerCase();
      if (threadHeadings.has(key) || seen.has(key)) continue;
      seen.add(key);
      unknown.push(thread);
    }
  }
  return unknown;
}

export const EFFORTS_SIDECAR_FILE_NAME = "efforts.md";

type MergedReading = Omit<ThreadReading, "heading" | "singleWriter"> & { threads: string[] };

/** One effort's counted readings, merged across the threads it gathers:
 * sums for counts, extremes for dates, speed relabeled from the summed
 * windows, neighbors excluding the effort's own threads. */
function mergeReadings(threads: ThreadReading[], today: string): MergedReading {
  const own = new Set(threads.map((t) => t.heading.toLowerCase()));
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let recent = 0;
  let before = 0;
  let nodeCount = 0;
  let internalLinks = 0;
  let crossWriterLinks = 0;
  const writers = new Map<string, number>();
  const neighbors = new Map<string, { outbound: number; inbound: number }>();
  for (const t of threads) {
    nodeCount += t.nodeCount;
    recent += t.recent;
    before += t.before;
    internalLinks += t.internalLinks;
    crossWriterLinks += t.crossWriterLinks;
    if (t.firstDate && (!firstDate || t.firstDate < firstDate)) firstDate = t.firstDate;
    if (t.lastDate && (!lastDate || t.lastDate > lastDate)) lastDate = t.lastDate;
    for (const w of t.writers) writers.set(w.name, (writers.get(w.name) ?? 0) + w.count);
    for (const n of t.neighbors) {
      if (own.has(n.heading.toLowerCase())) continue;
      const entry = neighbors.get(n.heading) ?? { outbound: 0, inbound: 0 };
      entry.outbound += n.outbound;
      entry.inbound += n.inbound;
      neighbors.set(n.heading, entry);
    }
  }
  return {
    threads: threads.map((t) => t.heading),
    nodeCount,
    firstDate,
    lastDate,
    daysQuiet: lastDate ? daysBetween(lastDate, today) : null,
    recent,
    before,
    speed: speedLabel(recent, before),
    writers: [...writers.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    internalLinks,
    crossWriterLinks,
    daysSpanned: firstDate && lastDate ? daysBetween(firstDate, lastDate) + 1 : null,
    neighbors: [...neighbors.entries()]
      .map(([heading, n]) => ({ heading, ...n }))
      .sort((a, b) => b.outbound + b.inbound - (a.outbound + a.inbound) || a.heading.localeCompare(b.heading)),
  };
}

/** `Graph/efforts.md`: the page's efforts as data, for a layout that
 * draws them. YAML front matter like `graph-structure.md`'s, then one
 * fenced JSON block. `size`, `posture` and `direction` are the model's
 * judgments copied off the page; every other number is counted. Threads
 * no effort named are listed so nothing on the index goes missing from
 * the drawing without saying so. */
export function buildEffortsSidecar(
  meta: { asOfGraphHash: string; generatedAt: string; skillFingerprint: string },
  efforts: EffortBlock[],
  readings: EffortReadings,
  marks: Map<string, EffortChange> = new Map(),
  page: { read: string | null; ask: string | null; removed: string[] } = { read: null, ask: null, removed: [] },
): string {
  const byHeading = new Map(readings.threads.map((t) => [t.heading.toLowerCase(), t]));
  const claimed = new Set<string>();
  const items = efforts.map((e) => {
    const threads = e.threads.map((name) => byHeading.get(name.toLowerCase())).filter((t): t is ThreadReading => !!t);
    for (const t of threads) claimed.add(t.heading.toLowerCase());
    const mark = marks.get(effortKey(e)) ?? { change: "unchanged" as const, changedLines: [] };
    return {
      name: e.name,
      person: e.person,
      section: e.section,
      threads: e.threads,
      size: e.size,
      sizeWords: e.sizeWords,
      posture: e.posture,
      direction: e.direction,
      change: mark.change,
      changedLines: mark.changedLines,
      lines: e.lines,
      readings: mergeReadings(threads, readings.today),
    };
  });
  const data = {
    today: readings.today,
    recentWindowDays: RECENT_WINDOW_DAYS,
    read: page.read,
    ask: page.ask,
    removed: page.removed,
    efforts: items,
    threadsWithoutEffort: readings.threads.filter((t) => !claimed.has(t.heading.toLowerCase())).map((t) => t.heading),
    load: readings.load,
    openQuestions: readings.openQuestions,
  };
  const frontmatter = [
    `asOfGraphHash: ${meta.asOfGraphHash}`,
    `generatedAt: ${meta.generatedAt}`,
    `skillFingerprint: ${meta.skillFingerprint}`,
  ].join("\n");
  return `---\n${frontmatter}\n---\n\nThe Efforts page as data, written by graph-project-view beside README.md. Read the page for the words; read this for the numbers.\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
}
