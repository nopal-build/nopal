/**
 * GraphLog's `sync-graph` stage — the second AGENTIC stage (see the
 * `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph (this file)
 *     -> graph-project-view
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog/PhyLog stage: a project's `skills/GRAPH.md` (seeded
 * with real starter instructions, NOT "skip" — see `graphLogDefaults.server.ts`)
 * decides whether/how this runs at all.
 *
 * Reads every file under a project's `syncs/` tree that carries a `date`
 * field (today, only `daily-log-sync`'s own output does — see that
 * file's own `date: entryDate` stamp), plus each one's sibling
 * `_knowledge/<name>.knowledge.md` if `sync-knowledge` already produced
 * one, and asks an LLM (grounded in `GRAPH.md`'s own instructions) to
 * extract citable NODES — verbatim or near-verbatim statements worth
 * remembering on their own — into `Graph/graph-log-YYYY-MM-DD.md`, one
 * file per day that has anything worth capturing (a day can legitimately
 * produce none at all).
 *
 * A REAL ARCHITECTURE CHANGE FROM THIS STAGE'S ORIGINAL SHAPE: one day's
 * worth of node extraction used to be ONE non-tool completion producing
 * the ENTIRE day's `graph-log-*.md` body in one shot. Confirmed against a
 * real project's real history that this genuinely truncates on a busy day
 * (`2026-08-13`'s output cut off at the shared 8192-token default) — the
 * exact same class of "one completion's output scales with how much
 * content there is" problem `graph-structure.server.ts` already hit and
 * fixed at the whole-graph level (see that file's own module doc). NOW: a
 * bounded tool-calling loop (`add_node`, one tool call per node) builds
 * the day up incrementally, accumulated in memory and written ONCE the
 * day is fully processed — a day's file is still all-or-nothing (an
 * interrupted/truncated day still writes nothing and is retried whole
 * next run, exactly as before), but the OUTPUT of any single completion
 * is now just one node's worth of text, not a whole day's, so the
 * original truncation mode is no longer reachable in ordinary use.
 *
 * A REAL, CONFIRMED FOLLOW-ON BUG, found against a real production run of
 * the redesign above (not theoretical): "one tool call per node" was only
 * ever a PROMPT-level assumption, not an enforced one -- Anthropic is free
 * to return several `tool_use` blocks in a single response, and on a busy
 * day the model batched multiple `add_node` calls into one turn, growing
 * that turn's own output past the shared 8192-token ceiling anyway -- the
 * exact same truncation class the redesign above was meant to eliminate,
 * just recreated one level up (per-turn instead of per-day). Fixed the
 * same way every other "never trust the model with something code can
 * just enforce" bug in this file already was: `runSyncGraphDayLoop` now
 * only EXECUTES the first `add_node` call in a given turn; any extra call
 * in that same turn is rejected (told to retry on a later turn) rather
 * than applied, so a turn's own necessary output is now actually bounded
 * to one node, not just asked to be. The system prompt and the tool's own
 * description were also reworded to ask for this directly -- belt and
 * suspenders, since a clearer prompt still reduces how often the reject-
 * and-retry path even needs to fire.
 *
 * Each node gets a plain, predictable `### Node <N>` heading (an
 * incrementing counter per day's file, never an LLM-generated title —
 * see `GRAPH.md`) and a verbose `:ref{...}` citation
 * (`oxmarkdown-core`'s `buildRefDirectiveMarkdown`) — PRE-COMPUTED here,
 * ATTACHED BY CODE THROUGH `add_node`'s OWN `sourceIndex` PARAMETER, so
 * the model never has to write (or copy) a citation's markdown at all —
 * a step further than the original design's "hand it verbatim text to
 * copy," which still left room for a long attribute string to get
 * mangled in transcription. Links (`sameDayLinks`/`backwardLinks`,
 * by node id) are VALIDATED by code against the actual candidate set
 * before being accepted — an id not in that list is silently dropped
 * and reported back to the model, rather than a hallucinated link
 * quietly ending up in the file the way free-form markdown could before.
 * Cross-day links point only BACKWARD (enforced here, not just
 * instructed) — the candidate list is `Graph/graph-structure.md` (see
 * `graphStructure.server.ts`), folded into the CACHED system prompt
 * (stable across every day this run touches, so it's only paid for once
 * per run, not resent per day — see "Prompt caching" below), falling
 * back to a plain scan of every existing graph-log file's headings for a
 * project that's never had graph-structure run yet. A node may ALSO link
 * to another node from the SAME day's file, in either direction, via
 * `sameDayLinks` — validated against node numbers already added earlier
 * in the SAME turn/day.
 *
 * PROMPT CACHING: `graph-structure.md`'s own content (and the shared
 * skill instructions) are now part of the SYSTEM prompt, which is
 * byte-identical across every day AND every turn this run touches —
 * `cacheSystemPrompt` (already used for exactly this reason elsewhere in
 * GraphLog/PhyLog) means a multi-day run pays full price for that block
 * ONCE, then a cheap cache-read for every day/turn after. Previously this
 * (often large) block lived in the per-day USER message and was resent
 * at full price on every single day of a run — a real, avoidable cost a
 * multi-day catch-up run would otherwise pay repeatedly for no reason.
 *
 * IDEMPOTENT via an aggregate hash of that day's candidates' own
 * `content_hash` PLUS each one's knowledge-sidecar hash (so a
 * `KNOWLEDGE.md` change that only touches the sidecar still invalidates
 * the day, not just a source-file edit) — stored in the graph-log file's
 * own front matter. An unchanged day is a total no-op. A CHANGED day's
 * existing `graph-log-*.md` is DELETED and fully regenerated — never
 * partially patched (see the `graphlog` skill's own doc on why: node
 * extraction is a single holistic judgment over the whole day, not
 * something that composes incrementally the way `graph-project-view`'s
 * `update_section` does for a README, or `graph-structure`'s own
 * `update_cluster` does for an existing thread — a day's raw source
 * content doesn't have the kind of stable identity a graph NODE or a
 * README SECTION already has to diff against).
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildRefDirectiveMarkdown } from "oxmarkdown-core";
import { splitFrontmatter } from "./project.types";
import {
  createFileRef,
  deleteFileRef,
  getFileRefById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import { getHumansById } from "./humans.server";
import {
  ensureProjectGraphFolder,
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import { parseSyncedCardFileName } from "./dailyLogSync.server";
import { KNOWLEDGE_FOLDER_NAME } from "./syncKnowledge.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolDefinition } from "./llmProvider";

const GRAPH_LOG_PREFIX = "graph-log-";

function graphLogFileName(date: string): string {
  return `${GRAPH_LOG_PREFIX}${date}.md`;
}

function dateFromGraphLogFileName(name: string): string | null {
  const match = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
  return match ? match[1] : null;
}

/** Best-effort GFM-style heading slug — good enough for a link to work
 * once/if `OxRenderer` ever emits real heading `id`s (not required for
 * `graph-project-view` itself, which parses this file's raw markdown
 * structurally, never relies on browser anchor-scrolling). */
function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type NodeHeading = { heading: string; slug: string };

function extractHeadings(markdown: string): NodeHeading[] {
  const out: NodeHeading[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^###\s+(.+)$/.exec(line.trim());
    if (match) out.push({ heading: match[1].trim(), slug: slugifyHeading(match[1].trim()) });
  }
  return out;
}

function existingSourceHash(content: string | null): string | null {
  if (!content) return null;
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return null;
  try {
    const data = parseYaml(frontmatter) as Record<string, unknown> | null;
    const hash = data?.sourceHash;
    return typeof hash === "string" ? hash : null;
  } catch {
    return null;
  }
}

function buildGraphLogContent(input: { date: string; hash: string; body: string }): string {
  const frontmatter = stringifyYaml({
    date: input.date,
    sourceHash: input.hash,
    generatedAt: new Date().toISOString(),
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.body.trim()}\n`;
}

type GraphCandidate = {
  fileId: string;
  name: string;
  date: string;
  contentHash: string | null;
  folderId: string;
};

/** Walks a project's `syncs/` tree recursively, collecting every file
 * that carries a `date` — skipping `_knowledge/` folders (their own
 * contents are read as a CANDIDATE's sidecar, never a candidate in their
 * own right). A file with no `date` set isn't supported yet (today, only
 * `daily-log-sync`'s own output stamps one) — silently excluded, not an
 * error. */
async function collectDatedCandidates(humanId: string, folderId: string): Promise<GraphCandidate[]> {
  const { folders, files } = await listFolderChildren(humanId, folderId);
  const out: GraphCandidate[] = files
    .filter((f) => !!f.date)
    .map((f) => ({ fileId: f._id, name: f.name, date: f.date!, contentHash: f.content_hash ?? null, folderId }));
  for (const sub of folders) {
    if (sub.name === KNOWLEDGE_FOLDER_NAME) continue;
    out.push(...(await collectDatedCandidates(humanId, sub._id)));
  }
  return out;
}

/** Finds a candidate's own sibling knowledge sidecar (`_knowledge/<name>.knowledge.md`
 * next to it), if `sync-knowledge` has already produced one — see that
 * stage's own module doc for the naming convention. */
async function findKnowledgeSidecar(
  humanId: string,
  candidate: GraphCandidate,
): Promise<{ fileId: string; contentHash: string | null } | null> {
  const { folders } = await listFolderChildren(humanId, candidate.folderId);
  const knowledgeFolder = folders.find((f) => f.name === KNOWLEDGE_FOLDER_NAME);
  if (!knowledgeFolder) return null;
  const dot = candidate.name.lastIndexOf(".");
  const base = dot > 0 ? candidate.name.slice(0, dot) : candidate.name;
  const sidecarName = `${base}.knowledge.md`;
  const { files } = await listFolderChildren(humanId, knowledgeFolder._id);
  const listing = files.find((f) => f.name === sidecarName);
  return listing ? { fileId: listing._id, contentHash: listing.content_hash ?? null } : null;
}

function aggregateHash(parts: string[]): string {
  return createHash("sha256").update([...parts].sort().join("|")).digest("hex").slice(0, 16);
}

// ─── Backward-link candidate ids — deterministic, parsed the same
// simple-regex way `graphStructure.server.ts`'s own parsing does ────────

const STRUCTURE_NODE_LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s+Node\s+(\d+)\b/;
const HEADING_NODE_NUMBER_RE = /^Node\s+(\d+)$/;

/** Scans `graph-structure.md`'s raw body (any cluster) for every
 * `- <date> Node <N> ...` line and returns a `date#number -> display
 * label` map — used only to VALIDATE a day's `backwardLinks`, not a real
 * parse of that file's structure (that's `graphStructure.server.ts`'s own
 * job). */
function extractStructureNodeIds(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const match = STRUCTURE_NODE_LINE_RE.exec(trimmed);
    if (match) map.set(`${match[1]}#${Number(match[2])}`, trimmed.replace(/^-\s*/, ""));
  }
  return map;
}

/** Same shape as `extractStructureNodeIds`, but over `headingsByDate`'s
 * live/fallback heading lists (see `runSyncGraph`'s own module doc on
 * when each source is used). */
function headingsByDateToIds(headingsByDate: Map<string, NodeHeading[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [date, headings] of headingsByDate) {
    for (const h of headings) {
      const match = HEADING_NODE_NUMBER_RE.exec(h.heading);
      if (!match) continue;
      map.set(`${date}#${Number(match[1])}`, `${date} ${h.heading}`);
    }
  }
  return map;
}

// ─── The per-day add_node tool-calling loop ────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "add_node",
    description:
      'Add one citable node to today\'s graph-log file. Call this AT MOST ONCE per turn, then stop and wait for the result before calling it again for the next node -- if you call it more than once in the same turn, only the first call is processed and the rest are rejected (you will need to call them again on a later turn). `sourceIndex` must be one of today\'s numbered sources (shown as "Source 0:", "Source 1:", etc) -- its citation is attached automatically from real data, never write a :ref{...} yourself. `blocks` is the verbatim words, broken into one or more paragraph/list blocks in order -- code applies ==...== highlighting itself (per-item for a list, so a marker never ends up inside the highlight, and per-paragraph, so a highlight never spans a blank line and breaks) -- never include == yourself. `sameDayLinks`/`backwardLinks` are optional -- at most 3 links total are kept (any more, or any id you weren\'t actually given as a candidate, are dropped and reported back to you), so only send the ones that matter most.',
    inputSchema: {
      type: "object",
      properties: {
        sourceIndex: { type: "number" },
        setup: {
          type: "string",
          description: "Optional short scaffolding clause BEFORE the verbatim words, only when needed to make the quote standalone. Never highlighted -- add as little as possible, most nodes need none.",
        },
        blocks: {
          type: "array",
          description: 'The verbatim words, in order. Use a "list" block for anything that was a numbered/bulleted list OR an indented/nested outline in the source -- never reproduce indentation as literal leading spaces (it renders as a broken code block).',
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["paragraph", "list"] },
              text: { type: "string", description: 'Required for a "paragraph" block -- one verbatim paragraph, no leading indentation.' },
              items: {
                type: "array",
                items: { type: "string" },
                description: 'Required for a "list" block -- one verbatim string per item, WITHOUT its own "1."/"-" marker (code adds that).',
              },
              ordered: { type: "boolean", description: 'For a "list" block only -- true for a numbered list, omit/false for a bulleted one.' },
            },
            required: ["type"],
          },
        },
        sameDayLinks: {
          type: "array",
          items: { type: "number" },
          description: "Node numbers you already added earlier this same day/turn.",
        },
        backwardLinks: {
          type: "array",
          items: { type: "string" },
          description: 'Ids of earlier days\' nodes, e.g. "2026-07-29#3" -- from the candidates you were shown.',
        },
      },
      required: ["sourceIndex", "blocks"],
    },
  },
];

/** Renders `add_node`'s own `blocks` parameter into the final `==...==`-
 * marked markdown, entirely in code -- the model never writes `==` itself
 * (see the header's "real architecture change" note: a real, confirmed
 * rendering bug came from the model wrapping a whole multi-paragraph/
 * indented passage in ONE `==...==` span, which CommonMark's inline
 * markup can never cross a blank line to close correctly). A "paragraph"
 * block becomes one `==text==`; a "list" block becomes one highlighted
 * item per entry, with its own `-`/`N.` marker kept OUTSIDE the highlight
 * (matching `GRAPH.md`'s own long-standing instruction for lists, now
 * structurally guaranteed instead of merely requested). Blocks are joined
 * with a blank line, since separate `==...==` spans are exactly how a
 * multi-paragraph verbatim passage must be represented at all. */
function renderQuoteBlocks(rawBlocks: unknown): string | null {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return null;
  const parts: string[] = [];
  for (const raw of rawBlocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    if (block.type === "paragraph") {
      const text = String(block.text ?? "").trim();
      if (text) parts.push(`==${text}==`);
    } else if (block.type === "list") {
      const items = Array.isArray(block.items)
        ? block.items.map((i) => String(i).trim()).filter(Boolean)
        : [];
      if (items.length === 0) continue;
      const ordered = block.ordered === true;
      parts.push(items.map((item, i) => `${ordered ? `${i + 1}.` : "-"} ==${item}==`).join("\n"));
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// brake, not a default — see ADR-002 (docs/adr/0002-three-link-cap-per-node.md,
// kept out of the public repo). Links create weight, weight creates
// visibility, visibility creates writing, and writing creates links --
// this caps that loop so whatever's already been mentioned most can't
// accumulate faster forever. Reads as an arbitrary tuning constant;
// raising it looks free right up until the top of every project's index
// stops changing. If this ever needs to change, that's a conversation,
// not a one-line tweak -- see the ADR for what "how you'd know it broke"
// looks like (nothing errors, the graph just slowly starts amplifying
// whatever got mentioned most).
export const MAX_LINKS_PER_NODE = 3;

/** Pure cap logic, split out from the \`add_node\` executor purely so
 * ADR-002's own "no node ends up with four links" test can exercise it
 * directly. Same-day links are kept first (see the caller's own comment
 * for why). */
export function capNodeLinks(
  sameDay: number[],
  backward: string[],
  max: number = MAX_LINKS_PER_NODE,
): { sameDay: number[]; backward: string[]; droppedCount: number } {
  const cappedSameDay = sameDay.slice(0, max);
  const cappedBackward = backward.slice(0, Math.max(0, max - cappedSameDay.length));
  const droppedCount = sameDay.length + backward.length - cappedSameDay.length - cappedBackward.length;
  return { sameDay: cappedSameDay, backward: cappedBackward, droppedCount };
}

function createSyncGraphExecutors(input: {
  date: string;
  sourceCitations: string[];
  knownBackwardIds: Map<string, string>;
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  getNodeBlocks: () => string[];
} {
  const nodeBlocks: string[] = [];
  let nextNumber = 1;

  const executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>> = {
    add_node: async (toolInput) => {
      const sourceIndex = Number(toolInput.sourceIndex);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= input.sourceCitations.length) {
        return `Error: sourceIndex must be an integer between 0 and ${input.sourceCitations.length - 1}`;
      }
      const quoteBody = renderQuoteBlocks(toolInput.blocks);
      if (!quoteBody) return "Error: blocks must include at least one non-empty paragraph or list block";
      const setup = typeof toolInput.setup === "string" ? toolInput.setup.trim() : "";
      const quote = [setup || null, quoteBody].filter(Boolean).join("\n\n");

      const number = nextNumber;
      const rawSameDay = Array.isArray(toolInput.sameDayLinks) ? toolInput.sameDayLinks : [];
      const validSameDay = rawSameDay
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n < number);
      const rawBackward = Array.isArray(toolInput.backwardLinks) ? toolInput.backwardLinks : [];
      const validBackward = rawBackward.map((id) => String(id)).filter((id) => input.knownBackwardIds.has(id));
      const invalidCount =
        rawSameDay.length - validSameDay.length + (rawBackward.length - validBackward.length);

      // A node may link to at most MAX_LINKS_PER_NODE others (per GRAPH.md's
      // own instructions) -- enforced here rather than left as a soft
      // instruction, same "never trust the model with a rule code can
      // just apply" reasoning the rest of this pipeline already follows.
      // Same-day links are kept first (they're rarer and more deliberate
      // -- a cross-day link is comparatively easy to over-produce).
      const { sameDay: sameDayNumbers, backward: backwardIds, droppedCount: overCapCount } = capNodeLinks(
        validSameDay,
        validBackward,
      );
      const droppedCount = invalidCount + overCapCount;

      const linkLines = [
        ...sameDayNumbers.map((n) => `- [${input.date} Node ${n}](./${graphLogFileName(input.date)}#node-${n})`),
        ...backwardIds.map((id) => {
          const [date, num] = id.split("#");
          return `- [${date} Node ${num}](./${graphLogFileName(date)}#node-${num})`;
        }),
      ];

      nodeBlocks.push(
        [
          `### Node ${number}`,
          quote,
          input.sourceCitations[sourceIndex],
          linkLines.length > 0 ? linkLines.join("\n") : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      nextNumber++;

      return `Added Node ${number}.${droppedCount > 0 ? ` (dropped ${droppedCount} link id(s) -- invalid, or over the ${MAX_LINKS_PER_NODE}-link cap)` : ""}`;
    },
  };

  return { executors, getNodeBlocks: () => nodeBlocks };
}

/** Generous relative to a single day's realistic node count — a very
 * prolific day might have 10-20 nodes; 30 turns leaves real headroom
 * without being unbounded. Each turn's own output is small (one node) —
 * see `runSyncGraphDayLoop`'s own "at most one add_node executed per
 * turn" enforcement below for why that's now actually GUARANTEED, not
 * just assumed — so a higher ceiling here costs more calls, not more
 * truncation risk. */
const MAX_TURNS = 30;

async function runSyncGraphDayLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  callCounter: { count: number },
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  perf: GraphLogPerfRecorder,
  date: string,
): Promise<{ usage: LlmUsage; model: string | null; truncated: boolean; hitMaxTurns: boolean }> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // The system prompt (skill instructions + graph-structure.md) is
    // byte-identical across every day AND every turn of this whole run —
    // see this file's own "Prompt caching" module doc. The FIRST ever
    // completion in the run doesn't yet know if there'll be a second one
    // worth reading the cache back for; every one after does.
    const cacheSystemPrompt = callCounter.count > 0;
    const turnStart = Date.now();
    const response = await provider.complete({ system, messages, tools: TOOLS, cacheSystemPrompt });
    callCounter.count++;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    // One perf event PER TURN (a real, individually-timed API call),
    // nested (by actual start time) under this day's own aggregate event
    // recorded by the caller -- includes whatever plain text the model
    // wrote alongside/instead of a tool call this turn, thrown away
    // everywhere else in this loop (only ever fed back into `messages`,
    // never persisted) but genuinely useful here: it's exactly what a
    // truncated turn was in the middle of writing when it got cut off.
    await perf.event({
      process: "sync-graph",
      type: "llm",
      name: "turn",
      params: {
        date,
        turn: turn + 1,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls.map((c) => c.name),
        text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
      },
      durationMs: Date.now() - turnStart,
      outcome: response.stopReason === "max_tokens" ? "error" : "ok",
    });

    if (response.stopReason === "max_tokens") {
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    // A REAL, CONFIRMED BUG (found against a real production run, not
    // theoretical): this loop's own module doc has always claimed "each
    // turn's own output is small (one node)", but nothing here actually
    // enforced that -- Anthropic is free to return MULTIPLE `tool_use`
    // blocks in a single response, and on a busy day the model batched
    // several `add_node` calls into one turn, which grew that turn's own
    // generated output past the shared 8192-token ceiling -- the exact
    // truncation class this stage's whole redesign was meant to make
    // unreachable, just recreated one level up (per-turn instead of
    // per-day). The system prompt/tool description now also ASK for one
    // call per turn, but a prompt alone is never trusted here (same
    // reasoning every other "never trust the model with something code
    // can just enforce" fix in this file already follows) -- only the
    // FIRST tool call in a turn is actually executed; every extra call in
    // that SAME turn is rejected without being applied, so the model
    // simply re-issues it on a later turn instead of it silently
    // succeeding twice or being dropped.
    let executedThisTurn = false;
    for (const call of response.toolCalls) {
      let resultText: string;
      if (executedThisTurn) {
        resultText =
          "Not processed -- only the FIRST add_node call in a turn is executed, to keep each turn's own output small. Call add_node again on your next turn for this node.";
      } else {
        const executor = executors[call.name];
        resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
        executedThisTurn = true;
      }
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns };
}

function buildSystemPrompt(skillContent: string, graphStructureBody: string | null): string {
  const structureSection = graphStructureBody
    ? `The graph's existing nodes, organized and glossed (from graph-structure.md, current as of its own last run — every "<date> Node <N>" you see here is a valid backwardLinks id, as "date#N"):\n\n${graphStructureBody}`
    : "No graph-structure.md exists yet for this project — see the plain candidate list you're given per day instead.";
  return `You are GraphLog's sync-graph step, extracting citable nodes from one day's synced content at a time, per a project owner's own instructions. Call add_node once per node worth capturing today, citing it by its sourceIndex — never write a :ref{...} yourself, it's attached automatically from real data. Call add_node ONE TIME PER TURN, then stop and wait for its result before calling it again for the next node — never call add_node more than once in the same response, even on a busy day with many nodes to add; only your first call each turn is actually processed, any extra calls in the same turn are rejected and must be retried on a later turn. Only use sameDayLinks/backwardLinks ids you were actually shown as candidates; an invented one is silently dropped and reported back to you. Stop calling add_node once you've captured everything worth capturing today — if nothing from today is worth capturing at all, make no tool calls.\n\n${skillContent}\n\n---\n\n${structureSection}`;
}

function buildUserPrompt(input: { date: string; sourceBlocks: string[]; liveCandidates: string[] }): string {
  return [
    `Today's date being processed: ${input.date}`,
    input.sourceBlocks.join("\n\n---\n\n"),
    input.liveCandidates.length > 0
      ? `Earlier days' nodes not yet reflected in graph-structure.md, which you may also link back to by id (never invent one not listed here):\n${input.liveCandidates.map((c) => `- ${c}`).join("\n")}`
      : null,
    "You may also link a node to another node you add earlier this same day, in either direction, via sameDayLinks.",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export type SyncGraphDayResult = {
  date: string;
  /** True when a day's graph-log file was newly written or regenerated
   * this run; false when an already-up-to-date one was found and left
   * untouched. */
  changed: boolean;
  /** True when the model decided this day had nothing worth capturing —
   * no `graph-log-*.md` file exists for it (possibly because a PREVIOUS
   * file for this exact day was just deleted, if its sources changed). */
  empty: boolean;
};

export type SyncGraphResult =
  | {
      ok: true;
      /** True when `skills/GRAPH.md` is missing or says "skip" — a total
       * no-op, no files examined, no model called. */
      skipped: boolean;
      days: SyncGraphDayResult[];
    }
  | { ok: false; error: string };

export interface RunSyncGraphOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. */
  perf?: GraphLogPerfRecorder;
}

/**
 * Runs sync-graph for one project. Sweeps every day with a dated
 * candidate under `syncs/`, oldest first, so a later day's cross-links
 * can always point at an already-processed earlier day within the same
 * run.
 */
export async function runSyncGraph(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunSyncGraphOptions = {},
): Promise<SyncGraphResult> {
  const log = opts.log ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const skill = await getProjectStageSkill(projectFolder, "GRAPH.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, days: [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const { folders } = await listFolderChildren(projectFolder.human_id, projectFolder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) {
    log("sync-graph: no syncs/ folder yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const candidates = await collectDatedCandidates(projectFolder.human_id, syncsFolder._id);
  if (candidates.length === 0) {
    log("sync-graph: no dated files under syncs/ yet — nothing to do.");
    return { ok: true, skipped: false, days: [] };
  }

  const byDate = new Map<string, GraphCandidate[]>();
  for (const c of candidates) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const dates = [...byDate.keys()].sort();

  // Resolve every possible contributor's display name up front, one
  // batched lookup — `parseSyncedCardFileName` returns `null` for
  // anything not shaped like a daily-log-sync copy (a future non-daily-
  // log sync source's own file), which just means no attribution name is
  // available for it below.
  const contributorIds = new Set<string>();
  for (const c of candidates) {
    const parsed = parseSyncedCardFileName(c.name);
    if (parsed) contributorIds.add(parsed.humanId);
  }
  const humans = await getHumansById([...contributorIds]);
  const humanNameById = new Map(humans.map((h) => [h._id, h.name]));

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");

  // `graph-structure.md` (if it exists) is the PRIMARY source for "nodes
  // from a previous run you may link back to" -- a real, glossed,
  // weighted index instead of a bare `[date Node N](...)` link list with
  // nothing to judge relevance against (see `graphStructure.server.ts`'s
  // own module doc). It's necessarily ONE CYCLE STALE -- reflects the
  // graph as of the last time graph-structure ran, not this exact moment
  // -- which is fine in practice since `nopal graphlog run` always runs
  // graph-structure immediately after sync-graph. It's folded into the
  // CACHED system prompt below (see this file's own "Prompt caching"
  // module doc) since it's stable across every day this run touches.
  //
  // `headingsByDate` stays for two jobs now: (1) nodes written EARLIER IN
  // THIS SAME RUN, which graph-structure.md can never reflect yet (it
  // hasn't regenerated) — shown to the model per day as a plain
  // additional candidate list; (2) a project that's never had
  // graph-structure run at all falls back to scanning every existing
  // graph-log file's headings, so early history isn't invisible.
  const existingGraphFolder = await findProjectGraphFolder(projectFolder);
  let graphStructureBody: string | null = null;
  const headingsByDate = new Map<string, NodeHeading[]>();
  if (existingGraphFolder) {
    const { files: existingFiles } = await listFolderChildren(
      projectFolder.human_id,
      existingGraphFolder._id,
    );
    const structureListing = existingFiles.find((f) => f.name === "graph-structure.md");
    const structureFile = structureListing ? await getFileRefById(structureListing._id) : undefined;
    graphStructureBody = structureFile?.content ? splitFrontmatter(structureFile.content).body.trim() : null;

    if (!graphStructureBody) {
      for (const f of existingFiles) {
        const date = dateFromGraphLogFileName(f.name);
        if (!date) continue;
        const full = await getFileRefById(f._id);
        if (full?.content) headingsByDate.set(date, extractHeadings(full.content));
      }
    }
  }
  const structureIds = graphStructureBody ? extractStructureNodeIds(graphStructureBody) : new Map<string, string>();
  const system = buildSystemPrompt(skillContent, graphStructureBody);

  let textLlm: LlmProvider | undefined = opts.provider;
  const callCounter = { count: 0 };
  const days: SyncGraphDayResult[] = [];

  for (const date of dates) {
    const dayCandidates = byDate.get(date)!;

    const hashParts: string[] = [];
    const sourceBlocks: string[] = [];
    const sourceCitations: string[] = [];
    for (const candidate of dayCandidates) {
      const source = await getFileRefById(candidate.fileId);
      if (!source) continue;
      hashParts.push(`${candidate.fileId}:${candidate.contentHash ?? candidate.fileId}`);

      const sidecar = await findKnowledgeSidecar(projectFolder.human_id, candidate);
      let knowledgeContent: string | null = null;
      if (sidecar) {
        hashParts.push(`${sidecar.fileId}:${sidecar.contentHash ?? sidecar.fileId}`);
        const sidecarFile = await getFileRefById(sidecar.fileId);
        knowledgeContent = sidecarFile?.content ?? null;
      }

      const parsed = parseSyncedCardFileName(candidate.name);
      const contributorHumanId = parsed?.humanId;
      const contributorName = contributorHumanId
        ? humanNameById.get(contributorHumanId) ?? "Unknown"
        : "Unknown";

      const sourceIndex = sourceBlocks.length;
      sourceCitations.push(
        buildRefDirectiveMarkdown({
          name: contributorName,
          humanId: contributorHumanId,
          datetime: `${date}T12:00:00Z`,
          location: `/fruits/vault?file=${source._id}`,
          verbose: true,
        }),
      );
      sourceBlocks.push(
        [
          `Source ${sourceIndex}: "${source.name}" (by ${contributorName})`,
          `Content:\n${source.content ?? "(no readable text content)"}`,
          knowledgeContent ? `Extracted knowledge about this source:\n${knowledgeContent}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    const newHash = aggregateHash(hashParts);
    const existingListing = existingGraphFolder
      ? (await listFolderChildren(projectFolder.human_id, existingGraphFolder._id)).files.find(
          (f) => f.name === graphLogFileName(date),
        )
      : undefined;
    const existing = existingListing ? await getFileRefById(existingListing._id) : undefined;

    if (existing && existingSourceHash(existing.content) === newHash) {
      days.push({ date, changed: false, empty: false });
      continue;
    }

    if (existing) {
      await deleteFileRef(existing._id);
    }

    // Combine graph-structure.md's own ids with this run's own live/
    // fallback ones, restricted to STRICTLY earlier days — enforced here
    // via validation, not just instructed, unlike the original design.
    const liveIds = headingsByDateToIds(headingsByDate);
    const knownBackwardIds = new Map(
      [...structureIds, ...liveIds].filter(([id]) => id.split("#")[0] < date),
    );
    const liveCandidates = [...liveIds.entries()]
      .filter(([id]) => id.split("#")[0] < date)
      .map(([, label]) => label);

    const userPrompt = buildUserPrompt({ date, sourceBlocks, liveCandidates });
    const { executors, getNodeBlocks } = createSyncGraphExecutors({ date, sourceCitations, knownBackwardIds });

    const callStart = Date.now();
    try {
      textLlm ??= new AnthropicProvider();
      const { usage, model, truncated, hitMaxTurns } = await runSyncGraphDayLoop(
        textLlm,
        system,
        userPrompt,
        callCounter,
        executors,
        perf,
        date,
      );

      if (truncated) {
        log(`sync-graph: ${date}'s output was cut off by the model's own output limit — skipped, will retry next run.`);
        const durationMs = Date.now() - callStart;
        await recordGraphLogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "sync-graph",
          kind: "graph-extract",
          model: model ?? undefined,
          usage,
          durationMs,
          outcome: "error",
          errorKind: "incomplete",
        });
        await perf.event({
          process: "sync-graph",
          type: "llm",
          name: "day",
          params: { date },
          durationMs,
          outcome: "error",
        });
        continue;
      }
      if (hitMaxTurns) {
        log(`sync-graph: ${date} hit its turn limit before finishing — skipped, will retry next run.`);
        const durationMs = Date.now() - callStart;
        await recordGraphLogUsage({
          humanId: actingHumanId,
          projectFolderId: projectFolder._id,
          stage: "sync-graph",
          kind: "graph-extract",
          model: model ?? undefined,
          usage,
          durationMs,
          outcome: "error",
          errorKind: "incomplete",
        });
        await perf.event({
          process: "sync-graph",
          type: "llm",
          name: "day",
          params: { date },
          durationMs,
          outcome: "error",
        });
        continue;
      }

      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        model: model ?? undefined,
        usage,
        durationMs,
        outcome: "success",
      });
      await perf.event({
        process: "sync-graph",
        type: "llm",
        name: "day",
        params: { date },
        durationMs,
      });

      const nodeBlocks = getNodeBlocks();
      if (nodeBlocks.length === 0) {
        log(`sync-graph: ${date} — nothing worth capturing.`);
        headingsByDate.delete(date);
        days.push({ date, changed: true, empty: true });
        continue;
      }

      const graphFolder = await ensureProjectGraphFolder(projectFolder);
      const content = buildGraphLogContent({ date, hash: newHash, body: nodeBlocks.join("\n\n") });
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: graphLogFileName(date),
        content,
        content_type: "text/markdown",
        folder_id: graphFolder._id,
      });
      if (!created) continue;

      headingsByDate.set(date, extractHeadings(content));
      log(`sync-graph: wrote ${graphLogFileName(date)} (${nodeBlocks.length} node(s)).`);
      days.push({ date, changed: true, empty: false });
    } catch (err) {
      log(`sync-graph: ${date} couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
      const durationMs = Date.now() - callStart;
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sync-graph",
        kind: "graph-extract",
        durationMs,
        outcome: "error",
        errorKind: classifyGraphLogError(err),
      });
      await perf.event({
        process: "sync-graph",
        type: "llm",
        name: "day",
        params: { date },
        durationMs,
        outcome: "error",
      });
    }
  }

  return { ok: true, skipped: false, days };
}
