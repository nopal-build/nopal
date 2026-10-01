/**
 * Sow: the stage that turns one file from someone's seed packet into
 * seed (Austin, 2026-09-30: "anyone on a project can fill a seed packet,
 * and a guide sows it into seed"). It does what was done by hand for
 * Campbell: splits a file by the day things were said, keeps people's
 * words exactly, leaves out chatter and AI framing, and writes plain
 * facts under Noted. `SOW.md` is its skill.
 *
 * Who decides what. The model: which day a line belongs to, who said it
 * and whether it is sure, chatter versus record, the Noted facts. Code:
 * that every quoted line is in the file word for word, that a date is a
 * date, and (in `runSow`, with the project in hand) whether a line
 * matches a Card, is already in the seed, or needs a guide's yes or no.
 * A person: what went into the packet, pressing Sow, each answer.
 *
 * `sowText` is the model's half and touches no database: a file's text
 * in, proposed lines out. The week grid runs it directly against the
 * hand-built Campbell week (`sowScore.ts`), which is how the stage's
 * model was chosen.
 *
 * One conversation per part of the file. A long file is cut at blank
 * lines into parts a model can read whole; each part is its own short
 * conversation, so a cut-off turn loses at most one call and the loop
 * simply asks again. The tools collect in memory and write nothing, so
 * several calls in one turn are all taken.
 */

import { AnthropicProvider } from "./anthropicProvider.server";
import { completedToolCalls } from "./llmProvider";
import type { LlmMessage, LlmProvider, LlmUsage, ToolDefinition } from "./llmProvider";
import { listCardsForProject } from "./dailyLog.server";
import { downloadFileBytes } from "./file.server";
import { getEffectiveGraphLogDefaultSkill } from "./graphLogDefaults.server";
import { classifyGraphLogError, recordGraphLogUsage } from "./graphLogMetrics.server";
import { GraphLogCancelledError, throwIfGraphLogCancelled } from "./graphLogQueue.server";
import { firstName } from "./humanNames";
import { enqueueRenditionsJob } from "./mediaQueue.server";
import { getHumansById } from "./humans.server";
import { composeStageSkill, getProjectStageSkill, isSkipInstruction, listExtraSkillFiles } from "./projectN02.server";
import {
  addSeedDocumentObject,
  classifyPreparedSeedFile,
  mergePreparedSeedDay,
  mergeSeedDay,
  moveNotedToSpeaker,
  parseSeedDayDoc,
  readSeedDayFile,
  seedBulletKey,
  seedMembers,
  seedSpeakerNames,
  writeSeedDayFile,
  writeSeedDocumentFile,
  writeSeedPeopleFile,
  type SeedAddition,
} from "./seed.server";
import {
  createSeedQuestion,
  getSeedQuestion,
  isPacketText,
  listPacketFiles,
  markPacketSown,
  setSeedQuestionDecided,
  type SeedPacketFile,
  type SeedQuestionKind,
} from "./seedPackets.server";
import type { VaultFolder } from "./vault.types";

export type SowLine = {
  date: string;
  speaker: string;
  text: string;
  speakerSure: boolean;
  dateSure: boolean;
};

export type SowNoted = { date: string; text: string; dateSure: boolean };

export type SowFileKind = { kind: "conversation" | "document"; date: string | null; author: string | null };

export type SowTextResult = {
  fileKind: SowFileKind | null;
  lines: SowLine[];
  noted: SowNoted[];
  /** Calls code refused, with why: not verbatim, not a date. Counted, so
   * a model that paraphrases shows up as a number. */
  refused: { tool: string; reason: string; text: string }[];
  usage: LlmUsage;
  model: string | null;
  turns: number;
  /** A part that ran out of turns while still adding. */
  incomplete: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** About six thousand tokens of source per conversation. */
const PART_CHARS = 24_000;
/** Bounds one part's conversation, never the file. */
const MAX_TURNS_PER_PART = 12;

export const SOW_TOOLS: ToolDefinition[] = [
  {
    name: "file_kind",
    description:
      "Say what this file is, once, before anything else. `conversation`: things people said on particular days, to be split into days. `document`: a standalone report, estimate, inspection or the like; give the date written inside it and its author if it names one, and add no lines from it.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["conversation", "document"] },
        date: { type: "string", description: "YYYY-MM-DD, for a document: the date written inside it. Omit if it states none." },
        author: { type: "string", description: "For a document: who wrote it, if it says. Omit otherwise." },
      },
      required: ["kind"],
    },
  },
  {
    name: "add_line",
    description:
      "One message or note entry, whole, as one person wrote it, on the day they wrote it. Never split or trimmed. `text` must be their words exactly as they appear in the file; it is checked word for word and refused otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD: the day it was said." },
        speaker: { type: "string", description: "Who said it, by the name the file uses." },
        text: { type: "string", description: "Their words, copied exactly from the file." },
        speaker_sure: { type: "boolean", description: "False when the file does not plainly say who this is." },
        date_sure: { type: "boolean", description: "False when the file states no date and this one is your estimate." },
        source: { type: "string", description: "A few words on where in the file this came from: the thread or note's name." },
      },
      required: ["date", "speaker", "text", "speaker_sure", "date_sure"],
    },
  },
  {
    name: "add_noted",
    description:
      "A fact worth keeping that nobody said in those words: a number, a date, who did what, a decision. One plain sentence in your words. Not for anything a line you added already carries.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD: the day the fact belongs to." },
        text: { type: "string" },
        date_sure: { type: "boolean" },
      },
      required: ["date", "text", "date_sure"],
    },
  },
];

/** Whitespace collapsed, list markers at line starts dropped: the form a
 * line and the file are compared in. Joining sub-bullets onto one line
 * is the one change to a person's words the skill allows, and this is
 * what makes that change invisible to the check and nothing else. */
export function sowFlat(value: string): string {
  return value
    .replace(/^[ \t]*[-*][ \t]+/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `text` is in the file word for word. */
export function isVerbatim(text: string, flatFile: string): boolean {
  const needle = sowFlat(text);
  return needle.length > 0 && flatFile.includes(needle);
}

// ─── Already logged? ────────────────────────────────────────────────────
//
// Austin: "You will have to compare the cards to my daily logs for what
// already exists in the graphlog and doesn't need adding." Inside the app
// that is a count, not a judgment: a line's words against every Card on
// the project within two days either side. A match is never a silent
// drop; it is held out and a guide is asked.

/** How much of a line has to be in a Card for the two to count as the
 * same words, and how long a run of words is compared. Values somebody
 * maintains: tuned on the Campbell dedupe, where the matches were
 * near-verbatim restatements and the misses shared a topic, not a
 * sentence. */
export const CARD_MATCH = { runWords: 4, share: 0.8, minWords: 8, days: 2 } as const;

function matchWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/::?\w+\{[^}]*\}/g, " ")
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Whether a line says what a Card already says: for a line of eight
 * words or more, four in five of its four-word runs appear in the Card;
 * for a shorter one, the whole line does. Pure. */
export function matchesCard(line: string, cardText: string): boolean {
  const words = matchWords(line);
  if (words.length < 3) return false;
  const card = ` ${matchWords(cardText).join(" ")} `;
  if (words.length < CARD_MATCH.minWords) return card.includes(` ${words.join(" ")} `);
  let runs = 0;
  let found = 0;
  for (let i = 0; i + CARD_MATCH.runWords <= words.length; i++) {
    runs += 1;
    if (card.includes(` ${words.slice(i, i + CARD_MATCH.runWords).join(" ")} `)) found += 1;
  }
  return runs > 0 && found / runs >= CARD_MATCH.share;
}

/** The first Card within two days either side that already says a line. */
export function findLoggedCard<T extends { date: string; content: string }>(line: { date: string; text: string }, cards: readonly T[]): T | null {
  const day = Date.parse(`${line.date}T00:00:00Z`);
  for (const card of cards) {
    const gap = Math.abs(Date.parse(`${card.date}T00:00:00Z`) - day) / 86_400_000;
    if (gap <= CARD_MATCH.days && matchesCard(line.text, card.content)) return card;
  }
  return null;
}

/** A long file in parts a model reads whole, cut at blank lines (and at
 * `## ` headings, which a notes file uses between days). Pure. */
export function splitForSow(text: string, maxChars = PART_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const blocks = text.split(/\n(?=\s*\n|## )/);
  const parts: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length + 1 > maxChars) {
      parts.push(current);
      current = "";
    }
    // A single block longer than a part is cut by lines, never mid-line.
    if (block.length > maxChars) {
      for (const line of block.split("\n")) {
        if (current && current.length + line.length + 1 > maxChars) {
          parts.push(current);
          current = "";
        }
        current = current ? `${current}\n${line}` : line;
      }
      continue;
    }
    current = current ? `${current}\n${block}` : block;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function buildSowSystemPrompt(skill: string): string {
  return `You are GraphLog's sow step, reading one file from a person's seed packet and giving it the shape of a daily log (who wrote what, on which day, in their words) for the graph stage to read, per the project's own instructions below. You work only through the tools: file_kind once, then add_line and add_noted. Never write a line's text from memory; copy it from the file, since code checks it word for word and refuses anything else. Stop calling tools when nothing is left.\n\n${skill}`;
}

export function buildSowUserPrompt(input: {
  fileName: string;
  uploaderName: string;
  knownNames: readonly string[];
  part: string;
  partNumber: number;
  partCount: number;
  alreadyKind: SowFileKind | null;
  /** The day the file went into the packet, `YYYY-MM-DD`. */
  addedOn?: string | null;
}): string {
  return [
    `File: "${input.fileName}", added by ${input.uploaderName}${input.addedOn ? ` on ${input.addedOn}` : ""}.`,
    // A thread says "8/5", almost never "8/5/2026". Without an anchor
    // every such date is honestly an estimate, and the first live packet
    // turned eight lines into six "when was this?" questions. The day
    // the file was added is a fact code holds, and it settles the year.
    input.addedOn
      ? `Where the file gives a month and day with no year, the year is the latest one that keeps the date on or before ${input.addedOn}. That is the file stating the date, so \`date_sure\` stays true; it is false only when the file gives no day at all.`
      : null,
    input.knownNames.length > 0
      ? `People already known on this project: ${input.knownNames.join(", ")}.`
      : "Nobody is known on this project yet beyond the person who added the file.",
    input.partCount > 1
      ? `This is part ${input.partNumber} of ${input.partCount} of the file.${input.alreadyKind ? ` You already said the file is a ${input.alreadyKind.kind}; do not call file_kind again.` : ""}`
      : null,
    "",
    "The file:",
    "",
    input.part,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The model's half of sowing: one file's text in, proposed lines out.
 * No database, no files written.
 */
export async function sowText(input: {
  text: string;
  fileName: string;
  uploaderName: string;
  knownNames: readonly string[];
  skill: string;
  /** The day the file was added, which settles a date written with no year. */
  addedOn?: string | null;
  provider?: LlmProvider;
  onTurn?: (info: { part: number; turn: number; stopReason: string; calls: number }) => void | Promise<void>;
}): Promise<SowTextResult> {
  const provider = input.provider ?? AnthropicProvider.forStage("sow");
  const system = buildSowSystemPrompt(input.skill);
  const flatFile = sowFlat(input.text);
  const parts = splitForSow(input.text);

  const result: SowTextResult = {
    fileKind: null,
    lines: [],
    noted: [],
    refused: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    model: null,
    turns: 0,
    incomplete: [],
  };
  const seenLines = new Set<string>();
  const seenNoted = new Set<string>();

  const execute = (name: string, args: Record<string, unknown>): string => {
    if (name === "file_kind") {
      const kind = args.kind === "document" ? "document" : args.kind === "conversation" ? "conversation" : null;
      if (!kind) return "Error: kind must be conversation or document.";
      const date = asString(args.date);
      if (!result.fileKind) result.fileKind = { kind, date: DATE_RE.test(date) ? date : null, author: asString(args.author) || null };
      return kind === "document"
        ? "Noted: a document. Add no lines from it; stop here."
        : "Noted: a conversation. Go on with add_line and add_noted.";
    }
    if (name === "add_line") {
      const date = asString(args.date);
      const speaker = asString(args.speaker);
      const text = asString(args.text);
      if (!DATE_RE.test(date)) {
        result.refused.push({ tool: name, reason: "date", text });
        return "Not added: date must be YYYY-MM-DD.";
      }
      if (!speaker) {
        result.refused.push({ tool: name, reason: "speaker", text });
        return "Not added: a line needs a speaker. If nobody said it in these words, it is add_noted.";
      }
      if (!isVerbatim(text, flatFile)) {
        result.refused.push({ tool: name, reason: "not verbatim", text });
        return "Not added: that text is not in the file word for word. Copy the person's words exactly as the file has them (you may leave off surrounding quotation marks), or leave the line out.";
      }
      const key = `${date}|${speaker.toLowerCase()}|${sowFlat(text)}`;
      if (seenLines.has(key)) return "Already added.";
      seenLines.add(key);
      result.lines.push({ date, speaker, text: sowFlat(text), speakerSure: args.speaker_sure !== false, dateSure: args.date_sure !== false });
      return "Added.";
    }
    if (name === "add_noted") {
      const date = asString(args.date);
      const text = asString(args.text).replace(/\s+/g, " ");
      if (!DATE_RE.test(date)) {
        result.refused.push({ tool: name, reason: "date", text });
        return "Not added: date must be YYYY-MM-DD.";
      }
      if (!text) return "Not added: empty.";
      const key = `${date}|${text.toLowerCase()}`;
      if (seenNoted.has(key)) return "Already added.";
      seenNoted.add(key);
      result.noted.push({ date, text, dateSure: args.date_sure !== false });
      return "Added.";
    }
    return `Error: no tool named ${name}.`;
  };

  for (let p = 0; p < parts.length; p++) {
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: buildSowUserPrompt({
          fileName: input.fileName,
          uploaderName: input.uploaderName,
          knownNames: input.knownNames,
          part: parts[p],
          partNumber: p + 1,
          partCount: parts.length,
          alreadyKind: result.fileKind,
          addedOn: input.addedOn ?? null,
        }),
      },
    ];
    let finished = false;
    for (let turn = 0; turn < MAX_TURNS_PER_PART; turn++) {
      const response = await provider.complete({ system, messages, tools: SOW_TOOLS, cacheSystemPrompt: p > 0 || turn > 0 });
      result.turns += 1;
      result.model = response.model;
      result.usage.inputTokens += response.usage.inputTokens;
      result.usage.outputTokens += response.usage.outputTokens;
      result.usage.cacheReadTokens = (result.usage.cacheReadTokens ?? 0) + (response.usage.cacheReadTokens ?? 0);
      result.usage.cacheWriteTokens = (result.usage.cacheWriteTokens ?? 0) + (response.usage.cacheWriteTokens ?? 0);
      // A cut-off turn keeps every call it finished (the last one is the
      // half-written one); the conversation goes on from their results.
      const calls = completedToolCalls(response.toolCalls, response.stopReason);
      await input.onTurn?.({ part: p + 1, turn: turn + 1, stopReason: response.stopReason, calls: calls.length });
      if (calls.length === 0) {
        if (response.stopReason === "max_tokens") {
          messages.push({ role: "assistant", content: response.text ?? "", toolCalls: [] });
          messages.push({ role: "user", content: "That turn was cut off before a tool call finished. Go on from where you were, a few calls per turn." });
          continue;
        }
        // "other" is how the provider reports a refusal or an API-side
        // stop. It is not the model saying the part is done, and a part
        // that ended that way must not read as a clean, empty file.
        if (response.stopReason === "other") {
          result.incomplete.push(`part ${p + 1} of ${parts.length} of "${input.fileName}" stopped before the model finished (declined or interrupted)`);
        }
        finished = true;
        break;
      }
      messages.push({ role: "assistant", content: response.text ?? "", toolCalls: calls });
      for (const call of calls) {
        messages.push({ role: "tool_result", toolCallId: call.id, content: execute(call.name, call.input) });
      }
      if (result.fileKind?.kind === "document") {
        finished = true;
        break;
      }
      if (response.stopReason !== "tool_use" && response.stopReason !== "max_tokens") {
        finished = true;
        break;
      }
    }
    if (!finished) result.incomplete.push(`part ${p + 1} of ${parts.length} of "${input.fileName}" was still adding after ${MAX_TURNS_PER_PART} turns`);
    if (result.fileKind?.kind === "document") break;
  }
  return result;
}

// ─── What code does with the model's proposals ──────────────────────────

/** The name the project already uses for a speaker: a known name with
 * the same first name, or null when nobody by that name is known. */
export function knownSpeaker(name: string, known: readonly string[]): string | null {
  const first = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const wanted = first(name);
  if (!wanted) return null;
  return known.find((k) => k.trim().toLowerCase() === name.trim().toLowerCase()) ?? known.find((k) => first(k) === wanted) ?? null;
}

export type SowQuestionPlan = {
  kind: SeedQuestionKind;
  date: string;
  text: string;
  speaker: string | null;
  speakerSettled: boolean;
  card: { date: string; humanId: string } | null;
};

export type SowPlan = {
  /** What goes into each seed day now. */
  days: Map<string, SeedAddition>;
  /** What waits for a guide. */
  questions: SowQuestionPlan[];
  /** Lines already in the seed, written by nobody twice. */
  alreadyThere: number;
};

/**
 * Where each proposed line goes. In this order, the first that applies:
 * already in that day's seed (skipped); matches a Card within two days
 * (held out, "already logged?"); no sure date (held out, "when was
 * this?"); no sure or known speaker (written under Noted, "who said
 * this?"); otherwise under the speaker. A wrong name never reaches the
 * seed: an unsure line is nobody's words until a guide says whose. Pure.
 */
export function planSow(input: {
  lines: readonly SowLine[];
  noted: readonly SowNoted[];
  /** Members' names and the names the seed already speaks under. */
  known: readonly string[];
  cards: readonly { date: string; humanId: string; content: string }[];
  /** Whether a line is already in that day of the seed. */
  present: (date: string, text: string) => boolean;
  src: string;
}): SowPlan {
  const plan: SowPlan = { days: new Map(), questions: [], alreadyThere: 0 };
  const day = (date: string): SeedAddition => {
    let d = plan.days.get(date);
    if (!d) {
      d = { lines: [], noted: [] };
      plan.days.set(date, d);
    }
    return d;
  };
  for (const line of input.lines) {
    const match = knownSpeaker(line.speaker, input.known);
    const settled = line.speakerSure && match !== null;
    const speaker = match ?? line.speaker;
    if (input.present(line.date, line.text)) {
      plan.alreadyThere += 1;
      continue;
    }
    const card = findLoggedCard(line, input.cards);
    if (card) {
      plan.questions.push({ kind: "logged", date: line.date, text: line.text, speaker, speakerSettled: settled, card: { date: card.date, humanId: card.humanId } });
      continue;
    }
    if (!line.dateSure) {
      plan.questions.push({ kind: "when", date: line.date, text: line.text, speaker, speakerSettled: settled, card: null });
      continue;
    }
    if (!settled) {
      day(line.date).noted.push(line.text);
      plan.questions.push({ kind: "who", date: line.date, text: line.text, speaker, speakerSettled: false, card: null });
      continue;
    }
    day(line.date).lines.push({ speaker, text: line.text, src: input.src });
  }
  for (const fact of input.noted) {
    if (input.present(fact.date, fact.text)) {
      plan.alreadyThere += 1;
      continue;
    }
    if (!fact.dateSure) {
      plan.questions.push({ kind: "when", date: fact.date, text: fact.text, speaker: null, speakerSettled: false, card: null });
      continue;
    }
    day(fact.date).noted.push(fact.text);
  }
  return plan;
}

// ─── The stage ──────────────────────────────────────────────────────────

export type SowRunResult =
  | {
      ok: true;
      /** True when there was nothing to sow, or SOW.md says skip. */
      skipped: boolean;
      files: number;
      days: string[];
      lines: number;
      documents: number;
      questions: number;
      incomplete: string[];
    }
  | { ok: false; error: string };

export interface RunSowOptions {
  provider?: LlmProvider;
  log?: (line: string) => void;
}

/** Past this many questions from one run, the count stands out: the
 * stage is asking what it should decide, or a packet needed a cleaner
 * source (the seed packets guide). Never a cap. */
export const SOW_QUESTION_NOTICE = 10;

async function packetText(file: SeedPacketFile): Promise<string | null> {
  if (typeof file.content === "string") return file.content;
  if (!file.s3_key) return null;
  return (await downloadFileBytes(file.s3_key)).toString("utf8");
}

/**
 * Sows every packet file on the project that has not been sown: each is
 * read once, turned into seed days (added to a day, never replacing
 * one) or a seed document, and stamped. A file that fails is left
 * waiting and named; the others still go in.
 */
export async function runSow(projectFolder: VaultFolder, actingHumanId: string, opts: RunSowOptions = {}): Promise<SowRunResult> {
  const log = opts.log ?? (() => {});
  const waiting = (await listPacketFiles(projectFolder._id)).filter((f) => !f.sown_at);
  if (waiting.length === 0) {
    log("sow: nothing in the seed packets is waiting.");
    return { ok: true, skipped: true, files: 0, days: [], lines: 0, documents: 0, questions: 0, incomplete: [] };
  }

  // A project with no SOW.md (every project made before this stage)
  // uses the default, so a guide can sow without a reseed.
  const ownSkill = await getProjectStageSkill(projectFolder, "SOW.md");
  if (ownSkill !== null && isSkipInstruction(ownSkill)) {
    const reason = "skills/SOW.md says skip, so no seed packet was read";
    log(`sow: ${reason}.`);
    return { ok: true, skipped: true, files: 0, days: [], lines: 0, documents: 0, questions: 0, incomplete: [reason] };
  }
  const stageSkill = ownSkill ?? (await getEffectiveGraphLogDefaultSkill("sow"));
  const { content: skill } = composeStageSkill(stageSkill, await getProjectStageSkill(projectFolder, "SKILL.md"), await listExtraSkillFiles(projectFolder));

  const members = await seedMembers(projectFolder);
  const memberNames = members.map((m) => firstName({ name: m.name, email: m.email }));
  const cards = (await listCardsForProject(projectFolder._id)).filter((c) => c.content.trim());
  const uploaders = new Map((await getHumansById([...new Set(waiting.map((f) => f.human_id))])).map((h) => [h._id, firstName(h)]));

  const incomplete: string[] = [];
  const daysWritten = new Set<string>();
  let files = 0;
  let lines = 0;
  let documents = 0;
  let questions = 0;

  for (const file of waiting) {
    await throwIfGraphLogCancelled(projectFolder._id);
    const uploader = uploaders.get(file.human_id) ?? "Someone";
    const addedOn = file.created_at.slice(0, 10);
    const started = Date.now();
    try {
      // A standalone file that is not text: kept as a document as it is.
      // The describer and the filing stage read it on the next run.
      if (!isPacketText(file.name, file.content_type)) {
        if (!file.s3_key) throw new Error("the file has no stored bytes");
        const fileId = await addSeedDocumentObject(projectFolder, {
          name: file.name,
          s3Key: file.s3_key,
          s3Url: file.s3_url,
          contentType: file.content_type,
          size: file.size,
          contentHash: file.content_hash,
          date: addedOn,
        });
        // A photo or a video gets its thumbnail and display rendition made
        // by the worker, exactly as one attached to a daily log does:
        // without this it lands in Photos as a tile that cannot load.
        if (file.content_type.startsWith("image/") || file.content_type.startsWith("video/")) {
          await enqueueRenditionsJob(fileId).catch((err) => log(`sow: couldn't queue the renditions for "${file.name}" (${err instanceof Error ? err.message : err}).`));
        }
        await markPacketSown(file._id, { days: [], fileId });
        documents += 1;
        files += 1;
        log(`sow: "${file.name}" from ${uploader} is on the project as a ${file.content_type.startsWith("image/") ? "photo" : file.content_type.startsWith("video/") ? "video" : "file"}.`);
        continue;
      }

      const text = await packetText(file);
      if (!text || !text.trim()) {
        await markPacketSown(file._id, { days: [] });
        files += 1;
        log(`sow: "${file.name}" from ${uploader} is empty.`);
        continue;
      }

      // A file somebody prepared in seed shape is placed by code and never
      // read by the model: the judgment in it is already somebody's. Code
      // decides which files those are (`classifyPreparedSeedFile`).
      const prepared = classifyPreparedSeedFile(file.name, text);
      if (prepared) {
        if (prepared.kind === "refused") {
          incomplete.push(`"${file.name}" from ${uploader}: ${prepared.reason}`);
          log(`sow: "${file.name}" from ${uploader} was not read: ${prepared.reason}. It stays in the packet.`);
          continue;
        }
        if (prepared.kind === "people") {
          await writeSeedPeopleFile(projectFolder, text);
          await markPacketSown(file._id, { days: [] });
          files += 1;
          log(`sow: "${file.name}" from ${uploader} is the seed's people file.`);
          continue;
        }
        if (prepared.kind === "document") {
          await writeSeedDocumentFile(projectFolder, file.name.split("/").pop() ?? file.name, text, prepared.date);
          await markPacketSown(file._id, { days: [] });
          documents += 1;
          files += 1;
          log(`sow: "${file.name}" from ${uploader} is a prepared document dated ${prepared.date}.`);
          continue;
        }
        const existing = await readSeedDayFile(projectFolder, prepared.date);
        const merged = mergePreparedSeedDay(existing?.content ?? null, text);
        if (merged.added > 0) {
          await writeSeedDayFile(projectFolder, prepared.date, merged.content);
          daysWritten.add(prepared.date);
        }
        lines += merged.added;
        await markPacketSown(file._id, { days: merged.added > 0 ? [prepared.date] : [] });
        files += 1;
        log(
          `sow: "${file.name}" from ${uploader} is a prepared day for ${prepared.date}${prepared.byShape ? " (read as prepared by its shape; no `kind: seed` in its front matter)" : ""}: ${merged.added} line(s) in${merged.skipped > 0 ? `, ${merged.skipped} already there` : ""}.`,
        );
        continue;
      }

      // Known now, not at the start: a name an earlier file in this same
      // run put into the seed is known to the next one.
      const known = [...new Set([...memberNames, ...(await seedSpeakerNames(projectFolder))])];
      const result = await sowText({ text, fileName: file.name, uploaderName: uploader, knownNames: known, skill, addedOn, provider: opts.provider });
      await recordGraphLogUsage({
        humanId: actingHumanId,
        projectFolderId: projectFolder._id,
        stage: "sow",
        kind: "sow",
        model: result.model ?? undefined,
        usage: result.usage,
        durationMs: Date.now() - started,
        outcome: result.incomplete.length > 0 ? "error" : "success",
        errorKind: result.incomplete.length > 0 ? "incomplete" : undefined,
      });
      if (result.incomplete.length > 0) {
        // Left waiting: what it proposed so far is not written, so the
        // next Sow reads the whole file again rather than half of it.
        incomplete.push(...result.incomplete);
        log(`sow: "${file.name}" from ${uploader} was not finished; it stays in the packet.`);
        continue;
      }
      if (result.refused.length > 0) log(`sow: "${file.name}": ${result.refused.length} line(s) were not word for word in the file and were left out.`);

      const src = `${uploader}'s seed packet, ${file.name}`;

      if (result.fileKind?.kind === "document") {
        const date = result.fileKind.date ?? addedOn;
        const author = knownSpeaker(result.fileKind.author ?? uploader, known) ?? result.fileKind.author ?? uploader;
        const name = /\.(md|markdown)$/i.test(file.name) ? file.name : `${file.name}.md`;
        const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
        await writeSeedDocumentFile(projectFolder, name, `---\ndate: ${date}\nkind: seed-document\nauthor: ${author}\nsource: ${src}\n---\n\n${body.trim()}\n`, date);
        await markPacketSown(file._id, { days: [] });
        documents += 1;
        files += 1;
        log(`sow: "${file.name}" from ${uploader} kept as a document dated ${date}.`);
        continue;
      }

      const dayCache = new Map<string, { content: string | null; keys: Set<string> }>();
      const dayOf = async (date: string) => {
        let d = dayCache.get(date);
        if (!d) {
          const existing = await readSeedDayFile(projectFolder, date);
          const doc = existing ? parseSeedDayDoc(existing.content) : null;
          d = {
            content: existing?.content ?? null,
            keys: new Set(doc ? [...doc.sections.flatMap((sec) => sec.groups.flatMap((g) => g.bullets.map(seedBulletKey))), ...doc.noted.map(seedBulletKey)] : []),
          };
          dayCache.set(date, d);
        }
        return d;
      };
      for (const date of new Set([...result.lines.map((l) => l.date), ...result.noted.map((n) => n.date)])) await dayOf(date);

      const plan = planSow({
        lines: result.lines,
        noted: result.noted,
        known,
        cards,
        present: (date, t) => dayCache.get(date)?.keys.has(seedBulletKey(t)) ?? false,
        src,
      });

      const touched: string[] = [];
      for (const [date, addition] of [...plan.days.entries()].sort()) {
        const merged = mergeSeedDay((await dayOf(date)).content, date, addition);
        if (merged.added === 0) continue;
        await writeSeedDayFile(projectFolder, date, merged.content);
        lines += merged.added;
        touched.push(date);
        daysWritten.add(date);
      }
      let asked = 0;
      for (const q of plan.questions) {
        if (q.kind === "who" && !q.speaker) continue;
        const cardAuthor = q.card ? members.find((m) => m.humanId === q.card!.humanId) : undefined;
        const made = await createSeedQuestion({
          project_folder_id: projectFolder._id,
          packet_file_id: file._id,
          kind: q.kind,
          date: q.date,
          text: q.text,
          src,
          speaker: q.speaker,
          speaker_settled: q.speakerSettled,
          card: q.card ? { ...q.card, name: cardAuthor ? firstName({ name: cardAuthor.name, email: cardAuthor.email }) : "someone" } : null,
        });
        if (made) asked += 1;
      }
      questions += asked;
      await markPacketSown(file._id, { days: touched });
      files += 1;
      log(`sow: "${file.name}" from ${uploader}: ${touched.length} day(s), ${asked} question(s)${plan.alreadyThere ? `, ${plan.alreadyThere} line(s) already in the seed` : ""}.`);
    } catch (err) {
      if (err instanceof GraphLogCancelledError) throw err;
      const message = err instanceof Error ? err.message : "unknown error";
      incomplete.push(`"${file.name}" from ${uploader} could not be sown: ${message}`);
      log(`sow: "${file.name}" from ${uploader} could not be sown (${message}); it stays in the packet.`);
      await recordGraphLogUsage({ humanId: actingHumanId, projectFolderId: projectFolder._id, stage: "sow", kind: "sow", durationMs: Date.now() - started, outcome: "error", errorKind: classifyGraphLogError(err) });
    }
  }

  if (questions > SOW_QUESTION_NOTICE) {
    log(`sow: ${questions} questions from this run. That is a lot: the stage may be asking what it should decide, or a packet needed a cleaner source.`);
  }
  log(`sow: ${files} file(s) sown into ${daysWritten.size} day(s), ${documents} document(s), ${questions} question(s).`);
  return { ok: true, skipped: false, files, days: [...daysWritten].sort(), lines, documents, questions, incomplete };
}

// ─── A guide's answer ───────────────────────────────────────────────────

/**
 * Applies a guide's yes or no to one question. Each kind has its own
 * meaning: "who" yes moves the line from Noted to the person; "logged"
 * yes drops the line, no puts it in; "when" yes puts it on that day. The
 * answer edits that one day's seed file (the packet is not read again),
 * which changes the day's hash, so the next GraphLog run re-extracts
 * that day and no other. The caller checks the guide may.
 */
export async function decideSeedQuestion(input: {
  project: VaultFolder;
  id: string;
  verdict: "yes" | "no";
  guideHumanId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await getSeedQuestion(input.id);
  if (!q || q.project_folder_id !== input.project._id) return { ok: false, error: "That question isn't on this project." };
  if (q.status !== "pending") return { ok: false, error: "A Guide already answered that one." };

  const putIn = async () => {
    const existing = await readSeedDayFile(input.project, q.date);
    const addition: SeedAddition =
      q.speaker && q.speaker_settled ? { lines: [{ speaker: q.speaker, text: q.text, src: q.src }], noted: [] } : { lines: [], noted: [q.text] };
    const merged = mergeSeedDay(existing?.content ?? null, q.date, addition);
    if (merged.added > 0) await writeSeedDayFile(input.project, q.date, merged.content);
  };

  if (q.kind === "who" && input.verdict === "yes" && q.speaker) {
    const existing = await readSeedDayFile(input.project, q.date);
    if (existing) {
      const moved = moveNotedToSpeaker(existing.content, q.text, q.speaker, q.src);
      if (moved !== existing.content) await writeSeedDayFile(input.project, q.date, moved);
    }
  } else if (q.kind === "logged" && input.verdict === "no") {
    await putIn();
  } else if (q.kind === "when" && input.verdict === "yes") {
    await putIn();
  }
  await setSeedQuestionDecided(q._id, input.verdict, input.guideHumanId);
  return { ok: true };
}
