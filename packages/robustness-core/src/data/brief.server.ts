/**
 * The brief (Austin, 2026-10-22 to 28): what the project already knows
 * that one letter will need, written by a model from the whole graph in
 * one pass, read once by a guide before they talk it through and write.
 * `BRIEF.md` is its skill, tuned over four rounds on the Madison attic
 * (`Efforts/On/Madison Attic/` in the vault) and rewritten here with the
 * code in view.
 *
 * Who decides what. The model: the brief's words, what each section
 * holds, which photos belong. Code: the trigger (a guide starting a
 * letter, or asking again; never a graph change), the headings, the
 * word count per section sent back ONCE with the resend kept whatever
 * its length (the test's finding: three rounds of wording the length into
 * the skill did nothing, the count halved it in one), that every citation
 * is a node's own, the order the sections are assembled in, where the
 * brief is kept and who reads it. A person: the purpose line, the click,
 * and judging every brief.
 *
 * `briefText` is the model's half and touches no database: the letter,
 * the nodes and the people in, a brief out. The sections arrive one tool
 * call each (the Efforts page's shape): a cut-off turn loses one section,
 * never the brief, and each count has its natural unit.
 *
 * Where it lives. Not on the letter's record (the Vault hands the whole
 * record to every reader in the sharing cache, and a write there remounts
 * the editor) and not as a file in the Letters folder (the cache reads
 * the folder): its own row in `letter_briefs`, one per letter, replaced
 * on each run, read by one route that asks `canManageLetters` first. A
 * client, a Crafter or an Observer never reaches it.
 */

import { RecordId } from "surrealdb";
import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import { countPageWords } from "./effortReadings.server";
import { defineTable, formatRecord, merge, select, upsert, type Data } from "./generic.server";
import { getEffectiveGraphLogDefaultSkill } from "./graphLogDefaults.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { getGraphLogRunStartedAt } from "./graphLogPerf.server";
import { enqueueGraphLogJob, getGraphLogJobStatus, GraphLogCancelledError, throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { countCitations, loadGraphNodes } from "./graphProjectView.server";
import { formatNodeVerbatim, type GraphLogNode } from "./graphNodeIndex.server";
import { firstName } from "./humanNames";
import { getHumansById } from "./humans.server";
import { letterHome, letterTitle } from "./letters.server";
import { completedToolCalls } from "./llmProvider";
import type { LlmMessage, LlmProvider, LlmUsage, ToolDefinition } from "./llmProvider";
import { splitFrontmatter } from "./project.types";
import { composeStageSkill, findProjectGraphFolder, getProjectStageSkill, isSkipInstruction, listExtraSkillFiles } from "./projectN02.server";
import { getProjectSharing } from "./projectSharing.server";
import { groupOf } from "./features";
import { findSeedSyncFolder, parseSeedPeople, SEED_PEOPLE_FILE_NAME } from "./seed.server";
import { getFileRefById, listFolderChildren } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";

// ─── The shape, held by code ────────────────────────────────────────────

/** The one heading the model names itself: what the letter is about. */
export const BRIEF_ABOUT_KEY = "<about>";

/** The first half's sections in the order the brief is assembled, keyed
 * by their lowercased heading, with the budget code sends back once. The
 * numbers are the test's (round 4, 2026-10-23); Austin re-reads them
 * when a brief feels long or thin. Reference is not counted. */
export const BRIEF_SECTION_BUDGETS: readonly { key: string; heading: string; budget: number; required: boolean }[] = [
  { key: "the ask", heading: "The ask", budget: 90, required: true },
  { key: "the bigger picture", heading: "The bigger picture", budget: 100, required: false },
  { key: BRIEF_ABOUT_KEY, heading: "<what the letter is about>", budget: 450, required: false },
  { key: "where it doesn't fit", heading: "Where it doesn't fit", budget: 80, required: false },
  { key: "people, timing and money", heading: "People, timing and money", budget: 100, required: false },
  { key: "what's been explored, and where we lean", heading: "What's been explored, and where we lean", budget: 150, required: false },
  { key: "not logged", heading: "Not logged", budget: 100, required: false },
];

const FIXED_KEYS = new Set(BRIEF_SECTION_BUDGETS.filter((s) => s.key !== BRIEF_ABOUT_KEY).map((s) => s.key));

/** A heading as the shape names it: no `## `, straight quotes, one space,
 * lowercase. */
export function briefHeadingKey(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type BriefSection = { heading: string; markdown: string };

/** What the model has written so far, keyed as the shape is. */
export type BriefDraft = {
  sections: Map<string, BriefSection>;
  reference: string | null;
};

export function emptyBriefDraft(): BriefDraft {
  return { sections: new Map(), reference: null };
}

/** The brief as a person reads it: the first half in the shape's order,
 * then Reference. Whatever order the calls arrived in. */
export function assembleBrief(draft: BriefDraft): string {
  const parts: string[] = [];
  for (const s of BRIEF_SECTION_BUDGETS) {
    const section = draft.sections.get(s.key);
    if (!section) continue;
    parts.push(`## ${section.heading.replace(/^#+\s*/, "").trim()}\n\n${section.markdown.trim()}`);
  }
  if (draft.reference?.trim()) parts.push(`---\n\n# Reference\n\n${draft.reference.trim()}`);
  return parts.join("\n\n") + "\n";
}

/** The count a section comes back with, or null inside its budget.
 * Citations and photos are not counted (`countPageWords`). */
export function briefSectionNote(key: string, markdown: string): string | null {
  const shape = BRIEF_SECTION_BUDGETS.find((s) => s.key === key);
  if (!shape) return null;
  const words = countPageWords(markdown);
  if (words <= shape.budget) return null;
  return `${words} words against a budget of ${shape.budget} (citations and photos not counted)`;
}

/** What `finish_brief` says once: the required section missing, optional
 * ones left out (a note, never a refusal: the skill lets them go when
 * nothing is true), and citations that match no node. */
export function briefFinishNotes(draft: BriefDraft, allNodesById: Map<string, GraphLogNode>): { refusals: string[]; notes: string[]; unmatched: string[] } {
  const refusals: string[] = [];
  const notes: string[] = [];
  for (const s of BRIEF_SECTION_BUDGETS) {
    if (draft.sections.has(s.key)) continue;
    if (s.required) refusals.push(`"${s.heading}" is not written, and the brief opens with it`);
    else if (s.key === BRIEF_ABOUT_KEY) notes.push("no section names what the letter is about (the shape's one free heading)");
    else notes.push(`"${s.heading}" is not written; leave it out only if nothing true belongs there`);
  }
  if (!draft.reference?.trim()) notes.push("Reference is not written (the client's questions, and More on sections)");
  const { unmatched } = countCitations(assembleBrief(draft), allNodesById);
  return { refusals, notes, unmatched };
}

// ─── The model's half ───────────────────────────────────────────────────

export const BRIEF_TOOLS: ToolDefinition[] = [
  {
    name: "write_section",
    description:
      "One first-half section of the brief, whole: its heading exactly as the shape names it (or the one free heading, named plainly), and its markdown with any ### pieces inside. Code counts it and may send it back once with its count; calling again for the same heading replaces it, and the resend is accepted as written.",
    inputSchema: {
      type: "object",
      properties: {
        heading: { type: "string", description: "The section heading, without the ## marks." },
        markdown: { type: "string", description: "The section's bullets, ### pieces and galleries, with every citation copied from its node." },
      },
      required: ["heading", "markdown"],
    },
  },
  {
    name: "write_reference",
    description: "The Reference half, whole and once: The client's questions, then the More on sections. Not counted. Calling again replaces it.",
    inputSchema: {
      type: "object",
      properties: { markdown: { type: "string", description: "Everything under # Reference, without that heading." } },
      required: ["markdown"],
    },
  },
  {
    name: "finish_brief",
    description: "When every section is written. Answers once with what is missing, named otherwise, or cited to no node; the second call finishes whatever stands.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** Bounds one brief's conversation: eight writes, each sent back at most
 * once, a finish asked twice, and room for a cut-off turn or two. */
const MAX_TURNS = 30;

export function buildBriefSystemPrompt(skill: string, input: Pick<BriefTextInput, "today" | "letterTitle" | "purpose" | "peopleLines" | "structureBody" | "nodes">): string {
  const nodesBlock =
    input.nodes.length > 0
      ? input.nodes.map((n) => formatNodeVerbatim(n, input.today)).join("\n\n")
      : "(The graph holds no nodes yet.)";
  return [
    "You are GraphLog's brief step, writing the brief a guide reads before writing one letter to the client, from the project's graph, per the project's own instructions below. You work only through the tools: write_section for each first-half section in the shape's order, write_reference once, then finish_brief. Copy every citation exactly from its node; code checks each against the graph. Write nothing outside a tool call.",
    "",
    skill,
    "",
    "---",
    "",
    `Today's actual date: ${input.today}`,
    "",
    `The letter: "${input.letterTitle}".`,
    `Its purpose, in the guide's words: ${input.purpose}`,
    "",
    "The people:",
    ...input.peopleLines.map((l) => `- ${l}`),
    "",
    "graph-structure.md (the map of the whole; read the nodes below to write from):",
    "",
    input.structureBody?.trim() || "(There is no graph-structure.md yet.)",
    "",
    "---",
    "",
    "Every node in the graph, verbatim, in the order it was logged, each with the citation to copy:",
    "",
    nodesBlock,
  ].join("\n");
}

export type BriefTextInput = {
  letterTitle: string;
  purpose: string;
  today: string;
  /** One line per person: name, group, and what the seed packet said of
   * them when it did. */
  peopleLines: readonly string[];
  structureBody: string | null;
  nodes: readonly GraphLogNode[];
  skill: string;
  provider?: LlmProvider;
  log?: (line: string) => void;
  /** Checked each turn so Stop on the Maker reaches a running brief. */
  checkCancelled?: () => Promise<void>;
};

export type BriefTextResult = {
  content: string;
  sections: string[];
  /** Sections sent back once with their count. */
  bounced: string[];
  /** Citations that match no node, after the finish. */
  unmatched: string[];
  incomplete: string[];
  usage: LlmUsage;
  model: string | null;
  turns: number;
};

/**
 * One brief from one conversation. The tools collect in memory; nothing
 * is written here.
 */
export async function briefText(input: BriefTextInput): Promise<BriefTextResult> {
  const provider = input.provider ?? AnthropicProvider.forStage("brief");
  const log = input.log ?? (() => {});
  const system = buildBriefSystemPrompt(input.skill, input);
  const allNodesById = new Map(input.nodes.map((n) => [n.id, n]));
  const draft = emptyBriefDraft();
  const turnedBack = new Set<string>();
  const bounced: string[] = [];
  const incomplete: string[] = [];
  let aboutKeyOf: string | null = null;
  let finishAsked = false;
  let finished = false;

  const execute = (name: string, args: Record<string, unknown>): string => {
    if (name === "write_section") {
      const heading = typeof args.heading === "string" ? args.heading.trim() : "";
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (!heading) return "Not written: a section needs its heading.";
      if (!markdown.trim()) return `Not written: "${heading}" is empty. A section with nothing true to say is left out instead.`;
      const key = briefHeadingKey(heading);
      let shapeKey: string;
      if (FIXED_KEYS.has(key)) shapeKey = key;
      else if (aboutKeyOf === null || aboutKeyOf === key) {
        aboutKeyOf = key;
        shapeKey = BRIEF_ABOUT_KEY;
      } else {
        const named = BRIEF_SECTION_BUDGETS.filter((s) => s.key !== BRIEF_ABOUT_KEY).map((s) => `"${s.heading}"`).join(", ");
        return `Not written: the shape has one free heading, and it is already "${draft.sections.get(BRIEF_ABOUT_KEY)?.heading ?? aboutKeyOf}". The others are ${named}. Put this under one of them, or inside the free section as a ### piece.`;
      }
      draft.sections.set(shapeKey, { heading, markdown });
      const note = briefSectionNote(shapeKey, markdown);
      if (note && !turnedBack.has(shapeKey)) {
        turnedBack.add(shapeKey);
        bounced.push(heading);
        log(`brief: sent back "${heading}" once: ${note}.`);
        return `Written for now, but "${heading}" is ${note}. Cut it, or move what you cut to Reference, and call write_section for it again; the resend replaces this and is accepted as written.`;
      }
      return `Written: "${heading}".`;
    }
    if (name === "write_reference") {
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (!markdown.trim()) return "Not written: Reference is empty.";
      draft.reference = markdown;
      return "Written: Reference.";
    }
    if (name === "finish_brief") {
      const { refusals, notes, unmatched } = briefFinishNotes(draft, allNodesById);
      const lines = [...refusals, ...notes, ...unmatched.map((r) => `a citation matches no node: ${r}`)];
      if (lines.length > 0 && !finishAsked) {
        finishAsked = true;
        log(`brief: finish asked once more: ${lines.join("; ")}.`);
        return `Not finished yet:\n- ${lines.join("\n- ")}\nPut right what you can, then call finish_brief again; the second call finishes whatever stands.`;
      }
      if (refusals.length > 0) incomplete.push(...refusals);
      finished = true;
      return "Finished.";
    }
    return `Error: no tool named ${name}.`;
  };

  const messages: LlmMessage[] = [
    {
      role: "user",
      content: `Write the brief for the letter "${input.letterTitle}". Start with write_section for "The ask", then each section in the shape's order, then write_reference, then finish_brief.`,
    },
  ];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let model: string | null = null;
  let turns = 0;

  for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
    await input.checkCancelled?.();
    const response = await provider.complete({ system, messages, tools: BRIEF_TOOLS, cacheSystemPrompt: true });
    turns += 1;
    model = response.model;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (response.usage.cacheReadTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0);
    const calls = completedToolCalls(response.toolCalls, response.stopReason);
    if (calls.length === 0) {
      if (response.stopReason === "max_tokens") {
        messages.push({ role: "assistant", content: response.text ?? "", toolCalls: [] });
        messages.push({ role: "user", content: "That turn was cut off before a tool call finished. Go on from where you were, one section per call." });
        continue;
      }
      if (response.stopReason === "other") incomplete.push("the model stopped before finishing the brief (declined or interrupted)");
      break;
    }
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: calls });
    for (const call of calls) {
      messages.push({ role: "tool_result", toolCallId: call.id, content: execute(call.name, call.input) });
    }
    if (response.stopReason !== "tool_use" && response.stopReason !== "max_tokens") break;
  }

  if (!finished) {
    // Ended without finish_brief: what stands is kept, and the brief says
    // it was not finished so a guide knows to ask again.
    const { refusals } = briefFinishNotes(draft, allNodesById);
    incomplete.push(...refusals);
    if (turns >= MAX_TURNS) incomplete.push(`still writing after ${MAX_TURNS} turns`);
    else if (!incomplete.some((l) => l.includes("stopped before"))) incomplete.push("the model ended without calling finish_brief");
  }

  const content = assembleBrief(draft);
  const { unmatched } = countCitations(content, allNodesById);
  return {
    content,
    sections: [...draft.sections.values()].map((s) => s.heading),
    bounced,
    unmatched,
    incomplete,
    usage,
    model,
    turns,
  };
}

// ─── Where the brief is kept ────────────────────────────────────────────

const TABLE = "letter_briefs";
let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await defineTable(TABLE);
  tableEnsured = true;
}

export type LetterBriefRow = Data & {
  letter_file_id: string;
  project_folder_id: string;
  content: string | null;
  written_at: string | null;
  by_human_id: string | null;
  run_id: string | null;
  model: string | null;
  incomplete: string[];
  bounced: string[];
  unmatched: string[];
  /** The job asked for and not yet finished, so a second click waits. */
  pending_job_id: string | null;
};

export async function getLetterBriefRow(letterFileId: string): Promise<LetterBriefRow | null> {
  await ensureTable();
  const row = await select<LetterBriefRow>(new RecordId(TABLE, letterFileId));
  return row ? formatRecord(row) : null;
}

/** One row per letter: made whole the first time, merged after. Never
 * spread a read record back into an upsert: the record carries its own
 * `id`, and SurrealDB refuses the write, quietly (the first dev walk's
 * second ask kept pointing at the first job). */
async function writeLetterBriefRow(letterFileId: string, patch: Partial<Omit<LetterBriefRow, "_id">> & { letter_file_id: string; project_folder_id: string }): Promise<void> {
  await ensureTable();
  const existing = await getLetterBriefRow(letterFileId);
  if (existing) await merge(TABLE, letterFileId, patch);
  else await upsert(new RecordId(TABLE, letterFileId), { content: null, written_at: null, by_human_id: null, run_id: null, model: null, incomplete: [], bounced: [], unmatched: [], pending_job_id: null, ...patch });
}

// ─── The stage ──────────────────────────────────────────────────────────

export type BriefRunResult =
  | { ok: true; sections: string[]; bounced: string[]; unmatched: string[]; incomplete: string[] }
  | { ok: false; error: string };

export interface RunBriefOptions {
  provider?: LlmProvider;
  runId?: string | null;
  log?: (line: string) => void;
}

/** The letter this brief is for, when it is one on this project with a
 * purpose line; else the one-line reason. */
async function letterForBrief(projectFolder: VaultFolder, letterFileId: string): Promise<{ ok: true; file: FileRef } | { ok: false; error: string }> {
  const file = await getFileRefById(letterFileId);
  if (!file || file.archived_at) return { ok: false, error: "That letter is not on this project" };
  const home = await letterHome(file);
  if (!home || home.project._id !== projectFolder._id) return { ok: false, error: "That letter is not on this project" };
  if (!file.purpose?.trim()) return { ok: false, error: "This letter has no purpose line yet. Say what it is for first." };
  return { ok: true, file };
}

/** One line per person the model may meet on a node. */
async function peopleLinesFor(projectFolder: VaultFolder): Promise<string[]> {
  const sharing = await getProjectSharing(projectFolder);
  const humans = await getHumansById([...new Set(sharing.map((e) => e.human))]);
  const byId = new Map(humans.map((h) => [h._id, h]));
  const lines: string[] = [];
  for (const entry of sharing) {
    const human = byId.get(entry.human);
    if (!human) continue;
    const group = groupOf(entry.role) ?? entry.role;
    lines.push(`${human.name} (${firstName(human)}): ${group} on this project`);
  }
  const seedFolder = await findSeedSyncFolder(projectFolder);
  if (seedFolder) {
    const { files } = await listFolderChildren(projectFolder.human_id, seedFolder._id);
    const listing = files.find((f) => f.name === SEED_PEOPLE_FILE_NAME);
    const peopleFile = listing ? await getFileRefById(listing._id) : undefined;
    for (const [name, role] of parseSeedPeople(peopleFile?.content ?? "")) lines.push(`${name}: ${role} (from the seed packet)`);
  }
  return lines;
}

/**
 * Writes one letter's brief and keeps it. Asked for by a guide (the
 * letters route when a letter starts, or "Write it again"); never by the
 * pipeline.
 */
export async function runBrief(projectFolder: VaultFolder, letterFileId: string, actingHumanId: string, opts: RunBriefOptions = {}): Promise<BriefRunResult> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  if (!opts.provider && !isGraphLogAgentConfigured()) return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };

  const letter = await letterForBrief(projectFolder, letterFileId);
  if (!letter.ok) return letter;
  const title = letterTitle(letter.file);

  const ownSkill = await getProjectStageSkill(projectFolder, "BRIEF.md");
  if (ownSkill !== null && isSkipInstruction(ownSkill)) {
    return { ok: false, error: "skills/BRIEF.md says skip, so no brief was written" };
  }
  const stageSkill = ownSkill ?? (await getEffectiveGraphLogDefaultSkill("brief"));
  const { content: skill } = composeStageSkill(stageSkill, await getProjectStageSkill(projectFolder, "SKILL.md"), await listExtraSkillFiles(projectFolder));

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) return { ok: false, error: "This project has no graph yet. Print an update on the Efforts tab first." };
  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const { allNodes, issues } = await loadGraphNodes(files);
  for (const issue of issues) log(`brief: ${issue}.`);
  if (allNodes.length === 0) return { ok: false, error: "The graph holds no nodes yet, so there is nothing to brief from." };
  const nodes = [...allNodes].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  const structureListing = files.find((f) => f.name === "graph-structure.md");
  const structureFile = structureListing ? await getFileRefById(structureListing._id) : undefined;
  const structureBody = structureFile?.content ? splitFrontmatter(structureFile.content).body : null;

  const peopleLines = await peopleLinesFor(projectFolder);
  const today = new Date().toISOString().slice(0, 10);
  log(`brief: writing the brief for "${title}" from ${nodes.length} node(s).`);

  try {
    const result = await briefText({
      letterTitle: title,
      purpose: letter.file.purpose!.trim(),
      today,
      peopleLines,
      structureBody,
      nodes,
      skill,
      provider: opts.provider,
      log,
      checkCancelled: () => throwIfGraphLogCancelled(projectFolder._id),
    });
    await recordGraphLogUsage({
      runId: opts.runId,
      humanId: actingHumanId,
      projectFolderId: projectFolder._id,
      stage: "brief",
      kind: "brief",
      model: result.model ?? undefined,
      usage: result.usage,
      durationMs: Date.now() - started,
      outcome: result.incomplete.length > 0 ? "error" : "success",
      errorKind: result.incomplete.length > 0 ? "incomplete" : undefined,
    });
    await writeLetterBriefRow(letterFileId, {
      letter_file_id: letterFileId,
      project_folder_id: projectFolder._id,
      content: result.content,
      written_at: new Date().toISOString(),
      by_human_id: actingHumanId,
      run_id: opts.runId ?? null,
      model: result.model,
      incomplete: result.incomplete,
      bounced: result.bounced,
      unmatched: result.unmatched,
      pending_job_id: null,
    });
    log(
      `brief: "${title}": ${result.sections.length} section(s), ${result.bounced.length} sent back once, ${result.unmatched.length} citation(s) matching no node, ${result.turns} turn(s)${result.incomplete.length ? `; not finished: ${result.incomplete.join("; ")}` : ""}.`,
    );
    return { ok: true, sections: result.sections, bounced: result.bounced, unmatched: result.unmatched, incomplete: result.incomplete };
  } catch (err) {
    if (err instanceof GraphLogCancelledError) throw err;
    await recordGraphLogUsage({ runId: opts.runId, humanId: actingHumanId, projectFolderId: projectFolder._id, stage: "brief", kind: "brief", durationMs: Date.now() - started, outcome: "error", errorKind: classifyGraphLogError(err) });
    throw err;
  }
}

// ─── Asking for one, and reading it ─────────────────────────────────────

export type RequestBriefResult = { ok: true; jobId: string } | { ok: false; status: 400 | 409; error: string };

/** Whether the job a row names is still ahead of us. */
async function pendingJob(row: LetterBriefRow | null): Promise<{ state: string; error: string | null } | null> {
  if (!row?.pending_job_id) return null;
  const status = await getGraphLogJobStatus(row.pending_job_id);
  if (!status.ok) return null;
  return { state: status.state, error: status.state === "failed" ? (status.error ?? "The brief stopped on an error.") : null };
}

function isRunning(state: string | undefined): boolean {
  return state === "waiting" || state === "active" || state === "delayed";
}

/**
 * Asks the worker for this letter's brief. The two callers are the two
 * controls a guide has: starting a letter, and "Write it again". The
 * routes have already asked `canManageLetters`.
 */
export async function requestBrief(projectFolder: VaultFolder, letter: FileRef, actingHumanId: string): Promise<RequestBriefResult> {
  if (!letter.purpose?.trim()) return { ok: false, status: 400, error: "Say what this letter is for first." };
  const row = await getLetterBriefRow(letter._id);
  const job = await pendingJob(row);
  if (job && isRunning(job.state)) return { ok: false, status: 409, error: "The brief is being written. Give it a few minutes." };
  const jobId = await enqueueGraphLogJob("brief", { actingHumanId, projectFolderId: projectFolder._id, fileId: letter._id });
  await writeLetterBriefRow(letter._id, { letter_file_id: letter._id, project_folder_id: projectFolder._id, pending_job_id: jobId });
  return { ok: true, jobId };
}

/** What the letter's page shows a guide about the brief. */
export type LetterBriefForPage = {
  brief: { content: string; writtenAt: string; byName: string; incomplete: string[] } | null;
  job: { state: "waiting" | "active" | "failed" | "completed" | "unknown"; error: string | null; startedAt: string | null; waitingOnAnotherRun: boolean } | null;
};

export async function getLetterBriefForPage(letterFileId: string): Promise<LetterBriefForPage> {
  const row = await getLetterBriefRow(letterFileId);
  let brief: LetterBriefForPage["brief"] = null;
  if (row?.content && row.written_at) {
    const author = row.by_human_id ? (await getHumansById([row.by_human_id]))[0] : undefined;
    brief = { content: row.content, writtenAt: row.written_at, byName: author ? firstName(author) : "a guide", incomplete: row.incomplete ?? [] };
  }
  let job: LetterBriefForPage["job"] = null;
  if (row?.pending_job_id) {
    const status = await getGraphLogJobStatus(row.pending_job_id);
    if (status.ok) {
      const state = status.state === "delayed" ? "waiting" : status.state === "waiting" || status.state === "active" || status.state === "failed" || status.state === "completed" ? status.state : "unknown";
      const startedAt = state === "active" || state === "completed" || state === "failed" ? await getGraphLogRunStartedAt(row.pending_job_id) : null;
      job = {
        state,
        error: state === "failed" ? (status.error ?? "The brief stopped on an error.") : null,
        startedAt,
        waitingOnAnotherRun: state === "active" && (status.log ?? []).some((l) => /waiting for another GraphLog run/i.test(l)),
      };
    }
  }
  return { brief, job };
}
