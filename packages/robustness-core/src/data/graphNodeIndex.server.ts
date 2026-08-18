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
      links,
    });
  }
  return nodes;
}

export type BacklinkInfo = {
  count: number;
  /** Distinct author NAMES of the nodes linking in — not ids, since two
   * different people are the strongest weight signal `GRAPH_STRUCTURE.md`
   * cares about (see the `graphlog` skill), and names are what a prompt
   * can use directly without another lookup. */
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

/** Deterministic hash over a set of parts, order-independent — same
 * "sort, join, sha256, truncate" shape `syncGraph.server.ts`'s own
 * `aggregateHash` uses, duplicated rather than imported (see this
 * package's established convention of small, independent duplications
 * across GraphLog stage files over cross-file coupling). */
export function aggregateHash(parts: string[]): string {
  return createHash("sha256").update([...parts].sort().join("|")).digest("hex").slice(0, 16);
}
