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
export function formatNodeVerbatim(node: GraphLogNode): string {
  return [`${node.date} Node ${node.number} (${node.authorName ?? "Unknown"}) [id: ${node.id}]:`, node.quote, node.refLine]
    .filter(Boolean)
    .join("\n");
}

const FILE_DIRECTIVE_RE = /::file\{[^}]*\}/g;

/** Every \`::file{...}\` directive verbatim (as it literally appears) in a
 * node's own quote — usually zero or one, never invented, since
 * `sync-graph`'s own \`add_node\` executor is the only writer (see that
 * file's own "A REAL, CONFIRMED GAP" module-doc note). Used by
 * `graph-project-view`'s own coverage pass to confirm a node's attached
 * file actually made it into the finished README — files are a hard
 * requirement there, not just a measurement. */
export function extractFileDirectives(quote: string): string[] {
  return [...quote.matchAll(FILE_DIRECTIVE_RE)].map((m) => m[0]);
}

export type BacklinkInfo = {
  count: number;
  /** Distinct author NAMES of the nodes linking in — not ids, since two
   * different people are the strongest weight signal `GRAPH_STRUCTURE.md`
   * cares about (see the `graphlog` skill), and names are what a prompt
   * can use directly without another lookup.
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
  fromAuthors: Set<string>;
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
      const authorName = node.authorName ?? "Unknown";
      if (existing) {
        existing.count += 1;
        existing.fromAuthors.add(authorName);
        if (node.date < existing.earliestDate) existing.earliestDate = node.date;
        if (node.date > existing.latestDate) existing.latestDate = node.date;
      } else {
        index.set(targetId, {
          count: 1,
          fromAuthors: new Set([authorName]),
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
