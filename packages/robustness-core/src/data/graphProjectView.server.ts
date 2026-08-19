/**
 * GraphLog's `graph-project-view` stage — the final, AGENTIC stage (see
 * the `graphlog` skill):
 *
 *   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
 *     -> graph-project-view (this file)
 *
 * Entirely skill-driven, same "skip means total no-op" convention as
 * every other GraphLog/PhyLog stage: a project's `skills/PROJECT_VIEW.md`
 * (seeded with real starter instructions, NOT "skip" — see
 * `graphLogDefaults.server.ts`) decides whether/how this runs at all.
 *
 * Reads `Graph/graph-structure.md` (`graph-structure`'s own output — the
 * WHOLE graph, already clustered/weighted/status-annotated) and uses it
 * to keep `README.md` an accurate, organized synthesis — never inventing
 * progress, dates, or facts that aren't grounded in a thread
 * `graph-structure.md` actually gives it. A bounded tool-calling loop
 * (`update_section`/`remove_section`, mirroring PhyLog's own
 * `capture.server.ts` shape closely but simplified — see this file's own
 * "Deliberately deferred" note) lets the model touch only the sections
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
import { parseGraphStructureFrontmatter, markGraphStructureApplied } from "./graphStructure.server";
import { AnthropicProvider, isPhylogAgentConfigured } from "./anthropicProvider.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import type { LlmMessage, LlmProvider, LlmUsage, ToolCall, ToolDefinition } from "./llmProvider";

const GRAPH_STRUCTURE_FILE_NAME = "graph-structure.md";

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
}): {
  executors: Record<string, (toolInput: Record<string, unknown>) => Promise<string>>;
  summaries: string[];
  hadRefusal: () => boolean;
  getCurrent: () => { content: string; fileId: string | undefined };
} {
  const { projectFolder, log } = input;
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
    const response = await provider.complete({ system, messages, tools: TOOLS });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    if (response.stopReason === "max_tokens") {
      // See this file's own "Deliberately deferred" note — no retry
      // escalation yet, just stop; whatever earlier turns already
      // committed stands, and this is retried on a future run.
      truncated = true;
      break;
    }

    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;
    for (const call of response.toolCalls) {
      toolCallsMade.push(call);
      const executor = executors[call.name];
      const resultText = executor ? await executor(call.input) : `Unknown tool: ${call.name}`;
      messages.push({ role: "tool_result", toolCallId: call.id, content: resultText });
    }
    if (response.stopReason !== "tool_use") break;
    if (turn === MAX_TURNS - 1) hitMaxTurns = true;
  }

  return { usage, model, truncated, hitMaxTurns, toolCallsMade };
}

// ─── Main entry point ───────────────────────────────────────────────────

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
    }
  | { ok: false; error: string };

export interface RunGraphProjectViewOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
}

function buildSystemPrompt(skillContent: string): string {
  return `You are GraphLog's graph-project-view step, keeping a project's README.md an accurate, organized synthesis of the whole graph (given to you as graph-structure.md's own clustered, weighted index). Never invent progress, dates, or facts that aren't grounded in a thread graph-structure.md actually gives you or the README's own existing content. Only touch sections that actually need to change -- call update_section/remove_section as needed, then stop (no more tool calls) once you're done. Never target "Notes on this view" with either tool -- it's off-limits, handled outside this loop entirely. If nothing needs to change, simply make no tool calls at all.

Do not write any planning, reasoning, or summary text outside of a tool call -- go straight to calling update_section/remove_section with no preamble and no narration in between calls either. Your own output budget per turn is limited, and explanatory text spends it on nothing that ends up in the README.

${skillContent}`;
}

function buildUserPrompt(input: {
  today: string;
  graphStructureBody: string;
  readmeContent: string;
  unstampedComments: string[];
}): string {
  const currentBody = splitFrontmatter(input.readmeContent).body.trim();
  return [
    `Today's actual date: ${input.today}`,
    `graph-structure.md (the whole graph, organized):\n\n${input.graphStructureBody}`,
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

  const skill = await getProjectStageSkill(projectFolder, "PROJECT_VIEW.md");
  if (isSkipInstruction(skill)) {
    return { ok: true, skipped: true, changed: false, summary: [] };
  }
  if (!isPhylogAgentConfigured()) {
    return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };
  }

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) {
    log("graph-project-view: no Graph/ folder yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [] };
  }

  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const structureListing = files.find((f) => f.name === GRAPH_STRUCTURE_FILE_NAME);
  if (!structureListing) {
    log("graph-project-view: no graph-structure.md yet — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [] };
  }
  const structureFile = await getFileRefById(structureListing._id);
  if (!structureFile?.content) {
    log("graph-project-view: graph-structure.md is empty — nothing to do.");
    return { ok: true, skipped: false, changed: false, summary: [] };
  }

  const meta = parseGraphStructureFrontmatter(structureFile.content);
  if (!meta.asOfGraphHash) {
    log("graph-project-view: graph-structure.md is malformed (no asOfGraphHash) — skipping.");
    return { ok: true, skipped: false, changed: false, summary: [] };
  }
  if (meta.appliedByProjectView === meta.asOfGraphHash) {
    log("graph-project-view: up to date, nothing changed since last run.");
    return { ok: true, skipped: false, changed: false, summary: [] };
  }

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
  });
  const { executors, summaries, hadRefusal, getCurrent } = executors_;

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = buildUserPrompt({
    today,
    graphStructureBody: splitFrontmatter(structureFile.content).body.trim(),
    readmeContent: contentWithNotes,
    unstampedComments: unstamped,
  });

  const callStart = Date.now();
  try {
    const llm = opts.provider ?? new AnthropicProvider();
    const { usage, model, truncated, hitMaxTurns } = await runReadmeAgentLoop(llm, system, userPrompt, executors);

    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-project-view",
      kind: "project-view",
      model: model ?? undefined,
      usage,
      durationMs: Date.now() - callStart,
      outcome: truncated ? "error" : "success",
      errorKind: truncated ? "incomplete" : undefined,
    });

    if (truncated) {
      log("graph-project-view: update was cut off by the model's own output limit — will retry next run.");
      return { ok: true, skipped: false, changed: false, summary: [] };
    }
    if (hitMaxTurns) {
      log("graph-project-view: hit its turn limit before finishing — will retry next run.");
      return { ok: true, skipped: false, changed: false, summary: [] };
    }
    if (hadRefusal()) {
      log("graph-project-view: had at least one refused edit — will retry next run.");
      return { ok: true, skipped: false, changed: false, summary: [] };
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
    return { ok: true, skipped: false, changed, summary: summaries };
  } catch (err) {
    log(`graph-project-view: couldn't be processed (${err instanceof Error ? err.message : "unknown error"}).`);
    await recordGraphLogUsage({
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "graph-project-view",
      kind: "project-view",
      durationMs: Date.now() - callStart,
      outcome: "error",
      errorKind: classifyGraphLogError(err),
    });
    return { ok: true, skipped: false, changed: false, summary: [] };
  }
}
