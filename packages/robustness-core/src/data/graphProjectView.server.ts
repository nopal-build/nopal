/**
 * GraphLog's `graph-project-view` stage — the final, AGENTIC stage (see
 * the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
 *     -> graph-project-view (this file)
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog stage: a project's `skills/PROJECT_VIEW.md`
 * (seeded with real starter instructions, NOT "skip" — see
 * `graphLogDefaults.server.ts`) decides whether/how this runs at all.
 *
 * Reads `Graph/graph-structure.md` (`graph-structure`'s own output — the
 * WHOLE graph, already clustered/weighted/status-annotated) and uses it
 * to keep `README.md` an accurate, organized synthesis — never inventing
 * progress, dates, or facts that aren't grounded in a thread
 * `graph-structure.md` actually gives it. A bounded tool-calling loop
 * (`update_section`/`remove_section` — see this file's own "Deliberately
 * deferred" note) lets the model touch only the sections
 * that actually need to change, rather than rewriting the whole README
 * every time.
 *
 * NOT per-day anymore (a real architecture change from this stage's
 * earlier shape): `graph-structure.md` already did the expensive
 * whole-graph read, so this stage runs ONCE per invocation, gated on
 * whether the graph has changed at all since it last ran — not once per
 * graph-log day. See the `graphlog` skill's own design notes for why
 * splitting "what changed" (graph-structure) from "what does the README
 * say about it" (this file) resolved the earlier per-day design's real
 * problems (no way to see real cross-graph weight, no way to reorder
 * sections, no comment-section protection).
 *
 * IDEMPOTENT via `graph-structure.md`'s own `asOfGraphHash` front-matter
 * field — this stage stamps `appliedByProjectView` onto that SAME file
 * (via `graphStructure.server.ts`'s `markGraphStructureApplied`) once an
 * update completes cleanly. An unchanged graph is a total no-op.
 *
 * THE "NOTES ON THIS VIEW" SECTION IS NEVER TOUCHED BY THE MODEL — see
 * `PROTECTED_HEADING` below. Reading unstamped reader comments and
 * stamping them ` → read <date>` is deterministic, pre/post-processing
 * code, never a tool call the model could skip, mangle, or reorder. This
 * is the one section of the README more trusted than the model's own
 * judgment, so it gets the same treatment a citation's exact text
 * already does elsewhere in GraphLog: computed by code, never authored
 * by the model.
 *
 * SECTION ORDER IS ALSO ENFORCED BY CODE, NOT THE MODEL — `update_section`
 * appends a brand new heading to the end of the README's own section
 * list, which would leave section order however sections HAPPENED to get
 * created over a project's life. `CANONICAL_ORDER` below re-sorts the six
 * known headings into `PROJECT_VIEW.md`'s own prescribed shape after
 * every run; anything else (a heading the model invented despite being
 * told not to) is left just before "Notes on this view" rather than
 * silently dropped.
 *
 * Deliberately deferred (start simple; add if a real need shows up, same
 * philosophy the `oxmarkdown` skill's Grid/Gallery/Toggle List promotions
 * already established):
 *   - `write_file` (splitting detail into a separate reference file) and
 *     `update_readme` (a full-body rewrite) — `update_section`/
 *     `remove_section` alone are enough to prove out the incremental
 *     shape first.
 *   - Truncation-retry escalation (`capture.server.ts`'s own
 *     `MAX_TRUNCATION_RETRIES` dance) — a turn that hits `max_tokens` here
 *     is simply treated as an error and retried on a future run, same
 *     "leave it, retry later" convention `sync-knowledge`/`sync-graph`
 *     already use.
 */

import {
  createFileRef,
  getFileRefById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import {
  joinReadmeSections,
  splitFrontmatter,
  splitReadmeSections,
  withReadmeBody,
  type ReadmeSection,
} from "./project.types";
import {
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import {
  parseGraphStructureFrontmatter,
  markGraphStructureApplied,
  hasFallenAway,
  nodeIdsInSection,
  buildMembershipIndex,
} from "./graphStructure.server";
import {
  parseGraphLogNodes,
  formatNodeVerbatim,
  extractAttachedFileLines,
  stripRefVerbose,
  type GraphLogNode,
} from "./graphNodeIndex.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { planTurnToolCalls } from "./llmProvider";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

const GRAPH_STRUCTURE_FILE_NAME = "graph-structure.md";
const GRAPH_LOG_RE = /^graph-log-(\d{4}-\d{2}-\d{2})\.md$/;

/** 1.1's own budget — bounded by NODE COUNT, not thread count (a thread
 * can hold fifty nodes a year from now even if it holds a dozen today).
 * Filled top-down, stopping mid-thread if needed — threads earlier in
 * graph-structure.md's own ordering (see `sortClustersByWeight`'s
 * importance-and-urgency grid, ADR-008) are exactly the ones this stage
 * most needs real words for, so they're served first and in full before
 * anything later gets a look. `get_node` (below) is the ceiling for
 * everything this floor doesn't reach. */
const NODE_PREFETCH_BUDGET = 60;

/** The two tools whose call input carries a whole section's prose, and so
 * the two `planTurnToolCalls` throttles. */
const isViewWrite = (name: string) => name === "update_section" || name === "remove_section";

// ADR-010 (docs/adr/0010-no-stage-reads-only-another-stages-output.md, kept
// out of the public repo) is what the node pre-fetch and `get_node` above
// exist to satisfy: this stage writes human-facing output, so it must take
// at least one input tracing to a person's own words. Being handed only
// `graph-structure.md` is what produced a 4,473-character README with zero
// citations -- a summary of a summary, which reads fine, which is the whole
// problem with it. Never reduce this stage's inputs to the index alone.

// ─── The "Notes on this view" section — protected, code-owned ─────────────

const PROTECTED_HEADING = "notes on this view";

const NOTES_SECTION_PLACEHOLDER = [
  "",
  '*Comment freely below. Corrections, missing context, "this section is wrong," anything. The next build reads these first and stamps them. Nothing you write here is ever overwritten or reworded.*',
  "",
].join("\n");

/** Appends ` → read <date>` — the exact stamp `PROJECT_VIEW.md` tells
 * readers about, and the exact pattern this file checks for to decide a
 * line's already been handled. */
function stampSuffix(date: string): string {
  return ` → read ${date}`;
}

function isStamped(line: string): boolean {
  return /→ read \d{4}-\d{2}-\d{2}\s*$/.test(line);
}

/** A line counts as a real reader comment worth surfacing if it has any
 * non-whitespace content beyond markdown's own decorative characters
 * (`*`, `-`, blank lines, the placeholder's own italic instructional
 * text) — the placeholder text itself is never treated as a comment to
 * read back to the model. */
function isMeaningfulCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed === NOTES_SECTION_PLACEHOLDER.trim()) return false;
  return true;
}

/**
 * Ensures the README has a "Notes on this view" section (creating it with
 * the standard placeholder text if entirely missing — see this file's own
 * module doc for why the MODEL never gets to create this section itself),
 * and returns (a) every unstamped comment line's text, for the model's
 * prompt, and (b) a function that stamps exactly those lines in place —
 * called only after a clean run, never before.
 */
function extractReaderComments(sections: ReadmeSection[]): {
  sections: ReadmeSection[];
  unstamped: string[];
  stampAppliedDate: (date: string) => ReadmeSection[];
} {
  const key = PROTECTED_HEADING;
  const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
  const notesSection: ReadmeSection = existingIndex === -1
    ? { heading: "Notes on this view", content: NOTES_SECTION_PLACEHOLDER }
    : sections[existingIndex];

  const lines = notesSection.content.split("\n");
  const unstamped = lines.filter((l) => isMeaningfulCommentLine(l) && !isStamped(l));

  const withNotes = existingIndex === -1 ? [...sections, notesSection] : sections;

  return {
    sections: withNotes,
    unstamped,
    stampAppliedDate: (date: string) => {
      const stampedLines = lines.map((l) => (isMeaningfulCommentLine(l) && !isStamped(l) ? `${l}${stampSuffix(date)}` : l));
      return withNotes.map((s) =>
        s.heading.toLowerCase() === key ? { heading: s.heading, content: stampedLines.join("\n") } : s,
      );
    },
  };
}

// ─── Section ordering — enforced by code, not the model ───────────────────

const CANONICAL_ORDER = [
  "what's carrying weight",
  "where we pull apart",
  "get shit done",
  "settled",
  "open questions",
  "notes on this view",
];

/** Re-sorts sections into `PROJECT_VIEW.md`'s prescribed shape — the
 * INTRO (heading `""`) always stays first; any of the six canonical
 * headings goes in `CANONICAL_ORDER`'s position; anything else (a
 * heading the model invented despite being told the shape is fixed) is
 * left just before "Notes on this view" rather than silently dropped, so
 * an instruction-following slip is visible instead of losing content. */
function reorderSections(sections: ReadmeSection[]): ReadmeSection[] {
  const intro = sections.filter((s) => s.heading === "");
  const named = sections.filter((s) => s.heading !== "");
  const known = CANONICAL_ORDER.map((h) => named.find((s) => s.heading.toLowerCase() === h)).filter(
    (s): s is ReadmeSection => !!s,
  );
  const unknown = named.filter((s) => !CANONICAL_ORDER.includes(s.heading.toLowerCase()));
  const notesIndex = known.findIndex((s) => s.heading.toLowerCase() === PROTECTED_HEADING);
  const withoutNotes = notesIndex === -1 ? known : known.filter((_, i) => i !== notesIndex);
  const notes = notesIndex === -1 ? [] : [known[notesIndex]];
  return [...intro, ...withoutNotes, ...unknown, ...notes];
}

// ─── The README tool-calling loop ──────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "update_section",
    description:
      'Replace or create one "## Heading" section in README.md with the given full content. For the intro (everything before the first heading), set heading to a zero-length empty string -- not any literal text, and not quote characters. Never target "Notes on this view" — that section is off-limits to this tool.',
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
    name: "remove_section",
    description: 'Deletes one "## Heading" section from README.md entirely. Never target "Notes on this view".',
    inputSchema: {
      type: "object",
      properties: { heading: { type: "string" } },
      required: ["heading"],
    },
  },
  {
    name: "get_node",
    description:
      'Fetch one node\'s full verbatim text and exact :ref{...} citation by id (e.g. "2026-07-29#3" -- ids are shown in brackets after every node you\'re already handed, and in every "- <date> Node <N>" line in graph-structure.md). Nodes behind the top threads are already given to you in full; use this for anything else you need to quote or cite before writing about it.',
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
];

/** A real bug, found in real production output: the tool description's
 * \`heading: ""\` example for the intro was sometimes misread by the
 * model as "pass the literal two-character string of two quote marks"
 * rather than "pass an actually-empty string" -- confirmed directly, a
 * real README came back with a literal \`## ""\` heading holding the
 * intro, sorted alongside other unrecognized headings instead of
 * leading the file. The tool description was reworded to be less
 * ambiguous, but this normalizes both spellings regardless, since a
 * clearer prompt reduces the odds without ever guaranteeing them. */
function normalizeIntroHeading(heading: string): string {
  return heading === '""' || heading === "''" ? "" : heading;
}

function createReadmeExecutors(input: {
  projectFolder: VaultFolder;
  log: (line: string) => void;
  initialContent: string;
  initialFileId: string | undefined;
  allNodesById: Map<string, GraphLogNode>;
  validNodeIds: Set<string>;
  today: string;
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  summaries: string[];
  hadRefusal: () => boolean;
  getCurrent: () => { content: string; fileId: string | undefined };
} {
  const { projectFolder, log, allNodesById, validNodeIds, today } = input;
  let currentContent = input.initialContent;
  let currentFileId = input.initialFileId;
  let hadRefusal = false;
  const summaries: string[] = [];

  async function commit(newFullContent: string): Promise<boolean> {
    if (!currentFileId) {
      const created = await createFileRef({
        human_id: projectFolder.human_id,
        name: "README.md",
        content: newFullContent,
        content_type: "text/markdown",
        folder_id: projectFolder._id,
      });
      if (!created) return false;
      currentFileId = created._id;
    } else {
      await updateFileRef(currentFileId, { content: newFullContent });
    }
    currentContent = newFullContent;
    return true;
  }

  const executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>> = {
    update_section: async (toolInput) => {
      const heading = normalizeIntroHeading(String(toolInput.heading ?? "").trim());
      const content = String(toolInput.content ?? "");
      const key = heading.toLowerCase();

      if (key === PROTECTED_HEADING) {
        hadRefusal = true;
        log('graph-project-view -- refused update_section on "Notes on this view" (protected; left unchanged).');
        return 'Error: "Notes on this view" is off-limits to this tool — it is never edited by GraphLog.';
      }

      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      const existing = existingIndex === -1 ? null : sections[existingIndex];

      if (content.trim().length === 0 && existing && existing.content.trim().length > 0) {
        hadRefusal = true;
        const label = heading || "(intro)";
        log(`graph-project-view -- refused update_section "${label}" (would erase real content with an empty section); left unchanged.`);
        return `Error: refused -- section "${label}" currently has real content; sending empty content would erase it. Use remove_section if you genuinely want to delete it.`;
      }

      const updatedSections = existing
        ? sections.map((s, i) => (i === existingIndex ? { heading: existing.heading, content } : s))
        : [...sections, { heading, content }];
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(reorderSections(updatedSections))));
      if (!ok) return "Error: failed to save section update";
      const label = heading || "(intro)";
      summaries.push(existing ? `updated "${label}"` : `added "${label}"`);
      log(`graph-project-view -- ${existing ? "updated" : "added"} README section "${label}".`);
      return `${existing ? "Updated" : "Added"} section "${label}".`;
    },
    remove_section: async (toolInput) => {
      const heading = normalizeIntroHeading(String(toolInput.heading ?? "").trim());
      const key = heading.toLowerCase();

      if (key === PROTECTED_HEADING) {
        hadRefusal = true;
        log('graph-project-view -- refused remove_section on "Notes on this view" (protected; left unchanged).');
        return 'Error: "Notes on this view" is off-limits to this tool — it is never edited by GraphLog.';
      }

      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      if (existingIndex === -1) return `Error: no section named "${heading}" found`;
      const updatedSections = sections.filter((_, i) => i !== existingIndex);
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(reorderSections(updatedSections))));
      if (!ok) return "Error: failed to remove section";
      summaries.push(`removed "${heading}"`);
      log(`graph-project-view -- removed README section "${heading}".`);
      return `Removed section "${heading}".`;
    },
    get_node: async (toolInput) => {
      const nodeId = String(toolInput.nodeId ?? "").trim();
      // Validated against graph-structure.md's OWN node list -- same "never
      // trust an id the model claims to have" reasoning `add_node` already
      // applies to its own link candidates (see 1.1(b)'s own ask).
      if (!validNodeIds.has(nodeId)) return `Error: "${nodeId}" is not a node id in graph-structure.md`;
      const node = allNodesById.get(nodeId);
      if (!node) return `Error: no node found with id "${nodeId}"`;
      // Same age stamp the pre-fetch applies -- a node reached via
      // get_node must not read differently from the same node pre-fetched.
      return formatNodeVerbatim(node, today);
    },
  };

  return { executors, summaries, hadRefusal: () => hadRefusal, getCurrent: () => ({ content: currentContent, fileId: currentFileId }) };
}

// Bumped from the original 8 as a defensive measure -- graph-structure's
// own truncation (see that file's own module doc: a real bootstrap run
// exceeded its output budget on the very first turn, spending it on
// planning/narration text before ever calling a tool) is a real, proven
// failure mode for a tool-calling loop asked to build a lot from scratch
// in one go, and this stage hasn't yet been exercised against a real,
// substantial graph-structure.md the way that one was. A first bootstrap
// needs at minimum ~5-6 update_section calls (one per canonical section);
// extra headroom here is free unless actually used.
const MAX_TURNS = 20;

async function runReadmeAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  perf: GraphLogPerfRecorder,
  projectFolderId: string,
): Promise<{
  usage: LlmUsage;
  model: string | null;
  truncated: boolean;
  hitMaxTurns: boolean;
  toolCallsMade: ToolCall[];
}> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per turn, so a Stop request never
    // waits longer than the current tool call.
    await throwIfGraphLogCancelled(projectFolderId);

    const turnStart = Date.now();
    const response = await provider.complete({ system, messages, tools: TOOLS });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    // Cache counts, same as `syncGraph.server.ts`'s own loop -- see there
    // for why these were missing everywhere and what it cost us.
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (response.usage.cacheReadTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0);
    model = response.model;

    // One perf event PER TURN -- see `syncGraph.server.ts`'s own
    // identically-shaped addition for the full reasoning (a real,
    // individually-timed API call, nested under this run's own
    // aggregate "readme" event, carrying whatever plain text the model
    // wrote this turn -- otherwise thrown away the moment it's folded
    // into `messages` below). Especially useful here: this is exactly
    // what a truncated turn was in the middle of writing when it got
    // cut off.
    await perf.event({
      process: "graph-project-view",
      type: "llm",
      name: "turn",
      params: {
        turn: turn + 1,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls.map((c) => c.name),
        text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
      },
      durationMs: Date.now() - turnStart,
      outcome: response.stopReason === "max_tokens" ? "error" : "ok",
    });

    if (response.stopReason === "max_tokens") {
      // See this file's own "Deliberately deferred" note — no retry
      // escalation yet, just stop; whatever earlier turns already
      // committed stands, and this is retried on a future run.
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    // At most ONE WRITE call (update_section/remove_section) per turn --
    // same enforcement and same reasoning as `syncGraph.server.ts`'s
    // `add_node` and `graphStructure.server.ts`'s `update_cluster`; see
    // the latter for the full note. An `update_section` call carries a
    // whole section's prose as its input, so several in one response is
    // several sections' worth of generated output against one
    // `DEFAULT_MAX_TOKENS`. A real run emitted four in a single turn;
    // that got away with it, and the identically-shaped call in
    // graph-structure did not. `get_node` stays unlimited: it's a read
    // whose call input is one id.
    for (const { call, execute } of planTurnToolCalls(response.toolCalls, isViewWrite)) {
      let resultText: string;
      if (execute) {
        toolCallsMade.push(call);
        resultText = (await executors[call.name]?.(call.input)) ?? `Unknown tool: ${call.name}`;
      } else {
        resultText =
          "Not processed -- only the FIRST update_section/remove_section call in a turn is executed, to keep each turn's own output within its limit. Call it again on your next turn for this section.";
      }
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns, toolCallsMade };
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * 1.2's own "what fell out of the README" report — deliberately just a
 * MEASUREMENT, never a rule: nothing here blocks a run or forces
 * coverage, it only makes visible what's currently invisible. See this
 * file's own module doc note on why (four of ten real threads produced
 * no README representation on the first production run, with no
 * predictable pattern by rank — the next tuning round should read this
 * data across a few real runs before anyone writes a coverage RULE).
 */
export type CoverageReport = {
  /** Threads present in graph-structure.md, not fallen away, and with NOT
   * ONE of their nodes cited anywhere in the README's final body — an
   * exact test (`GraphLogNode.refLine` found in the README), which is
   * ADR-006's own stated definition of a node making it in.
   *
   * Still a soft MEASUREMENT, never a gate: nothing here blocks a run or
   * forces coverage. What changed is that it now measures the thing it
   * claims to. It used to substring-match the thread's HEADING against the
   * README, and since the model writes its own section headings in its own
   * voice, a well-covered thread reported as missing nearly every run. */
  missingThreads: string[];
  /** Threads that fell away THIS run per ADR-009/`hasFallenAway`
   * (dormant, no Due, no Blocking) — still fully present in
   * graph-structure.md and still linkable by sync-graph (ADR-004), just
   * no longer surfaced to the README. Reported so the drop is visible,
   * never silent. */
  fellAway: string[];
  /** A FEATURED node (its own citation is in the README) carrying a real
   * attached-file markdown line (an image, a video link, or a plain file
   * link, all pointing at `/api/vault/view/<fileId>` -- see
   * `syncGraph.server.ts`'s own "A REAL, CONFIRMED GAP" note) whose exact
   * image line is nowhere in the finished README -- a hard requirement
   * (`PROJECT_VIEW.md`'s own "A file is never optional *if a node you are
   * featuring carries one*"), not a soft measurement: a file is either
   * carried along with its node's words or it isn't, and this catches the
   * model dropping one.
   *
   * The "featuring" condition is load-bearing and used to be missing.
   * Without it this walked every node in every non-fallen thread and
   * reported a miss for every photo the model correctly chose NOT to
   * feature, which on a photo-heavy project made the hard check the
   * loudest and least trustworthy line in the run report. Grouping several such images under a
   * shared `:::gallery{}...:::` wrapper is fine and expected -- only the
   * individual image LINE has to survive unchanged, not any particular
   * wrapper around it. Each entry is `"<node id> (<thread>)"`. Empty when
   * every non-fallen-away file-bearing node's file made it in. */
  missingFiles: string[];
};

export type GraphProjectViewResult =
  | {
      ok: true;
      /** True when `skills/PROJECT_VIEW.md` is missing or says "skip" —
       * a total no-op, no files examined, no model called. */
      skipped: boolean;
      /** True when the graph has changed since this stage last applied
       * it (`graph-structure.md`'s own `asOfGraphHash` didn't match its
       * `appliedByProjectView`) AND at least one section was edited. */
      changed: boolean;
      summary: string[];
      /** Null whenever this run didn't get far enough to check (skipped,
       * no graph yet, truncated, refused, errored, ...) — only a CLEAN
       * finish computes this. See `CoverageReport`'s own doc. */
      coverage: CoverageReport | null;
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

export interface RunGraphProjectViewOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
  /** Timeline recorder for this run — see `graphLogPerf.server.ts`. */
  perf?: GraphLogPerfRecorder;
}

function buildSystemPrompt(skillContent: string): string {
  return `You are GraphLog's graph-project-view step, keeping a project's README.md an accurate, organized synthesis of the whole graph (given to you as graph-structure.md's own clustered, weighted index, PLUS the actual verbatim text of the nodes behind its top threads). Never invent progress, dates, or facts that aren't grounded in a real node's own words or the README's own existing content -- graph-structure.md's glosses are a table of contents, never something to write prose from directly. Call get_node for any node you need that wasn't already handed to you in full. A node's own text may carry an attached file: a PHOTO or VIDEO (an ordinary markdown image or a link marked ?type=video) belongs in a :::gallery{}...::: block wherever that node's words are featured -- group several photos/videos from the same thread into ONE gallery rather than several. Anything else (a PDF, a doc, ...) is a plain [name](url) link, never put inside a gallery. Either way, that exact image/link line must appear in the same section as the words it came with -- a file is never optional and never gets its own separate section. Only touch sections that actually need to change -- call update_section/remove_section as needed, then stop (no more tool calls) once you're done. Never target "Notes on this view" with either tool -- it's off-limits, handled outside this loop entirely. If nothing needs to change, simply make no tool calls at all.

Do not write any planning, reasoning, or summary text outside of a tool call -- go straight to calling update_section/remove_section/get_node with no preamble and no narration in between calls either. Your own output budget per turn is limited, and explanatory text spends it on nothing that ends up in the README.

${skillContent}`;
}

/**
 * 1.1's own pre-fetch — the FLOOR nobody can forget (see this file's own
 * module doc / ADR-006): without this, a run that never happens to call
 * `get_node` silently falls back to writing from glosses alone, and
 * nothing errors when that happens. Walks graph-structure.md's OWN
 * ordering top-down (already importance-sorted, see
 * `graphStructure.server.ts`'s `sortClustersByWeight`) and fills a fixed
 * NODE budget, grouped by thread, stopping mid-thread rather than
 * mid-graph once the budget runs out — bounded by node count, not thread
 * count, so this stays flat as a thread that holds a dozen nodes today
 * grows to hold fifty. */
function buildNodePrefetchBlock(
  sections: ReadmeSection[],
  allNodesById: Map<string, GraphLogNode>,
  today: string,
): string | null {
  const named = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() !== "unclustered");
  const blocks: string[] = [];
  let remaining = NODE_PREFETCH_BUDGET;
  for (const section of named) {
    if (remaining <= 0) break;
    // A fallen-away thread is one `PROJECT_VIEW.md` tells the model to
    // leave out of the README. Handing over its full verbatim text and
    // then instructing the model not to use it is the wrong side of the
    // pressure: the material is right there, rich, and specifically
    // forbidden. It also spends a budget that belongs to threads that
    // earned it, since this fills top-down until it runs out.
    //
    // NOTE for anyone extending this: filtering here is safe precisely
    // because this is a VIEW. Applying the same filter to `sync-graph`'s
    // link-candidate list is ADR-004's forbidden move, and the one failure
    // that can never be detected from outside (a thread nobody can see is
    // a thread nobody writes about, so nothing links to it, so it can
    // never return). Fallen away means out of the README. Nothing else.
    if (hasFallenAway(section)) continue;
    const nodeIds = nodeIdsInSection(section);
    if (nodeIds.length === 0) continue;
    const included = nodeIds.slice(0, remaining);
    const nodeTexts = included.map((id) => allNodesById.get(id)).filter((n): n is GraphLogNode => !!n);
    if (nodeTexts.length === 0) continue;
    remaining -= included.length;
    const truncatedNote = included.length < nodeIds.length
      ? `\n\n(truncated -- ${nodeIds.length - included.length} more node(s) in this thread not shown here; call get_node for any of them by id)`
      : "";
    blocks.push(`## ${section.heading}\n\n${nodeTexts.map((n) => formatNodeVerbatim(n, today)).join("\n\n")}${truncatedNote}`);
  }
  if (blocks.length === 0) return null;
  return `The actual node text behind graph-structure.md's own top threads, in its own order (read these to decide what to WRITE, not just what to write ABOUT -- call get_node for anything else you need):\n\n${blocks.join("\n\n---\n\n")}`;
}

/** How many DISTINCT people have written anything in this graph, and who.
 *
 * `PROJECT_VIEW.md` spends a paragraph telling the model to check the
 * number of distinct writers before making any claim about agreement or
 * convergence, because those claims are meaningless in a one-person
 * project (a journal and a merge are not the same tool). The exact answer
 * is right here in the parsed nodes. Asking the model to infer it by
 * reading author names off node blocks is asking it to recount something
 * the code knows, and to get it wrong quietly when the pre-fetch happens
 * to show one person's nodes first. */
function describeWriters(allNodes: GraphLogNode[]): string {
  // HOW MANY is counted by human id; WHO is read off the names. Counting
  // names is the ADR-015 bug in its most damaging form: the one-person
  // branch below is a CONSTRAINT the model is handed, and a multi-author
  // graph whose names had collapsed used to satisfy `names.length === 1`
  // and be told, wrongly, that convergence was unclaimable here.
  const byId = new Map<string, string | null>();
  for (const node of allNodes) {
    // Same identity ladder as `computeBacklinkIndex` -- see ADR-015. A
    // node with no id at all is still a person; falling back to the name
    // (then to the node's own id) keeps a pre-ADR-015 graph counting the
    // way it always did rather than reporting everyone as one writer.
    const id = node.authorHumanId ?? node.authorName ?? node.id;
    const existing = byId.get(id);
    if (!existing) byId.set(id, node.authorName ?? null);
  }
  if (byId.size === 0) return "Distinct people who have written in this graph: unknown.";

  // Defensive, and should be unreachable: `sync-graph` refuses to write a
  // node whose author it cannot name (ADR-015), so an id with no name
  // means a node written before that rule, or a bug upstream of here.
  const names = [...byId.values()].filter((n): n is string => !!n).sort();
  const unnamed = byId.size - names.length;
  const who = [
    names.join(", ") || null,
    unnamed > 0 ? `${unnamed} unnamed` : null,
  ].filter(Boolean).join(", and ");

  if (byId.size === 1) {
    return `Distinct people who have written in this graph: 1 (${who}). This is a one-person project — convergence, agreement and "several people keep returning to this" are not claims the graph can support here.`;
  }
  return `Distinct people who have written in this graph: ${byId.size} (${who}).`;
}

function buildUserPrompt(input: {
  today: string;
  writersFact: string;
  graphStructureBody: string;
  nodeTextBlock: string | null;
  readmeContent: string;
  unstampedComments: string[];
}): string {
  const currentBody = splitFrontmatter(input.readmeContent).body.trim();
  return [
    `Today's actual date: ${input.today}`,
    input.writersFact,
    `graph-structure.md (the whole graph, organized -- a table of contents; read the nodes below to write from):\n\n${input.graphStructureBody}`,
    input.nodeTextBlock,
    currentBody
      ? `README.md's CURRENT body (edit this incrementally via update_section/remove_section):\n\n${currentBody}`
      : "README.md is currently empty — this is the first content it will ever have.",
    input.unstampedComments.length > 0
      ? `Unread reader corrections in "Notes on this view" (treat these as ground truth overriding your own reading; you do not need to and should not edit that section yourself):\n${input.unstampedComments.map((c) => `- ${c}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/**
 * The coverage/fell-away pass — pure text comparison, no LLM call, run
 * unconditionally after every clean finish.
 *
 * ONE DEFINITION OF "IN THE README", USED BY BOTH CHECKS: a node is
 * featured when its own exact `:ref{...}` line appears in the README body.
 * That is ADR-006's own stated test, and `GraphLogNode.refLine` keeps the
 * line for exactly this.
 *
 * It replaces a substring match on the thread's HEADING, which measured
 * the wrong thing entirely. Headings are two-to-five-word labels and the
 * model is told to write in its own voice with its own section headings,
 * so a thoroughly covered thread read as missing on almost every run. A
 * report that cries wolf every run is worse than no report, and the whole
 * point of this one is to make dropout measurable BEFORE anyone writes a
 * coverage rule.
 *
 * `missingFiles` is now conditioned on featuring too. `PROJECT_VIEW.md`
 * says a file is never optional *if a node you are featuring carries one*;
 * this used to drop that condition and walk every node in every non-fallen
 * thread, so it reported a miss for every photo the model correctly chose
 * not to feature. On any project with more than a handful of photos that
 * made it the loudest line in the run report, drowning the soft
 * measurement sitting next to it.
 */
export function computeCoverageReport(
  structureBody: string,
  readmeBody: string,
  allNodesById: Map<string, GraphLogNode>,
): CoverageReport {
  const sections = splitReadmeSections(structureBody);
  // Both sides normalized through the same function, so the match doesn't
  // care whether the citation is in graph-log (verbose) or view mode.
  const normalizedReadme = stripRefVerbose(readmeBody);
  const isFeatured = (node: GraphLogNode): boolean =>
    !!node.refLine && normalizedReadme.includes(stripRefVerbose(node.refLine));

  const missingThreads: string[] = [];
  const fellAway: string[] = [];
  const missingFiles: string[] = [];
  for (const section of sections) {
    if (section.heading === "" || section.heading.toLowerCase() === "unclustered") continue;
    const threadFellAway = hasFallenAway(section);
    if (threadFellAway) fellAway.push(section.heading);

    const nodes = nodeIdsInSection(section)
      .map((id) => allNodesById.get(id))
      .filter((n): n is GraphLogNode => !!n);
    const featured = nodes.filter(isFeatured);

    // A thread counts as represented when at least ONE of its nodes is
    // actually cited. A fallen-away thread is intentionally absent
    // (ADR-009), so its absence is never a miss.
    if (!threadFellAway && featured.length === 0) missingThreads.push(section.heading);

    // Only a FEATURED node's file can be dropped -- a node the model
    // didn't feature was never carrying its file into the README in the
    // first place.
    if (threadFellAway) continue;
    for (const node of featured) {
      for (const fileLine of extractAttachedFileLines(node.quote)) {
        if (!readmeBody.includes(fileLine)) missingFiles.push(`${node.id} (${section.heading})`);
      }
    }
  }
  return { missingThreads, fellAway, missingFiles };
}

/**
 * Runs graph-project-view for one project: reconciles README.md against
 * `Graph/graph-structure.md`'s current content, once, if the graph has
 * changed since this stage last applied it.
 */
export async function runGraphProjectView(
  projectFolder: VaultFolder,
  actingHumanId: string,
  opts: RunGraphProjectViewOptions = {},
): Promise<GraphProjectViewResult> {
  const log = opts.log ?? (() => {});
  const perf = opts.perf ?? noopGraphLogRunRecorder;

  const skill = await getProjectStageSkill(projectFolder, "PROJECT_VIEW.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, changed: false, summary: [], coverage: null, incomplete: [] };
  }
  if (!isGraphLogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) {
    log("graph-project-view: no Graph/ folder yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [] };
  }

  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const structureListing = files.find((f) => f.name === GRAPH_STRUCTURE_FILE_NAME);
  if (!structureListing) {
    log("graph-project-view: no graph-structure.md yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [] };
  }
  const structureFile = await getFileRefById(structureListing._id);
  if (!structureFile?.content) {
    log("graph-project-view: graph-structure.md is empty — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [] };
  }

  const meta = parseGraphStructureFrontmatter(structureFile.content);
  if (!meta.asOfGraphHash) {
    log("graph-project-view: graph-structure.md is malformed (no asOfGraphHash) — skipping.");
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [] };
  }
  if (meta.appliedByProjectView === meta.asOfGraphHash) {
    log("graph-project-view: up to date, nothing changed since last run.");
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [] };
  }

  // 1.1's own floor+ceiling (ADR-006): read every graph-log file's real
  // node text, not just graph-structure.md's own glosses, so the model
  // has actual words to write from -- see `buildNodePrefetchBlock`/
  // `get_node`'s own doc for the full reasoning.
  const graphLogListings = files
    .map((f) => ({ listing: f, date: GRAPH_LOG_RE.exec(f.name)?.[1] }))
    .filter((x): x is { listing: (typeof files)[number]; date: string } => !!x.date);
  const allNodes: GraphLogNode[] = [];
  for (const { listing, date } of graphLogListings) {
    const file = await getFileRefById(listing._id);
    if (!file?.content) continue;
    allNodes.push(...parseGraphLogNodes(date, splitFrontmatter(file.content).body));
  }
  const allNodesById = new Map(allNodes.map((n) => [n.id, n]));
  const structureSections = splitReadmeSections(splitFrontmatter(structureFile.content).body);
  const validNodeIds = buildMembershipIndex(structureSections);
  // Declared here rather than beside `buildUserPrompt` below because the
  // pre-fetch and `get_node` both stamp each node's age from it now, and
  // every one of them must agree about what today is within a run.
  const today = new Date().toISOString().slice(0, 10);
  const nodeTextBlock = buildNodePrefetchBlock(structureSections, allNodesById, today);

  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  const extraSkillFiles = await listExtraSkillFiles(projectFolder);
  const skillContent = [skill, generalSkill, ...extraSkillFiles.map((f) => `## ${f.name}\n\n${f.content}`)]
    .filter(Boolean)
    .join("\n\n");
  const system = buildSystemPrompt(skillContent);

  const readmeFile = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  const initialContent = readmeFile?.content ?? "";

  // Ensure "Notes on this view" exists and pull out anything unstamped —
  // BEFORE the model ever sees the README, so its own prompt already
  // reflects the guaranteed-present section (see this file's own module
  // doc: the model never creates or edits this section itself).
  const initialSections = splitReadmeSections(splitFrontmatter(initialContent).body);
  const { sections: sectionsWithNotes, unstamped, stampAppliedDate } = extractReaderComments(initialSections);
  const contentWithNotes = withReadmeBody(initialContent, joinReadmeSections(reorderSections(sectionsWithNotes)));

  // If the README didn't already have a real file (or was missing
  // "Notes on this view"), persist that placeholder shape now, BEFORE
  // constructing the executors below — they need the REAL file id this
  // produces (a brand new README) to edit the SAME file the model's
  // first tool call touches, rather than starting from `undefined` and
  // creating a second, duplicate README the moment `update_section`
  // first fires (a real bug, caught by direct testing, not assumed).
  let readmeFileId = readmeFile?._id;
  if (!readmeFileId) {
    const created = await createFileRef({
      human_id: projectFolder.human_id,
      name: "README.md",
      content: contentWithNotes,
      content_type: "text/markdown",
      folder_id: projectFolder._id,
    });
    if (!created) return { ok: false, error: "Failed to create README.md" };
    readmeFileId = created._id;
  } else if (contentWithNotes !== initialContent) {
    await updateFileRef(readmeFileId, { content: contentWithNotes });
  }

  const executors_ = createReadmeExecutors({
    projectFolder,
    log,
    initialContent: contentWithNotes,
    initialFileId: readmeFileId,
    allNodesById,
    validNodeIds,
    today,
  });
  const { executors, summaries, hadRefusal, getCurrent } = executors_;

  const userPrompt = buildUserPrompt({
    today,
    writersFact: describeWriters(allNodes),
    graphStructureBody: splitFrontmatter(structureFile.content).body.trim(),
    nodeTextBlock,
    readmeContent: contentWithNotes,
    unstampedComments: unstamped,
  });

  const callStart = Date.now();
  try {
    const llm = opts.provider ?? new AnthropicProvider();
    const { usage, model, truncated, hitMaxTurns } = await runReadmeAgentLoop(
      llm,
      system,
      userPrompt,
      executors,
      perf,
      projectFolder._id,
    );

    const durationMs = Date.now() - callStart;
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-project-view",
      kind: "project-view",
      model: model ?? undefined,
      usage,
      durationMs,
      outcome: truncated ? "error" : "success",
      errorKind: truncated ? "incomplete" : undefined,
    });
    await perf.event({
      process: "graph-project-view",
      type: "llm",
      name: "readme",
      params: null,
      durationMs,
      outcome: truncated ? "error" : "ok",
    });

    if (truncated) {
      const reason = "update was cut off by the model's own output limit";
      log(`graph-project-view: ${reason} — will retry next run.`);
      return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
    }
    if (hitMaxTurns) {
      const reason = "hit its turn limit before finishing";
      log(`graph-project-view: ${reason} — will retry next run.`);
      return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
    }
    if (hadRefusal()) {
      const reason = "had at least one refused edit";
      log(`graph-project-view: ${reason} — will retry next run.`);
      return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
    }

    // Clean finish: one final deterministic reconcile pass, always run
    // regardless of what (if anything) the model touched --
    //   1. Re-sort sections into canonical order (a run that only edited
    //      ONE section shouldn't leave the other five wherever history
    //      happened to put them).
    //   2. Stamp today's date onto whichever comment lines were unstamped
    //      BEFORE this run (deterministic, never the model's own text --
    //      the notes section is protected, so the loop above could never
    //      have touched it, meaning `stampAppliedDate`'s closure, built
    //      from the README's state BEFORE the loop ran, is still accurate).
    // Then mark this graph-structure.md version applied so it's never
    // reprocessed unless graph-structure regenerates it.
    const { content: latestContent, fileId } = getCurrent();
    const latestSections = splitReadmeSections(splitFrontmatter(latestContent).body);
    const stampedNotes = unstamped.length > 0
      ? stampAppliedDate(today).find((s) => s.heading.toLowerCase() === PROTECTED_HEADING)
      : undefined;
    const reconciledSections = reorderSections(
      stampedNotes
        ? latestSections.map((s) => (s.heading.toLowerCase() === PROTECTED_HEADING ? stampedNotes : s))
        : latestSections,
    );
    const reconciledContent = withReadmeBody(latestContent, joinReadmeSections(reconciledSections));
    if (reconciledContent !== latestContent && fileId) {
      await updateFileRef(fileId, { content: reconciledContent });
    }

    await markGraphStructureApplied(structureListing._id, structureFile.content, meta.asOfGraphHash);
    const changed = summaries.length > 0;
    log(changed ? `graph-project-view: ${summaries.join(", ")}.` : "graph-project-view: nothing to change.");

    const coverage = computeCoverageReport(
      splitFrontmatter(structureFile.content).body,
      splitFrontmatter(reconciledContent).body,
      allNodesById,
    );
    if (coverage.missingThreads.length > 0) {
      log(`graph-project-view: ${coverage.missingThreads.length} thread(s) have no representation in the README this run: ${coverage.missingThreads.join(", ")}.`);
    }
    if (coverage.fellAway.length > 0) {
      log(`graph-project-view: ${coverage.fellAway.length} thread(s) fell away this run (dormant, no Due, no Blocking): ${coverage.fellAway.join(", ")}.`);
    }
    if (coverage.missingFiles.length > 0) {
      log(`graph-project-view: ${coverage.missingFiles.length} attached file(s) were dropped this run (PROJECT_VIEW.md says never): ${coverage.missingFiles.join(", ")}.`);
    }

    return { ok: true, skipped: false, changed, summary: summaries, coverage, incomplete: [] };
  } catch (err) {
    log(`graph-project-view: couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
    const durationMs = Date.now() - callStart;
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-project-view",
      kind: "project-view",
      durationMs,
      outcome: "error",
      errorKind: classifyGraphLogError(err),
    });
    await perf.event({
      process: "graph-project-view",
      type: "llm",
      name: "readme",
      params: null,
      durationMs,
      outcome: "error",
    });
    return {
      ok: true,
      skipped: false,
      changed: false,
      summary: [],
      coverage: null,
      incomplete: [`stopped on an error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
