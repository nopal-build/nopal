/**
 * A photo is a node of its own, linked to the words it belongs to, and it
 * never re-reads its day (2026-10-30).
 *
 * Why. A photo used to be a source of the day's extraction: its
 * description went into the agent's prompt and its hash into the day's
 * `sourceHash`. One new photo, one new description, one caption re-ran
 * the agent over every source on that day, and a seeded day holds 150 of
 * them. Ambika Sohal's seed cost $17 in one run, most of it the agent
 * re-reading photo descriptions turn after turn.
 *
 * Now the day's text pass reads words only (`syncGraph.server.ts`), and
 * this module writes each photo's node by code, after the text nodes:
 *
 * - The node says what the photo shows: the uploader's caption (their
 *   words, highlighted) or the AI description, unhighlighted and marked
 *   as such (ADR-012, unchanged). The photo itself is attached.
 * - It links to the text node it belongs to, if any. Found by code when
 *   the photo sits under a paragraph in a Card (nodes quote verbatim, so
 *   the paragraph is in the node); otherwise asked once, text only, of a
 *   small model (`photo-link`). The answer, "none" included, is kept in
 *   the day file's front matter (`photoLinks`) against the photo's own
 *   hash and the linked node's words, and is not asked again until one of
 *   those changes.
 * - The photo nodes sit after a marker line; everything before it is the
 *   text pass's. A text re-extraction rewrites what is above the marker,
 *   and this re-appends what is below from the stored links, for free.
 *
 * A photo already carried by a text node (a caption written as a mark on
 * the Photos tab, or a node written before this change) gets no node of
 * its own; that node already is it.
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractAttachedFileLines, parseGraphLogNodes, type GraphLogNode } from "./graphNodeIndex.server";
import { splitFrontmatter } from "./project.types";
import type { LlmProvider, LlmUsage } from "./llmProvider";

/** Everything after this line in a day file was written by this module. */
export const PHOTO_NODES_MARKER = "<!-- Photo nodes below: written by code from each photo's caption or description, one per photo (photoNodes.server.ts). -->";

/** One photo or video on a day, as sync-graph found it. */
export type DayMedia = {
  /** The id the file is served by; what its attached line points at. */
  fileId: string;
  name: string;
  /** The file's own content hash: a changed photo is asked about again. */
  hash: string;
  /** The uploader's caption on the Card, or null. */
  caption: string | null;
  /** The AI description (sync-knowledge's sidecar body), or null. */
  description: string | null;
  /** The paragraph just above the photo in its Card, or null. */
  context: string | null;
  /** The node's `:ref{...}` line, built by sync-graph like any source's. */
  citation: string;
  /** The attached image or video line, built by sync-graph. */
  mediaLine: string;
};

export type PhotoLinkRecord = {
  /** The photo's hash when the link was decided. */
  hash: string;
  /** The linked node's words (`quoteKey`), or null for "belongs to no node". */
  quote: string | null;
  by: "code" | "model";
};

export type PhotoLinks = Record<string, PhotoLinkRecord>;

/** Splits a day file's body into the text pass's part and this module's. */
export function splitPhotoSection(body: string): { text: string; photos: string } {
  const at = body.indexOf(PHOTO_NODES_MARKER);
  if (at === -1) return { text: body.trim(), photos: "" };
  return { text: body.slice(0, at).trim(), photos: body.slice(at + PHOTO_NODES_MARKER.length).trim() };
}

/** The ids of the photo nodes in one day file's body. */
export function photoNodeIdsOf(date: string, body: string): Set<string> {
  return new Set(parseGraphLogNodes(date, splitPhotoSection(body).photos).map((n) => n.id));
}

/** Words for matching: no highlight marks, no markdown punctuation, one case. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/==/g, "")
    .replace(/[*_`>#[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A node's own words, without attached files or code-written provenance
 * lines: what a photo link remembers the node by, since node numbers
 * change when a day re-extracts. */
export function quoteKey(quote: string): string {
  const lines = quote
    .split("\n")
    .filter((l) => extractAttachedFileLines(l).length === 0 && !/^\*.*\*$/.test(l.trim()));
  return normalizeForMatch(lines.join(" ")).slice(0, 200);
}

/** How many photos may share one paragraph for it to say what each shows.
 * A few photos under a sentence illustrate it; a Card that ends with a
 * paragraph and then 35 photos (This Healthy House, 2026-09-30) is a
 * photo dump, and its last sentence is about none of them in particular. */
export const CONTEXT_SHARED_LIMIT = 3;

/** Each attachment's paragraph, kept only where few enough share it. */
export function photoContexts(attachments: readonly { name: string; context: string }[]): Map<string, string> {
  const shared = new Map<string, number>();
  for (const a of attachments) if (a.context) shared.set(a.context, (shared.get(a.context) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const a of attachments) if (a.context && (shared.get(a.context) ?? 0) <= CONTEXT_SHARED_LIMIT) out.set(a.name, a.context);
  return out;
}

/** The text node whose words hold the paragraph a photo was attached
 * under, or that the paragraph holds. Short text matches too much, so
 * both sides need some length. */
export function nodeForContext(context: string, nodes: readonly GraphLogNode[]): GraphLogNode | null {
  const ctx = normalizeForMatch(context);
  if (ctx.length < 12) return null;
  for (const node of nodes) {
    const words = normalizeForMatch(node.quote);
    if (words.length < 12) continue;
    if (words.includes(ctx) || ctx.includes(words.slice(0, Math.min(words.length, 80)))) return node;
  }
  return null;
}

/** The fileIds a day's text nodes already attach. */
export function filesCarriedBy(nodes: readonly GraphLogNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const line of extractAttachedFileLines(node.quote)) {
      const id = /\/api\/vault\/view\/([^)?\s]+)/.exec(line)?.[1];
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** The node a photo belongs to, null for none, or undefined when no
 * answer came back (an API error): that photo is linked to nothing this
 * run and asked again next run, never stored as "none". */
export type ChooseNode = (media: DayMedia, nodes: readonly GraphLogNode[]) => Promise<GraphLogNode | null | undefined>;

/**
 * The photo nodes for one day and the links behind them. Pure apart from
 * `chooseByModel`, which is only called for a photo with no stored link,
 * no matching Card paragraph, and text nodes to choose from.
 */
export async function planPhotoNodes(input: {
  date: string;
  textBody: string;
  media: readonly DayMedia[];
  links: PhotoLinks;
  descriptionOnlyProvenance: string;
  chooseByModel: ChooseNode;
}): Promise<{ section: string; links: PhotoLinks; asked: number; linkedByCode: number }> {
  const textNodes = parseGraphLogNodes(input.date, input.textBody);
  const carried = filesCarriedBy(textNodes);
  const byKey = new Map(textNodes.map((n) => [quoteKey(n.quote), n]));
  const links: PhotoLinks = {};
  let asked = 0;
  let linkedByCode = 0;
  let next = textNodes.reduce((max, n) => Math.max(max, n.number), 0) + 1;
  const blocks: string[] = [];

  const media = [...input.media].sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId));
  for (const m of media) {
    if (carried.has(m.fileId)) continue;
    if (!m.caption?.trim() && !m.description?.trim()) continue;

    let linked: GraphLogNode | null = null;
    const stored = input.links[m.fileId];
    if (stored && stored.hash === m.hash && (stored.quote === null || byKey.has(stored.quote))) {
      linked = stored.quote === null ? null : byKey.get(stored.quote)!;
      links[m.fileId] = stored;
    } else {
      const byContext = m.context ? nodeForContext(m.context, textNodes) : null;
      if (byContext) {
        linked = byContext;
        linkedByCode++;
        links[m.fileId] = { hash: m.hash, quote: quoteKey(byContext.quote), by: "code" };
      } else if (textNodes.length > 0) {
        asked++;
        const chosen = await input.chooseByModel(m, textNodes);
        linked = chosen ?? null;
        if (chosen !== undefined) links[m.fileId] = { hash: m.hash, quote: chosen ? quoteKey(chosen.quote) : null, by: "model" };
      } else {
        // Nothing on the day to link to. Not stored, so a photo on a day
        // that later gets words is asked about then.
        linked = null;
      }
    }

    const caption = m.caption?.trim();
    const words = caption ? `==${caption}==` : [m.description!.trim(), input.descriptionOnlyProvenance].join("\n\n");
    const link = linked ? `- [${input.date} Node ${linked.number}](./graph-log-${input.date}.md#node-${linked.number})` : null;
    blocks.push([`### Node ${next}`, words, m.mediaLine, m.citation, link].filter(Boolean).join("\n"));
    next++;
  }

  return { section: blocks.join("\n\n"), links, asked, linkedByCode };
}

/** A day file with its photo section and photo links replaced; null when
 * nothing about them changed, so the file is not rewritten. */
export function withPhotoNodes(input: {
  date: string;
  existingContent: string | null;
  section: string;
  links: PhotoLinks;
}): string | null {
  const { frontmatter, body } = input.existingContent ? splitFrontmatter(input.existingContent) : { frontmatter: null, body: "" };
  const meta = (frontmatter ? (parseYaml(frontmatter) as Record<string, unknown> | null) : null) ?? {};
  const { text } = splitPhotoSection(body ?? "");
  const hasLinks = Object.keys(input.links).length > 0;
  const photoNodesHash = createHash("sha256")
    .update(`${input.section}\n${JSON.stringify(sortedLinks(input.links))}`)
    .digest("hex")
    .slice(0, 16);
  if (meta.photoNodesHash === photoNodesHash && splitPhotoSection(body ?? "").photos === input.section.trim()) return null;
  if (!input.section && !meta.photoNodesHash && !hasLinks) return null;

  const nextMeta: Record<string, unknown> = { ...meta, date: meta.date ?? input.date };
  if (hasLinks) nextMeta.photoLinks = sortedLinks(input.links);
  else delete nextMeta.photoLinks;
  nextMeta.photoNodesHash = photoNodesHash;
  if (!nextMeta.generatedAt) nextMeta.generatedAt = new Date().toISOString();
  const nextBody = [text, input.section ? `${PHOTO_NODES_MARKER}\n\n${input.section}` : null].filter(Boolean).join("\n\n");
  return `---\n${stringifyYaml(nextMeta).trimEnd()}\n---\n\n${nextBody.trim()}\n`;
}

/** The stored photo links in a day file's front matter. */
export function readPhotoLinks(content: string | null): PhotoLinks {
  if (!content) return {};
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return {};
  try {
    const meta = parseYaml(frontmatter) as Record<string, unknown> | null;
    const raw = meta?.photoLinks;
    if (!raw || typeof raw !== "object") return {};
    const out: PhotoLinks = {};
    for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
      const r = rec as Record<string, unknown>;
      if (typeof r?.hash !== "string") continue;
      out[id] = { hash: r.hash, quote: typeof r.quote === "string" ? r.quote : null, by: r.by === "code" ? "code" : "model" };
    }
    return out;
  } catch {
    return {};
  }
}

function sortedLinks(links: PhotoLinks): PhotoLinks {
  return Object.fromEntries(Object.entries(links).sort(([a], [b]) => a.localeCompare(b)));
}

/** How long a node preview the model reads when choosing. */
const NODE_PREVIEW_CHARS = 240;

/**
 * One photo, the day's notes, one answer: which note the photo belongs
 * to, or none. Text only: the description already says what the photo
 * shows, so the image is never sent again.
 */
export async function chooseNodeByModel(
  llm: LlmProvider,
  media: DayMedia,
  nodes: readonly GraphLogNode[],
): Promise<{ node: GraphLogNode | null; usage: LlmUsage; model: string }> {
  const list = nodes
    .map((n) => `Note ${n.number}: ${Array.from(normalizeForMatch(n.quote)).slice(0, NODE_PREVIEW_CHARS).join("")}`)
    .join("\n");
  const about = [
    media.caption ? `Caption by the person who took it: "${media.caption}"` : null,
    media.description ? `Description: ${media.description.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const response = await llm.complete({
    system:
      "You link a photo from a construction project's daily log to the one note from the same day that it shows or illustrates. Answer with the note's number only, or the word none if no note is about what the photo shows. Do not explain.",
    messages: [{ role: "user", content: `Notes from the day:\n${list}\n\nThe photo:\n${about}\n\nWhich note number, or none?` }],
    tools: [],
    maxTokens: 64,
  });
  const answer = (response.text ?? "").trim().toLowerCase();
  const number = /\d+/.exec(answer)?.[0];
  const node = number ? nodes.find((n) => n.number === Number(number)) ?? null : null;
  return { node, usage: response.usage, model: response.model };
}
