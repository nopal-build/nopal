/**
 * The outline (Austin, 2026-10-23 to 28): what one letter covers, in the
 * guide's order, written by a model from the guide's talk-through of the
 * brief. Each line a fact the project logged, cited, or a position the
 * guide took, opening `Position:`; the model adds no reasons of its own.
 * Then what the brief holds that the talk skipped, what the talk said
 * that nothing logged backs, and one thing for the client to go do.
 * `OUTLINE.md` is its skill, written from the attic test's three rounds.
 *
 * Without a brief (Austin, 2026-11-05: the talk box and the outline are
 * for anyone writing a letter, brief or no brief) the outline is made
 * from the writer's talk-through and nothing else: no brief, no node, no
 * list of people, no project skill. `outlineFromTalkText` is that call,
 * and its input has no field a node or a brief could ride in on.
 * `OUTLINE-TALK` is its skill, a default only.
 *
 * A letter started from what its writer said about a letter they read
 * (Austin, 2026-11-06; `letterReflection.server.ts`) has a third call,
 * `letterBackOutlineText`: their reflection, the letter they read, and
 * the sender's own older words from the project's record, and nothing
 * else. Its shape and budgets are the `reply-pause` seed's, hand-tested
 * over ten rounds (2026-10-29): one sentence, three or four moves, what
 * is left for another letter. `OUTLINE-LETTER-BACK` is its skill, a
 * default only.
 *
 * Who decides what. A person: the talk (typed on the letter's page), the
 * click, editing the outline, judging it, and sending the letter, which
 * is what puts the talk on the record (Austin, 2026-11-05: "you could
 * talk it through and then decide that it's not important. Once you send
 * the letter, that is kind of the distinction"). Code: the Card write at
 * Send (`landTalkThrough`, through `appendToCard`), the trigger, the one
 * count and the one bounce, that a topic line is cited or a position,
 * that every citation is a node's own, that Go do is last and one line,
 * that an outline made without a brief cites nothing, where the outline
 * is kept and who reads it. The model: the outline's words.
 *
 * A second call on the brief's stage: same job name, model and effort,
 * `kind: "outline"` on the job. The outline never enters the graph; the
 * talk does, as its speaker's words on the day the letter is sent.
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
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { enqueueGraphLogJob, GraphLogCancelledError, throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { countCitations, loadGraphNodes } from "./graphProjectView.server";
import { formatNodeVerbatim, type GraphLogNode } from "./graphNodeIndex.server";
import { firstName } from "./humanNames";
import { getHumansById } from "./humans.server";
import { houseOf } from "./letterHouses";
import { letterSenderId } from "./letterReflection.server";
import { letterHome, letterTitle, resolveSentLetterForMember, sentCopyOf } from "./letters.server";
import type { LlmProvider, ToolDefinition } from "./llmProvider";
import { splitFrontmatter, splitReadmeSections } from "./project.types";
import { composeStageSkill, findProjectGraphFolder, getProjectStageSkill, isSkipInstruction, listExtraSkillFiles } from "./projectN02.server";
import { getProjectRole, getProjectSharing } from "./projectSharing.server";
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

/** The document read into topics and the tail. `tail` is the headings
 * read as the tail: the fixed three, or none for an outline made without
 * a brief, where every section is a topic. Pure. */
export function parseOutlineDocument(markdown: string, tailOf: readonly { key: string }[] = OUTLINE_TAIL): { topics: OutlineSection[]; tail: Map<string, OutlineSection>; order: string[] } {
  const body = splitFrontmatter(markdown).body;
  const tailKeys = new Set<string>(tailOf.map((t) => t.key));
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

// ─── Without a brief: the talk and nothing else ─────────────────────────

/**
 * Everything code has to say about one write of an outline made without
 * a brief. Hard sends it back once: no topics; a citation (there is no
 * node behind this outline to cite); a heading from the brief's tail
 * (there is no brief to have skipped, no graph to be missing from, and
 * Go do is a guide's line to a client); the whole over its budget.
 */
export function talkOutlineWriteNotes(markdown: string): WriteNotes & { words: number } {
  const hard: string[] = [];
  const parsed = parseOutlineDocument(markdown, []);
  if (parsed.topics.length === 0) hard.push("no topic section: the outline is the writer's topics, in the order they took them");
  const tailKeys = new Set<string>(OUTLINE_TAIL.map((t) => t.key));
  for (const topic of parsed.topics) {
    if (tailKeys.has(topic.key)) hard.push(`"${topic.heading}" does not belong here: this outline has only the talk behind it, no brief and no graph`);
  }
  if (/:ref\{/.test(markdown)) hard.push("a citation: this outline cites nothing, because it was given nothing to cite");
  const words = countPageWords(markdown);
  if (words > OUTLINE_WORD_BUDGET) hard.push(`${words} words against a budget of ${OUTLINE_WORD_BUDGET}`);
  return { hard, soft: [], words };
}

export const TALK_OUTLINE_TOOL: ToolDefinition = {
  name: "write_outline",
  description:
    "The whole outline, once: the writer's topics in the order they took them, and nothing after. Code reads it and may send it back once; send it again whole, and the resend is accepted as written.",
  inputSchema: {
    type: "object",
    properties: { markdown: { type: "string", description: "The outline as a markdown document." } },
    required: ["markdown"],
  },
};

/** What the call is given. No brief, no node, no people, no purpose: the
 * type has nowhere to put them. */
export type TalkOutlineTextInput = {
  letterTitle: string;
  today: string;
  writerName: string;
  talk: string;
  skill: string;
  provider?: LlmProvider;
  log?: (line: string) => void;
  checkCancelled?: () => Promise<void>;
};

export function buildTalkOutlineSystemPrompt(skill: string, input: Pick<TalkOutlineTextInput, "letterTitle" | "today" | "writerName" | "talk">): string {
  return [
    "You are GraphLog's outline step, turning what someone said out loud before writing a letter into the outline they write it from, per the instructions below. You work only through the tool: write_outline, the whole outline in one call. You are given their talk-through and nothing else. Write nothing outside the tool call.",
    "",
    skill,
    "",
    "---",
    "",
    `Today's actual date: ${input.today}`,
    "",
    `The letter: "${input.letterTitle}".`,
    `The person writing it, whose talk this is: ${input.writerName}.`,
    "",
    `The talk-through, ${input.writerName}'s words, unedited:`,
    "",
    input.talk.trim(),
  ].join("\n");
}

/** The model's half without a brief: the talk in, an outline out. No
 * database, and nothing from the graph. */
export async function outlineFromTalkText(input: TalkOutlineTextInput): Promise<OutlineTextResult> {
  const provider = input.provider ?? AnthropicProvider.forStage("brief");
  const result = await writeWholeDocument({
    provider,
    system: buildTalkOutlineSystemPrompt(input.skill, input),
    firstMessage: `Write the outline for the letter "${input.letterTitle}" from ${input.writerName}'s talk-through, whole, in one write_outline call.`,
    tool: TALK_OUTLINE_TOOL,
    what: "outline",
    maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
    log: input.log,
    checkCancelled: input.checkCancelled,
    notes: (markdown) => {
      const { hard, soft } = talkOutlineWriteNotes(markdown);
      return { hard, soft };
    },
  });
  const parsed = result.markdown ? parseOutlineDocument(result.markdown, []) : { topics: [], tail: new Map<string, OutlineSection>(), order: [] };
  const content = assembleOutline(parsed);
  return {
    content,
    topics: parsed.topics.map((t) => t.heading),
    bounced: result.bouncedWith,
    unmatched: [],
    words: countPageWords(content),
    incomplete: result.incomplete,
    usage: result.usage,
    model: result.model,
    turns: result.turns,
  };
}

// ─── A letter back: the reflection, the letter read, the sender's older words ──

/** The two fixed headings, and the budgets code holds (the `reply-pause`
 * seed's, first guesses from one letter: Austin re-reads them when an
 * outline feels long or thin). Everything between the two headings is a
 * move. The leave list is not counted. */
export const LETTER_BACK_SAYING = { key: "what you're saying", heading: "What you're saying" } as const;
export const LETTER_BACK_LEAVE = { key: "leave for another letter", heading: "Leave for another letter" } as const;
export const LETTER_BACK_BUDGETS = { saying: 30, move: 75, moveLines: 3, movesMin: 3, movesMax: 4 } as const;

/** A section's lines: its bullets when it is a list, its non-empty lines
 * when it is prose. */
function sectionLines(markdown: string): string[] {
  const bullets = sectionBullets(markdown);
  return bullets.length > 0 ? bullets : markdown.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Everything code has to say about one write of an outline for a letter
 * back. All of it is hard, and all of it goes back once with the counts:
 * the sentence missing, not first, or over its words; fewer than three
 * moves or more than four; a move over its words or its lines; the leave
 * list anywhere but last; a numbered heading; a `:ref{...}` citation (the
 * sender's older words go in a line as their words, never as a link into
 * the record). The resend is kept as written and the person is shown no
 * warning.
 */
export function letterBackOutlineWriteNotes(markdown: string): WriteNotes & { words: number } {
  const hard: string[] = [];
  const B = LETTER_BACK_BUDGETS;
  const sections = parseOutlineDocument(markdown, []).topics;
  const saying = sections.findIndex((s) => s.key === LETTER_BACK_SAYING.key);
  const leave = sections.findIndex((s) => s.key === LETTER_BACK_LEAVE.key);
  if (saying === -1) hard.push(`"${LETTER_BACK_SAYING.heading}" is not written: one plain sentence, first`);
  else {
    if (saying !== 0) hard.push(`"${LETTER_BACK_SAYING.heading}" is not the first section`);
    const words = countPageWords(sections[saying].markdown);
    if (words > B.saying) hard.push(`"${LETTER_BACK_SAYING.heading}" is ${words} words against a budget of ${B.saying}`);
  }
  if (leave !== -1 && leave !== sections.length - 1) hard.push(`"${LETTER_BACK_LEAVE.heading}" is not the last section`);
  const moves = sections.filter((_, i) => i !== saying && i !== leave);
  if (moves.length < B.movesMin || moves.length > B.movesMax) hard.push(`${moves.length} move(s); the letter goes in ${B.movesMin} or ${B.movesMax}`);
  for (const move of moves) {
    const words = countPageWords(move.markdown);
    if (words > B.move) hard.push(`"${move.heading}" is ${words} words against a budget of ${B.move}`);
    const lines = sectionLines(move.markdown).length;
    if (lines > B.moveLines) hard.push(`"${move.heading}" has ${lines} lines; a move has at most ${B.moveLines}`);
  }
  for (const section of sections) {
    if (/^\d/.test(section.heading)) hard.push(`"${section.heading}" is numbered; headings carry no numbers`);
  }
  if (/:ref\{/.test(markdown)) hard.push("a citation: put the sender's older words in the line as their words, with no citation");
  return { hard, soft: [], words: countPageWords(markdown) };
}

export const LETTER_BACK_OUTLINE_TOOL: ToolDefinition = {
  name: "write_outline",
  description:
    "The whole outline, once: What you're saying, the three or four moves, then Leave for another letter. Code counts it and may send it back once with the counts; send it again whole, and the resend is accepted as written.",
  inputSchema: {
    type: "object",
    properties: { markdown: { type: "string", description: "The outline as a markdown document." } },
    required: ["markdown"],
  },
};

/** What the call is given. The letter read is one the writer was shown;
 * the sender's words are the sender's own, from the project's record.
 * No brief, no other node, no people, no purpose: nowhere to put them. */
export type LetterBackOutlineTextInput = {
  letterTitle: string;
  today: string;
  writerName: string;
  reflection: string;
  letterRead: { title: string; fromName: string | null; text: string };
  senderWords: readonly { date: string; quote: string }[];
  skill: string;
  provider?: LlmProvider;
  log?: (line: string) => void;
  checkCancelled?: () => Promise<void>;
};

export function buildLetterBackOutlineSystemPrompt(skill: string, input: Pick<LetterBackOutlineTextInput, "letterTitle" | "today" | "writerName" | "reflection" | "letterRead" | "senderWords">): string {
  const sender = input.letterRead.fromName ?? "the sender";
  return [
    "You are GraphLog's outline step, turning what someone said after reading a letter into the outline they write their own letter from, per the instructions below. You work only through the tool: write_outline, the whole outline in one call. You are given the letter they read, what they said, and the sender's own older words where there are any. Write nothing outside the tool call.",
    "",
    skill,
    "",
    "---",
    "",
    `Today's actual date: ${input.today}`,
    "",
    `The letter being written: "${input.letterTitle}".`,
    `The person writing it, whose reflection this is: ${input.writerName}.`,
    "",
    `The letter they read, "${input.letterRead.title}", from ${sender}:`,
    "",
    input.letterRead.text.trim(),
    "",
    "---",
    "",
    `${input.writerName}'s reflection on it, their words, unedited:`,
    "",
    input.reflection.trim(),
    "",
    "---",
    "",
    `${sender}'s own older words on this project, each with the day it was said:`,
    "",
    input.senderWords.length > 0 ? input.senderWords.map((w) => `${w.date}: ${w.quote.trim()}`).join("\n\n") : "(None on the record.)",
  ].join("\n");
}

/** The model's half for a letter back. No database. */
export async function letterBackOutlineText(input: LetterBackOutlineTextInput): Promise<OutlineTextResult> {
  const provider = input.provider ?? AnthropicProvider.forStage("brief");
  const result = await writeWholeDocument({
    provider,
    system: buildLetterBackOutlineSystemPrompt(input.skill, input),
    firstMessage: `Write the outline for the letter "${input.letterTitle}" from ${input.writerName}'s reflection, whole, in one write_outline call.`,
    tool: LETTER_BACK_OUTLINE_TOOL,
    what: "outline",
    maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
    log: input.log,
    checkCancelled: input.checkCancelled,
    notes: (markdown) => {
      const { hard, soft } = letterBackOutlineWriteNotes(markdown);
      return { hard, soft };
    },
  });
  const parsed = result.markdown ? parseOutlineDocument(result.markdown, []) : { topics: [], tail: new Map<string, OutlineSection>(), order: [] };
  const content = assembleOutline(parsed);
  return {
    content,
    topics: parsed.topics.map((t) => t.heading),
    bounced: result.bouncedWith,
    unmatched: [],
    words: countPageWords(content),
    incomplete: result.incomplete,
    usage: result.usage,
    model: result.model,
    turns: result.turns,
  };
}

/**
 * What a letter-back outline may be given, or null when the letter read
 * can no longer stand behind it: the reflection's speaker can't open it
 * any more (archived, their house changed, off the project), or it has
 * left this project. Asked again at every run, whoever clicked. The
 * sender's older words are the nodes logged under the sender's account,
 * and are read only for a speaker in the guides' house: nobody in the
 * clients' house is handed anything from the graph.
 */
async function letterBackInputs(projectFolder: VaultFolder, readLetterId: string, speakerId: string, log: (line: string) => void): Promise<Pick<LetterBackOutlineTextInput, "letterRead" | "senderWords"> | null> {
  const read = await resolveSentLetterForMember(readLetterId, speakerId);
  if (!read || read.project._id !== projectFolder._id) return null;
  const senderId = letterSenderId(read.file);
  const sender = senderId ? (await getHumansById([senderId]))[0] : undefined;
  const letterRead = { title: letterTitle(read.file), fromName: sender ? firstName(sender) : null, text: splitFrontmatter(sentCopyOf(read.file)?.content ?? "").body };
  const speakerRole = await getProjectRole(projectFolder, speakerId);
  if (!senderId || houseOf(speakerRole?.role) !== "guides") return { letterRead, senderWords: [] };
  const graphFolder = await findProjectGraphFolder(projectFolder);
  if (!graphFolder) return { letterRead, senderWords: [] };
  const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
  const { allNodes, issues } = await loadGraphNodes(files);
  for (const issue of issues) log(`outline: ${issue}.`);
  const senderWords = allNodes
    .filter((n) => n.authorHumanId === senderId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)
    .map((n) => ({ date: n.date, quote: n.quote }));
  return { letterRead, senderWords };
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
 * Writes one letter's outline from the talk-through on its row, and from
 * the brief beside it when the letter has one. With no brief the graph
 * is never opened: the call is the talk alone (`outlineFromTalkText`).
 * Asked for by whoever is writing the letter; never by the pipeline.
 */
export async function runOutline(projectFolder: VaultFolder, letterFileId: string, actingHumanId: string, opts: RunOutlineOptions = {}): Promise<OutlineRunResult> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  if (!opts.provider && !isGraphLogAgentConfigured()) return { ok: false, error: "GraphLog isn't configured (missing ANTHROPIC_API_KEY)" };

  const file = await getFileRefById(letterFileId);
  const home = file && !file.archived_at ? await letterHome(file) : null;
  if (!file || !home || home.project._id !== projectFolder._id) return { ok: false, error: "That letter is not on this project" };
  const row = await getLetterBriefRow(letterFileId);
  if (!row?.talk_through?.trim()) return { ok: false, error: "Nothing has been talked through yet." };
  const title = letterTitle(file);
  const talk = row.talk_through;

  const ownSkill = await getProjectStageSkill(projectFolder, "OUTLINE.md");
  if (ownSkill !== null && isSkipInstruction(ownSkill)) return { ok: false, error: "skills/OUTLINE.md says skip, so no outline was written" };
  const writer = (await getHumansById([row.talk_through_by_human_id ?? actingHumanId]))[0];
  const today = new Date().toISOString().slice(0, 10);
  const checkCancelled = () => throwIfGraphLogCancelled(projectFolder._id);

  let write: () => Promise<OutlineTextResult>;
  // A letter started from what its writer said about a letter they read,
  // with no brief: that letter and its sender's older words go in beside
  // the reflection. When the letter read can't stand behind it any more,
  // the outline is made from the talk alone, like any letter with no brief.
  const back = !row.content && row.reflects_on_letter_file_id ? await letterBackInputs(projectFolder, row.reflects_on_letter_file_id, row.talk_through_by_human_id ?? actingHumanId, log) : null;
  if (back) {
    const skill = await getEffectiveGraphLogDefaultSkill("outlineLetterBack");
    const writerName = writer ? firstName(writer) : "the writer";
    log(`outline: writing the outline for "${title}" from ${writerName}'s reflection on "${back.letterRead.title}" and ${back.senderWords.length} of the sender's older node(s).`);
    write = () => letterBackOutlineText({ letterTitle: title, today, writerName, reflection: talk, ...back, skill, provider: opts.provider, log, checkCancelled });
  } else if (!row.content) {
    // No brief: the talk and nothing else. The default skill alone, so
    // nothing a project keeps in `skills/` rides along either.
    const skill = await getEffectiveGraphLogDefaultSkill("outlineTalk");
    const writerName = writer ? firstName(writer) : "the writer";
    log(`outline: writing the outline for "${title}" from ${writerName}'s talk-through alone (no brief, nothing from the graph).`);
    write = () => outlineFromTalkText({ letterTitle: title, today, writerName, talk, skill, provider: opts.provider, log, checkCancelled });
  } else {
    const brief = row.content;
    const stageSkill = ownSkill ?? (await getEffectiveGraphLogDefaultSkill("outline"));
    const { content: skill } = composeStageSkill(stageSkill, await getProjectStageSkill(projectFolder, "SKILL.md"), await listExtraSkillFiles(projectFolder));
    const graphFolder = await findProjectGraphFolder(projectFolder);
    if (!graphFolder) return { ok: false, error: "This project has no graph yet." };
    const { files } = await listFolderChildren(projectFolder.human_id, graphFolder._id);
    const { allNodes, issues } = await loadGraphNodes(files);
    for (const issue of issues) log(`outline: ${issue}.`);
    const nodes = [...allNodes].sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
    const guideName = writer ? firstName(writer) : "the guide";
    const peopleLines = await peopleLinesFor(projectFolder);
    log(`outline: writing the outline for "${title}" from ${guideName}'s talk-through and ${nodes.length} node(s).`);
    write = () => outlineText({ letterTitle: title, purpose: file.purpose?.trim() ?? "", today, guideName, brief, talk, peopleLines, nodes, skill, provider: opts.provider, log, checkCancelled });
  }

  try {
    const result = await write();
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
    log(`outline: "${title}": ${result.topics.length} topic(s), ${result.words} words, ${result.bounced.length ? "sent back once" : "written first time"}, ${result.unmatched.length} citation(s) matching no node, ${result.turns} turn(s), ${result.usage.inputTokens} token(s) in and ${result.usage.outputTokens} out${result.incomplete.length ? `; not finished: ${result.incomplete.join("; ")}` : ""}.`);
    return { ok: true, topics: result.topics, bounced: result.bounced, unmatched: result.unmatched, words: result.words, incomplete: result.incomplete };
  } catch (err) {
    if (err instanceof GraphLogCancelledError) throw err;
    await recordGraphLogUsage({ runId: opts.runId, humanId: actingHumanId, projectFolderId: projectFolder._id, stage: "brief", kind: "outline", durationMs: Date.now() - started, outcome: "error", errorKind: classifyGraphLogError(err) });
    throw err;
  }
}

// ─── The writer's side: the talk, the outline asked for, the outline edited ──

export type TalkResult = { ok: true; jobId: string } | { ok: false; status: 400 | 403 | 409; error: string };

/** Autosave of what the writer has typed and not yet handed over. */
export async function saveTalkDraft(projectFolder: VaultFolder, letter: FileRef, draft: string): Promise<void> {
  await writeLetterBriefRow(letter._id, { letter_file_id: letter._id, project_folder_id: projectFolder._id, talk_draft: draft });
}

/**
 * The writer's click: their talk is kept on the letter's row and the
 * outline is asked for, with or without a brief. Nothing goes onto a
 * Card here: the talk waits for the letter to be sent (`landTalkThrough`).
 * Someone who could not put it on the record then is told now. One talk
 * per letter; asking again is `requestOutline`.
 */
export async function sendTalkThrough(
  projectFolder: VaultFolder,
  letter: FileRef,
  actor: { humanId: string; features: readonly Feature[] },
  input: { text: string },
): Promise<TalkResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, status: 400, error: "Say something first." };
  const row = await getLetterBriefRow(letter._id);
  // One talk per letter, held here and not only by the page hiding the
  // box: a second would clear the Card the first is on, and Send would
  // write those words to the record again.
  if (row?.talk_through?.trim()) return { ok: false, status: 409, error: "This letter has been talked through already." };
  if (await jobIsRunning(row?.outline_pending_job_id)) return { ok: false, status: 409, error: "The outline is being written. Give it a few minutes." };
  if (!actor.features.includes("dailyLog")) return { ok: false, status: 403, error: "You're not on this project's log, so your talk-through can't go on its record." };
  const jobId = await enqueueGraphLogJob("brief", { actingHumanId: actor.humanId, projectFolderId: projectFolder._id, fileId: letter._id, kind: "outline" });
  await writeLetterBriefRow(letter._id, {
    letter_file_id: letter._id,
    project_folder_id: projectFolder._id,
    talk_draft: null,
    talk_through: text,
    talk_through_at: new Date().toISOString(),
    talk_through_by_human_id: actor.humanId,
    // Set when it lands, at Send: the day it went on the record, and the Card.
    talk_through_date: null,
    talk_through_card_file_id: null,
    outline_pending_job_id: jobId,
  });
  return { ok: true, jobId };
}

/** Whether a letter has a talk-through still waiting for Send. */
export function talkIsWaiting(row: { talk_through?: string | null; talk_through_card_file_id?: string | null } | null | undefined): boolean {
  return !!row?.talk_through?.trim() && !row.talk_through_card_file_id;
}

/**
 * The letter was sent, so its talk-through goes on the record: onto its
 * speaker's Card for the send day on this project, as their words
 * (`appendToCard`, the daily log's own rules, read for the speaker and
 * not for whoever sent), and that day is copied into the project the way
 * a taken suggestion is, so the next run finds it. Once: a talk that
 * already has its Card (every one given before 2026-11-05 landed when it
 * was given) is left alone, and so is a send again. Called by
 * `sendLetter` and by nothing else.
 */
export async function landTalkThrough(projectFolder: VaultFolder, letterFileId: string, date: string): Promise<{ landed: boolean }> {
  const row = await getLetterBriefRow(letterFileId);
  if (!row || !talkIsWaiting(row) || !row.talk_through_by_human_id) return { landed: false };
  const speaker = row.talk_through_by_human_id;
  const features = (await getProjectRole(projectFolder, speaker))?.features ?? [];
  // No longer on the project's log: their words stay on the letter's row.
  if (!features.includes("dailyLog")) return { landed: false };
  const card = await appendToCard({ humanId: speaker, date, projectFolderId: projectFolder._id, text: row.talk_through!.trim(), features });
  await writeLetterBriefRow(letterFileId, { letter_file_id: letterFileId, project_folder_id: projectFolder._id, talk_through_date: date, talk_through_card_file_id: card.fileId });
  try {
    await runDailyLogSync(projectFolder._id, { date });
  } catch {
    // The next run copies the day.
  }
  return { landed: true };
}

/** "Write it again": the same talk, a new outline. */
export async function requestOutline(projectFolder: VaultFolder, letter: FileRef, actingHumanId: string): Promise<TalkResult> {
  const row = await getLetterBriefRow(letter._id);
  if (!row?.talk_through?.trim()) return { ok: false, status: 400, error: "Talk it through first." };
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
