/**
 * The outline (Austin, 2026-10-23 to 28): what one letter covers, in the
 * guide's order, written by a model from the guide's talk-through of the
 * brief. Each line a fact the project logged, cited, or a position the
 * guide took, opening `Position:`; the model adds no reasons of its own.
 * Then what the brief holds that the talk skipped, what the talk said
 * that nothing logged backs, and one thing for the client to go do.
 * `OUTLINE.md` is its skill, written from the attic test's three rounds.
 *
 * Who decides what. A person: the talk (typed on the letter's page, on
 * the record as their Card for the day when they ask for the outline),
 * the click, editing the outline, judging it. Code: the Card write
 * (`appendToCard`), the trigger, the one count and the one bounce, that
 * a topic line is cited or a position, that every citation is a node's
 * own, that Go do is last and one line, where the outline is kept and
 * who reads it. The model: the outline's words.
 *
 * A second call on the brief's stage: same job name, model and effort,
 * `kind: "outline"` on the job. The outline never enters the graph; the
 * talk does, as the guide's words on that day, at the next run.
 */

import { AnthropicProvider, isGraphLogAgentConfigured } from "./anthropicProvider.server";
import {
  BRIEF_MAX_OUTPUT_TOKENS,
  getLetterBriefRow,
  jobIsRunning,
  writeLetterBriefRow,
  writeWholeDocument,
  type WriteNotes,
} from "./brief.server";
import { appendToCard } from "./dailyLog.server";
import { runDailyLogSync } from "./dailyLogSync.server";
import { countPageWords } from "./effortReadings.server";
import { groupOf, type Feature } from "./features";
import { getEffectiveGraphLogDefaultSkill } from "./graphLogDefaults.server";
import { markDate } from "./graphLogMarks.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { enqueueGraphLogJob, GraphLogCancelledError, throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { countCitations, loadGraphNodes } from "./graphProjectView.server";
import { formatNodeVerbatim, type GraphLogNode } from "./graphNodeIndex.server";
import { firstName } from "./humanNames";
import { getHumansById } from "./humans.server";
import { letterHome, letterTitle } from "./letters.server";
import type { LlmProvider, ToolDefinition } from "./llmProvider";
import { splitFrontmatter, splitReadmeSections } from "./project.types";
import { composeStageSkill, findProjectGraphFolder, getProjectStageSkill, isSkipInstruction, listExtraSkillFiles } from "./projectN02.server";
import { getProjectSharing } from "./projectSharing.server";
import { findSeedSyncFolder, parseSeedPeople, SEED_PEOPLE_FILE_NAME } from "./seed.server";
import { getFileRefById, listFolderChildren } from "./vault.server";
import type { FileRef, VaultFolder } from "./vault.types";

// ─── The shape, held by code ────────────────────────────────────────────

/** The fixed tail after the guide's topics, in order. */
export const OUTLINE_TAIL = [
  { key: "in the brief, no position yet", heading: "In the brief, no position yet" },
  { key: "in the talk, not in the graph", heading: "In the talk, not in the graph" },
  { key: "go do", heading: "Go do" },
] as const;

/** The whole outline's words, sent back once when over. The attic
 * example ran about 700; Austin re-reads this when an outline feels thin
 * or like a draft. */
export const OUTLINE_WORD_BUDGET = 750;

export function outlineHeadingKey(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type OutlineSection = { heading: string; key: string; markdown: string };

/** The document read into topics and the tail. Pure. */
export function parseOutlineDocument(markdown: string): { topics: OutlineSection[]; tail: Map<string, OutlineSection>; order: string[] } {
  const body = splitFrontmatter(markdown).body;
  const tailKeys = new Set<string>(OUTLINE_TAIL.map((t) => t.key));
  const topics: OutlineSection[] = [];
  const tail = new Map<string, OutlineSection>();
  const order: string[] = [];
  for (const section of splitReadmeSections(body)) {
    if (section.heading === "") continue;
    const key = outlineHeadingKey(section.heading);
    const entry = { heading: section.heading.replace(/^#+\s*/, "").trim(), key, markdown: section.content.trim() };
    order.push(key);
    if (tailKeys.has(key)) tail.set(key, entry);
    else topics.push(entry);
  }
  return { topics, tail, order };
}

/** The outline as a person reads it: the guide's topics in the order the
 * model gave them, then the tail in its fixed order. */
export function assembleOutline(parsed: { topics: OutlineSection[]; tail: Map<string, OutlineSection> }): string {
  const parts = parsed.topics.map((t) => `## ${t.heading}\n\n${t.markdown}`);
  for (const t of OUTLINE_TAIL) {
    const section = parsed.tail.get(t.key);
    if (section) parts.push(`## ${t.heading}\n\n${section.markdown}`);
  }
  return parts.join("\n\n") + "\n";
}

const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** The bullets of a section's markdown, first lines only. */
export function sectionBullets(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => BULLET_RE.exec(l)?.[1]?.trim())
    .filter((l): l is string => !!l);
}

/** A topic line is a cited fact or a position; anything else is the
 * model's own line, the shape the third round's cold read caught. */
export function isOwnLine(bullet: string): boolean {
  return !/:ref\{/.test(bullet) && !/^\*{0,2}Position:/i.test(bullet);
}

/**
 * Everything code has to say about one write of the outline. Hard sends
 * it back once: a topic line that is neither cited nor a position; a
 * citation matching no node; Go do missing, not last, or not one line; no
 * topics at all; the whole over its budget. Soft rides along: a back
 * list missing.
 */
export function outlineWriteNotes(markdown: string, allNodesById: Map<string, GraphLogNode>): WriteNotes & { words: number } {
  const hard: string[] = [];
  const soft: string[] = [];
  const parsed = parseOutlineDocument(markdown);
  if (parsed.topics.length === 0) hard.push("no topic section: the outline opens with the guide's topics, in the order they took them");
  for (const topic of parsed.topics) {
    for (const bullet of sectionBullets(topic.markdown)) {
      if (isOwnLine(bullet)) hard.push(`under "${topic.heading}", a line that is neither a cited fact nor a Position: line: "${bullet.slice(0, 80)}${bullet.length > 80 ? "…" : ""}"`);
    }
  }
  const goDo = parsed.tail.get("go do");
  if (!goDo) hard.push('"Go do" is not written: one sentence naming something the client can check or do at the house');
  else {
    const items = sectionBullets(goDo.markdown);
    if (items.length !== 1) hard.push(`"Go do" holds ${items.length} items; it holds one`);
    if (parsed.order[parsed.order.length - 1] !== "go do") hard.push('"Go do" is not the last section');
  }
  for (const t of OUTLINE_TAIL) {
    if (t.key !== "go do" && !parsed.tail.has(t.key)) soft.push(`"${t.heading}" is not written; leave it out only if nothing belongs there`);
  }
  const { unmatched } = countCitations(markdown, allNodesById);
  for (const r of unmatched) hard.push(`a citation matches no node: ${r}`);
  const words = countPageWords(markdown);
  if (words > OUTLINE_WORD_BUDGET) hard.push(`${words} words against a budget of ${OUTLINE_WORD_BUDGET} (citations not counted)`);
  return { hard, soft, words };
}

// ─── The model's half ───────────────────────────────────────────────────

export const OUTLINE_TOOL: ToolDefinition = {
  name: "write_outline",
  description:
    "The whole outline, once: the guide's topics in their order, then In the brief, no position yet; In the talk, not in the graph; Go do. Code reads it and may send it back once; send it again whole, and the resend is accepted as written.",
  inputSchema: {
    type: "object",
    properties: { markdown: { type: "string", description: "The outline as a markdown document, every citation copied exactly from the brief or a node." } },
    required: ["markdown"],
  },
};

export type OutlineTextInput = {
  letterTitle: string;
  purpose: string;
  today: string;
  guideName: string;
  brief: string;
  talk: string;
  peopleLines: readonly string[];
  nodes: readonly GraphLogNode[];
  skill: string;
  provider?: LlmProvider;
  log?: (line: string) => void;
  checkCancelled?: () => Promise<void>;
};

export function buildOutlineSystemPrompt(skill: string, input: Omit<OutlineTextInput, "skill" | "provider" | "log" | "checkCancelled">): string {
  const nodesBlock = input.nodes.length > 0 ? input.nodes.map((n) => formatNodeVerbatim(n, input.today)).join("\n\n") : "(The graph holds no nodes yet.)";
  return [
    "You are GraphLog's outline step, turning a guide's talk-through of a letter's brief into the outline they write the letter from, per the project's own instructions below. You work only through the tool: write_outline, the whole outline in one call. Copy every citation exactly from the brief or a node; code checks each against the graph. Write nothing outside the tool call.",
    "",
    skill,
    "",
    "---",
    "",
    `Today's actual date: ${input.today}`,
    "",
    `The letter: "${input.letterTitle}".`,
    `Its purpose, in the guide's words: ${input.purpose}`,
    `The guide whose talk this is: ${input.guideName}.`,
    "",
    "The people:",
    ...input.peopleLines.map((l) => `- ${l}`),
    "",
    "The brief, as the guide read it:",
    "",
    input.brief.trim(),
    "",
    "---",
    "",
    `The talk-through, ${input.guideName}'s words, unedited:`,
    "",
    input.talk.trim(),
    "",
    "---",
    "",
    "Every node in the graph, verbatim, in the order it was logged, each with the citation to copy:",
    "",
    nodesBlock,
  ].join("\n");
}

export type OutlineTextResult = {
  content: string;
  topics: string[];
  bounced: string[];
  unmatched: string[];
  words: number;
  incomplete: string[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  model: string | null;
  turns: number;
};

/** The model's half: the brief, the talk and the nodes in, an outline
 * out. No database. */
export async function outlineText(input: OutlineTextInput): Promise<OutlineTextResult> {
  const provider = input.provider ?? AnthropicProvider.forStage("brief");
  const allNodesById = new Map(input.nodes.map((n) => [n.id, n]));
  const result = await writeWholeDocument({
    provider,
    system: buildOutlineSystemPrompt(input.skill, input),
    firstMessage: `Write the outline for the letter "${input.letterTitle}" from ${input.guideName}'s talk-through, whole, in one write_outline call.`,
    tool: OUTLINE_TOOL,
    what: "outline",
    maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
    log: input.log,
    checkCancelled: input.checkCancelled,
    notes: (markdown) => {
      const { hard, soft } = outlineWriteNotes(markdown, allNodesById);
      return { hard, soft };
    },
  });
  const parsed = result.markdown ? parseOutlineDocument(result.markdown) : { topics: [], tail: new Map<string, OutlineSection>(), order: [] };
  const content = assembleOutline(parsed);
  const { unmatched } = countCitations(content, allNodesById);
  return {
    content,
    topics: parsed.topics.map((t) => t.heading),
    bounced: result.bouncedWith,
    unmatched,
    words: countPageWords(content),
    incomplete: result.incomplete,
    usage: result.usage,
    model: result.model,
    turns: result.turns,
  };
}

// ─── The stage ──────────────────────────────────────────────────────────

export type OutlineRunResult = { ok: true; topics: string[]; bounced: string[]; unmatched: string[]; words: number; incomplete: string[] } | { ok: false; error: string };

export interface RunOutlineOptions {
  provider?: LlmProvider;
  runId?: string | null;
  log?: (line: string) => void;
}

async function peopleLinesFor(projectFolder: VaultFolder): Promise<string[]> {
  const sharing = await getProjectSharing(projectFolder);
  const humans = await getHumansById([...new Set(sharing.map((e) => e.human))]);
  const byId = new Map(humans.map((h) => [h._id, h]));
  const lines: string[] = [];
  for (const entry of sharing) {
    const human = byId.get(entry.human);
    if (!human) continue;
    lines.push(`${human.name} (${firstName(human)}): ${groupOf(entry.role) ?? entry.role} on this project`);
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
 * Writes one letter's outline from the talk-through on its row and the
 * brief beside it, and keeps it. First copies the talk's day into the
 * project (`runDailyLogSync`), as a taken suggestion does, so the next
 * run finds it. Asked for by a guide; never by the pipeline.
 */
export async function runOutline(projectFolder: VaultFolder, letterFileId: string, actingHumanId: string, opts: RunOutlineOptions = {}): Promise<OutlineRunResult> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  if (!opts.provider && !isGraphLogAgentConfigured()) return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };

  const file = await getFileRefById(letterFileId);
  const home = file && !file.archived_at ? await letterHome(file) : null;
  if (!file || !home || home.project._id !== projectFolder._id) return { ok: false, error: "That letter is not on this project" };
  const row = await getLetterBriefRow(letterFileId);
  if (!row?.content) return { ok: false, error: "This letter has no brief yet. Read the brief first." };
  if (!row.talk_through?.trim()) return { ok: false, error: "Nothing has been talked through yet." };
  const title = letterTitle(file);

  if (row.talk_through_date) {
    try {
      await runDailyLogSync(projectFolder._id, { date: row.talk_through_date });
    } catch (err) {
      log(`outline: the talk's day could not be copied into the project (${err instanceof Error ? err.message : String(err)}); the next run will.`);
    }
  }

  const ownSkill = await getProjectStageSkill(projectFolder, "OUTLINE.md");
  if (ownSkill !== null && isSkipInstruction(ownSkill)) return { ok: false, error: "skills/OUTLINE.md says skip, so no outline was written" };
  const stageSkill = ownSkill ?? (await getEffectiveGraphLogDefaultSkill("outline"));
  const { content: skill } = composeStageSkill(stageSkill, await getProjectStageSkill(projectFolder, "SKILL.md"), await listExtraSkillFiles(projectFolder));

  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) return { ok: false, error: "This project has no graph yet." };
  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const { allNodes, issues } = await loadGraphNodes(files);
  for (const issue of issues) log(`outline: ${issue}.`);
  const nodes = [...allNodes].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  const guide = (await getHumansById([row.talk_through_by_human_id ?? actingHumanId]))[0];
  const guideName = guide ? firstName(guide) : "the guide";
  const today = new Date().toISOString().slice(0, 10);
  log(`outline: writing the outline for "${title}" from ${guideName}'s talk-through and ${nodes.length} node(s).`);

  try {
    const result = await outlineText({
      letterTitle: title,
      purpose: file.purpose?.trim() ?? "",
      today,
      guideName,
      brief: row.content,
      talk: row.talk_through,
      peopleLines: await peopleLinesFor(projectFolder),
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
      kind: "outline",
      model: result.model ?? undefined,
      usage: result.usage,
      durationMs: Date.now() - started,
      outcome: result.incomplete.length > 0 ? "error" : "success",
      errorKind: result.incomplete.length > 0 ? "incomplete" : undefined,
    });
    await writeLetterBriefRow(letterFileId, {
      letter_file_id: letterFileId,
      project_folder_id: projectFolder._id,
      outline: result.content,
      outline_written_at: new Date().toISOString(),
      outline_by_human_id: actingHumanId,
      outline_run_id: opts.runId ?? null,
      outline_incomplete: result.incomplete,
      outline_bounced: result.bounced,
      outline_edited_at: null,
      outline_pending_job_id: null,
    });
    log(`outline: "${title}": ${result.topics.length} topic(s), ${result.words} words, ${result.bounced.length ? "sent back once" : "written first time"}, ${result.unmatched.length} citation(s) matching no node, ${result.turns} turn(s)${result.incomplete.length ? `; not finished: ${result.incomplete.join("; ")}` : ""}.`);
    return { ok: true, topics: result.topics, bounced: result.bounced, unmatched: result.unmatched, words: result.words, incomplete: result.incomplete };
  } catch (err) {
    if (err instanceof GraphLogCancelledError) throw err;
    await recordGraphLogUsage({ runId: opts.runId, humanId: actingHumanId, projectFolderId: projectFolder._id, stage: "brief", kind: "outline", durationMs: Date.now() - started, outcome: "error", errorKind: classifyGraphLogError(err) });
    throw err;
  }
}

// ─── The guide's side: the talk, the outline asked for, the outline edited ──

export type TalkResult = { ok: true; jobId: string } | { ok: false; status: 400 | 403 | 409; error: string };

/** Autosave of what the guide has typed and not yet put on the record. */
export async function saveTalkDraft(projectFolder: VaultFolder, letter: FileRef, draft: string): Promise<void> {
  await writeLetterBriefRow(letter._id, { letter_file_id: letter._id, project_folder_id: projectFolder._id, talk_draft: draft });
}

/**
 * The guide's click: their talk goes onto their Card for today on the
 * project (`appendToCard`, the daily log's own rules) and the outline is
 * asked for. One talk per letter; asking again is `requestOutline`.
 */
export async function sendTalkThrough(
  projectFolder: VaultFolder,
  letter: FileRef,
  actor: { humanId: string; features: readonly Feature[] },
  input: { text: string; date?: string },
): Promise<TalkResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: "Say something first." };
  const row = await getLetterBriefRow(letter._id);
  if (!row?.content) return { ok: false, status: 400, error: "Read the brief first." };
  if (await jobIsRunning(row.outline_pending_job_id)) return { ok: false, status: 409, error: "The outline is being written. Give it a few minutes." };
  if (!actor.features.includes("dailyLog")) return { ok: false, status: 403, error: "You're not on this project's log, so your talk-through can't go on its record." };
  const date = markDate(input.date);
  const card = await appendToCard({ humanId: actor.humanId, date, projectFolderId: projectFolder._id, text, features: actor.features });
  const jobId = await enqueueGraphLogJob("brief", { actingHumanId: actor.humanId, projectFolderId: projectFolder._id, fileId: letter._id, kind: "outline" });
  await writeLetterBriefRow(letter._id, {
    letter_file_id: letter._id,
    project_folder_id: projectFolder._id,
    talk_draft: null,
    talk_through: text,
    talk_through_at: new Date().toISOString(),
    talk_through_by_human_id: actor.humanId,
    talk_through_date: date,
    talk_through_card_file_id: card.fileId,
    outline_pending_job_id: jobId,
  });
  return { ok: true, jobId };
}

/** "Write it again": the same talk, a new outline. */
export async function requestOutline(projectFolder: VaultFolder, letter: FileRef, actingHumanId: string): Promise<TalkResult> {
  const row = await getLetterBriefRow(letter._id);
  if (!row?.content) return { ok: false, status: 400, error: "Read the brief first." };
  if (!row.talk_through?.trim()) return { ok: false, status: 400, error: "Talk it through first." };
  if (await jobIsRunning(row.outline_pending_job_id)) return { ok: false, status: 409, error: "The outline is being written. Give it a few minutes." };
  const jobId = await enqueueGraphLogJob("brief", { actingHumanId, projectFolderId: projectFolder._id, fileId: letter._id, kind: "outline" });
  await writeLetterBriefRow(letter._id, { letter_file_id: letter._id, project_folder_id: projectFolder._id, outline_pending_job_id: jobId });
  return { ok: true, jobId };
}

/** The guide's own edit of the outline. It re-runs nothing. */
export async function saveOutlineEdit(projectFolder: VaultFolder, letter: FileRef, content: string): Promise<{ ok: true } | { ok: false; status: 400; error: string }> {
  if (!content.trim()) return { ok: false, status: 400, error: "The outline can't be empty. Write it again instead." };
  await writeLetterBriefRow(letter._id, { letter_file_id: letter._id, project_folder_id: projectFolder._id, outline: content, outline_edited_at: new Date().toISOString() });
  return { ok: true };
}
