/**
 * Parses GraphLog's `Graph/graph-log-YYYY-MM-DD.md` files back into
 * structured node records, and computes real (never LLM-guessed) inbound
 * link counts across the whole graph — the deterministic grounding data
 * `graph-structure.server.ts` hands its model, per the `graphlog` skill's
 * own reasoning: "citations are pre-computed, never left to the model"
 * already applies to a node's `:ref{...}`, and the same logic applies here
 * — counting links is arithmetic, and arithmetic a model does over text
 * it's shown is strictly worse than arithmetic the code just does.
 *
 * Deliberately simple LINE-based regex parsing, not a full markdown
 * parser — same tradeoff `syncGraph.server.ts`'s own `extractHeadings`/
 * `existingSourceHash` already make for this exact generated-file shape
 * (a node's structure is fully controlled by `GRAPH.md`'s own format, so
 * there's no need for `oxmarkdown-core`'s real parser here).
 */

import { createHash } from "node:crypto";

export type NodeLink = { date: string; number: number };

export type GraphLogNode = {
  /** Canonical id, e.g. `"2026-07-29#3"` — unique across the whole graph. */
  id: string;
  date: string;
  number: number;
  /** The verbatim `==...==` quote (and any surrounding prose the model
   * wrote), exactly as it appears between the heading and the `:ref{...}`
   * line — never re-derived or summarized here. */
  quote: string;
  authorName: string | null;
  authorHumanId: string | null;
  /** The exact, unmodified `:ref{...}` line as it appears in the
   * graph-log file — kept verbatim (not just the name/humanId parsed out
   * of it below) so a later stage that needs to COPY a citation (see
   * `graph-project-view`'s own "the view stage reads node text" fix,
   * ADR-006) never has to re-serialize one from parts and risk it drifting
   * from what `sync-graph` actually wrote. */
  refLine: string;
  /** This node's own OUTBOUND links — other nodes it points AT. */
  links: NodeLink[];
};

function nodeId(date: string, number: number): string {
  return `${date}#${number}`;
}

const NODE_HEADING_RE = /^###[ \t]+Node[ \t]+(\d+)[ \t]*$/;
const REF_LINE_RE = /^:ref\{(.*)\}[ \t]*$/;
const LINK_LINE_RE = /^-\s*\[(\d{4}-\d{2}-\d{2})\s+Node\s+(\d+)\]/;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function parseRefLineAttrs(raw: string): { name: string | null; humanId: string | null } {
  let name: string | null = null;
  let humanId: string | null = null;
  for (const match of raw.matchAll(ATTR_RE)) {
    if (match[1] === "name") name = match[2];
    if (match[1] === "human-id") humanId = match[2];
  }
  return { name, humanId };
}

/**
 * Splits ONE graph-log file's BODY (front matter already stripped) into
 * its `### Node <N>` blocks. A block with no `:ref{...}` line (shouldn't
 * happen for real GraphLog output, but a hand-edited or malformed file is
 * possible) is skipped rather than guessed at.
 */
export function parseGraphLogNodes(date: string, body: string): GraphLogNode[] {
  const lines = body.split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (NODE_HEADING_RE.test(line.trim())) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  const nodes: GraphLogNode[] = [];
  for (const block of blocks) {
    const headingMatch = NODE_HEADING_RE.exec(block[0].trim());
    if (!headingMatch) continue;
    const number = Number(headingMatch[1]);

    const refIndex = block.findIndex((l) => REF_LINE_RE.test(l.trim()));
    if (refIndex === -1) continue; // malformed — no citation, skip rather than guess.
    const refMatch = REF_LINE_RE.exec(block[refIndex].trim())!;
    const { name, humanId } = parseRefLineAttrs(refMatch[1]);

    const quote = block.slice(1, refIndex).join("\n").trim();

    const links: NodeLink[] = [];
    for (const line of block.slice(refIndex + 1)) {
      const linkMatch = LINK_LINE_RE.exec(line.trim());
      if (linkMatch) links.push({ date: linkMatch[1], number: Number(linkMatch[2]) });
    }

    nodes.push({
      id: nodeId(date, number),
      date,
      number,
      quote,
      authorName: name,
      authorHumanId: humanId,
      refLine: block[refIndex].trim(),
      links,
    });
  }
  return nodes;
}

/**
 * Formats one node for a stage that needs to WRITE FROM it (not just
 * count links against it) — verbatim quote plus its exact citation, so
 * the model can copy a `:ref{...}` directive rather than construct one
 * (ADR-005). Used by `graph-project-view`'s own node pre-fetch/`get_node`
 * (ADR-006) — deliberately separate from `graphStructure.server.ts`'s own
 * `buildNodeBlock`, which also carries inbound/outbound link facts that
 * matter for CLUSTERING a node but not for writing prose from one.
 */
/**
 * Drops the `verbose="true"` attribute from a `:ref{...}` line, leaving
 * everything else byte-identical.
 *
 * Two callers, and they must use the SAME function or the second one
 * silently breaks. `graph-project-view` hands node text to the model in
 * view mode (`refDirective.ts`: verbose is for graph-log files, every
 * other use omits it), and the coverage report decides whether a node was
 * featured by looking for its citation in the finished README. If the
 * stripping and the matching disagree by one attribute, every node reads
 * as dropped.
 *
 * Normalizing BOTH sides through here is what makes the comparison
 * independent of which mode the citation happens to be in.
 */
export function stripRefVerbose(text: string): string {
  return text.replace(/\s+verbose="true"/g, "");
}

export function formatNodeVerbatim(node: GraphLogNode, today?: string): string {
  // The age is handed over as a NUMBER rather than left as two dates for
  // the model to subtract. `PROJECT_VIEW.md` asks it to work out each open
  // item's age from today against a node's date; the code holds both
  // exactly. Same family as the citation itself, a cluster's weight, and
  // the link counts: arithmetic the code can do exactly is never the
  // model's job, and a model doing date subtraction over prose is a way to
  // get a confidently wrong number into a README.
  const age = today ? daysBetweenIso(node.date, today) : null;
  const ageNote = age === null ? "" : ` [${age} day(s) ago]`;
  // VIEW MODE CITATION. `verbose="true"` is right in a graph-log file and
  // wrong everywhere else -- `refDirective.ts` says so outright: verbose
  // is for graph-log entries, every other use omits it. Verbose renders a
  // spelled-out `Name · date · source` block after the sentence; without
  // it, `RefDirectiveMarker` renders a small inline `*` opening a popover
  // with the same information.
  //
  // The README inherited the record's citation style purely because the
  // model is told to copy the node's `:ref{...}` exactly as it appears,
  // which is the right rule and stays. Eleven block attributions is what
  // turned a README into a wall. So the mode is decided HERE, in code, by
  // handing the view a citation already in the form it should use. The
  // model still copies exactly and never edits a directive.
  //
  // MUST stay `stripRefVerbose`: `computeCoverageReport` decides a node
  // was featured by matching this same line against the README, and
  // normalizes through the same function. Render a view citation any other
  // way and every node silently reports as dropped.
  return [
    `${node.date}${ageNote} Node ${node.number} (${node.authorName ?? "Unknown"}) [id: ${node.id}]:`,
    node.quote,
    node.refLine ? stripRefVerbose(node.refLine) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Whole days between two ISO `YYYY-MM-DD` dates. Deliberately crude (no
 * timezone reasoning): the inputs are date-only and the consumer is prose
 * about how long ago something was, not an hour-accurate figure. */
function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// Matches all three shapes `syncGraph.server.ts`'s own
// `buildAttachedMediaMarkdown` can produce: an image (`![alt](url)`), a
// video link (`[alt](url?type=video)`), or a plain file link
// (`[alt](url)`) — the leading `!` is optional, everything else is the
// same `[...](/api/vault/view/...)` shape either way.
const ATTACHED_FILE_RE = /!?\[[^\]]*\]\(\/api\/vault\/view\/[^)\s]+\)/g;

/** Every attached-file markdown line verbatim (as it literally appears)
 * in a node's own quote — usually zero or one, never invented, since
 * `sync-graph`'s own \`add_node\` executor is the only writer (see that
 * file's own "A REAL, CONFIRMED GAP" module-doc note). A node's own
 * attached file is ORDINARY markdown — no custom directive at all — so
 * it degrades gracefully anywhere, and a writer can freely group several
 * photos/videos under a shared \`:::gallery{}...:::\` wrapper without
 * touching the image/link line itself (see `graph-project-view`'s own
 * "Files travel with their nodes" note). Used by `graph-project-view`'s
 * own coverage pass to confirm a node's attached file actually made it
 * into the finished README — files are a hard requirement there, not
 * just a measurement. */
export function extractAttachedFileLines(quote: string): string[] {
  return [...quote.matchAll(ATTACHED_FILE_RE)].map((m) => m[0]);
}

export type BacklinkInfo = {
  count: number;
  /** Distinct author HUMAN IDS of the nodes linking in — two different
   * people are the strongest weight signal `GRAPH_STRUCTURE.md` cares
   * about (see the `graphlog` skill), and the id is the only half of a
   * citation that stays distinct per person no matter what happened to
   * the display name.
   *
   * It used to hold names, which is how ADR-015's failure ran: every
   * contributor with no local `humans` row resolved to the same literal
   * "Unknown", so this set — the one thing standing between one loud
   * writer and the whole ranking — collapsed to size 1 for all of them at
   * once, and nothing errored. See ADR-015; a name is for reading, an id
   * is for counting.
   *
   * brake, not a default — see ADR-003 (docs/adr/0003-rank-by-distinct-authors.md,
   * kept out of the public repo). Every caller that RANKS by weight (see
   * `graphStructure.server.ts`'s own thread sort) must read the SIZE of
   * this set before it reads `count` — one person circling their own idea
   * produces the same `count` as two people converging on it, and
   * converging-from-different-directions is the only signal here that
   * justifies a multi-person tool over a private journal. Collapsing this
   * to a sum (it looks like a harmless, faster optimization: a `Set` costs
   * more to maintain than a running total, and on any given day the two
   * numbers usually agree) is silent — nothing errors, convergence just
   * stops showing up in the ranking and whoever writes the most starts
   * winning every one of them. */
  fromAuthorIds: Set<string>;
  /** The same people's DISPLAY NAMES, for the one place that shows them
   * (`graphStructure.server.ts`'s own `buildNodeBlock` writes them into a
   * prompt line). Never counted -- counting these is the bug ADR-015
   * exists to close, and the reason the two sets are separate rather than
   * one set doing both jobs. */
  fromAuthorNames: Set<string>;
  earliestDate: string;
  latestDate: string;
};

/**
 * Walks every node's own OUTBOUND `links` and builds the REVERSE index:
 * for each node id, how many other nodes point at it, from how many
 * distinct people, across what date span. A node with zero inbound links
 * simply has no entry — callers should treat a missing id as "0, no
 * authors, no span", not an error.
 */
export function computeBacklinkIndex(allNodes: GraphLogNode[]): Map<string, BacklinkInfo> {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const index = new Map<string, BacklinkInfo>();

  for (const node of allNodes) {
    for (const link of node.links) {
      const targetId = nodeId(link.date, link.number);
      if (!byId.has(targetId)) continue; // the model named a link that doesn't exist — ignore, don't fabricate.
      const existing = index.get(targetId);
      // Identity, in descending order of trustworthiness: the human id
      // (distinct per person even when the name isn't), then the name (a
      // graph written before ADR-015 has no ids at all), then the node's
      // own id — which is unique, so two genuinely unattributable nodes
      // count as two people rather than silently merging into one. Never
      // a shared literal: that is exactly what "Unknown" was.
      const authorId = node.authorHumanId ?? node.authorName ?? node.id;
      const authorName = node.authorName ?? "Unknown";
      if (existing) {
        existing.count += 1;
        existing.fromAuthorIds.add(authorId);
        existing.fromAuthorNames.add(authorName);
        if (node.date < existing.earliestDate) existing.earliestDate = node.date;
        if (node.date > existing.latestDate) existing.latestDate = node.date;
      } else {
        index.set(targetId, {
          count: 1,
          fromAuthorIds: new Set([authorId]),
          fromAuthorNames: new Set([authorName]),
          earliestDate: node.date,
          latestDate: node.date,
        });
      }
    }
  }
  return index;
}

const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const MONTH_DAY_YEAR_RE = new RegExp(
  `\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
  "gi",
);

/**
 * Best-effort scan for date-like mentions in a node's own verbatim text —
 * feeds `graph-structure`'s own "dates found in a thread's nodes" fact
 * (see `GRAPH_STRUCTURE.md`'s "Due and Blocking" section: code finds the
 * dates, the MODEL judges whether each is a real commitment or a passing
 * mention — never the reverse). Deliberately permissive rather than
 * precise: an over-detected non-date is harmless noise the model already
 * has to judge past anyway, but a missed real deadline is invisible
 * forever, same "be generous" tradeoff `GRAPH.md` already makes for
 * whether something earns a node at all. Returns ISO `YYYY-MM-DD` where
 * the source was already that explicit, otherwise the mention as written
 * (e.g. "August 20") — deduped, not otherwise interpreted.
 */
export function extractDatesFromText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ISO_DATE_RE)) found.add(match[1]);
  for (const match of text.matchAll(MONTH_DAY_YEAR_RE)) found.add(match[0].trim());
  return [...found];
}

/** Deterministic hash over a set of parts, order-independent — same
 * "sort, join, sha256, truncate" shape `syncGraph.server.ts`'s own
 * `aggregateHash` uses, duplicated rather than imported (see this
 * package's established convention of small, independent duplications
 * across GraphLog stage files over cross-file coupling). */
export function aggregateHash(parts: string[]): string {
  return createHash("sha256").update([...parts].sort().join("|")).digest("hex").slice(0, 16);
}
