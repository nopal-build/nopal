/**
 * GraphLog's `graph-project-view` stage — the final, AGENTIC stage (see
 * the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
 *     -> graph-project-view (this file)
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog stage: a project's `skills/EFFORTS.md`
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
 * A "NOTES ON THIS VIEW" SECTION, WHERE ONE STILL EXISTS, IS NEVER TOUCHED
 * BY THE MODEL — see `PROTECTED_HEADING` below. It is no longer created
 * (annotation is its own feature now; see `extractReaderComments`), but
 * every README that has one keeps it. Reading unstamped reader comments and
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
 * created over a project's life. `reorderSections` re-sorts the known
 * headings into the shape `EFFORTS.md` itself declares (read off
 * the skill by `parseSectionShape`; the built-in list is only a reported
 * fallback) after every run; anything else (a heading the model invented
 * despite being told not to) is left just before "Notes on this view"
 * rather than silently dropped.
 *
 * Deliberately deferred (start simple; add if a real need shows up, same
 * philosophy the `oxmarkdown` skill's Grid/Gallery/Toggle List promotions
 * already established):
 *   - `write_file` (splitting detail into a separate reference file) and
 *     `update_readme` (a full-body rewrite) — `update_section`/
 *     `remove_section` alone are enough to prove out the incremental
 *     shape first.
 *   - A write unit BELOW the section (an `append_to_section`). The run
 *     is a loop of passes now (see "A RUN IS A LOOP OF PASSES" in
 *     `runGraphProjectView`), so a section that overruns one response
 *     no longer blocks the sections after it, and the next pass is told
 *     by name which section was cut off so it can write that one
 *     shorter. What is still deferred is content that genuinely cannot
 *     fit one response per section. `EFFORTS.md` bounds a section
 *     far below the output budget ("two or three quoted phrases is
 *     normal, six is a wall"; the whole file readable in one sitting),
 *     so that case is a skill violation the shortfall names, not a
 *     shape this stage should quietly absorb. Appending is also not
 *     idempotent across runs (a half-appended section on retry has no
 *     marker saying so), which is the hazard `update_section`'s
 *     replace semantics avoid. Build the sub-unit when a real run names
 *     a section that could not be written shorter, and not before.
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
  stripIncompleteBanner,
  withIncompleteBanner,
  withReadmeBody,
  type ReadmeSection,
} from "./project.types";
import {
  classifyStageSkill,
  composeStageSkill,
  withVoiceFirst,
  findProjectGraphFolder,
  getProjectStageSkill,
  isSkipInstruction,
  listExtraSkillFiles,
} from "./projectN02.server";
import {
  parseGraphStructureFrontmatter,
  markGraphStructureApplied,
  hasFallenAway,
  parseClusterFields,
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
import {
  applyEffortDescriptions,
  arrivedSince,
  assignEffortThreads,
  buildEffortsSidecar,
  buildReadingsBlock,
  computeEffortReadings,
  countPageWords,
  EFFORTS_SIDECAR_FILE_NAME,
  fallenAwayThreads,
  firstName,
  markChanges,
  PAGE_WORD_CEILING,
  parseEffortBlocks,
  parseRead,
  readEffortsSidecar,
  readSidecarMeta,
  removedEfforts,
  sectionShapeNotes,
  stripChangeTags,
  type EffortDescription,
} from "./effortReadings.server";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { noopGraphLogRunRecorder, type GraphLogPerfRecorder } from "./graphLogPerf.server";
import { pageHash } from "./pageBody.server";
import {
  authorNames,
  describeRef,
  listMarksSourceFileIds,
  listUnreadMarks,
  refLineFileId,
  MARK_KINDS,
  stampMarksRead,
  type GraphLogMark,
  type MarkKind,
} from "./graphLogMarks.server";
import { cardChunks, checkMoveProposal, listDestinationNames, recordMove, type MovePlan } from "./graphLogMoves.server";
import { parseSyncedCardFileName } from "./dailyLogSync.server";
import { throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { completedToolCalls, cutOffHeading, headingText, planTurnToolCalls } from "./llmProvider";
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

/** Appends ` → read <date>` — the exact stamp `EFFORTS.md` tells
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
 * Reads a "Notes on this view" section IF the README has one, and returns
 * (a) every unstamped comment line's text, for the model's prompt, and
 * (b) a function that stamps exactly those lines in place — called only
 * after a clean run, never before.
 *
 * NO LONGER CREATED. This section was the README's own comment box until
 * annotation became its own feature; the skill's shape no longer includes
 * it and a fresh README does not get one. A README that already carries
 * one keeps every protection it had: the model can never touch it, its
 * comments are still read and stamped, and it still sorts last. Nothing
 * a person wrote there is ever removed by code.
 */
export function extractReaderComments(sections: ReadmeSection[]): {
  sections: ReadmeSection[];
  unstamped: string[];
  stampAppliedDate: (date: string) => ReadmeSection[];
} {
  const key = PROTECTED_HEADING;
  const notesSection = sections.find((s) => s.heading.toLowerCase() === key);
  if (!notesSection) return { sections, unstamped: [], stampAppliedDate: () => sections };

  const lines = notesSection.content.split("\n");
  const unstamped = lines.filter((l) => isMeaningfulCommentLine(l) && !isStamped(l));

  return {
    sections,
    unstamped,
    stampAppliedDate: (date: string) => {
      const stampedLines = lines.map((l) => (isMeaningfulCommentLine(l) && !isStamped(l) ? `${l}${stampSuffix(date)}` : l));
      return sections.map((s) =>
        s.heading.toLowerCase() === key ? { heading: s.heading, content: stampedLines.join("\n") } : s,
      );
    },
  };
}

// ─── Section ordering — enforced by code, not the model ───────────────────

/** Headings in the README that are neither the intro nor one of the
 * canonical six -- a heading the model invented despite being told the
 * shape is fixed. `reorderSections` keeps them (just before "Notes on this
 * view") so the content is never lost, and its own doc promised that made
 * the slip "visible"; it was visible only to a person reading the README.
 * Counted onto the pass event and the log now, and the skill's "propose a
 * better cut" invitation finally has a place its answer lands. */
export function unknownHeadings(sections: ReadmeSection[], order: readonly string[] = BUILT_IN_ORDER): string[] {
  return sections
    .filter((s) => s.heading !== "" && !order.includes(s.heading.toLowerCase()))
    .map((s) => s.heading);
}

/**
 * THE SHAPE COMES FROM THE SKILL. `EFFORTS.md` declares the README's
 * sections in a fenced block under `# The shape`, and the code used to
 * hold a second copy of the same list here. Two sources of truth, and
 * they had already drifted once (the skill invited "propose a better
 * cut" while the code quarantined any heading it did not know). The
 * sections are read off the project's own skill file now -- see
 * `parseSectionShape` -- so changing the README's shape is editing one
 * file, and a project can carry a different shape from the default.
 *
 * This built-in list is the FALLBACK for a skill whose shape block cannot
 * be parsed (reported through `incomplete`, never silent), and the
 * default for the pure helpers' tests. `PROTECTED_HEADING` stays here
 * regardless of what any skill says: it guards a section a person may
 * have written in, and a protection whose scope is read from an editable
 * text file is not a protection.
 */
const BUILT_IN_ORDER: readonly string[] = [
  "what's carrying weight",
  "where we pull apart",
  "get shit done",
  "settled",
  "open questions",
  PROTECTED_HEADING,
];

/**
 * The section headings a `EFFORTS.md` declares, lowercased, in
 * order, or `[]` when it declares none this can read.
 *
 * Reads ONLY the fenced block that follows the `# The shape` heading --
 * never the whole skill, which carries `## ` lines of its own prose
 * ("## On the two lanes", "## Get shit done is a surface, not an
 * assignment") that a naive scan would take for sections. The fence is
 * an unambiguous delimiter; inside it `splitReadmeSections` does the same
 * work it does on a README, and `# <Project>` falls into the intro
 * (heading `""`) the way an intro is represented everywhere else.
 */
export function parseSectionShape(skill: string | null | undefined): string[] {
  if (!skill) return [];
  const lines = skill.split("\n");
  const headingAt = lines.findIndex((l) => /^#\s+the shape\s*$/i.test(l.trim()));
  if (headingAt === -1) return [];
  const fenceStart = lines.findIndex((l, i) => i > headingAt && /^```/.test(l.trim()));
  if (fenceStart === -1) return [];
  const fenceEnd = lines.findIndex((l, i) => i > fenceStart && /^```/.test(l.trim()));
  if (fenceEnd === -1) return [];
  const block = lines.slice(fenceStart + 1, fenceEnd).join("\n");
  return splitReadmeSections(block)
    .map((s) => s.heading.trim().toLowerCase())
    .filter((h) => h !== "");
}

/**
 * The order this run enforces: the skill's own shape with the protected
 * heading always last (whether or not the skill names it), or the
 * built-in list when the skill's shape cannot be read. `reason` is the
 * line for `incomplete` in that case -- a free-text file becoming
 * load-bearing needs its failure to be loud.
 */
export function resolveSectionOrder(skill: string | null | undefined): { order: string[]; reason: string | null } {
  const parsed = parseSectionShape(skill);
  if (parsed.length === 0) {
    return {
      order: [...BUILT_IN_ORDER],
      reason: "skills/EFFORTS.md declares no readable section shape (a fenced block under \"# The shape\"), so the built-in shape was used",
    };
  }
  const withoutProtected = parsed.filter((h) => h !== PROTECTED_HEADING);
  return { order: [...withoutProtected, PROTECTED_HEADING], reason: null };
}

/** Re-sorts sections into the skill's prescribed shape — the INTRO
 * (heading `""`) always stays first; any known heading goes in `order`'s
 * position; anything else (a heading the model invented despite being
 * told the shape is fixed) is left just before "Notes on this view"
 * rather than silently dropped, so an instruction-following slip is
 * visible instead of losing content. */
export function reorderSections(sections: ReadmeSection[], order: readonly string[] = BUILT_IN_ORDER): ReadmeSection[] {
  const intro = sections.filter((s) => s.heading === "");
  const named = sections.filter((s) => s.heading !== "");
  // EVERY section under a known heading, in file order, not only the
  // first. `find` kept one and silently dropped the rest, which
  // contradicted this function's own promise above: `splitReadmeSections`
  // is line-based and ignores code fences, so a `## ` line inside a
  // section's prose manufactures a duplicate, and the duplicate's content
  // was gone on the next commit with nothing to say so.
  const known = order.flatMap((h) => named.filter((s) => s.heading.toLowerCase() === h));
  const unknown = unknownHeadings(sections, order).map((h) => named.find((s) => s.heading === h)!);
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
    name: "describe_effort",
    description:
      "Report one bench effort's size (XS, S, M, L or XL), posture (regroup or accelerate) and direction (a few words) for the layout. Call it once per bench effort after writing it. Nothing you send here appears on the page; the page carries no fields.",
    inputSchema: {
      type: "object",
      properties: {
        effort: { type: "string", description: "The effort's heading text without the person, exactly as written" },
        size: { type: "string" },
        posture: { type: "string" },
        direction: { type: "string" },
      },
      required: ["effort", "size", "posture"],
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

/** Only offered on a run that has marks to read, so a run without any
 * sees exactly the tools it always did. See `viewTools`. */
const READ_MARK_TOOL: ToolDefinition = {
  name: "read_mark",
  description:
    'Say what one mark is doing. Call it once for every mark listed under "Marks people wrote on the page". kind is one of: correction (something on the page is wrong or out of date), addition (something true that nobody logged), thought (a reaction, a question or an idea, which may change nothing on the page), structural (about how things are organized rather than the work, for example an entry filed under the wrong project). Nothing you send here appears on the page.',
  inputSchema: {
    type: "object",
    properties: {
      markId: { type: "string" },
      kind: { type: "string", enum: [...MARK_KINDS] },
    },
    required: ["markId", "kind"],
  },
};

const PROPOSE_MOVE_TOOL: ToolDefinition = {
  name: "propose_move",
  description:
    "For a structural mark saying a daily-log entry was filed under the wrong project. entryFileId is one of the entries the marked passage cites (the file id shown with it). section is the ## section of that entry that moves, exactly as listed; leave it out to move the whole entry. destination is the project the mark says it belongs to, in the mark's own words. Code checks it and tells you whether it moves (the entry leaves this project on the next sync, so write this page without it) or waits for the entry's author to confirm (leave it on the page). Never name the other project anywhere on this page.",
  inputSchema: {
    type: "object",
    properties: {
      markId: { type: "string" },
      entryFileId: { type: "string" },
      section: { type: "string" },
      destination: { type: "string" },
    },
    required: ["markId", "entryFileId", "destination"],
  },
};

/** The tools a pass is offered. With no marks, `TOOLS` itself, the same
 * array every run has always had: Efforts is live, and a run nobody has
 * marked must not see a single new word. */
export function viewTools(withMarks: boolean): ToolDefinition[] {
  return withMarks ? [...TOOLS, READ_MARK_TOOL, PROPOSE_MOVE_TOOL] : TOOLS;
}

/** A mark as the page run is shown it. */
export type PromptMark = {
  id: string;
  authorName: string;
  date: string;
  unitKind: string;
  unitText: string;
  section: string;
  effort: string;
  cites: { label: string; fileId: string | null; sections: string[] }[];
  earlierVersion: boolean;
  text: string;
};

/** The marks block of the user prompt. Only built when there are marks. */
export function buildMarksBlock(marks: readonly PromptMark[]): string {
  const lines = marks.map((m) => {
    const where = [m.section || "the opening", m.effort].filter(Boolean).join(" · ");
    const cites = m.cites.length
      ? m.cites
          .map((c) => `${c.label}${c.fileId ? ` [file ${c.fileId}${c.sections.length ? `; its sections: ${c.sections.map((h) => `"${h}"`).join(", ")}` : ""}]` : ""}`)
          .join("; ")
      : "nothing (the passage carries no citation)";
    return [
      `- mark:${m.id} · ${m.authorName} · ${m.date} · on the ${m.unitKind} "${m.unitText}" (${where})${m.earlierVersion ? " · written on an earlier version of the page" : ""}`,
      `  The passage cites: ${cites}`,
      `  Their words: ${m.text.replace(/\s*\n\s*/g, " / ")}`,
    ].join("\n");
  });
  return [
    "Marks people wrote on the page since it was last read. A mark is a person's own words written beside one thought on the page, and it outranks your own reading, the same as a reader correction. Each is also in the graph as that person's entry, dated the day they wrote it, so the page can cite it.",
    "Reflect a mark where it changes what the page should say, citing the entries that back the change (the mark's own entry among them). A thought (a reaction, a question, an idea) already shows in the margin beside the passage it was written on: leave it there. Do not add a line, a quotation or a sentence to the page to carry a thought; the page changes for one only when it says something new about the work itself. Never present a mark's words as the entry it comments on. Call read_mark once for every mark below. For a structural mark saying a daily-log entry belongs to a different project, also call propose_move. This page never names another project.",
    ...lines,
  ].join("\n\n");
}

/** The first forbidden project name this content says, or null. Whole
 * words, so a project called "Garage" is caught in "the Garage" and not
 * in "garages". */
export function namesAnotherProject(content: string, names: readonly string[]): string | null {
  const haystack = content.toLowerCase();
  const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const name of names) {
    const needle = name.trim().toLowerCase();
    if (!needle) continue;
    // EVERY occurrence, not the first: a page that says "casitas nearby"
    // before it says "the Casita" would otherwise pass the guard on the
    // strength of the word that was not the project.
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return name;
    }
  }
  return null;
}

/** Everything the model is shown about each mark: who, when, the passage
 * and where it sat, and, for each entry the passage cites, its `##`
 * sections (what `propose_move` can name). */
async function buildPromptMarks(marks: readonly GraphLogMark[], currentPageHash: string): Promise<PromptMark[]> {
  const names = await authorNames(marks.map((m) => m.author_human_id));
  const sectionsByFile = new Map<string, string[]>();
  for (const ref of marks.flatMap((m) => m.unit.refs)) {
    if (!ref.fileId || sectionsByFile.has(ref.fileId)) continue;
    const file = await getFileRefById(ref.fileId);
    sectionsByFile.set(ref.fileId, file?.content ? cardChunks(file.content).map((c) => c.heading).filter(Boolean) : []);
  }
  return marks.map((m) => ({
    id: m._id,
    authorName: names.get(m.author_human_id) ?? m.author_human_id,
    date: m.date,
    unitKind: m.unit.kind === "bullet" ? "line" : m.unit.kind,
    unitText: m.unit.text,
    section: m.unit.section,
    effort: m.unit.effort,
    cites: m.unit.refs.map((r) => ({
      label: describeRef(r),
      fileId: r.fileId,
      sections: r.fileId ? sectionsByFile.get(r.fileId) ?? [] : [],
    })),
    earlierVersion: m.page_hash !== currentPageHash,
    text: m.text,
  }));
}

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

/**
 * Whether an `update_section` aimed at the intro (heading `""`) should be
 * turned back because no body section has any content yet.
 *
 * The intro characterizes the whole project, so on a bootstrap it is the
 * weakest section when written first, and it was (yesterday's finding on
 * a real README). Under one-write-per-turn the write ORDER is the model's
 * to choose, which makes the system prompt's "write the intro last" a
 * hope rather than a rule. This is the structural half. It can only bite
 * on a bootstrap: any README with one non-empty body section lets the
 * intro through. "Notes on this view" never counts as body -- it is
 * always present and code-owned, so it says nothing about whether the
 * model has written anything yet.
 */
/** The first `## ` line inside a section's content, or null. A section's
 * content must hold only its body -- see the guard in `update_section`. */
export function contentCarriesHeading(content: string): string | null {
  const line = content.split("\n").find((l) => /^##\s/.test(l.trim()));
  return line ? line.trim() : null;
}

export function introShouldWait(sections: ReadmeSection[], headingKey: string): boolean {
  if (headingKey !== "") return false;
  return !sections.some(
    (s) => s.heading !== "" && s.heading.toLowerCase() !== PROTECTED_HEADING && s.content.trim().length > 0,
  );
}

function createReadmeExecutors(input: {
  projectFolder: VaultFolder;
  log: (line: string) => void;
  initialContent: string;
  initialFileId: string | undefined;
  allNodesById: Map<string, GraphLogNode>;
  validNodeIds: Set<string>;
  today: string;
  /** The skill's section order -- see `resolveSectionOrder`. */
  sectionOrder: readonly string[];
  /** `describe_effort` reports, keyed by lowercased effort name; the
   * caller reads them into the sidecar after the clean finish. */
  descriptions: Map<string, EffortDescription>;
  /** First names of everyone who has written in the graph: the only
   * names a bench heading may carry. See `sectionShapeNotes`. */
  writerFirstNames: readonly string[];
  /** Project names this page may not say: the destination of a move a
   * mark asked for this run. A reader here may not be allowed to know
   * that project exists (Austin, 2026-09-21), and the instruction not to
   * name it is only in the prompt while the mark is unread, so the rule
   * lives in code too. */
  forbiddenNames?: () => readonly string[];
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  summaries: string[];
  /** How many edits were refused so far. A COUNTER, not a flag, because
   * the run is a loop of passes and only the final pass's own refusals
   * decide whether the result is applied -- a refusal in pass 1 that
   * pass 2 got right is history, not a reason to retry the whole stage
   * next run. The loop takes the per-pass delta, same as `summaries`. */
  refusals: () => number;
  /** The reason for each refusal so far, in order -- what a refused final
   * pass names in `incomplete` instead of only saying that something was
   * refused. Which section, and whether it was "would erase real content"
   * or "a cut-off call", are two very different diagnoses that used to
   * exist only in the job log. */
  refusalReasons: () => readonly string[];
  getCurrent: () => { content: string; fileId: string | undefined };
} {
  const { projectFolder, log, allNodesById, validNodeIds, today, sectionOrder, descriptions, writerFirstNames } = input;
  let currentContent = input.initialContent;
  let currentFileId = input.initialFileId;
  let refusals = 0;
  const refusalReasons: string[] = [];
  const refuse = (reason: string) => {
    refusals++;
    refusalReasons.push(reason);
    log(`graph-project-view -- ${reason}.`);
  };
  let introTurnedBack = false;
  // One name turn-back per section per run, same shape as the shape
  // turn-backs below: a rule worth stating once, never a loop that stalls
  // a run on a name that is also an ordinary word.
  const nameTurnedBack = new Set<string>();
  // One shape turn-back per section per run -- see `sectionShapeNotes`.
  const shapeTurnedBack = new Set<string>();
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
      // Both fields are `required` in this tool's schema, so an ABSENT
      // one never means "the model chose to omit it" -- it means the
      // call was cut off mid-JSON and arrived as a plausible-looking
      // object with a hole in it. `String(x ?? "")` would quietly turn
      // that hole into "write an empty section", and the erase guard
      // below cannot catch it on a freshly-reset README where no section
      // has content worth protecting yet. An explicitly empty string is
      // a different thing and still goes through: `heading: ""` is how
      // the intro is addressed, and `content: ""` is a real instruction
      // the erase guard handles on its own terms.
      const named = namesAnotherProject(String(toolInput.content ?? ""), input.forbiddenNames?.() ?? []);
      if (named && !nameTurnedBack.has(String(toolInput.heading ?? ""))) {
        nameTurnedBack.add(String(toolInput.heading ?? ""));
        log(`graph-project-view -- turned back update_section "${String(toolInput.heading ?? "")}" once: it named another project ("${named}").`);
        return `Not written. This page named another project ("${named}"). A reader here may not be able to see that project, so the page never names it: say the material was logged here by mistake and belongs to another project, and send the same section again.`;
      }
      if (typeof toolInput.heading !== "string" || typeof toolInput.content !== "string") {
        refuse("refused a malformed update_section (heading/content missing; likely a cut-off call)");
        return 'Error: update_section needs both "heading" and "content" as strings. Nothing was written.';
      }
      const heading = normalizeIntroHeading(headingText(toolInput.heading));
      const content = toolInput.content;
      const key = heading.toLowerCase();

      // A section holds its BODY, never headings of its own. The README is
      // split into sections on `## ` lines, so a content that carries one
      // becomes two sections on the next read: an empty one under the
      // heading the call named and a second one under the heading the
      // content carried. A real run pasted the skill's whole shape
      // skeleton as the intro and the README came back with every heading
      // twice, most of them empty. Refused with the reason, so the model
      // writes the body and the code keeps the shape (ADR-005's spirit:
      // structure is computed, never authored). `###` is fine; it is how
      // a section subdivides. Turned back like the intro guard, not
      // counted as a refusal: the model gets the reason and writes the
      // body on its next turn, and a corrected slip must not leave the
      // run unapplied.
      const h2 = contentCarriesHeading(content);
      if (h2) {
        log(`graph-project-view -- turned back update_section "${heading || "(intro)"}": its content carries a "## " heading line (${h2.trim()}).`);
        return `Error: refused -- a section's content must not contain "## " heading lines (found: ${h2.trim()}). Each section is written with its own update_section call and holds only its body; "###" subheadings are fine. Send this section's body alone.`;
      }

      if (key === PROTECTED_HEADING) {
        refuse('refused update_section on "Notes on this view" (protected; left unchanged)');
        return 'Error: "Notes on this view" is off-limits to this tool — it is never edited by GraphLog.';
      }

      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      const existing = existingIndex === -1 ? null : sections[existingIndex];

      // THE INTRO IS WRITTEN LAST -- see `introShouldWait`. Turned back
      // ONCE per run, with the reason. Once, not always: a genuinely quiet
      // project may have nothing for any body section, and a guard that
      // never yields would leave it with no intro at all. Not counted as
      // a refusal -- nothing was malformed, the model is simply told what
      // to write first.
      if (introShouldWait(sections, key) && !introTurnedBack) {
        introTurnedBack = true;
        log("graph-project-view -- turned back an intro write before any body section existed (intro is written last).");
        return "Not yet: write the body sections first, then the intro. An intro states where the project stands and what it hinges on, and that reads from the sections it introduces. Call update_section for the intro again after the body sections are written.";
      }

      if (content.trim().length === 0 && existing && existing.content.trim().length > 0) {
        const label = heading || "(intro)";
        refuse(`refused update_section "${label}" (would erase real content with an empty section); left unchanged`);
        return `Error: refused -- section "${label}" currently has real content; sending empty content would erase it. Use remove_section if you genuinely want to delete it.`;
      }

      // The page is read on a phone, and code holds its shape: the
      // section's word budget, quotes per effort, labels once, one fact
      // per bullet, first names on bench headings. A section that is out
      // of shape is turned back ONCE with every count that is off (the
      // list bounce's shape, not a refusal): the resend is accepted as
      // written, because the skill is the judge of what to cut. See
      // `sectionShapeNotes`.
      const shapeNotes = sectionShapeNotes(heading, content, writerFirstNames);
      if (shapeNotes.length > 0 && !shapeTurnedBack.has(key)) {
        shapeTurnedBack.add(key);
        const label = heading || "(intro)";
        log(`graph-project-view -- turned back update_section "${label}" once: ${shapeNotes.join("; ")}.`);
        return `Not written yet. Section "${label}" is out of shape:\n- ${shapeNotes.join("\n- ")}\nCut and call update_section again; the resend is accepted as written.`;
      }

      const updatedSections = existing
        ? sections.map((s, i) => (i === existingIndex ? { heading: existing.heading, content } : s))
        : [...sections, { heading, content }];
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(reorderSections(updatedSections, sectionOrder))));
      if (!ok) return "Error: failed to save section update";
      const label = heading || "(intro)";
      summaries.push(existing ? `updated "${label}"` : `added "${label}"`);
      log(`graph-project-view -- ${existing ? "updated" : "added"} README section "${label}".`);
      return `${existing ? "Updated" : "Added"} section "${label}".`;
    },
    remove_section: async (toolInput) => {
      // Same reasoning as `update_section` above: a missing `heading` is
      // a cut-off call, and defaulting it to "" would aim a DELETE at
      // the intro.
      if (typeof toolInput.heading !== "string") {
        refuse("refused a malformed remove_section (heading missing; likely a cut-off call)");
        return 'Error: remove_section needs "heading" as a string. Nothing was removed.';
      }
      const heading = normalizeIntroHeading(headingText(toolInput.heading));
      const key = heading.toLowerCase();

      if (key === PROTECTED_HEADING) {
        refuse('refused remove_section on "Notes on this view" (protected; left unchanged)');
        return 'Error: "Notes on this view" is off-limits to this tool — it is never edited by GraphLog.';
      }

      const sections = splitReadmeSections(splitFrontmatter(currentContent).body);
      const existingIndex = sections.findIndex((s) => s.heading.toLowerCase() === key);
      if (existingIndex === -1) return `Error: no section named "${heading}" found`;
      const updatedSections = sections.filter((_, i) => i !== existingIndex);
      const ok = await commit(withReadmeBody(currentContent, joinReadmeSections(reorderSections(updatedSections, sectionOrder))));
      if (!ok) return "Error: failed to remove section";
      summaries.push(`removed "${heading}"`);
      log(`graph-project-view -- removed README section "${heading}".`);
      return `Removed section "${heading}".`;
    },
    describe_effort: async (toolInput) => {
      const effort = String(toolInput.effort ?? "").trim();
      if (!effort) return "Error: describe_effort needs the effort's heading text.";
      const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      descriptions.set(effort.toLowerCase(), {
        size: clean(toolInput.size)?.toUpperCase() ?? null,
        posture: clean(toolInput.posture)?.toLowerCase() ?? null,
        direction: clean(toolInput.direction),
      });
      return `Noted for "${effort}" (sidecar only; nothing on the page).`;
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

  return {
    executors,
    summaries,
    refusals: () => refusals,
    refusalReasons: () => refusalReasons,
    getCurrent: () => ({ content: currentContent, fileId: currentFileId }),
  };
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
//
// Per ADR-013 this bounds one PASS, never the README: a pass that fills
// its turns having written sections is a full pass, and the next pass
// picks up from the README as committed. See `classifyViewPassEnding`.
const MAX_TURNS = 20;

/** The runaway guard on the pass loop itself, never the number of threads
 * a README may cite. Three is enough for the shape this loop exists for:
 * a bootstrap writes the sections, a targeted pass places what the first
 * left uncited, and a third catches what the second moved. A run still
 * making progress at the cap says so (a shortfall), is not marked
 * applied, and the next run resumes from the committed README. */
const MAX_PASSES = 3;

/** The uncited threads a targeted pass chases: those carrying a Blocking
 * or a Due. Every other uncited thread is reported ("off the page") and
 * left alone. Before 2026-09-16 every uncited live thread was re-offered
 * with its node text until cited, which is the pressure that turned a
 * 41-thread graph into a 2,500-word page: the Efforts page's shelf rule
 * (past bench work and claimed work only, everything else off the page)
 * cannot hold against a loop that chases everything. */
export function requiredThreads(threads: UncitedThread[]): UncitedThread[] {
  return threads.filter((t) => t.hasBlocking || t.hasDue);
}

async function runReadmeAgentLoop(
  provider: LlmProvider,
  system: string,
  userPrompt: string,
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>,
  perf: GraphLogPerfRecorder,
  projectFolderId: string,
  pass: number,
  callCounter: { count: number },
  tools: ToolDefinition[] = TOOLS,
): Promise<{
  usage: LlmUsage;
  model: string | null;
  truncated: boolean;
  hitMaxTurns: boolean;
  toolCallsMade: ToolCall[];
  /** The section the truncating call was writing, when `truncated` and
   * the partial input still named it -- see `cutOffHeading`. Distinct
   * from `null` on a clean pass only by `truncated` itself. */
  cutOff: string | null;
}> {
  const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];
  const toolCallsMade: ToolCall[] = [];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let truncated = false;
  let hitMaxTurns = false;
  let cutOff: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Stop checkpoint (see `graphLogQueue.server.ts`'s own "Cooperative
    // cancellation" section) — once per turn, so a Stop request never
    // waits longer than the current tool call.
    await throwIfGraphLogCancelled(projectFolderId);

    const turnStart = Date.now();
    // The system prompt carries everything invariant within a run (skill,
    // structure body, pre-fetched node text -- see `buildSystemPrompt`),
    // and every pass is a fresh one-message conversation, so without this
    // flag turn 1 of every pass would re-send all of it uncached
    // (`anthropicProvider.server.ts` only caches on its own from turn 2).
    // Pass 1's first turn writes the cache; every later turn and every
    // later pass reads it. Same reason `graph-structure` drives the flag
    // from its own shared `callCounter`, kept here for the same
    // "one counter per run, shared across passes" shape.
    const response = await provider.complete({ system, messages, tools, cacheSystemPrompt: true });
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
        pass: pass + 1,
        turn: turn + 1,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls.map((c) => c.name),
        text: response.text?.trim() ? response.text.trim().slice(0, 8000) : null,
      },
      durationMs: Date.now() - turnStart,
      outcome: response.stopReason === "max_tokens" ? "error" : "ok",
    });

    if (response.stopReason === "max_tokens") {
      // Still no retry escalation (see this file's own "Deliberately
      // deferred" note): the loop ends here and the rest is picked up by
      // a future run. What changed is that it no longer ends EMPTY-
      // HANDED. This response was cut off, not blank, and every tool
      // call before the last one was fully generated -- see
      // `completedToolCalls`. Discarding those was survivable on a
      // README that already had content and silently fatal on one the
      // reset had just emptied: turn one truncates, nothing commits, and
      // the project's README stays blank while the run reports a stage
      // issue nobody reads as "your README is gone".
      //
      // Each executor persists its own section as it goes, so there is
      // nothing to flush here; the stage's return carries both what was
      // written and the fact that it was cut off, and it deliberately
      // does NOT mark graph-structure applied, so the next run resumes.
      truncated = true;
      // Read off the dropped call BEFORE `completedToolCalls` drops it.
      cutOff = cutOffHeading(response.toolCalls, response.stopReason);
      for (const { call, execute } of planTurnToolCalls(
        completedToolCalls(response.toolCalls, response.stopReason),
        isViewWrite,
      )) {
        if (!execute) continue;
        toolCallsMade.push(call);
        await executors[call.name]?.(call.input);
      }
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

  return { usage, model, truncated, hitMaxTurns, toolCallsMade, cutOff };
}

/** What a pass that ended tells the loop to do next. Pure, so the rules
 * are testable without a model; the shape is `syncGraph.server.ts`'s own
 * `classifyPassEnding`, with one difference that is the whole point of
 * this stage's version.
 *
 * TWO PROGRESS MEASURES, ON PURPOSE. `writes` (sections committed this
 * pass) decides whether a pass that hit a limit was WORKING or STUCK: a
 * pass that rewrote three sections and was cut off on the fourth is
 * working, and stopping the run there is what used to leave every section
 * after the big one unwritten, on every run, forever. `uncitedBefore`/
 * `uncitedAfter` (threads with no citation in the README, computed by
 * `computeCoverageReport` off the committed file) decides whether ANOTHER
 * pass is worth running at all. The two answer different questions and a
 * single number cannot answer both.
 *
 * WHEN A TARGETED PASS RUNS. After the first pass, once, whenever
 * anything is still uncited -- the offer costs one cached read and the
 * first production run left four of ten threads uncited on a CLEAN
 * finish, which is the miss this exists to catch. After a targeted pass,
 * only while the offer is still moving the number: a pass that placed
 * nothing is the model saying the rest do not belong, which
 * `EFFORTS.md` permits ("emptiness is honest signal"), and the loop
 * takes its word rather than asking again. That is a deliberate
 * non-rule: which misses MATTER (rank, Blocking, Due) is recorded on
 * every run now and stays unread by this code until a few real runs show
 * what the model does with the offer.
 *
 * `shortfall === null` is a clean ending. It is the caller's job to
 * combine that with the final pass's own refusals before marking the
 * structure applied. */
export function classifyViewPassEnding(input: {
  writes: number;
  truncated: boolean;
  hitMaxTurns: boolean;
  /** Which section the truncating call was writing, if known. */
  cutOff: string | null;
  uncitedBefore: number;
  uncitedAfter: number;
  /** Whether the pass that just ended was a targeted one (pass 2+). */
  targeted: boolean;
  passesCompleted: number;
  maxPasses: number;
  maxTurns: number;
}): { stop: boolean; shortfall: string | null } {
  const where = input.cutOff === null ? "a section" : `"${input.cutOff || "(intro)"}"`;
  const atCap = input.passesCompleted >= input.maxPasses;

  if (input.truncated || input.hitMaxTurns) {
    const how = input.truncated
      ? `was cut off by the model's own output limit while writing ${where}`
      : `hit its ${input.maxTurns}-turn limit`;
    if (input.writes === 0) {
      // Stuck: a limit with nothing to show for it. Retrying the same
      // pass would hit the same limit the same way.
      return { stop: true, shortfall: `a pass ${how} before writing anything` };
    }
    if (atCap) {
      return { stop: true, shortfall: `a pass ${how} after writing ${input.writes} section(s), with no passes left` };
    }
    // Working: keep what landed, and let the next pass carry on from the
    // committed README, told by name what was cut off.
    return { stop: false, shortfall: null };
  }

  if (input.uncitedAfter === 0) return { stop: true, shortfall: null };
  if (!input.targeted) {
    // The first pass ended clean with threads still uncited: offer them
    // once. Never a shortfall at the cap here -- with MAX_PASSES >= 2 the
    // first pass always has a pass left, and if it didn't, an unoffered
    // thread is a measurement, not a failure.
    return atCap ? { stop: true, shortfall: null } : { stop: false, shortfall: null };
  }
  if (input.uncitedAfter < input.uncitedBefore) {
    if (atCap) {
      return { stop: true, shortfall: `still placing uncited threads after ${input.maxPasses} passes` };
    }
    return { stop: false, shortfall: null };
  }
  // A targeted pass that moved nothing: the model declined the offer.
  return { stop: true, shortfall: null };
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
/**
 * One thread the finished README cites nothing from, WITH what decides
 * whether that matters.
 *
 * A bare list of headings can only ever say "three threads were missed",
 * and no threshold on that number can become a rule: the skill says
 * plainly that "a quiet project has thin or empty sections, and that
 * emptiness is honest signal. Don't manufacture depth to fill a heading."
 * A minor thread going uncited is the model doing its job. Counting it as
 * a miss and acting on the count would be wiring a rule that tells the
 * model to do the thing the skill forbids.
 *
 * What makes it a real miss is WHICH thread. graph-structure.md is
 * already sorted down the importance-and-urgency grid (ADR-008), and this
 * walk already goes top to bottom through it, so `rank` costs nothing but
 * writing down the index instead of discarding it. `hasBlocking`/`hasDue`
 * come from the parse `hasFallenAway` was already doing on the same
 * section.
 *
 * That is the difference between a number nobody can act on and one that
 * names the miss: "thread 14 of 20 uncited" is fine, "the top thread went
 * uncited" and "a thread carrying Blocking went uncited" are not, and the
 * skill is explicit that a hard constraint must never be pushed down the
 * page.
 */
export type UncitedThread = {
  heading: string;
  /** 1-based position among the named threads in graph-structure.md's own
   * ordering. 1 is the most important thing in the project. */
  rank: number;
  /** How many named threads there were, so a rank reads as a fraction
   * rather than an absolute that means different things per project. */
  of: number;
  /** ADR-007: `Blocking` names something this thread is holding up. An
   * uncited thread carrying one is the sharpest miss available. */
  hasBlocking: boolean;
  hasDue: boolean;
};

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
  missingThreads: UncitedThread[];
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
   * (`EFFORTS.md`'s own "A file is never optional *if a node you are
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
      /** True when `skills/EFFORTS.md` is missing or says "skip" —
       * a total no-op, no files examined, no model called. */
      skipped: boolean;
      /** True when the graph has changed since this stage last applied
       * it (`graph-structure.md`'s own `asOfGraphHash` didn't match its
       * `appliedByProjectView`) AND at least one section was edited. */
      changed: boolean;
      /** True when README.md was last written under an older
       * EFFORTS.md than the current one (or before stamping) as this
       * run FOUND it. Reported on every run; acted on only under
       * `rebuildStale`. Absent on the early-return paths. */
      staleSkill?: boolean;
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
  /** Reconcile the README again when it was last written under an older
   * EFFORTS.md (or before stamping), even though the graph has not
   * changed. Off by default: a normal run only reports the drift. Set by
   * the `rerun-outputs` job. See `composeStageSkill`. */
  rebuildStale?: boolean;
}

/** Everything that does not change between passes within one run. It
 * lives in the SYSTEM prompt, not the user message, because the provider
 * caches the system prompt as one block and a run is now several fresh
 * conversations: the structure body and up to 60 nodes of verbatim text
 * are written to the cache once on pass 1 and read back by every later
 * turn and pass. In the user message they were re-sent, uncached, at the
 * start of every pass. Only what changes per pass (the README as it
 * stands, the mandate, unread comments) stays in the user message. */
export type ViewRunContext = {
  today: string;
  writersFact: string;
  graphStructureBody: string;
  nodeTextBlock: string | null;
  /** `buildReadingsBlock` over the whole graph: per-thread dates, speed,
   * writers, alignment, neighbors, the load picture and the open-question
   * stand-in. Every number `EFFORTS.md` mentions, counted by code. */
  readingsBlock?: string | null;
};

export function buildSystemPrompt(skillContent: string, run: ViewRunContext): string {
  return `You are GraphLog's graph-project-view step, keeping a project's README.md an accurate, organized synthesis of the whole graph (given to you as graph-structure.md's own clustered, weighted index, PLUS the actual verbatim text of the nodes behind its top threads). Never invent progress, dates, or facts that aren't grounded in a real node's own words or the README's own existing content -- graph-structure.md's glosses are a table of contents, never something to write prose from directly. Call get_node for any node you need that wasn't already handed to you in full. A node's own text may carry an attached file: a PHOTO or VIDEO (an ordinary markdown image or a link marked ?type=video) belongs in a :::gallery{}...::: block wherever that node's words are featured -- group several photos/videos from the same thread into ONE gallery rather than several. Anything else (a PDF, a doc, ...) is a plain [name](url) link, never put inside a gallery. Either way, that exact image/link line must appear in the same section as the words it came with -- a file is never optional and never gets its own separate section. Only touch sections that actually need to change -- call update_section/remove_section as needed, then stop (no more tool calls) once you're done. Never target "Notes on this view" with either tool -- it's off-limits, handled outside this loop entirely. If nothing needs to change, simply make no tool calls at all.

Make at most ONE update_section or remove_section call per response. Every tool call in one response is generated into that response's single output budget, and a section's whole prose travels in the call, so several writes at once is several sections' worth of text against one limit -- the response gets cut off and the work in it is lost. Write one section, wait for the result, then write the next. Reads (get_node) are free to batch: call as many as you need in one go.

Do not write any planning, reasoning, or summary text outside of a tool call -- go straight to calling update_section/remove_section/get_node with no preamble and no narration in between calls either. Your own output budget per turn is limited, and explanatory text spends it on nothing that ends up in the README.

Write the intro (the section addressed with an empty heading) LAST, after the sections it introduces exist -- it states where the project stands and what it hinges on, and that reads from the body, not the other way around. An intro attempted before any body section is written is turned back.

${skillContent}

---

Today's actual date: ${run.today}

${run.writersFact}

graph-structure.md (the whole graph, organized -- a table of contents; read the nodes below to write from):

${run.graphStructureBody}${run.readingsBlock ? `\n\n---\n\n${run.readingsBlock}` : ""}${run.nodeTextBlock ? `\n\n---\n\n${run.nodeTextBlock}` : ""}`;
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
  /** The sentence that leads the block. The default describes the run's
   * own top-down pre-fetch; a targeted pass walks a different list (the
   * threads still uncited) and says so. */
  lead = "The actual node text behind graph-structure.md's own top threads, in its own order (read these to decide what to WRITE, not just what to write ABOUT -- call get_node for anything else you need):",
): string | null {
  const named = sections.filter((s) => s.heading !== "" && s.heading.toLowerCase() !== "unclustered");
  const blocks: string[] = [];
  let remaining = NODE_PREFETCH_BUDGET;
  for (const section of named) {
    if (remaining <= 0) break;
    // A fallen-away thread is one `EFFORTS.md` tells the model to
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
    // Charged for what was actually handed over. This used to charge
    // `included.length`, so a thread whose ids no longer resolve (a day
    // rewritten after the structure was built) spent budget on nodes the
    // model never saw and starved the healthy threads below it.
    remaining -= nodeTexts.length;
    const truncatedNote = included.length < nodeIds.length
      ? `\n\n(truncated -- ${nodeIds.length - included.length} more node(s) in this thread not shown here; call get_node for any of them by id)`
      : "";
    blocks.push(`## ${section.heading}\n\n${nodeTexts.map((n) => formatNodeVerbatim(n, today)).join("\n\n")}${truncatedNote}`);
  }
  if (blocks.length === 0) return null;
  return `${lead}\n\n${blocks.join("\n\n---\n\n")}`;
}

/** How many DISTINCT people have written anything in this graph, and who.
 *
 * `EFFORTS.md` spends a paragraph telling the model to check the
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

/** What changes per pass: the README as it stands (always read from the
 * executors' own `getCurrent()`, never from the pre-loop content, or a
 * second pass would be shown a README its first pass already rewrote)
 * and the unread reader comments. The graph itself is in the system
 * prompt -- see `ViewRunContext`. */
function readmeAndComments(input: {
  readmeContent: string;
  unstampedComments: string[];
  marks?: readonly PromptMark[];
  namedProject?: string | null;
}): string[] {
  const currentBody = splitFrontmatter(input.readmeContent).body.trim();
  return [
    currentBody
      ? `README.md's CURRENT body (edit this incrementally via update_section/remove_section):\n\n${currentBody}`
      : "README.md is currently empty — this is the first content it will ever have.",
    input.unstampedComments.length > 0
      ? `Unread reader corrections in "Notes on this view" (treat these as ground truth overriding your own reading; you do not need to and should not edit that section yourself):\n${input.unstampedComments.map((c) => `- ${c}`).join("\n")}`
      : "",
    input.marks && input.marks.length > 0 ? buildMarksBlock(input.marks) : "",
    input.namedProject
      ? `This page names another project ("${input.namedProject}"). Some people who read this page cannot see that project, and its existence is not theirs to learn, so this page never names it. Rewrite the section that says it: the material was logged here by mistake and belongs to another project, and that is all the page says about it.`
      : "",
  ].filter(Boolean);
}

/** Pass 1: reconcile the README with the graph. */
export function buildUserPrompt(input: {
  readmeContent: string;
  unstampedComments: string[];
  marks?: readonly PromptMark[];
  namedProject?: string | null;
}): string {
  return readmeAndComments(input).join("\n\n---\n\n");
}

/**
 * Pass 2 and later: a mandate built by code from what the committed
 * README measurably lacks, never from the model's opinion of its own
 * work. Two deterministic inputs, either of which is enough to run it:
 *
 *   - `uncited`: threads with no node cited anywhere in the README, in
 *     graph-structure.md's own order, each with its rank and whether it
 *     carries Blocking/Due (the `computeCoverageReport` shape), plus their
 *     node text so the ceiling reaches what the pre-fetch floor may have
 *     missed (ADR-006, ADR-010). It is an OFFER: the skill's "emptiness is
 *     honest signal" still binds, and the pass may decline it all.
 *   - `cutOff`: the section the previous pass was writing when its
 *     output limit hit. That write was never saved, and a retry with the
 *     same prompt and the same budget cuts off the same way; telling the
 *     model which section and why is the only input that changes the
 *     outcome. `heading: null` means the cut landed before the heading
 *     was readable.
 */
export function buildTargetedUserPrompt(input: {
  readmeContent: string;
  unstampedComments: string[];
  marks?: readonly PromptMark[];
  namedProject?: string | null;
  uncited: UncitedThread[];
  uncitedNodeText: string | null;
  cutOff: { heading: string | null } | null;
}): string {
  const parts: string[] = [
    "This is a follow-up pass over the same graph (given to you above). The README below is as the previous pass left it.",
    ...readmeAndComments(input),
  ];
  if (input.cutOff) {
    const where = input.cutOff.heading === null ? "one section" : `the section "${input.cutOff.heading || "(intro)"}"`;
    parts.push(
      `In the previous pass, your update_section call for ${where} was cut off by your own output limit and was NOT saved. Write that section again, shorter: a few quoted phrases carried by your own prose, every working line still citing its node, and the working-out pointed at rather than reproduced. If it genuinely cannot fit, write the part that carries weight and leave the rest to the graph.`,
    );
  }
  if (input.uncited.length > 0) {
    parts.push(
      [
        `These threads in graph-structure.md have NO node cited anywhere in the README. Rank 1 is the most important thread in the project; a thread carrying Blocking or Due is a hard constraint that must never be pushed off the page:`,
        ...input.uncited.map((t) => `- ${describeUncited(t)}`),
        "",
        "For each one, either place it where its material belongs (in an existing section, citing its nodes exactly as given) or leave it out deliberately. A quiet or minor thread left out is honest signal; a top-ranked thread, or one carrying Blocking or Due, almost never is. Touch only what this changes -- do not rewrite sections that already say what they need to. If nothing should change, make no tool calls.",
      ].join("\n"),
    );
    if (input.uncitedNodeText) parts.push(input.uncitedNodeText);
  }
  return parts.join("\n\n---\n\n");
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
 * `missingFiles` is now conditioned on featuring too. `EFFORTS.md`
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

  const missingThreads: UncitedThread[] = [];
  const fellAway: string[] = [];
  const missingFiles: string[] = [];
  // Ranked, not just listed. `sections` arrives in graph-structure.md's
  // own importance-and-urgency order (ADR-008), so position IS importance
  // and the only work here is not throwing it away.
  const named = sections.filter(
    (sec) => sec.heading !== "" && sec.heading.toLowerCase() !== "unclustered",
  );
  for (const [index, section] of named.entries()) {
    const threadFellAway = hasFallenAway(section);
    if (threadFellAway) fellAway.push(section.heading);

    const nodes = nodeIdsInSection(section)
      .map((id) => allNodesById.get(id))
      .filter((n): n is GraphLogNode => !!n);
    const featured = nodes.filter(isFeatured);

    // A thread counts as represented when at least ONE of its nodes is
    // actually cited. A fallen-away thread is intentionally absent
    // (ADR-009), so its absence is never a miss.
    if (!threadFellAway && featured.length === 0) {
      const fields = parseClusterFields(section);
      missingThreads.push({
        heading: section.heading,
        rank: index + 1,
        of: named.length,
        hasBlocking: fields.hasBlocking,
        hasDue: fields.hasDue,
      });
    }

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
 * ADR-005's own test, run against the README: every citation in output
 * matches one the code generated, character for character. `citations` is
 * every `:ref{...}` in the body, `matched` the ones that are some node's
 * own line (both sides normalized through `stripRefVerbose`, same as the
 * coverage check), `unmatched` the rest, distinct, as written.
 *
 * Found necessary directly: a real pass wrote four sections and the
 * coverage check matched NOTHING in them, then the next pass rewrote them
 * and matched every thread. Coverage could not say which of two very
 * different things had happened -- the model wrote no citations, or it
 * COMPOSED them (a wrong datetime, a reordered attribute) and the exact
 * test correctly refused to count them. The second is the failure ADR-005
 * exists for and it is undetectable by reading. Recorded on every pass's
 * own event so the two are never confused again.
 */
export function countCitations(
  readmeBody: string,
  allNodesById: Map<string, GraphLogNode>,
): { citations: number; matched: number; unmatched: string[] } {
  const known = new Set<string>();
  for (const node of allNodesById.values()) {
    if (node.refLine) known.add(stripRefVerbose(node.refLine).trim());
  }
  const found = stripRefVerbose(readmeBody).match(/:ref\{[^}]*\}/g) ?? [];
  const unmatched = new Set<string>();
  let matched = 0;
  for (const ref of found) {
    if (known.has(ref.trim())) matched++;
    else unmatched.add(ref);
  }
  return { citations: found.length, matched, unmatched: [...unmatched] };
}

/** One uncited thread as a line a person can act on: what it is, where it
 * ranked, and whether it was carrying a hard constraint. Shared by the run
 * log and the run report so both say the same thing. */
export function describeUncited(t: UncitedThread): string {
  const flags = [t.hasBlocking ? "Blocking" : null, t.hasDue ? "Due" : null].filter(Boolean);
  return `${t.heading} (${t.rank}/${t.of}${flags.length ? `, ${flags.join("+")}` : ""})`;
}

/**
 * Every node in every `graph-log-*.md`, plus the accounting graph-structure
 * does on its own read of the graph (ADR-016): a day with no content and a
 * node block with no `:ref` line are both nodes the README can never cite,
 * and both used to vanish here without a line anywhere.
 *
 * Shared by the stage's main path and its up-to-date path, which measures
 * coverage against the README it is leaving alone. One loader so the two
 * can never disagree about which nodes exist.
 */
async function loadGraphNodes(
  files: { _id: string; name: string }[],
): Promise<{ allNodes: GraphLogNode[]; issues: string[] }> {
  const graphLogListings = files
    .map((f) => ({ listing: f, date: GRAPH_LOG_RE.exec(f.name)?.[1] }))
    .filter((x): x is { listing: (typeof files)[number]; date: string } => !!x.date);
  const issues: string[] = [];
  const allNodes: GraphLogNode[] = [];
  const parseDiag = { malformed: 0 };
  for (const { listing, date } of graphLogListings) {
    const file = await getFileRefById(listing._id);
    if (!file?.content) {
      issues.push(`${listing.name} exists but has no content, so its nodes cannot reach the README`);
      continue;
    }
    const before = parseDiag.malformed;
    allNodes.push(...parseGraphLogNodes(date, splitFrontmatter(file.content).body, parseDiag));
    if (parseDiag.malformed > before) {
      issues.push(`${listing.name}: ${parseDiag.malformed - before} node block(s) have no :ref line and cannot be cited`);
    }
  }
  return { allNodes, issues };
}

/**
 * Pulls this stage's coverage check off whatever a GraphLog JOB returned,
 * for both shapes that can carry one: a full `"run"` (coverage sits at the
 * top level beside `incomplete`) and a lone `"graph-project-view"` job
 * (the stage result IS the job result). Pure, so the worker's plumbing is
 * testable without a queue.
 *
 * Deliberately separate from the worker's own `collectRunStats`, whose
 * shape check keys on `nodesWritten`/`daysWritten` -- fields only a
 * `"run"` job produces. Coverage folded in there would be silently
 * dropped for the single-stage job, which is the one somebody runs
 * precisely because they are looking at the README.
 *
 * `null` means NOT MEASURED, never "measured and clean". Coverage is
 * computed only on a clean finish, so every truncated, refused,
 * turn-limited or skipped run has none -- and those are the runs whose
 * coverage you would most want. A caller that reads null as clean reports
 * a passing check that never ran.
 */
export function coverageFromJobResult(result: unknown): {
  uncitedThreads: string[];
  threadsFellAway: string[];
  droppedFiles: string[];
} | null {
  if (!result || typeof result !== "object") return null;
  const coverage = (result as { coverage?: unknown }).coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const c = coverage as Record<string, unknown>;
  // `missingThreads` is this file's own field name; "uncited" is what it
  // measures and what the run row and the run report both call it.
  if (!Array.isArray(c.missingThreads)) return null;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const uncited = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is UncitedThread => !!x && typeof x === "object" && typeof (x as UncitedThread).heading === "string")
          .map(describeUncited)
      : [];
  return {
    uncitedThreads: uncited(c.missingThreads),
    threadsFellAway: strings(c.fellAway),
    droppedFiles: strings(c.missingFiles),
  };
}

/**
 * Whether the job that produced `result` edited README.md, read the way
 * `coverageFromJobResult` reads coverage. Keyed on the job name because
 * the two jobs that touch the README return it under different names (the
 * pipeline lifts it to `readmeChanged`; the lone stage has `changed`), and
 * every other job's `changed`, if it has one, is about a different file.
 * `null` for those: not "unchanged", not known.
 */
export function readmeChangedFromJobResult(jobName: string, result: unknown): boolean | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (jobName === "run" || jobName === "rerun-outputs") return typeof r.readmeChanged === "boolean" ? r.readmeChanged : null;
  if (jobName === "graph-project-view") return typeof r.changed === "boolean" ? r.changed : null;
  return null;
}

/**
 * Raises or clears the README's own "this is incomplete" banner from the
 * outcome of a WHOLE run, and is the only thing that writes it.
 *
 * Called by the pipeline (`graphLogAgent.server.ts`) after it has
 * aggregated every stage, because no single stage knows enough to make
 * this call: a README can be perfectly written by this stage and still be
 * missing half a project because `sync-knowledge` skipped and the photos
 * never became nodes. The stage that writes the README is not the stage
 * that knows whether the README can be trusted.
 *
 * An empty `reasons` clears the banner, so the same call that raises the
 * warning is the one that takes it down and a fixed README cannot keep
 * wearing a stale one.
 *
 * A single-stage job (`nopal graphlog graph-project-view`, or the API
 * route) does not go through the pipeline, so the worker calls this
 * itself from the stage's own reasons after such a job. That used to be
 * described here as "a stale banner is the safe direction", which was
 * backwards: the stage strips the banner BEFORE the model runs, so with
 * nobody restoring it the failure direction was a silently cleared
 * warning, never a stale one.
 */
export async function syncReadmeIncompleteBanner(
  projectFolder: VaultFolder,
  reasons: string[],
): Promise<boolean> {
  const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  if (!readme) return false;
  const current = readme.content ?? "";
  const { body } = splitFrontmatter(current);
  const next = withReadmeBody(current, withIncompleteBanner(body, reasons));
  if (next === current) return false;
  await updateFileRef(readme._id, { content: next });
  return true;
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

  const skill = await getProjectStageSkill(projectFolder, "EFFORTS.md");
  if (isSkipInstruction(skill)) {
    // The quietest way this stage can produce nothing: no log line, no
    // `incomplete` entry, and a run that renders as clean. Fine when a
    // human wrote `skip` and meant it; not fine when the file was never
    // seeded, which is indistinguishable to `isSkipInstruction` and was
    // the whole reason `classifyStageSkill` exists.
    const reason = "skills/EFFORTS.md is missing or empty, so this stage had no instructions and wrote nothing";
    const missing = classifyStageSkill(skill) === "missing";
    if (missing) log(`graph-project-view: ${reason}.`);
    return {
      ok: true,
      skipped: true,
      changed: false,
      summary: [],
      coverage: null,
      incomplete: missing ? [reason] : [],
    };
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
    // Reported, unlike the no-`Graph/`-folder case above: the folder
    // existing means something built it, so the index being absent from
    // it is a missing artifact rather than a project that has never run.
    const reason = "Graph/ exists but holds no graph-structure.md, so there was no index to build a README from";
    log(`graph-project-view: ${reason}.`);
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
  }
  const structureFile = await getFileRefById(structureListing._id);
  if (!structureFile?.content) {
    const reason = "graph-structure.md is empty, so there was no index to build a README from";
    log(`graph-project-view: ${reason}.`);
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
  }

  const meta = parseGraphStructureFrontmatter(structureFile.content);
  if (!meta.asOfGraphHash) {
    const reason =
      "graph-structure.md has no asOfGraphHash, which means graph-structure never reached a clean finish; " +
      "the README is not rebuilt from a half-organized index";
    log(`graph-project-view: ${reason}.`);
    return { ok: true, skipped: false, changed: false, summary: [], coverage: null, incomplete: [reason] };
  }
  // Composed before the up-to-date check, not beside the prompt, because
  // drift is reported here. See `composeStageSkill`.
  const generalSkill = await getProjectStageSkill(projectFolder, "SKILL.md");
  // VOICE.md is this stage's alone: it says how a sentence is written when
  // the software talks to people, which only this stage does. Composed in
  // so the fingerprint covers it (a voice edit is README drift).
  const voiceSkill = await getProjectStageSkill(projectFolder, "VOICE.md");
  const extraSkillFiles = withVoiceFirst(voiceSkill, await listExtraSkillFiles(projectFolder));
  const { content: skillContent, fingerprint: skillFingerprint } = composeStageSkill(skill, generalSkill, extraSkillFiles);
  const applied = meta.appliedByProjectView === meta.asOfGraphHash;
  const staleSkill = applied && meta.appliedSkillFingerprint !== skillFingerprint;
  const rewrite = staleSkill && opts.rebuildStale === true;
  if (staleSkill && !rewrite) {
    log(
      "graph-project-view: README.md was written under an older EFFORTS.md and was left as it is (Rerun GraphLog Outputs rewrites it).",
    );
  }
  if (rewrite) {
    log(
      meta.appliedSkillFingerprint
        ? "graph-project-view: reconciling README.md again under the current EFFORTS.md."
        : "graph-project-view: README.md has no skill stamp; reconciling it under the current EFFORTS.md.",
    );
  }
  // Marks nobody's page run has read yet (see `graphLogMarks.server.ts`).
  // Like an unread note, they are new input even when the graph is not.
  const readerMarks = await listUnreadMarks(projectFolder._id);
  // Projects this page's material has moved to. Their names may never
  // appear on this page: a reader here may not be able to see them, and
  // may not be allowed to learn they exist (Austin, 2026-09-21).
  const moveDestNames = await listDestinationNames(projectFolder._id);
  if (applied && !rewrite) {
    // A reader correction is new input even when the graph is not: a
    // person wrote in "Notes on this view" and the page has not read it.
    // Found 2026-09-17 by the Coronado test (a correction alone never
    // reached the model until the next content change). Unread notes
    // make the run reconcile; otherwise the up-to-date path below.
    const readme = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
    const readmeBody = stripIncompleteBanner(splitFrontmatter(readme?.content ?? "").body);
    const unread = extractReaderComments(splitReadmeSections(readmeBody)).unstamped.length;
    const named = namesAnotherProject(readmeBody, moveDestNames);
    if (named) {
      // Not a report this time: the page can fix itself, and a check that
      // only ever says the same thing every run is a check nobody reads.
      log(`graph-project-view: the graph is unchanged, but the page names another project ("${named}"); reconciling to take the name out.`);
    } else if (unread > 0) {
      log(`graph-project-view: the graph is unchanged, but ${unread} unread reader correction(s) are waiting in "Notes on this view"; reconciling the page against them.`);
    } else if (readerMarks.length > 0) {
      log(`graph-project-view: the graph is unchanged, but ${readerMarks.length} unread mark(s) are waiting; reconciling the page against them.`);
    } else {
      // The README is not rewritten, but it still exists and the graph is
      // still the graph, so coverage is measurable and gets measured. This
      // used to return `coverage: null`, which the run page reads (correctly)
      // as "graph-project-view never reached a clean finish" -- on a run
      // where nothing was wrong. A warning that fires on the normal state
      // is training to ignore the warning; the no-op run on production
      // read that way the first time anyone did one.
      log("graph-project-view: up to date, nothing changed since last run.");
      const { allNodes } = await loadGraphNodes(files);
      const coverage = readme
        ? computeCoverageReport(
            splitFrontmatter(structureFile.content).body,
            readmeBody,
            new Map(allNodes.map((n) => [n.id, n])),
          )
        : null;
      return { ok: true, skipped: false, changed: false,
        staleSkill, summary: [], coverage, incomplete: [] };
    }
  }

  // 1.1's own floor+ceiling (ADR-006): read every graph-log file's real
  // node text, not just graph-structure.md's own glosses, so the model
  // has actual words to write from -- see `buildNodePrefetchBlock`/
  // `get_node`'s own doc for the full reasoning.
  // The README's shape, from this project's own EFFORTS.md -- see
  // `resolveSectionOrder`. A skill whose shape cannot be read falls back
  // to the built-in list and says so on every return below.
  const { order: sectionOrder, reason: shapeReason } = resolveSectionOrder(skill);
  const loadIssues: string[] = [];
  if (shapeReason) {
    loadIssues.push(shapeReason);
    log(`graph-project-view: ${shapeReason}.`);
  }
  const loaded = await loadGraphNodes(files);
  const allNodes = loaded.allNodes;
  loadIssues.push(...loaded.issues);
  for (const issue of loaded.issues) log(`graph-project-view: ${issue}.`);
  const allNodesById = new Map(allNodes.map((n) => [n.id, n]));
  const structureSections = splitReadmeSections(splitFrontmatter(structureFile.content).body);
  const validNodeIds = buildMembershipIndex(structureSections);
  // Declared here rather than beside `buildUserPrompt` below because the
  // pre-fetch and `get_node` both stamp each node's age from it now, and
  // every one of them must agree about what today is within a run.
  const today = new Date().toISOString().slice(0, 10);
  const nodeTextBlock = buildNodePrefetchBlock(structureSections, allNodesById, today);
  const readings = computeEffortReadings(structureSections, allNodes, today);
  // Last run's sidecar, read BEFORE anything is written this run: the
  // change marks compare the new page against its efforts, and the
  // readings block says what arrived since it was written and which
  // threads it left without an effort (loose-end candidates).
  const previousSidecarListing = files.find((f) => f.name === EFFORTS_SIDECAR_FILE_NAME);
  const previousSidecar = previousSidecarListing ? (await getFileRefById(previousSidecarListing._id))?.content : null;
  const previousEfforts = readEffortsSidecar(previousSidecar);
  const previousMeta = readSidecarMeta(previousSidecar);
  // A mark is somebody's words in the graph, but writing in the margin is
  // not working on the project: it must not make a client a writer, and
  // only writers get a bench heading. Nodes that came from a marks file
  // are left out of both. On a project nobody has marked this is every
  // node, as before.
  const markFileIds = await listMarksSourceFileIds(projectFolder);
  const workNodes =
    markFileIds.size > 0 ? allNodes.filter((n) => !markFileIds.has(refLineFileId(n.refLine) ?? "")) : allNodes;
  const workWriters = new Set(workNodes.map((n) => n.authorName).filter((n): n is string => !!n));
  const writerFirstNames = (markFileIds.size > 0 ? readings.load.filter((p) => workWriters.has(p.name)) : readings.load).map(
    (p) => firstName(p.name),
  );
  // The readings name "the only names a bench heading may carry", and the
  // executor refuses anything else, so the block has to be built from the
  // same filtered list or the prompt invites a turn-back it caused.
  const shownReadings =
    markFileIds.size > 0 ? { ...readings, load: readings.load.filter((p) => workWriters.has(p.name)) } : readings;
  const readingsBlock = buildReadingsBlock(shownReadings, {
    sinceDate: previousMeta?.today ?? null,
    arrivedSince: arrivedSince(structureSections, allNodes, previousMeta?.today ?? null),
    fellAway: fallenAwayThreads(structureSections),
    offPage: previousMeta?.threadsWithoutEffort ?? [],
  });
  const descriptions = new Map<string, EffortDescription>();

  const structureBody = splitFrontmatter(structureFile.content).body;
  const system = buildSystemPrompt(skillContent, {
    today,
    writersFact: describeWriters(workNodes),
    graphStructureBody: structureBody.trim(),
    nodeTextBlock,
    readingsBlock,
  });

  const readmeFile = await getReadmeFileForFolder(projectFolder.human_id, projectFolder._id);
  // The incomplete banner comes off BEFORE anything else touches the
  // README, and the pipeline puts it back on afterward from the whole
  // run's outcome (`syncReadmeIncompleteBanner` below). The model must
  // never see it: handed a warning inside a document it has been asked to
  // improve, the helpful thing to do is delete it, and then the one signal
  // that this README is untrustworthy is gone. Same treatment "Notes on
  // this view" gets, and for the same reason -- code owns it end to end.
  const rawReadmeContent = readmeFile?.content ?? "";
  // Change tags come off with the banner, for the same reason: a mark the
  // model can see is a mark it can copy forward, and a copied `{moved}`
  // would say something moved when nothing did.
  const initialContent = withReadmeBody(
    rawReadmeContent,
    stripChangeTags(stripIncompleteBanner(splitFrontmatter(rawReadmeContent).body)),
  );

  // Pull out any unstamped reader comments from a "Notes on this view"
  // section, if the README still has one -- BEFORE the model ever sees
  // the README (see `extractReaderComments`: the section is no longer
  // created, only protected where it exists).
  const initialSections = splitReadmeSections(splitFrontmatter(initialContent).body);
  const { sections: sectionsWithNotes, unstamped, stampAppliedDate } = extractReaderComments(initialSections);
  const contentWithNotes = withReadmeBody(initialContent, joinReadmeSections(reorderSections(sectionsWithNotes, sectionOrder)));

  // If the README didn't already have a real file (or its sections
  // needed re-sorting), persist that shape now, BEFORE
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
  } else if (contentWithNotes !== rawReadmeContent) {
    // Compared against the file AS STORED, not against `initialContent`:
    // stripping the banner and the change tags happens in memory, and a
    // run in which the model writes nothing would otherwise leave last
    // run's `{moved}` tags standing on disk while the in-memory page (and
    // the marks computed from it) said nothing moved. The banner is put
    // back by the pipeline from this run's own outcome.
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
    sectionOrder,
    descriptions,
    writerFirstNames,
    forbiddenNames: () => [...moveDestNames, ...movePlans.map((p) => p.destName)],
  });
  const { executors: viewExecutors, summaries, refusals, refusalReasons, getCurrent } = executors_;

  // The marks this run reads, as the model is shown them, plus the two
  // tools that exist only when there are marks. With none, the prompt,
  // the tools and the executors are exactly what they always were.
  const promptMarks = readerMarks.length > 0 ? await buildPromptMarks(readerMarks, pageHash(rawReadmeContent)) : [];
  const offeredMarks = new Map(readerMarks.map((m) => [m._id, m]));
  const markKinds = new Map<string, MarkKind>();
  const movePlans: MovePlan[] = [];
  const executors =
    readerMarks.length === 0
      ? viewExecutors
      : {
          ...viewExecutors,
          read_mark: async (toolInput: Record<string, unknown>) => {
            const id = String(toolInput.markId ?? "").replace(/^mark:/, "");
            const kind = String(toolInput.kind ?? "") as MarkKind;
            if (!offeredMarks.has(id)) return `Error: no mark ${id} was offered this run.`;
            if (!MARK_KINDS.includes(kind)) return `Error: kind must be one of ${MARK_KINDS.join(", ")}.`;
            markKinds.set(id, kind);
            return "Noted.";
          },
          propose_move: async (toolInput: Record<string, unknown>) => {
            const id = String(toolInput.markId ?? "").replace(/^mark:/, "");
            const mark = offeredMarks.get(id);
            if (!mark) return `Error: no mark ${id} was offered this run.`;
            const section = typeof toolInput.section === "string" ? toolInput.section.replace(/^#+\s*/, "").trim() : null;
            const check = await checkMoveProposal({
              proposal: {
                markId: id,
                entryFileId: String(toolInput.entryFileId ?? ""),
                section,
                destination: String(toolInput.destination ?? ""),
              },
              mark,
              sourceProject: projectFolder,
              parseSyncedName: parseSyncedCardFileName,
            });
            if (!check.ok) {
              log(`graph-project-view: mark ${id} asked for a move that was not made: ${check.reason}.`);
              return `Not moved: ${check.reason}. Leave the material on the page, and do not name another project.`;
            }
            movePlans.push(check.plan);
            return check.plan.status === "applied"
              ? "It moves: the entry's author made the mark, so this material is refiled under the project it belongs to and leaves this one. Write this page without it, and never name where it went."
              : "Recorded as a request for the entry's author to confirm. Until they do it stays here, so leave it on the page.";
          },
        };
  const tools = viewTools(readerMarks.length > 0);

  // Coverage off the COMMITTED README, computed by code between passes and
  // again at the end. Both the loop's own progress measure and the
  // stage's report read from this one function, so what drives another
  // pass and what the run row records are the same number.
  const measure = (): CoverageReport =>
    computeCoverageReport(structureBody, splitFrontmatter(getCurrent().content).body, allNodesById);
  // Non-null from here on: a README exists, so coverage is measurable on
  // every path below, clean or not. `null` stays reserved for the early
  // returns above, which never had a README to measure. Every partial
  // return used to hand back null, which made the runs whose coverage you
  // would most want the only ones without it.
  let lastCoverage: CoverageReport = measure();

  // Every way this stage can stop short of a clean finish, reported the
  // same way. These used to hardcode `changed: false, summary: []`, which
  // was wrong in the direction that matters least noisily: a run that
  // committed four sections and then hit a limit reported that it had
  // changed nothing, so the one signal saying "go look at this README"
  // was an empty diff. `incomplete` is what marks the run unfinished; the
  // summary is what it actually did. Both are true at once and both get
  // reported -- an unfinished run is never allowed to read as a clean
  // one, and a partial one is never allowed to read as a no-op.
  //
  // Declared out here, not inside the `try`, so the catch below reports
  // identically. That path is NOT only for bugs: `throwIfGraphLogCancelled`
  // throws on the Stop button, an ordinary thing for a person to press,
  // and it used to report "changed nothing" about a README this run had
  // already rewritten.
  const partial = (reason: string): GraphProjectViewResult => {
    log(`graph-project-view: ${reason} — will retry next run.`);
    if (summaries.length > 0) log(`graph-project-view: kept this run's committed work — ${summaries.join(", ")}.`);
    return {
      ok: true,
      skipped: false,
      changed: summaries.length > 0,
      staleSkill,
      summary: summaries,
      coverage: lastCoverage,
      incomplete: [...loadIssues, reason],
    };
  };

  const callStart = Date.now();
  try {
    const llm = opts.provider ?? AnthropicProvider.forStage("graph-project-view");

    // A RUN IS A LOOP OF PASSES, NOT ONE CONVERSATION.
    //
    // Same shape as `sync-graph`'s day loop and `graph-structure`'s
    // batches, and for the same ADR-013 reason: a turn limit and an
    // output limit each bound one bounded unit of work, never how much a
    // README may hold. Each pass is a fresh conversation bounded by
    // `MAX_TURNS`, over the SAME whole graph (in the cached system
    // prompt), sharing one set of executors so every section committed
    // by an earlier pass is in the README the next pass is shown.
    //
    // What makes the loop resumable without storing anything: the
    // remaining work is DERIVED from the committed README by
    // `computeCoverageReport` (threads with no citation), the way
    // `graph-structure` derives its unplaced nodes from its own file.
    // A stored "sections done" marker would survive `resetProjectView`,
    // which clears the README body and exactly one front-matter key, and
    // would then point at an empty README -- the live failure
    // `clearGraphStructureAppliedMarker` was written for. Nothing here
    // can go stale that way, because nothing here is stored.
    //
    // Pass 1 reconciles. Every later pass is TARGETED: told by code which
    // threads are still uncited, with their node text, and which section
    // (if any) the previous pass was cut off writing. The rules for
    // stopping are in `classifyViewPassEnding`.
    const callCounter = { count: 0 };
    const runUsage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    let runModel: string | null = null;
    let passes = 0;
    let shortfall: string | null = null;
    let refusedInFinalPass = 0;
    let cutOff: { heading: string | null } | null = null;
    let uncited: UncitedThread[] = requiredThreads(lastCoverage.missingThreads);

    while (passes < MAX_PASSES) {
      const targeted = passes > 0;
      const before = { writes: summaries.length, refusals: refusals(), uncited: uncited.length };
      const current = getCurrent().content;
      const namedProject = namesAnotherProject(splitFrontmatter(current).body, [
        ...moveDestNames,
        ...movePlans.map((p) => p.destName),
      ]);
      const userPrompt = targeted
        ? buildTargetedUserPrompt({
            readmeContent: current,
            unstampedComments: unstamped,
            uncited,
            uncitedNodeText: buildNodePrefetchBlock(
              structureSections.filter((sec) => uncited.some((t) => t.heading === sec.heading)),
              allNodesById,
              today,
              "The actual node text behind the uncited threads above, in graph-structure.md's own order (call get_node for any node not shown):",
            ),
            cutOff,
            ...(promptMarks.length > 0 ? { marks: promptMarks } : {}),
            ...(namedProject ? { namedProject } : {}),
          })
        : buildUserPrompt({
            readmeContent: current,
            unstampedComments: unstamped,
            ...(promptMarks.length > 0 ? { marks: promptMarks } : {}),
            ...(namedProject ? { namedProject } : {}),
          });

      const passStart = Date.now();
      const result = await runReadmeAgentLoop(llm, system, userPrompt, executors, perf, projectFolder._id, passes, callCounter, tools);
      passes++;
      runUsage.inputTokens += result.usage.inputTokens;
      runUsage.outputTokens += result.usage.outputTokens;
      runUsage.cacheReadTokens = (runUsage.cacheReadTokens ?? 0) + (result.usage.cacheReadTokens ?? 0);
      runUsage.cacheWriteTokens = (runUsage.cacheWriteTokens ?? 0) + (result.usage.cacheWriteTokens ?? 0);
      runModel = result.model ?? runModel;

      lastCoverage = measure();
      const cites = countCitations(splitFrontmatter(getCurrent().content).body, allNodesById);
      const invented = unknownHeadings(splitReadmeSections(splitFrontmatter(getCurrent().content).body), sectionOrder);
      const writes = summaries.length - before.writes;
      refusedInFinalPass = refusals() - before.refusals;
      const ending = classifyViewPassEnding({
        writes,
        truncated: result.truncated,
        hitMaxTurns: result.hitMaxTurns,
        cutOff: result.cutOff,
        uncitedBefore: before.uncited,
        uncitedAfter: requiredThreads(lastCoverage.missingThreads).length,
        targeted,
        passesCompleted: passes,
        maxPasses: MAX_PASSES,
        maxTurns: MAX_TURNS,
      });
      // One event per pass, carrying what the offer was and what it did
      // with it -- the data the not-yet-written "which misses matter"
      // filter will be tuned on. `offered`/`cited` are the pass's own
      // uncited count before and how many of those it placed.
      await perf.event({
        process: "graph-project-view",
        type: "llm",
        name: "pass",
        params: {
          pass: passes,
          targeted,
          writes,
          refused: refusedInFinalPass,
          offered: targeted ? before.uncited : null,
          cited: targeted ? before.uncited - requiredThreads(lastCoverage.missingThreads).length : null,
          offPage: lastCoverage.missingThreads.length - requiredThreads(lastCoverage.missingThreads).length,
          citations: cites.citations,
          matched: cites.matched,
          unmatched: cites.unmatched.length,
          unknownHeadings: invented,
          cutOff: result.truncated ? (result.cutOff ?? "(unknown)") : null,
          shortfall: ending.shortfall,
        },
        durationMs: Date.now() - passStart,
        outcome: result.truncated || result.hitMaxTurns ? "error" : "ok",
      });
      log(
        `graph-project-view: pass ${passes}${targeted ? ` (targeted, ${before.uncited} uncited thread(s) offered)` : ""}: ` +
          `${writes} section write(s), ${cites.citations} citation(s) of which ${cites.matched} match a node, ` +
          `${requiredThreads(lastCoverage.missingThreads).length} Blocking/Due thread(s) still uncited, ` +
          `${lastCoverage.missingThreads.length - requiredThreads(lastCoverage.missingThreads).length} left off the page (no Blocking, no Due)` +
          `${result.truncated ? `; cut off writing ${result.cutOff === null ? "a section" : `"${result.cutOff || "(intro)"}"`}` : ""}` +
          `${result.hitMaxTurns ? "; hit its turn limit" : ""}.`,
      );
      if (invented.length > 0) {
        log(`graph-project-view: pass ${passes} left ${invented.length} heading(s) outside the skill's shape, kept before "Notes on this view": ${invented.map((h) => `"${h}"`).join(", ")}.`);
      }
      if (cites.unmatched.length > 0) {
        // ADR-005: a citation the model built rather than copied. Named
        // here because it reads as verified for as long as it survives.
        const shown = cites.unmatched.slice(0, 3);
        log(
          `graph-project-view: pass ${passes} left ${cites.unmatched.length} citation(s) matching no node in the graph (ADR-005: composed, not copied)` +
            `${shown.length ? `, e.g. ${shown.join(" | ")}` : ""}${cites.unmatched.length > shown.length ? ` and ${cites.unmatched.length - shown.length} more` : ""}.`,
        );
      }

      shortfall = ending.shortfall;
      cutOff = result.truncated ? { heading: result.cutOff } : null;
      uncited = requiredThreads(lastCoverage.missingThreads);
      if (ending.stop) break;
    }

    const durationMs = Date.now() - callStart;
    const failed = shortfall !== null || refusedInFinalPass > 0;
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-project-view",
      kind: "project-view",
      model: runModel ?? undefined,
      usage: runUsage,
      durationMs,
      outcome: failed ? "error" : "success",
      errorKind: failed ? "incomplete" : undefined,
    });
    await perf.event({
      process: "graph-project-view",
      type: "llm",
      name: "readme",
      params: { passes },
      durationMs,
      outcome: failed ? "error" : "ok",
    });

    // Applied iff the FINAL pass ended clean. An earlier pass's trouble
    // that a later pass repaired is in the log and the perf timeline, not
    // in `incomplete`, because the stage did finish its job. A final pass
    // with a shortfall or a refusal leaves the structure unapplied so the
    // next run resumes from the committed README, same convention as
    // sync-graph's `hash: null` and graph-structure's completeness gate.
    if (shortfall !== null) return partial(shortfall);
    if (refusedInFinalPass > 0) {
      const reasons = refusalReasons().slice(-refusedInFinalPass);
      return partial(`${refusedInFinalPass} refused edit(s) in its final pass: ${reasons.join("; ")}`);
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
      sectionOrder,
    );
    // Change marks: what moved against last run's sidecar, tagged onto the
    // effort headings (stripped again before the model sees the page
    // next run) and recorded in the sidecar as data. See `markChanges`.
    const reconciledBody = joinReadmeSections(reconciledSections);
    const currentEfforts = parseEffortBlocks(reconciledBody);
    // An effort is what its citations say it is (round 4: nothing on the
    // page declares threads); size, posture and direction come from
    // `describe_effort`. Both go to the sidecar; the page keeps no marks.
    assignEffortThreads(currentEfforts, allNodes, structureSections);
    applyEffortDescriptions(currentEfforts, descriptions, previousEfforts);
    const marks = markChanges(previousEfforts, currentEfforts);
    const reconciledContent = withReadmeBody(latestContent, reconciledBody);
    if (reconciledContent !== latestContent && fileId) {
      await updateFileRef(fileId, { content: reconciledContent });
    }
    const pageWords = countPageWords(reconciledBody);
    const marked = [...marks.values()].filter((m) => m.change !== "unchanged");
    const removed = removedEfforts(previousEfforts, currentEfforts);
    const pageRead = parseRead(reconciledBody);
    log(
      `graph-project-view: page is ${pageWords} words against a ceiling of ${PAGE_WORD_CEILING}; ${currentEfforts.length} effort(s)` +
        `${previousEfforts ? `, ${marked.filter((m) => m.change === "new").length} new, ${marked.filter((m) => m.change === "moved").length} moved, ${removed.length} left the page${removed.length ? ` (${removed.join(", ")})` : ""}` : ", no previous page to compare"}` +
        `${pageRead.ask ? `; the one ask: ${pageRead.ask}` : "; no one-ask line"}.`,
    );

    await markGraphStructureApplied(structureListing._id, structureFile.content, meta.asOfGraphHash, skillFingerprint);

    // Marks this run was offered are read now, and any move one of them
    // asked for is saved. Only here, on a clean finish: a run that stops
    // short leaves its marks unread for the next one, same as the notes.
    if (readerMarks.length > 0) {
      // One move per chunk, however many times the model proposed it: the
      // clash check in `checkMove` reads the table, and nothing is in the
      // table until this loop runs.
      const movedChunks = new Set<string>();
      for (const plan of movePlans) {
        const chunkKey = `${plan.authorHumanId}|${plan.date}|${plan.chunk.kind}|${plan.chunk.heading.toLowerCase()}`;
        if (movedChunks.has(chunkKey)) continue;
        movedChunks.add(chunkKey);
        // The Cards are corrected here, on a clean finish and nowhere
        // else: a run that stopped short leaves the mark unread and the
        // daily log untouched. See `graphLogMoves.server.ts`.
        const what = plan.chunk.kind === "whole" ? "entry" : `section "${plan.chunk.heading}"`;
        const done = await recordMove(plan);
        log(
          `graph-project-view: mark ${plan.markId} ${done.status === "applied" ? "refiled" : "asked to refile"} ` +
            `${plan.authorHumanId}'s ${plan.date} ${what} under another project (${done.id})` +
            `${done.reason ? `; it did not move: ${done.reason}` : ""}.`,
        );
      }
      const unclassified = readerMarks.filter((m) => !markKinds.has(m._id)).length;
      await stampMarksRead(readerMarks.map((m) => m._id), markKinds, today);
      log(
        `graph-project-view: read ${readerMarks.length} mark(s)` +
          `${[...MARK_KINDS].map((k) => ({ k, n: [...markKinds.values()].filter((v) => v === k).length })).filter(({ n }) => n > 0).map(({ k, n }) => `, ${n} ${k}`).join("")}` +
          `${unclassified > 0 ? `, ${unclassified} the run never classified` : ""}.`,
      );
    }

    // The page as data, beside it in Graph/ (system-written like the
    // structure file). Written on every clean finish, rewrite or not,
    // because the readings move with today's date even when the words
    // did not. See `buildEffortsSidecar`.
    const sidecarContent = buildEffortsSidecar(
      { asOfGraphHash: meta.asOfGraphHash, generatedAt: new Date().toISOString(), skillFingerprint },
      currentEfforts,
      readings,
      marks,
      { read: pageRead.read, ask: pageRead.ask, removed },
    );
    const sidecarListing = files.find((f) => f.name === EFFORTS_SIDECAR_FILE_NAME);
    if (sidecarListing) {
      await updateFileRef(sidecarListing._id, { content: sidecarContent });
    } else {
      await createFileRef({
        human_id: projectFolder.human_id,
        name: EFFORTS_SIDECAR_FILE_NAME,
        content: sidecarContent,
        content_type: "text/markdown",
        folder_id: graphFolder._id,
      });
    }
    // Last line of defence on the rule a page can never break: if the
    // words still name another project, the run says so rather than
    // leaving a quiet leak (the turn-back above only sees writes this run
    // made, and a name written by an earlier run outlives the mark that
    // put it there).
    const leaked = namesAnotherProject(reconciledBody, [...moveDestNames, ...movePlans.map((p) => p.destName)]);
    if (leaked) {
      const reason = `the page names another project ("${leaked}"), which a reader here may not be able to see; it needs an edit that takes the name out`;
      loadIssues.push(reason);
      log(`graph-project-view: ${reason}.`);
    }
    const changed = summaries.length > 0;
    log(
      changed
        ? `graph-project-view: ${summaries.join(", ")} (${passes} pass${passes === 1 ? "" : "es"}).`
        : "graph-project-view: nothing to change.",
    );

    // The reconcile above only re-sorts and stamps; it cites nothing new.
    // Measured once more anyway so the report reads the file as written.
    const coverage = computeCoverageReport(structureBody, splitFrontmatter(reconciledContent).body, allNodesById);
    if (coverage.missingThreads.length > 0) {
      log(
        `graph-project-view: ${coverage.missingThreads.length} thread(s) have no representation in the README this run: ` +
          `${coverage.missingThreads.map(describeUncited).join(", ")}.`,
      );
    }
    if (coverage.fellAway.length > 0) {
      log(`graph-project-view: ${coverage.fellAway.length} thread(s) fell away this run (dormant, no Due, no Blocking): ${coverage.fellAway.join(", ")}.`);
    }
    if (coverage.missingFiles.length > 0) {
      log(`graph-project-view: ${coverage.missingFiles.length} attached file(s) were dropped this run (EFFORTS.md says never): ${coverage.missingFiles.join(", ")}.`);
    }

    return { ok: true, skipped: false, changed, summary: summaries, coverage, incomplete: loadIssues, staleSkill };
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
    return partial(`stopped on an error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
