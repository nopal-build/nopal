/**
 * GraphLog's `graph-structure` stage — sits between `sync-graph` and
 * `graph-project-view` (see the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure (this file)
 *     -> graph-project-view
 *
 * Reads EVERY `Graph/graph-log-YYYY-MM-DD.md` file — the whole graph, not
 * incrementally — and asks an LLM (grounded in `GRAPH_STRUCTURE.md`'s own
 * instructions) to organize it into ONE file, `Graph/graph-structure.md`:
 * every node clustered by topic/thread, weighted, and status-annotated
 * (active / open / settled / superseded).
 *
 * This exists to solve a problem neither neighboring stage can solve on
 * its own without reading the whole graph every time it does anything:
 *
 *   - `graph-project-view` needs to know what's actually heavy enough to
 *     feature in the README, which needs real weight (inbound links
 *     across the WHOLE graph), not just what one new day added.
 *   - `sync-graph` needs real candidate nodes to link new content back
 *     to, with enough content to judge relevance — not the bare, gloss-
 *     free `[date Node N](...)` link list it used to be limited to.
 *
 * Both now read THIS file instead of re-deriving their own view of the
 * whole graph. Expensive input (every node, every run), cheap output (a
 * compact index, not prose) — a deliberate trade accepted for the whole
 * pipeline, not hidden: see the `graphlog` skill's own cost discussion.
 *
 * INBOUND LINK COUNTS ARE PRE-COMPUTED HERE, NEVER LEFT TO THE MODEL
 * (`graphNodeIndex.server.ts`'s `computeBacklinkIndex`) — same reasoning
 * `sync-graph` already applies to a node's own `:ref{...}` citation:
 * arithmetic a model does over text it's shown is strictly worse than
 * arithmetic the code just does and hands over as fact.
 *
 * IDEMPOTENT via an aggregate hash of every graph-log file's OWN
 * `sourceHash` (so a day `sync-graph` regenerates always invalidates this
 * stage too) — stored as `asOfGraphHash` in `graph-structure.md`'s own
 * front matter. `graph-project-view` stamps `appliedByProjectView` on
 * that SAME front matter once it successfully reconciles the README
 * against a given version — this stage never sets or reads that field,
 * it's the next stage's own marker living alongside this one's, same
 * co-located-marker convention `sync-graph`/`graph-project-view` already
 * used for `sourceHash`/`appliedSourceHash` before this stage existed.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter } from "./project.types";
import {
  createFileRef,
  getFileRefById,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import {
  ensureProjectGraphFolder,
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import {
  aggregateHash,
  computeBacklinkIndex,
  parseGraphLogNodes,
  type GraphLogNode,
} from "./graphNodeIndex.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import type { LlmProvider } from "./llmProvider";

const GRAPH_STRUCTURE_FILE_NAME = "graph-structure.md";
const GRAPH_LOG_RE = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/;

/** A real bug, found running this against a real project's real history
 * (88 nodes): the provider's own shared default output budget (8192
 * tokens, sized for a single day's/section's worth of output elsewhere
 * in GraphLog/PhyLog) isn't enough here, because THIS stage's output
 * scales with the WHOLE graph's node count -- something no other stage
 * does, and something that only grows as a project ages. Confirmed via
 * the real failed call's own recorded usage (`output_tokens: 8192`,
 * exactly the old ceiling) that this was a genuine truncation, not a
 * separate bug. A generous, stage-specific override -- tightening
 * `GRAPH_STRUCTURE.md`'s own gloss-length instruction is the other,
 * complementary half of this fix (see `graphLogDefaults.server.ts`).
 *
 * CANNOT simply go arbitrarily high: the Anthropic SDK refuses a
 * non-streaming call outright once `max_tokens` implies more than 10
 * minutes of generation (`expectedTime = 60min * maxTokens / 128000`,
 * throwing "Streaming is required..." instead of ever making the
 * request) -- confirmed directly by hitting exactly this error at
 * 32000. That formula caps a safe non-streaming value at ~21333;
 * 20000 leaves real margin without needing to add streaming support
 * for what's still a once-a-run, no-tool-calls completion. */
const GRAPH_STRUCTURE_MAX_TOKENS = 20000;

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

function buildGraphStructureContent(input: { hash: string; body: string }): string {
  const frontmatter = stringifyYaml({
    asOfGraphHash: input.hash,
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body.trim()}\n`;
}

/** One node's full text block for the model — its words, its author, and
 * its PRE-COMPUTED weight facts (see this file's own module doc for why
 * those are never left for the model to count itself). */
function buildNodeBlock(node: GraphLogNode, backlinks: ReturnType<typeof computeBacklinkIndex>): string {
  const info = backlinks.get(node.id);
  const inbound = info
    ? `Inbound links: ${info.count} (${[...info.fromAuthors].join(", ")}; ${info.earliestDate} to ${info.latestDate})`
    : "Inbound links: none yet";
  const outbound = node.links.length > 0
    ? `Outbound links: ${node.links.map((l) => `-> ${l.date} Node ${l.number}`).join(", ")}`
    : null;
  return [
    `${node.date} Node ${node.number} (${node.authorName ?? "Unknown"}):`,
    node.quote,
    inbound,
    outbound,
  ]
    .filter(Boolean)
    .join("\n");
}

export type GraphStructureResult =
  | {
      ok: true;
      /** True when `skills/GRAPH_STRUCTURE.md` is missing or says "skip"
       * — a total no-op, no files examined, no model called. */
      skipped: boolean;
      /** True when a new `graph-structure.md` was written this run; false
       * when the existing one was already current (or there was nothing
       * to build yet). */
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
 * this ran (`asOfGraphHash` mismatch), asks the model to rebuild
 * `Graph/graph-structure.md` from the current whole graph.
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

  const backlinks = computeBacklinkIndex(allNodes);
  const nodeBlocks = allNodes
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number))
    .map((n) => buildNodeBlock(n, backlinks));

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");

  const existingBody = existing ? splitFrontmatter(existing.content ?? "").body.trim() : "";
  const userMessage = [
    `Every node currently in the graph (${allNodes.length} total):`,
    nodeBlocks.join("\n\n---\n\n"),
    existingBody
      ? `The PREVIOUS graph-structure.md, for thread-naming continuity (rebuild fresh, but keep a continuing thread's name where it still fits):\n\n${existingBody}`
      : "No previous graph-structure.md exists yet — this is the first time this project's graph is being organized.",
  ].join("\n\n---\n\n");

  const callStart = Date.now();
  try {
    const llm = opts.provider ?? new AnthropicProvider();
    const response = await llm.complete({
      system: `You are GraphLog's graph-structure step, organizing the whole graph into one weighted, clustered index per a project owner's own instructions. Follow those instructions closely; write only the graph-structure.md file's body itself, no preamble.\n\n${skillContent}`,
      messages: [{ role: "user", content: userMessage }],
      tools: [],
      maxTokens: GRAPH_STRUCTURE_MAX_TOKENS,
    });

    if (response.stopReason === "max_tokens") {
      const text = response.text ?? "";
      log(`graph-structure: output was cut off by the model's own output limit (${text.length} chars generated) — skipped, will retry next run.`);
      log(`graph-structure: truncated output START:\n${text.slice(0, 500)}`);
      log(`graph-structure: truncated output END:\n${text.slice(-500)}`);
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "graph-structure",
        kind: "graph-structure",
        model: response.model,
        usage: response.usage,
        durationMs: Date.now() - callStart,
        outcome: "error",
        errorKind: "incomplete",
      });
      return { ok: true, skipped: false, changed: false };
    }

    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-structure",
      kind: "graph-structure",
      model: response.model,
      usage: response.usage,
      durationMs: Date.now() - callStart,
      outcome: "success",
    });

    const body = response.text?.trim() ?? "";
    if (!body) {
      log("graph-structure: model returned nothing — leaving the previous graph-structure.md in place.");
      return { ok: true, skipped: false, changed: false };
    }

    const content = buildGraphStructureContent({ hash: newHash, body });
    if (existing) {
      await updateFileRef(existing._id, { content });
    } else {
      const graph = await ensureProjectGraphFolder(projectFolder);
      await createFileRef({
        human_id: projectFolder.human_id,
        name: GRAPH_STRUCTURE_FILE_NAME,
        content,
        content_type: "text/markdown",
        folder_id: graph._id,
      });
    }
    log(`graph-structure: rebuilt ${GRAPH_STRUCTURE_FILE_NAME} from ${allNodes.length} node(s).`);
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
    return { ok: true, skipped: false, changed: false };
  }
}
