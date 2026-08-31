/**
 * GraphLog's `graph-structure` stage — sits between `sync-graph` and
 * `graph-project-view` (see the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure (this file)
 *     -> graph-project-view
 *
 * Keeps ONE file, `Graph/graph-structure.md`, an accurate, organized,
 * weighted index of the whole graph: every node clustered by topic/thread,
 * weighted, and status-annotated (active / open / settled / superseded).
 *
 * This exists to solve a problem neither neighboring stage can solve on
 * its own without reading the whole graph every time it does anything:
 *
 *   - `graph-project-view` needs to know what's actually heavy enough to
 *     feature in the README, which needs real weight (inbound links
 *     across the WHOLE graph), not just what one new day added.
 *   - `sync-graph` needs real candidate nodes to link new content back
 *     to, with enough content to judge relevance — not a bare, gloss-
 *     free `[date Node N](...)` link list.
 *
 * Both now read THIS file instead of re-deriving their own view of the
 * whole graph.
 *
 * A REAL ARCHITECTURE CHANGE FROM THIS STAGE'S ORIGINAL SHAPE: this used
 * to rebuild `graph-structure.md` FROM SCRATCH, in one non-tool,
 * non-streaming completion, reading every node's full text every single
 * run. That was found to be a genuine scaling problem, not just a
 * theoretical one — running this against a real project's real history
 * (88 nodes) truncated at the shared 8192-token output default (confirmed
 * via the failed call's own recorded `output_tokens: 8192`), and even
 * after a generous stage-specific override (20000), the Anthropic SDK's
 * own non-streaming ceiling (`expectedTime = 60min * maxTokens / 128000`,
 * ~21333 tokens) is a HARD WALL that any amount of further graph growth
 * will eventually hit again — this stage's output scaling with the WHOLE
 * graph's node count, forever, is a fundamentally unbounded shape, not a
 * dial that can just be turned up further.
 *
 * NOW: a bounded tool-calling loop (`update_cluster`/`remove_cluster`/
 * `get_node`, mirroring `graph-project-view.server.ts`'s own
 * `update_section`/`remove_section` shape closely) edits
 * `graph-structure.md` ONE CLUSTER AT A TIME, and the model is handed only
 * the nodes that are genuinely NEW since the last run — not the whole
 * graph's full text — plus the CURRENT `graph-structure.md` itself (already
 * compact by design) for context. A `get_node` tool lets it pull an
 * older node's full original text on demand if it's considering a merge/
 * split/rename, rather than that text being resent eagerly every run.
 * Steady-state runs (a few new nodes) now touch only the one or two
 * clusters those nodes belong to; a full rebuild (first run, or an
 * unparseable previous file — see below) still happens, but spread
 * across many small, bounded tool calls instead of one unbounded
 * completion, so the old hard ceiling is no longer reachable in ordinary
 * operation.
 *
 * `graph-structure.md`'s body is REQUIRED to be `## <Thread name>`
 * sections (`GRAPH_STRUCTURE.md`'s own node-format instructions already
 * specified this shape before this change — nothing about the file's
 * on-disk format changed, only how it gets edited) — this is what makes
 * it addressable with `project.types.ts`'s existing, already-proven
 * `splitReadmeSections`/`joinReadmeSections` helpers, unmodified, the
 * same primitives `graph-project-view` already uses for README sections.
 *
 * BACKWARD COMPATIBILITY: an existing project's `graph-structure.md` from
 * BEFORE this change already followed the `## Thread` / `- <date> Node
 * <N> (<author>) — <gloss>` shape (that format predates this change), so
 * its existing content parses and diffs against cleanly on the first
 * post-upgrade run. If a file somehow doesn't parse into any recognizable
 * node lines at all, every node in the graph is simply treated as "new"
 * for that one run — a full rebuild, same as a brand new project, just
 * safely spread across bounded tool calls rather than one completion.
 *
 * INBOUND LINK COUNTS, AND NOW EVERY CLUSTER'S "Weight: ..." LINE, ARE
 * FULLY CODE-COMPUTED, NEVER LEFT TO THE MODEL (`graphNodeIndex.server.ts`'s
 * `computeBacklinkIndex`, plus this file's own `refreshClusterWeight`) —
 * same reasoning `sync-graph` already applies to a node's own `:ref{...}`
 * citation: arithmetic a model does over text it's shown is strictly
 * worse than arithmetic the code just does and hands over as fact. The
 * model no longer needs to get a cluster's Weight numbers right AT ALL —
 * every cluster's Weight line (whether the model touched that cluster
 * this run or not) is recomputed from live backlink data as a
 * deterministic pass after the tool loop finishes, and clusters are then
 * re-sorted heaviest-first the same way. This also means a node gaining
 * an inbound link from somewhere else in the graph never requires the
 * model to revisit its own cluster just to keep its Weight line honest.
 *
 * KNOWN, ACCEPTED GAP: a node whose own TEXT changes without its id
 * changing (e.g. a past day's graph-log file gets regenerated with the
 * same date/number but different wording — possible, if rare, since
 * `sync-graph` deletes and fully regenerates a day whose source content
 * changed) won't be detected as "new" by the placement-delta logic below,
 * since only NODE IDS are diffed, not content. Its stale gloss in
 * `graph-structure.md` would go unnoticed until something else causes
 * that cluster to be touched. Not fixed here — no evidence yet that this
 * has happened in practice — but worth an explicit audit if it ever
 * shows up as a real symptom (a gloss that's clearly describing the
 * wrong words for a given node).
 *
 * IDEMPOTENT via an aggregate hash of every graph-log file's OWN
 * `sourceHash` (so a day `sync-graph` regenerates always invalidates this
 * stage too) — stored as `asOfGraphHash` in `graph-structure.md`'s own
 * front matter, UNCHANGED from before this redesign. What changed is
 * WHEN it's written: earlier tool-call commits during a run persist
 * `graph-structure.md`'s BODY immediately (so a crash mid-run keeps
 * whatever was already placed), but `asOfGraphHash` itself is only
 * stamped to the new value once the whole run finishes cleanly AND every
 * node has been confirmed placed — a run that gets interrupted, hits its
 * turn limit, or leaves any node unplaced is picked up again next time,
 * and the delta logic naturally finds only the STILL-unplaced nodes as
 * "new", since already-committed placements are already reflected in the
 * file it re-reads. `graph-project-view` stamps `appliedByProjectView` on
 * that SAME front matter once it successfully reconciles the README
 * against a given version — this stage never sets or reads that field.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter, splitReadmeSections, joinReadmeSections, type ReadmeSection } from "./project.types";
import {
  createFileRef,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import {
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import {
  aggregateHash,
  computeBacklinkIndex,
  extractDatesFromText,
  parseGraphLogNodes,
  type BacklinkInfo,
  type GraphLogNode,
} from "./graphNodeIndex.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { planTurnToolCalls } from "./llmProvider";
import type { LlmMessage, LlmProvider, LlmUsage, ToolDefinition } from "./llmProvider";

const GRAPH_STRUCTURE_FILE_NAME = "graph-structure.md";
const GRAPH_LOG_RE = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/;

type GraphStructureFrontmatter = {
  asOfGraphHash?: string;
  generatedAt?: string;
  appliedByProjectView?: string;
};

export function parseGraphStructureFrontmatter(content: string | null): GraphStructureFrontmatter {
  if (!content) return {};
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return {};
  try {
    return (parseYaml(frontmatter) as GraphStructureFrontmatter) ?? {};
  } catch {
    return {};
  }
}

/** Stamps `appliedByProjectView` onto `graph-structure.md`'s own front
 * matter, alongside (never replacing) this stage's own `asOfGraphHash`/
 * `generatedAt` — `graph-project-view`'s own idempotency marker, exported
 * for that stage to call directly rather than duplicating the
 * read-modify-write here. */
export async function markGraphStructureApplied(fileId: string, content: string, hash: string): Promise<void> {
  const { body } = splitFrontmatter(content);
  const meta = parseGraphStructureFrontmatter(content);
  const frontmatter = stringifyYaml({ ...meta, appliedByProjectView: hash }).trimEnd();
  await updateFileRef(fileId, { content: `---\n${frontmatter}\n---\n${body}` });
}

/** The inverse of `markGraphStructureApplied` — drops `appliedByProjectView`
 * while leaving `asOfGraphHash`/`generatedAt` exactly as they are. Returns
 * false (and writes nothing) when the marker wasn't set in the first place.
 *
 * Exists for `graphLogReset.server.ts`'s `resetProjectView`, and this is
 * NOT a nicety: both idempotency markers live on `graph-structure.md`, and
 * a project-view reset deliberately does not touch the `graph` folder. So
 * without this, clearing the README leaves `appliedByProjectView` still
 * equal to `asOfGraphHash`, `graph-project-view`'s own up-to-date check
 * short-circuits on the very next run, and the README stays empty until
 * something unrelated changes the graph — a reset whose entire purpose is
 * rebuilding the view, guaranteeing the view can never be rebuilt. (This
 * was a real, live failure, not a reading of the code.) `resetGraph`
 * doesn't need an equivalent: it deletes the whole folder, so both markers
 * go with it. */
export async function clearGraphStructureAppliedMarker(fileId: string, content: string): Promise<boolean> {
  const rewritten = withoutProjectViewMarker(content);
  if (rewritten === null) return false;
  await updateFileRef(fileId, { content: rewritten });
  return true;
}

/** Pure half of `clearGraphStructureAppliedMarker`, split out the same way
 * (and for the same reason) as `syncGraph.server.ts`'s `capNodeLinks` — so
 * the regression test can exercise "the applied marker goes, the graph
 * hash stays" directly, with no vault round-trip. Returns null when there
 * was no marker to clear, so the caller can skip the write entirely. */
export function withoutProjectViewMarker(content: string): string | null {
  const meta = parseGraphStructureFrontmatter(content);
  if (meta.appliedByProjectView === undefined) return null;
  const { body } = splitFrontmatter(content);
  const { appliedByProjectView: _dropped, ...rest } = meta;
  const frontmatter = stringifyYaml(rest).trimEnd();
  return `---\n${frontmatter}\n---\n${body}`;
}

/** The one file name this stage owns, exported so `resetProjectView` can
 * find it without re-declaring the literal. */
export const GRAPH_STRUCTURE_FILE = GRAPH_STRUCTURE_FILE_NAME;

function buildGraphStructureContent(meta: GraphStructureFrontmatter, body: string): string {
  const frontmatter = stringifyYaml(meta).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}

/** One node's full text block — its words, its author, and its
 * PRE-COMPUTED weight facts (see this file's own module doc for why
 * those are never left for the model to count itself). Used both for a
 * genuinely new node's own prompt block, and for `get_node`'s on-demand
 * lookup of an older one. */
function buildNodeBlock(node: GraphLogNode, backlinks: Map<string, BacklinkInfo>): string {
  const info = backlinks.get(node.id);
  const inbound = info
    ? `Inbound links: ${info.count} (${[...info.fromAuthors].join(", ")}; ${info.earliestDate} to ${info.latestDate})`
    : "Inbound links: none yet";
  const outbound = node.links.length > 0
    ? `Outbound links: ${node.links.map((l) => `-> ${l.date} Node ${l.number}`).join(", ")}`
    : null;
  return [
    `${node.date} Node ${node.number} (${node.authorName ?? "Unknown"}) [id: ${node.id}]:`,
    node.quote,
    inbound,
    outbound,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Cluster/node-id parsing — deterministic, over the fixed node-line
// shape `GRAPH_STRUCTURE.md`'s own instructions already specify ─────────

const NODE_LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s+Node\s+(\d+)\b/;
const WEIGHT_LINE_RE = /^Weight:/i;
const STATUS_SUFFIX_RE = /(·\s*Status:.*)$/i;
const STATUS_FIELD_RE = /·\s*Status:\s*([^·]*)/i;
const DUE_FIELD_RE = /·\s*Due:\s*([^·]*)/i;
const BLOCKING_FIELD_RE = /·\s*Blocking:\s*([^·]*)/i;

/** Exported for `graph-project-view.server.ts`'s own node pre-fetch/
 * `get_node` (1.1/ADR-006) to reuse the exact same parsing rather than
 * re-deriving it. */
export function nodeIdsInSection(section: ReadmeSection): string[] {
  const ids: string[] = [];
  for (const line of section.content.split("\n")) {
    const match = NODE_LINE_RE.exec(line.trim());
    if (match) ids.push(`${match[1]}#${Number(match[2])}`);
  }
  return ids;
}

/** Exported for `graph-project-view.server.ts`'s own `get_node` id
 * validation — "same as `add_node` already does for link candidates"
 * (1.1). */
export function buildMembershipIndex(sections: ReadmeSection[]): Set<string> {
  const set = new Set<string>();
  for (const section of sections) {
    for (const id of nodeIdsInSection(section)) set.add(id);
  }
  return set;
}

/** A field is "present" only when it has a real, non-placeholder value —
 * guards against a stray literal \`<date>\`/\`<what it holds up>\` left
 * over from the node-format template shown in `GRAPH_STRUCTURE.md`. */
function isRealFieldValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  return trimmed.length > 0 && !/^<.*>$/.test(trimmed);
}

export type ClusterStatusCategory = "settled" | "superseded" | "dormant" | "other";

export type ClusterFields = {
  hasDue: boolean;
  hasBlocking: boolean;
  statusCategory: ClusterStatusCategory;
};

/** Reads the `Due`/`Blocking`/`Status` fields off a cluster's own
 * "Weight: ... · Status: ... · Due: ... · Blocking: ..." line (see
 * `GRAPH_STRUCTURE.md`'s own "four fields on a thread") — these are the
 * model's real judgment calls (never recomputed, unlike Weight itself),
 * read back deterministically wherever code needs to ACT on them (the
 * sort order below; `graph-project-view`'s "fell away" detection). A
 * cluster with no recognizable Weight line has none of these.
 *
 * THAT LAST SENTENCE IS THE WHOLE OF ADR-014
 * (docs/adr/0014-status-lives-on-the-weight-line.md, kept out of the
 * public repo). The `Weight:` line is the CARRIER for a thread's three
 * judged fields, not a display of its weight, so deleting the skill
 * instruction that asks for it -- which looks like a pure cleanup, since
 * the weight value itself is unconditionally recomputed -- silently
 * strips every thread of its Status, Due and Blocking instead. */
export function parseClusterFields(section: ReadmeSection): ClusterFields {
  const line = section.content.split("\n").find((l) => WEIGHT_LINE_RE.test(l.trim())) ?? "";
  const statusRaw = STATUS_FIELD_RE.exec(line)?.[1];
  const status = (statusRaw ?? "").trim().toLowerCase();
  const statusCategory: ClusterStatusCategory = status.startsWith("settled")
    ? "settled"
    : status.startsWith("superseded")
      ? "superseded"
      : status.startsWith("dormant")
        ? "dormant"
        : "other";
  return {
    hasDue: isRealFieldValue(DUE_FIELD_RE.exec(line)?.[1]),
    hasBlocking: isRealFieldValue(BLOCKING_FIELD_RE.exec(line)?.[1]),
    statusCategory,
  };
}

/** A thread that's "fallen away" per `GRAPH_STRUCTURE.md`'s own "Falling
 * away" section (ADR-009) — dormant, no Due, no Blocking. Its nodes stay
 * in the graph permanently and it stays in graph-structure.md (so
 * `sync-graph` can still link back to it — ADR-004), it just stops being
 * surfaced to the README. Exported for `graph-project-view.server.ts`'s
 * own coverage report (1.2) to report which threads this run. */
export function hasFallenAway(section: ReadmeSection): boolean {
  const fields = parseClusterFields(section);
  return fields.statusCategory === "dormant" && !fields.hasDue && !fields.hasBlocking;
}

/**
 * Counts what the model actually judged, across every cluster after a
 * clean finish. A counter, not a judgment: nothing here changes a run's
 * outcome or corrects a field.
 *
 * The reason it exists at all is that this whole redesign happened because
 * nine of ten threads said `active`, nothing said settled or superseded,
 * and nobody knew until a human read the file weeks later. This line would
 * have said it on run one. `parseClusterFields` had exactly two callers,
 * `rankCluster` and `hasFallenAway`, and neither of them counts anything.
 *
 * The two directions to watch are opposite. Everything collapsing to one
 * Status is the failure that already happened: a label costs nothing to
 * type, so the safest one wins. A climbing `Blocking` share is the alarm
 * for the other direction, since `Blocking` is supposed to be rare and
 * name a real consequence.
 */
/** Real threads only — the same intro/`Unclustered` exclusions every other
 * per-cluster pass in this file applies, so the reported thread count means
 * the same thing the file's own headings do. */
function countNamedClusters(sections: ReadmeSection[]): number {
  return sections.filter(
    (s) => s.heading !== "" && s.heading.toLowerCase() !== "unclustered",
  ).length;
}

export function summarizeClusterFields(sections: ReadmeSection[]): string {
  let active = 0;
  let dormant = 0;
  let settled = 0;
  let superseded = 0;
  let due = 0;
  let blocking = 0;
  for (const section of sections) {
    if (section.heading === "" || section.heading.toLowerCase() === "unclustered") continue;
    const fields = parseClusterFields(section);
    if (fields.statusCategory === "settled") settled++;
    else if (fields.statusCategory === "superseded") superseded++;
    else if (fields.statusCategory === "dormant") dormant++;
    else active++;
    if (fields.hasDue) due++;
    if (fields.hasBlocking) blocking++;
  }
  return `active ${active}, dormant ${dormant}, settled ${settled}, superseded ${superseded}; Due ${due}, Blocking ${blocking}`;
}

/** Restates a thread's Weight line from LIVE backlink data — pure
 * arithmetic, run unconditionally over every cluster after every clean
 * finish, regardless of whether the model touched that cluster this run.
 * A cluster's own Status text (if present, after "· Status:") is
 * preserved verbatim; only the numbers/dates before it are replaced.
 *
 * A cluster with NO recognizable "Weight:" line gets one written for it,
 * as the cluster's first line. It used to be skipped instead, which was
 * the worst of both: the model is told to write `Weight: (recomputed)` on
 * every cluster and to spend no effort on it, this function overwrites
 * whatever it wrote unconditionally, and a cluster that missed the line
 * was then left with no Weight and no Status parsing at all
 * (`parseClusterFields` reads both off that one line, so a cluster without
 * it silently has no Due, no Blocking and no status either). Code writing
 * the line closes that gap and lets the instruction come out of the skill:
 * every `update_cluster` call on every run was spending output tokens on a
 * line guaranteed to be discarded. */
export function refreshClusterWeight(section: ReadmeSection, backlinks: Map<string, BacklinkInfo>): ReadmeSection {
  const lines = section.content.split("\n");
  const weightLineIndex = lines.findIndex((l) => WEIGHT_LINE_RE.test(l.trim()));

  const nodeIds = nodeIdsInSection(section);
  let count = 0;
  const authors = new Set<string>();
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const id of nodeIds) {
    const info = backlinks.get(id);
    if (!info) continue;
    count += info.count;
    for (const a of info.fromAuthors) authors.add(a);
    if (!earliest || info.earliestDate < earliest) earliest = info.earliestDate;
    if (!latest || info.latestDate > latest) latest = info.latestDate;
  }
  const weightText = count === 0 || !earliest || !latest
    ? "Weight: no inbound links yet"
    : `Weight: ${count} inbound link${count === 1 ? "" : "s"}, ${authors.size} ${authors.size === 1 ? "person" : "people"}, ${earliest} \u2192 ${latest}`;

  if (weightLineIndex === -1) {
    // No Weight line at all: write one in, ahead of whatever the cluster
    // does have. No Status suffix to preserve, because the Status lived on
    // the line that isn't there.
    return { heading: section.heading, content: [weightText, ...lines].join("\n") };
  }

  const statusMatch = STATUS_SUFFIX_RE.exec(lines[weightLineIndex]);
  const newLines = [...lines];
  newLines[weightLineIndex] = statusMatch ? `${weightText} ${statusMatch[1]}` : weightText;
  return { heading: section.heading, content: newLines.join("\n") };
}

function totalInboundCount(nodeIds: string[], backlinks: Map<string, BacklinkInfo>): number {
  return nodeIds.reduce((sum, id) => sum + (backlinks.get(id)?.count ?? 0), 0);
}

/** The union of distinct linking authors across every node in a
 * cluster — brake, not a default, see ADR-003 (docs/adr/0003-rank-by-
 * distinct-authors.md, kept out of the public repo, and the matching note
 * on `BacklinkInfo.fromAuthors` in `graphNodeIndex.server.ts`). This is
 * read BEFORE raw count in `rankCluster` below — never replace that
 * ordering with a plain count/sum, even though the two usually agree. */
function distinctAuthorsInSection(nodeIds: string[], backlinks: Map<string, BacklinkInfo>): number {
  const authors = new Set<string>();
  for (const id of nodeIds) {
    const info = backlinks.get(id);
    if (!info) continue;
    for (const a of info.fromAuthors) authors.add(a);
  }
  return authors.size;
}

function latestInboundDate(nodeIds: string[], backlinks: Map<string, BacklinkInfo>): string {
  let latest = "";
  for (const id of nodeIds) {
    const info = backlinks.get(id);
    if (info && info.latestDate > latest) latest = info.latestDate;
  }
  return latest;
}

type ClusterRank = { tier: number; distinctAuthors: number; totalCount: number; latestDate: string };

/**
 * Places one cluster on the importance-and-urgency grid `GRAPH_STRUCTURE.md`
 * itself now describes (ADR-008: "the structure file's order serves the
 * next stages, not a human reader") — NOT the earlier "raw link count
 * only" sort this replaces. `Blocking`/`Due` are the model's own judgment
 * calls (never recomputed, see `parseClusterFields`); everything below
 * them is ordered by real, code-computed weight, distinct authors first
 * (ADR-003). A thread that's dormant with neither field has fallen away
 * (ADR-009) and sinks to the very bottom, tier 5, rather than competing
 * on weight at all — an old, heavy thread nobody's kept alive should NOT
 * be able to outrank a live one just because it accumulated more links
 * over more time.
 */
function rankCluster(section: ReadmeSection, backlinks: Map<string, BacklinkInfo>): ClusterRank {
  const fields = parseClusterFields(section);
  const nodeIds = nodeIdsInSection(section);
  const tier = fields.hasBlocking && fields.hasDue
    ? 1
    : fields.hasBlocking
      ? 2
      : fields.hasDue
        ? 3
        : fields.statusCategory !== "other"
          ? 5 // settled / superseded / dormant, carrying neither Due nor Blocking
          : 4;
  return {
    tier,
    distinctAuthors: distinctAuthorsInSection(nodeIds, backlinks),
    totalCount: totalInboundCount(nodeIds, backlinks),
    latestDate: latestInboundDate(nodeIds, backlinks),
  };
}

/** Re-sorts named clusters down the importance-and-urgency grid (see
 * `rankCluster`) — never the model's job to order by feel, and (per
 * ADR-008) never optimized for a human reading this file directly: this
 * order is what `sync-graph` sees as its backward-link candidate list and
 * what `graph-project-view` reads off top-down, so it serves THEM. The
 * intro (heading `""`, should always be empty per `GRAPH_STRUCTURE.md`'s
 * own "no preamble" instruction) stays first if present; `## Unclustered`
 * (per that same skill's own convention for a node with no thread yet)
 * always stays last, never competing for a "live work" slot. */
export function sortClustersByWeight(sections: ReadmeSection[], backlinks: Map<string, BacklinkInfo>): ReadmeSection[] {
  const intro = sections.filter((s) => s.heading === "");
  const unclustered = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() === "unclustered");
  const named = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() !== "unclustered");
  const ranked = named.map((section) => ({ section, rank: rankCluster(section, backlinks) }));
  ranked.sort((a, b) => {
    if (a.rank.tier !== b.rank.tier) return a.rank.tier - b.rank.tier;
    if (a.rank.distinctAuthors !== b.rank.distinctAuthors) return b.rank.distinctAuthors - a.rank.distinctAuthors;
    if (a.rank.totalCount !== b.rank.totalCount) return b.rank.totalCount - a.rank.totalCount;
    return b.rank.latestDate.localeCompare(a.rank.latestDate);
  });
  return [...intro, ...ranked.map((r) => r.section), ...unclustered];
}

// ─── The graph-structure tool-calling loop ─────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "update_cluster",
    description:
      'Replace or create one "## Thread name" cluster in graph-structure.md with the given full content (just the body -- a "Weight: ... · Status: ..." line plus one "- <date> Node <N> (<author>) — <gloss>" line per member node; never include the "## " heading line itself, pass it separately). The Weight numbers you write are IGNORED and recomputed automatically from real data after every run, regardless of what you write there -- write a placeholder and spend your effort on Status and the node list instead. Use this for both brand-new threads and any edit to an existing one (adding a node, re-glossing, renaming, changing status).',
    inputSchema: {
      type: "object",
      properties: {
        heading: { type: "string" },
        content: { type: "string" },
      },
      required: ["heading", "content"],
    },
  },
  {
    name: "remove_cluster",
    description:
      'Deletes one "## Thread name" cluster entirely. Only ever use this alongside an update_cluster call that re-homes its nodes into another cluster (e.g. merging two threads, or renaming one by writing the new heading and removing the old) -- never to drop nodes from the graph.',
    inputSchema: {
      type: "object",
      properties: { heading: { type: "string" } },
      required: ["heading"],
    },
  },
  {
    name: "get_node",
    description:
      'Fetch one existing node\'s full verbatim text, author, and links by id (e.g. "2026-07-29#3" -- ids are shown in brackets after each node you\'re given, and in every "- <date> Node <N>" line you see). Nodes new since your last run are already given to you in full; use this only for an OLDER node you need to re-examine before deciding to merge, split, or re-cluster threads.',
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
];

function createStructureExecutors(input: {
  projectFolder: VaultFolder;
  graphFolderId: string;
  log: (line: string) => void;
  initialSections: ReadmeSection[];
  initialFileId: string | undefined;
  baseMeta: GraphStructureFrontmatter;
  allNodesById: Map<string, GraphLogNode>;
  backlinks: Map<string, BacklinkInfo>;
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  hadRefusal: () => boolean;
  anyCommitted: () => boolean;
  getCurrent: () => { sections: ReadmeSection[]; fileId: string | undefined };
} {
  const { projectFolder, graphFolderId, log, baseMeta, allNodesById, backlinks } = input;
  let currentSections = input.initialSections;
  let currentFileId = input.initialFileId;
  let hadRefusal = false;
  let committed = false;

  async function commit(newSections: ReadmeSection[]): Promise<boolean> {
    const body = joinReadmeSections(newSections);
    const content = buildGraphStructureContent({ ...baseMeta, generatedAt: new Date().toISOString() }, body);
    if (!currentFileId) {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: GRAPH_STRUCTURE_FILE_NAME,
        content,
        content_type: "text/markdown",
        folder_id: graphFolderId,
      });
      if (!created) return false;
      currentFileId = created._id;
    } else {
      await updateFileRef(currentFileId, { content });
    }
    currentSections = newSections;
    committed = true;
    return true;
  }

  const executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>> = {
    update_cluster: async (toolInput) => {
      const heading = String(toolInput.heading ?? "").trim();
      const content = String(toolInput.content ?? "");
      if (!heading) return "Error: heading is required";
      const key = heading.toLowerCase();
      const existingIndex = currentSections.findIndex((s) => s.heading.toLowerCase() === key);
      const existing = existingIndex === -1 ? null : currentSections[existingIndex];

      if (content.trim().length === 0 && existing && existing.content.trim().length > 0) {
        hadRefusal = true;
        log(`graph-structure -- refused update_cluster "${heading}" (would erase real content with an empty cluster); left unchanged.`);
        return `Error: refused -- cluster "${heading}" currently has real content; sending empty content would erase it. Use remove_cluster if you genuinely want to delete it.`;
      }

      const updated = existing
        ? currentSections.map((s, i) => (i === existingIndex ? { heading: existing.heading, content } : s))
        : [...currentSections, { heading, content }];
      const ok = await commit(updated);
      if (!ok) return "Error: failed to save cluster update";
      log(`graph-structure -- ${existing ? "updated" : "added"} cluster "${heading}".`);
      return `${existing ? "Updated" : "Added"} cluster "${heading}".`;
    },
    remove_cluster: async (toolInput) => {
      const heading = String(toolInput.heading ?? "").trim();
      const key = heading.toLowerCase();
      const existingIndex = currentSections.findIndex((s) => s.heading.toLowerCase() === key);
      if (existingIndex === -1) return `Error: no cluster named "${heading}" found`;
      const updated = currentSections.filter((_, i) => i !== existingIndex);
      const ok = await commit(updated);
      if (!ok) return "Error: failed to remove cluster";
      log(`graph-structure -- removed cluster "${heading}".`);
      return `Removed cluster "${heading}".`;
    },
    get_node: async (toolInput) => {
      const nodeId = String(toolInput.nodeId ?? "").trim();
      const node = allNodesById.get(nodeId);
      if (!node) return `Error: no node found with id "${nodeId}"`;
      return buildNodeBlock(node, backlinks);
    },
  };

  return {
    executors,
    hadRefusal: () => hadRefusal,
    anyCommitted: () => committed,
    getCurrent: () => ({ sections: currentSections, fileId: currentFileId }),
  };
}

/** Generous relative to `graph-project-view`'s own MAX_TURNS=20 -- a
 * first-ever build (or a fallback full rebuild against an unparseable
 * previous file, see this file's own module doc) may need one
 * update_cluster call per thread, and a real project can have dozens.
 * Each turn is small/bounded (one cluster's worth of output), so a higher
 * ceiling here costs proportionally more calls, not more risk -- and that
 * is now ENFORCED in the loop below (at most one write call executed per
 * turn) rather than assumed, which is what this comment used to do while
 * a real run truncated on six `update_cluster` calls in one turn.
 *
 * Per ADR-013 this bounds one BATCH, never how many nodes a run may
 * contain: a batch that hits the limit commits what it placed and the
 * next run picks up the still-unplaced remainder. */
const MAX_TURNS = 40;

/** The two tools whose call input carries a whole cluster's worth of
 * content, and so the two `planTurnToolCalls` throttles. */
const isStructureWrite = (name: string) => name === "update_cluster" || name === "remove_cluster";

/** Splits a large new-node delta (a first-ever build, or a fallback full
 * rebuild against an unparseable previous file) into separate, smaller
 * conversations rather than handing the model everything at once. Found
 * necessary directly: a real 61-node bootstrap run truncated on its very
 * FIRST turn, before any tool call completed at all -- consistent with
 * the model spending its per-turn output budget on planning/narration
 * text for the whole batch before ever calling a tool, an easier trap to
 * fall into the more there is to organize at once. Each batch still
 * benefits from `createStructureExecutors`'s own persisted state (the
 * NEXT batch's prompt reflects whatever the previous one already placed),
 * so this doesn't change the end result, only how much the model is
 * asked to hold in mind in any one conversation. A steady-state run (a
 * handful of new nodes) is always exactly one batch, unaffected. */
const NEW_NODE_BATCH_SIZE = 15;

async function runStructureAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  callCounter: { count: number },
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  perf: GraphLogPerfRecorder,
  batchIndex: number,
  batchCount: number,
  projectFolderId: string,
): Promise<{ usage: LlmUsage; model: string | null; truncated: boolean; hitMaxTurns: boolean }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per turn, so a Stop request never
    // waits longer than the current tool call.
    await throwIfGraphLogCancelled(projectFolderId);
    // The system prompt (skill instructions -- stable across every turn
    // AND every batch of this whole run) is worth caching from the
    // second real completion onward, same convention `sync-graph` uses
    // for its own (larger) cached block.
    const cacheSystemPrompt = callCounter.count > 0;
    const turnStart = Date.now();
    const response = await provider.complete({ system, messages, tools: TOOLS, cacheSystemPrompt });
    callCounter.count++;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    // Cache counts, same as `syncGraph.server.ts`'s own loop -- see there
    // for why these were missing everywhere and what it cost us.
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (response.usage.cacheReadTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0);
    model = response.model;

    // One perf event PER TURN -- see `syncGraph.server.ts`'s own
    // identically-shaped addition for the full reasoning (a real,
    // individually-timed API call, nested under this batch's own
    // aggregate event, carrying whatever plain text the model wrote
    // this turn -- otherwise thrown away the moment it's folded into
    // `messages` below).
    await perf.event({
      process: "graph-structure",
      type: "llm",
      name: "turn",
      params: {
        batchIndex,
        batchCount,
        turn: turn + 1,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls.map((c) => c.name),
        text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
      },
      durationMs: Date.now() - turnStart,
      outcome: response.stopReason === "max_tokens" ? "error" : "ok",
    });

    if (response.stopReason === "max_tokens") {
      // Same "leave it, retry later" convention every other GraphLog
      // stage already uses -- no truncation-retry escalation.
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    // At most ONE WRITE call (update_cluster/remove_cluster) executed per
    // turn -- the same enforcement, for the same reason, that
    // `syncGraph.server.ts`'s own loop applies to `add_node`. Every tool
    // call in one response shares that response's single output budget,
    // and an `update_cluster` call carries a whole cluster's node list as
    // its input, so N clusters in one turn is N clusters' worth of
    // generated output against one `DEFAULT_MAX_TOKENS`. That is exactly
    // how a real run truncated: six `update_cluster` calls in a single
    // turn on a large graph, `stopReason: "max_tokens"`, batch discarded.
    //
    // `MAX_TURNS`'s own comment above has always CLAIMED each turn is
    // "one cluster's worth of output". Until now nothing made that true;
    // it was an assumption sitting next to a constant, which is precisely
    // the state `add_node` was in before its own identical fix. The
    // system prompt asks for one call per cluster too, but a prompt is
    // never trusted here for something code can just enforce.
    //
    // `get_node` is deliberately NOT limited: it's a read, its call input
    // is a single id, and batching several costs nothing in output. The
    // budget problem belongs entirely to the writes.
    for (const { call, execute } of planTurnToolCalls(response.toolCalls, isStructureWrite)) {
      const resultText = execute
        ? ((await executors[call.name]?.(call.input)) ?? `Unknown tool: ${call.name}`)
        : "Not processed -- only the FIRST update_cluster/remove_cluster call in a turn is executed, to keep each turn's own output within its limit. Call it again on your next turn for this cluster.";
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns };
}

function buildSystemPrompt(skillContent: string): string {
  return `You are GraphLog's graph-structure step, keeping Graph/graph-structure.md an accurate, organized, weighted index of the whole graph. You're handed the CURRENT graph-structure.md (already organized from every earlier run) plus only the node(s) that are genuinely new since last time -- place each new node into whichever existing cluster it belongs to, or start a new one via update_cluster if it doesn't fit anywhere yet. Only touch clusters that actually need a change, one update_cluster/remove_cluster call per cluster -- never try to redescribe the whole file in one call. If real restructuring is warranted (renaming, merging, or splitting threads), do it, but only through update_cluster/remove_cluster calls on the specific clusters involved. Call get_node if you need an older node's exact original wording before deciding to merge or split. Stop making tool calls once every new node has a home and any warranted restructuring is done -- if nothing needs to change at all, make no tool calls. Every node must end up with a home somewhere; never drop one because it seems minor.

Do not write any planning, reasoning, or summary text outside of a tool call -- go straight to calling update_cluster/remove_cluster/get_node with no preamble and no narration in between calls either. Your own output budget per turn is limited, and explanatory text spends it on nothing that ends up in the file.

${skillContent}`;
}

/**
 * Per-existing-thread MECHANICAL facts (`GRAPH_STRUCTURE.md`'s own "What
 * you receive": "the date of its most recent node, and any dates found
 * in its nodes' own text") — both plain arithmetic/regex, never the
 * model's job to recompute, same "never trust the model with something
 * code can just hand over" reasoning every other precomputed fact in
 * this pipeline already follows. What these MEAN (a commitment vs. a
 * passing mention; whether a thread is actually dormant) stays the
 * model's own judgment via `Status`/`Due`/`Blocking` — this only surfaces
 * the raw material for that judgment. Skips a cluster with no real nodes
 * (a stray heading) and the intro/Unclustered pseudo-sections, which have
 * no meaningful "most recent node" of their own. */
/** Whole days between two ISO `YYYY-MM-DD` dates. Deliberately crude (no
 * timezone reasoning) because the inputs are date-only and the consumer is
 * a judgment about "weeks", not an hour-accurate figure. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function buildClusterFactsBlock(
  sections: ReadmeSection[],
  allNodesById: Map<string, GraphLogNode>,
  today: string,
): string | null {
  const lines: string[] = [];
  for (const section of sections) {
    if (section.heading === "" || section.heading.toLowerCase() === "unclustered") continue;
    const nodeIds = nodeIdsInSection(section);
    if (nodeIds.length === 0) continue;
    let mostRecent: string | null = null;
    const mentionedDates = new Set<string>();
    for (const id of nodeIds) {
      const node = allNodesById.get(id);
      if (!node) continue;
      if (!mostRecent || node.date > mostRecent) mostRecent = node.date;
      for (const d of extractDatesFromText(node.quote)) mentionedDates.add(d);
    }
    if (!mostRecent && mentionedDates.size === 0) continue;
    const mentioned = mentionedDates.size > 0 ? [...mentionedDates].sort().join(", ") : "none found";
    // The gap is handed over as a NUMBER rather than left as two dates for
    // the model to subtract. Same family as citations, weights and link
    // counts: arithmetic the code can do exactly is never the model's job.
    // This is the specific figure `GRAPH_STRUCTURE.md`'s own dormancy rule
    // ("nothing added for weeks") is written against, so without it that
    // rule was asking for a judgment whose input didn't exist.
    const quiet = mostRecent ? `; ${daysBetween(mostRecent, today)} day(s) quiet since then` : "";
    lines.push(
      `- "${section.heading}" — most recent node: ${mostRecent ?? "unknown"}${quiet}; dates mentioned in its nodes' own text: ${mentioned}`,
    );
  }
  if (lines.length === 0) return null;
  return `Per-thread mechanical facts (you decide what they mean — a commitment vs. a passing mention, dormant vs. just quiet):\n\n${lines.join("\n")}`;
}

function buildUserPrompt(input: {
  today: string;
  existingStructureBody: string | null;
  clusterFactsBlock: string | null;
  newNodeBlocks: string[];
}): string {
  return [
    // This stage is asked to decide whether a thread is dormant ("nothing
    // added for weeks") and whether a date inside a node is a live
    // commitment or a passing mention. Neither question has an answer
    // without knowing what NOW is, and this prompt did not contain the
    // current date anywhere -- `graph-project-view` was handed one, its
    // sibling was not. The mechanical facts below give every reference
    // point except this one.
    `Today's actual date: ${input.today}`,
    input.existingStructureBody
      ? `The CURRENT graph-structure.md:\n\n${input.existingStructureBody}`
      : "No graph-structure.md exists yet -- every node below needs a fresh home.",
    input.clusterFactsBlock,
    input.newNodeBlocks.length > 0
      ? `Node(s) new since the last run, needing a home (full text -- call get_node for anything else you need to re-examine):\n\n${input.newNodeBlocks.join("\n\n---\n\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export type GraphStructureResult =
  | {
      ok: true;
      /** True when `skills/GRAPH_STRUCTURE.md` is missing or says "skip"
       * — a total no-op, no files examined, no model called. */
      skipped: boolean;
      /** True when `graph-structure.md` was actually edited this run
       * (including a deterministic weight-only refresh with no LLM call
       * at all); false when it was already fully up to date. */
      changed: boolean;
      /** Total nodes across every `graph-log-*.md` at the end of this run,
       * and total threads in `graph-structure.md`. Null when this stage
       * didn't get far enough to know (skipped, no graph yet, stopped
       * early).
       *
       * 1.7's missing denominators. This stage already parses every node
       * in the graph and every cluster in the index in order to do its own
       * job, so these cost nothing to report and are the terms that make
       * the cost curves legible: extraction's INPUT scales with graph size
       * (all of `graph-structure.md` rides in `sync-graph`'s system prompt
       * as the link-candidate list and is resent every turn), so extraction
       * cost is roughly nodes-that-day multiplied by graph size. One run at
       * one graph size is not a curve. */
      graphNodeCount: number | null;
      threadCount: number | null;
      /** Reasons this stage finished WITHOUT doing everything it set out
       * to, one human-readable line each; empty when it finished clean.
       *
       * `ok: true` here means "nothing threw and whatever was captured is
       * safely committed", NOT "the stage did its whole job". Those came
       * apart in a real run: a truncated batch left this stage's own work
       * half-done and its downstream stage producing nothing, and the run
       * still reported OK at the top. A partial result that says it is
       * partial is fine (ADR-011 -- a budget bounds how late the derived
       * layer runs, never what is kept); a partial result that reports
       * itself as complete is not. `graphLogAgent.server.ts` collects
       * these across all five stages so the run's own status can say so.
       *
       * Deliberately NOT `ok: false`: every case here is resumable, made
       * real progress, and is picked up by the next run. Failing the job
       * outright would discard that progress in the reporting and invite
       * a retry of work that already landed. */
      incomplete: string[];
    }
  | { ok: false; error: string };

export interface RunGraphStructureOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. */
  perf?: GraphLogPerfRecorder;
}

/**
 * Runs graph-structure for one project: reads every existing
 * `graph-log-*.md` file, and if the graph has changed since the last time
 * this ran (`asOfGraphHash` mismatch), diffs the current node set against
 * whichever nodes `graph-structure.md` already has homes for, and asks
 * the model to place only the DIFFERENCE — via a bounded tool-calling
 * loop editing `graph-structure.md` one cluster at a time — rather than
 * rebuilding the whole file from scratch. See this file's own module doc
 * for the full redesign rationale.
 */
export async function runGraphStructure(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunGraphStructureOptions = {},
): Promise<GraphStructureResult> {
  const log = opts.log ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const skill = await getProjectStageSkill(projectFolder, "GRAPH_STRUCTURE.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, changed: false, graphNodeCount: null, threadCount: null, incomplete: [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) {
    log("graph-structure: no Graph/ folder yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, graphNodeCount: null, threadCount: null, incomplete: [] };
  }

  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const graphLogListings = files
    .map((f) => ({ listing: f, date: GRAPH_LOG_RE.exec(f.name)?.[1] }))
    .filter((f): f is { listing: typeof files[number]; date: string } => !!f.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (graphLogListings.length === 0) {
    log("graph-structure: no graph-log files yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, graphNodeCount: null, threadCount: null, incomplete: [] };
  }

  const allNodes: GraphLogNode[] = [];
  const hashParts: string[] = [];
  for (const { listing, date } of graphLogListings) {
    const file = await getFileRefById(listing._id);
    if (!file?.content) continue;
    const { body, frontmatter } = splitFrontmatter(file.content);
    hashParts.push(`${date}:${frontmatter ?? file.content_hash ?? listing._id}`);
    allNodes.push(...parseGraphLogNodes(date, body));
  }

  const newHash = aggregateHash(hashParts);
  const structureListing = files.find((f) => f.name === GRAPH_STRUCTURE_FILE_NAME);
  const existing = structureListing ? await getFileRefById(structureListing._id) : undefined;
  const existingMeta = parseGraphStructureFrontmatter(existing?.content ?? null);

  if (existing && existingMeta.asOfGraphHash === newHash) {
    log("graph-structure: up to date, nothing changed since last run.");
    return { ok: true, skipped: false, changed: false, graphNodeCount: null, threadCount: null, incomplete: [] };
  }

  if (allNodes.length === 0) {
    log("graph-structure: no parsed nodes found in any graph-log file — nothing to organize.");
    return { ok: true, skipped: false, changed: false, graphNodeCount: null, threadCount: null, incomplete: [] };
  }

  const backlinks = computeBacklinkIndex(allNodes);
  const allNodesById = new Map(allNodes.map((n) => [n.id, n]));
  const baseMeta: GraphStructureFrontmatter = { ...existingMeta };

  const existingSections = existing ? splitReadmeSections(splitFrontmatter(existing.content ?? "").body) : [];
  const placedIds = buildMembershipIndex(existingSections);
  const newNodes = allNodes.filter((n) => !placedIds.has(n.id));

  // Nothing genuinely new to PLACE — the graph's hash still moved (e.g. a
  // day was regenerated producing identical node ids), but there's no
  // placement decision left for the model to make. Refresh every
  // cluster's Weight line from live data (pure arithmetic, never the
  // model's job) and stamp the new hash without spending an LLM call at
  // all.
  if (newNodes.length === 0 && existingSections.length > 0) {
    const refreshed = sortClustersByWeight(
      existingSections.map((s) => refreshClusterWeight(s, backlinks)),
      backlinks,
    );
    const content = buildGraphStructureContent(
      { ...baseMeta, asOfGraphHash: newHash, generatedAt: new Date().toISOString() },
      joinReadmeSections(refreshed),
    );
    if (existing) await updateFileRef(existing._id, { content });
    log("graph-structure: no new nodes to place — refreshed weights only, no LLM call.");
    log(`graph-structure: ${summarizeClusterFields(refreshed)}.`);
    return {
      ok: true,
      skipped: false,
      changed: true,
      graphNodeCount: allNodes.length,
      threadCount: countNamedClusters(refreshed),
      incomplete: [],
    };
  }

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");
  const system = buildSystemPrompt(skillContent);

  const sortedNewNodes = newNodes.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number,
  );
  const batches: GraphLogNode[][] = [];
  for (let i = 0; i < sortedNewNodes.length; i += NEW_NODE_BATCH_SIZE) {
    batches.push(sortedNewNodes.slice(i, i + NEW_NODE_BATCH_SIZE));
  }

  const { executors, hadRefusal, anyCommitted, getCurrent } = createStructureExecutors({
    projectFolder,
    graphFolderId: graphFolder._id,
    log,
    initialSections: existingSections,
    initialFileId: existing?._id,
    baseMeta,
    allNodesById,
    backlinks,
  });

  // Same source `graph-project-view` uses for its own `Today's actual
  // date:` line -- date-only, UTC, computed once per run so every batch in
  // one run agrees about what today is.
  const today = new Date().toISOString().slice(0, 10);

  const runCallStart = Date.now();
  try {
    const llm = opts.provider ?? new AnthropicProvider();
    const callCounter = { count: 0 };

    for (const [batchIndex, batchNodes] of batches.entries()) {
      // Reflects whatever the PREVIOUS batch (or a prior run) already
      // committed -- each batch is a fresh, small conversation, never a
      // single giant one trying to place every new node from scratch,
      // which is what let a large bootstrap run's own planning/narration
      // balloon a single turn's output past the provider's limit.
      const { sections: currentSections } = getCurrent();
      const existingStructureBody =
        currentSections.length > 0 ? joinReadmeSections(currentSections).trim() : null;
      const clusterFactsBlock = buildClusterFactsBlock(currentSections, allNodesById, today);
      const newNodeBlocks = batchNodes.map((n) => buildNodeBlock(n, backlinks));
      const userPrompt = buildUserPrompt({ today, existingStructureBody, clusterFactsBlock, newNodeBlocks });
      const batchLabel = batches.length > 1 ? ` (batch ${batchIndex + 1}/${batches.length})` : "";

      const callStart = Date.now();
      const { usage, model, truncated, hitMaxTurns } = await runStructureAgentLoop(
        llm,
        system,
        userPrompt,
        callCounter,
        executors,
        perf,
        batchIndex,
        batches.length,
        projectFolder._id,
      );

      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "graph-structure",
        kind: "graph-structure",
        model: model ?? undefined,
        usage,
        durationMs,
        outcome: truncated ? "error" : "success",
        errorKind: truncated ? "incomplete" : undefined,
      });
      await perf.event({
        process: "graph-structure",
        type: "llm",
        name: "batch",
        params: { batchIndex, batchCount: batches.length, nodeCount: batchNodes.length },
        durationMs,
        outcome: truncated ? "error" : "ok",
      });

      // Each of these three leaves the file half-organized, and every one
      // of them ALSO leaves `asOfGraphHash` unstamped, which makes
      // `graph-project-view` skip its next run entirely. That downstream
      // consequence is the reason these have to be reported rather than
      // just logged: one truncated batch here is a silently empty view
      // stage there, and the run used to call the pair of them OK.
      if (truncated) {
        const reason = `a turn was cut off by the model's own output limit${batchLabel}`;
        log(`graph-structure: ${reason} — will retry next run.`);
        return {
          ok: true,
          skipped: false,
          changed: anyCommitted(),
          graphNodeCount: null,
          threadCount: null,
          incomplete: [reason],
        };
      }
      if (hitMaxTurns) {
        const reason = `hit its turn limit before finishing${batchLabel}`;
        log(`graph-structure: ${reason} — will retry next run.`);
        return {
          ok: true,
          skipped: false,
          changed: anyCommitted(),
          graphNodeCount: null,
          threadCount: null,
          incomplete: [reason],
        };
      }
      if (hadRefusal()) {
        const reason = `had at least one refused edit${batchLabel}`;
        log(`graph-structure: ${reason} — will retry next run.`);
        return {
          ok: true,
          skipped: false,
          changed: anyCommitted(),
          graphNodeCount: null,
          threadCount: null,
          incomplete: [reason],
        };
      }
    }

    // Safety net, never trusting the model's own sense that it's done:
    // confirm every node in the graph actually has a home before
    // stamping this version applied.
    const { sections: finalSections, fileId } = getCurrent();
    const finalPlaced = buildMembershipIndex(finalSections);
    const stillMissing = allNodes.filter((n) => !finalPlaced.has(n.id));
    if (stillMissing.length > 0) {
      const reason = `${stillMissing.length} node(s) still unplaced (e.g. ${stillMissing[0].id})`;
      log(`graph-structure: ${reason} after this run — will retry next run.`);
      return {
          ok: true,
          skipped: false,
          changed: anyCommitted(),
          graphNodeCount: null,
          threadCount: null,
          incomplete: [reason],
        };
    }

    // Clean finish: recompute every cluster's Weight line from live
    // backlink data and re-sort heaviest-first (both pure arithmetic,
    // never the model's job — see this file's own module doc), then
    // stamp this graph's hash as fully applied.
    const reconciled = sortClustersByWeight(
      finalSections.map((s) => refreshClusterWeight(s, backlinks)),
      backlinks,
    );
    const reconciledContent = buildGraphStructureContent(
      { ...baseMeta, asOfGraphHash: newHash, generatedAt: new Date().toISOString() },
      joinReadmeSections(reconciled),
    );
    if (fileId) await updateFileRef(fileId, { content: reconciledContent });

    log(`graph-structure: placed ${newNodes.length} new node(s) across ${reconciled.length} cluster(s).`);
    log(`graph-structure: ${summarizeClusterFields(reconciled)}.`);
    return {
      ok: true,
      skipped: false,
      changed: true,
      graphNodeCount: allNodes.length,
      threadCount: countNamedClusters(reconciled),
      incomplete: [],
    };
  } catch (err) {
    log(`graph-structure: couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
    const durationMs = Date.now() - runCallStart;
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-structure",
      kind: "graph-structure",
      durationMs,
      outcome: "error",
      errorKind: classifyGraphLogError(err),
    });
    await perf.event({
      process: "graph-structure",
      type: "llm",
      name: "batch",
      params: null,
      durationMs,
      outcome: "error",
    });
    return {
      ok: true,
      skipped: false,
      changed: anyCommitted(),
      graphNodeCount: null,
      threadCount: null,
      incomplete: [`stopped on an error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
