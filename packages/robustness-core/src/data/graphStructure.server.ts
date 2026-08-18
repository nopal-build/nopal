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
  parseGraphLogNodes,
  type BacklinkInfo,
  type GraphLogNode,
} from "./graphNodeIndex.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
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

function nodeIdsInSection(section: ReadmeSection): string[] {
  const ids: string[] = [];
  for (const line of section.content.split("\n")) {
    const match = NODE_LINE_RE.exec(line.trim());
    if (match) ids.push(`${match[1]}#${Number(match[2])}`);
  }
  return ids;
}

function buildMembershipIndex(sections: ReadmeSection[]): Set<string> {
  const set = new Set<string>();
  for (const section of sections) {
    for (const id of nodeIdsInSection(section)) set.add(id);
  }
  return set;
}

/** Restates a thread's Weight line from LIVE backlink data — pure
 * arithmetic, run unconditionally over every cluster after every clean
 * finish, regardless of whether the model touched that cluster this run.
 * A cluster's own Status text (if present, after "· Status:") is
 * preserved verbatim; only the numbers/dates before it are replaced. A
 * cluster with no recognizable "Weight:" line at all is left untouched
 * rather than guessing where to insert one. */
function refreshClusterWeight(section: ReadmeSection, backlinks: Map<string, BacklinkInfo>): ReadmeSection {
  const lines = section.content.split("\n");
  const weightLineIndex = lines.findIndex((l) => WEIGHT_LINE_RE.test(l.trim()));
  if (weightLineIndex === -1) return section;

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

  const statusMatch = STATUS_SUFFIX_RE.exec(lines[weightLineIndex]);
  const newLines = [...lines];
  newLines[weightLineIndex] = statusMatch ? `${weightText} ${statusMatch[1]}` : weightText;
  return { heading: section.heading, content: newLines.join("\n") };
}

function totalInboundCount(nodeIds: string[], backlinks: Map<string, BacklinkInfo>): number {
  return nodeIds.reduce((sum, id) => sum + (backlinks.get(id)?.count ?? 0), 0);
}

/** Re-sorts named clusters heaviest-first by real inbound-link count —
 * arithmetic, never the model's job to order by feel. The intro
 * (heading `""`, should always be empty per `GRAPH_STRUCTURE.md`'s own
 * "no preamble" instruction) stays first if present; `## Unclustered`
 * (per that same skill's own convention for zero-inbound-link nodes)
 * always stays last. */
function sortClustersByWeight(sections: ReadmeSection[], backlinks: Map<string, BacklinkInfo>): ReadmeSection[] {
  const intro = sections.filter((s) => s.heading === "");
  const unclustered = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() === "unclustered");
  const named = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() !== "unclustered");
  const sorted = [...named].sort(
    (a, b) => totalInboundCount(nodeIdsInSection(b), backlinks) - totalInboundCount(nodeIdsInSection(a), backlinks),
  );
  return [...intro, ...sorted, ...unclustered];
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

/** Generous relative to `graph-project-view`'s own MAX_TURNS=8 -- a
 * first-ever build (or a fallback full rebuild against an unparseable
 * previous file, see this file's own module doc) may need one
 * update_cluster call per thread, and a real project can have dozens.
 * Each turn is still small/bounded (one cluster's worth of output), so a
 * higher ceiling here costs proportionally more calls, not more risk. */
const MAX_TURNS = 40;

async function runStructureAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
): Promise<{ usage: LlmUsage; model: string | null; truncated: boolean; hitMaxTurns: boolean }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await provider.complete({ system, messages, tools: TOOLS });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    if (response.stopReason === "max_tokens") {
      // Same "leave it, retry later" convention every other GraphLog
      // stage already uses -- no truncation-retry escalation.
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns };
}

function buildSystemPrompt(skillContent: string): string {
  return `You are GraphLog's graph-structure step, keeping Graph/graph-structure.md an accurate, organized, weighted index of the whole graph. You're handed the CURRENT graph-structure.md (already organized from every earlier run) plus only the node(s) that are genuinely new since last time -- place each new node into whichever existing cluster it belongs to, or start a new one via update_cluster if it doesn't fit anywhere yet. Only touch clusters that actually need a change, one update_cluster/remove_cluster call per cluster -- never try to redescribe the whole file in one call. If real restructuring is warranted (renaming, merging, or splitting threads), do it, but only through update_cluster/remove_cluster calls on the specific clusters involved. Call get_node if you need an older node's exact original wording before deciding to merge or split. Stop making tool calls once every new node has a home and any warranted restructuring is done -- if nothing needs to change at all, make no tool calls. Every node must end up with a home somewhere; never drop one because it seems minor.\n\n${skillContent}`;
}

function buildUserPrompt(input: { existingStructureBody: string | null; newNodeBlocks: string[] }): string {
  return [
    input.existingStructureBody
      ? `The CURRENT graph-structure.md:\n\n${input.existingStructureBody}`
      : "No graph-structure.md exists yet -- every node below needs a fresh home.",
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
    }
  | { ok: false; error: string };

export interface RunGraphStructureOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
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

  const skill = await getProjectStageSkill(projectFolder, "GRAPH_STRUCTURE.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, changed: false };
  }
  if (!isPhylogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) {
    log("graph-structure: no Graph/ folder yet — nothing to do.");
    return { ok: true, skipped: false, changed: false };
  }

  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const graphLogListings = files
    .map((f) => ({ listing: f, date: GRAPH_LOG_RE.exec(f.name)?.[1] }))
    .filter((f): f is { listing: typeof files[number]; date: string } => !!f.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (graphLogListings.length === 0) {
    log("graph-structure: no graph-log files yet — nothing to do.");
    return { ok: true, skipped: false, changed: false };
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
    return { ok: true, skipped: false, changed: false };
  }

  if (allNodes.length === 0) {
    log("graph-structure: no parsed nodes found in any graph-log file — nothing to organize.");
    return { ok: true, skipped: false, changed: false };
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
    return { ok: true, skipped: false, changed: true };
  }

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");
  const system = buildSystemPrompt(skillContent);

  const newNodeBlocks = newNodes
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number))
    .map((n) => buildNodeBlock(n, backlinks));
  const existingStructureBody = existingSections.length > 0 ? joinReadmeSections(existingSections).trim() : null;
  const userPrompt = buildUserPrompt({ existingStructureBody, newNodeBlocks });

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

  const callStart = Date.now();
  try {
    const llm = opts.provider ?? new AnthropicProvider();
    const { usage, model, truncated, hitMaxTurns } = await runStructureAgentLoop(llm, system, userPrompt, executors);

    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-structure",
      kind: "graph-structure",
      model: model ?? undefined,
      usage,
      durationMs: Date.now() - callStart,
      outcome: truncated ? "error" : "success",
      errorKind: truncated ? "incomplete" : undefined,
    });

    if (truncated) {
      log("graph-structure: a turn was cut off by the model's own output limit — will retry next run.");
      return { ok: true, skipped: false, changed: anyCommitted() };
    }
    if (hitMaxTurns) {
      log("graph-structure: hit its turn limit before finishing — will retry next run.");
      return { ok: true, skipped: false, changed: anyCommitted() };
    }
    if (hadRefusal()) {
      log("graph-structure: had at least one refused edit — will retry next run.");
      return { ok: true, skipped: false, changed: anyCommitted() };
    }

    // Safety net, never trusting the model's own sense that it's done:
    // confirm every node in the graph actually has a home before
    // stamping this version applied.
    const { sections: finalSections, fileId } = getCurrent();
    const finalPlaced = buildMembershipIndex(finalSections);
    const stillMissing = allNodes.filter((n) => !finalPlaced.has(n.id));
    if (stillMissing.length > 0) {
      log(
        `graph-structure: ${stillMissing.length} node(s) still unplaced after this run (e.g. ${stillMissing[0].id}) — will retry next run.`,
      );
      return { ok: true, skipped: false, changed: anyCommitted() };
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
    return { ok: true, skipped: false, changed: true };
  } catch (err) {
    log(`graph-structure: couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-structure",
      kind: "graph-structure",
      durationMs: Date.now() - callStart,
      outcome: "error",
      errorKind: classifyGraphLogError(err),
    });
    return { ok: true, skipped: false, changed: anyCommitted() };
  }
}
