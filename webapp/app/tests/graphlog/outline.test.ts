/**
 * The outline (2026-10-28): what code decides around the model's words. A
 * topic line is a cited fact or a Position: line, anything else is the
 * model's own and is named back once; every citation is a node's own;
 * Go do is last and one line; the whole outline is counted and sent back
 * once; the shape's tail keeps its order whatever order the model wrote
 * it in; the talk goes onto its speaker's Card by the daily log's own
 * rules, and only when the letter is sent (2026-11-05). Without a brief
 * the outline is written from the talk and nothing else: its prompt, its
 * one bounce and its skill are held here; that the graph is never opened
 * for it is `fruits/app/tests/letterTalk.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_TAIL,
  OUTLINE_WORD_BUDGET,
  assembleOutline,
  LETTER_BACK_BUDGETS,
  buildLetterBackOutlineSystemPrompt,
  buildOutlineSystemPrompt,
  buildTalkOutlineSystemPrompt,
  letterBackOutlineText,
  letterBackOutlineWriteNotes,
  isOwnLine,
  outlineFromTalkText,
  outlineText,
  outlineWriteNotes,
  talkOutlineWriteNotes,
  parseOutlineDocument,
  sectionBullets,
} from "robustness-core/data/outline.server";
import type { GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import type { LlmProvider, LlmResponse, ToolCall } from "robustness-core/data/llmProvider";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (rel: string) => readFileSync(path.join(here, "../../../../", rel), "utf8");

const REF = ':ref{name="Susan" datetime="2026-08-05T12:00:00Z" location="/vault?file=of8igwqbz4urgqtru8i3" origin="seed"}';
const NODES: GraphLogNode[] = [
  { id: "2026-08-05#1", date: "2026-08-05", number: 1, quote: "The joists are 5.5 inches deep.", authorName: "Susan", authorHumanId: null, origin: "seed", refLine: REF.replace('" origin', '" verbose="true" origin'), links: [] },
];
const nodesById = new Map(NODES.map((n) => [n.id, n]));

function response(calls: Omit<ToolCall, "id">[], stopReason: LlmResponse["stopReason"] = "tool_use"): LlmResponse {
  return { text: null, toolCalls: calls.map((c, i) => ({ ...c, id: `c${i}` })), thinking: { blocks: 0, text: "" }, partialToolCall: null, stopReason, usage: { inputTokens: 10, outputTokens: 5 }, model: "scripted" } as LlmResponse;
}
function scripted(turns: LlmResponse[]): LlmProvider & { seen: string[][] } {
  const seen: string[][] = [];
  let i = 0;
  return {
    seen,
    async complete(input) {
      seen.push(input.messages.filter((m) => m.role === "tool_result").map((m) => m.content));
      return turns[i++] ?? response([], "end_turn");
    },
  };
}
const write = (markdown: string) => ({ name: "write_outline", input: { markdown } });
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const GOOD = `## The assembly today\n\n- The joists are 5.5 inches deep. ${REF}\n- Position: the assembly is slowing moisture, not stopping it.\n\n## In the brief, no position yet\n\n- Jonathan, whom the letter has to convince.\n\n## In the talk, not in the graph\n\n- Blocked vents, Austin's memory of the call.\n\n## Go do\n\n- Check whether the gable windows are still cracked an inch.\n`;
const base = { letterTitle: "Attic assembly report", purpose: "Settle the attic floor assembly.", today: "2026-10-28", guideName: "Austin", brief: "## The ask\n\n- p " + REF, talk: "I'm trying to give just a limited deliverable...", peopleLines: ["Austin T (Austin): Guide on this project"], nodes: NODES, skill: "skill" };

describe("the shape, held by code", () => {
  it("reads topics in the model's order and the tail by its keys, and assembles the tail in its fixed order", () => {
    const shuffled = `## Go do\n\n- one\n\n## A topic\n\n- Position: x\n\n## In the talk, not in the graph\n\n- t\n\n## In the brief, no position yet\n\n- b\n`;
    const parsed = parseOutlineDocument(shuffled);
    expect(parsed.topics.map((t) => t.heading)).toEqual(["A topic"]);
    expect([...parsed.tail.keys()].sort()).toEqual(OUTLINE_TAIL.map((t) => t.key).sort());
    expect(assembleOutline(parsed)).toBe("## A topic\n\n- Position: x\n\n## In the brief, no position yet\n\n- b\n\n## In the talk, not in the graph\n\n- t\n\n## Go do\n\n- one\n");
  });

  it("a topic line is a cited fact or a Position: line; anything else is the model's own", () => {
    expect(isOwnLine(`The joists are 5.5 inches deep. ${REF}`)).toBe(false);
    expect(isOwnLine("Position: the assembly is slowing moisture.")).toBe(false);
    expect(isOwnLine("**Position:** bare.")).toBe(false);
    expect(isOwnLine("A tighter floor pushes risk upward.")).toBe(true);
    expect(sectionBullets("- a\n- b\n\nnot a bullet\n1. c")).toEqual(["a", "b", "c"]);
  });

  it("names the model's own line, a citation matching no node, Go do missing or not last or not one, and the count over budget; a back list missing only rides along", () => {
    const clean = outlineWriteNotes(GOOD, nodesById);
    expect(clean.hard).toEqual([]);
    expect(clean.soft).toEqual([]);

    const own = outlineWriteNotes(GOOD.replace("- Position: the assembly is slowing moisture, not stopping it.", "- A tighter floor pushes risk upward."), nodesById);
    expect(own.hard).toEqual(['under "The assembly today", a line that is neither a cited fact nor a Position: line: "A tighter floor pushes risk upward."']);

    const stray = outlineWriteNotes(GOOD.replace(REF, ':ref{name="Nobody" datetime="2026-01-01T12:00:00Z" location="/vault?file=zzz"}'), nodesById);
    expect(stray.hard.some((h) => h.startsWith("a citation matches no node:"))).toBe(true);

    const noGo = outlineWriteNotes(GOOD.replace(/## Go do[\s\S]*$/, ""), nodesById);
    expect(noGo.hard).toEqual(['"Go do" is not written: one sentence naming something the client can check or do at the house']);

    const twoGo = outlineWriteNotes(GOOD.replace("- Check whether", "- One.\n- Check whether"), nodesById);
    expect(twoGo.hard).toEqual(['"Go do" holds 2 items; it holds one']);

    const notLast = outlineWriteNotes(GOOD.replace("## Go do\n\n- Check whether the gable windows are still cracked an inch.\n", "") .replace("## In the brief", "## Go do\n\n- Check the windows.\n\n## In the brief"), nodesById);
    expect(notLast.hard).toEqual(['"Go do" is not the last section']);

    const noLists = outlineWriteNotes(`## A topic\n\n- Position: x\n\n## Go do\n\n- one\n`, nodesById);
    expect(noLists.hard).toEqual([]);
    expect(noLists.soft.length).toBe(2);

    const long = outlineWriteNotes(GOOD.replace("- Position: the assembly is slowing moisture, not stopping it.", `- Position: ${words(OUTLINE_WORD_BUDGET)}`), nodesById);
    expect(long.hard.some((h) => /words against a budget of 750/.test(h))).toBe(true);
    expect(long.words).toBeGreaterThan(OUTLINE_WORD_BUDGET);
  });
});

describe("one pass, the whole outline", () => {
  it("a clean outline is written first time, in the model's topic order with the fixed tail", async () => {
    const provider = scripted([response([write(GOOD)])]);
    const result = await outlineText({ ...base, provider });
    expect(result.turns).toBe(1);
    expect(result.bounced).toEqual([]);
    expect(result.topics).toEqual(["The assembly today"]);
    expect(result.content).toBe(GOOD);
    expect(result.incomplete).toEqual([]);
  });

  it("the model's own line sends the outline back once; the resend is kept as written", async () => {
    const own = GOOD.replace("- Position: the assembly is slowing moisture, not stopping it.", "- A tighter floor pushes risk upward.");
    const provider = scripted([response([write(own)]), response([write(own)])]);
    const result = await outlineText({ ...base, provider });
    expect(provider.seen[1][0]).toMatch(/^Not written yet\. The outline as sent:\n- under "The assembly today", a line that is neither a cited fact nor a Position: line/);
    expect(result.bounced.length).toBe(1);
    expect(result.content).toContain("A tighter floor pushes risk upward.");
    expect(result.turns).toBe(2);
  });

  it("hands the model the letter, the guide, the brief, the talk and every node", () => {
    const system = buildOutlineSystemPrompt("THE SKILL", base);
    expect(system).toContain("THE SKILL");
    expect(system).toContain("The guide whose talk this is: Austin.");
    expect(system).toContain("The brief, as the guide read it:");
    expect(system).toContain("The talk-through, Austin's words, unedited:");
    expect(system).toContain("I'm trying to give just a limited deliverable...");
    expect(system).toContain("The joists are 5.5 inches deep.");
    expect(system).not.toContain('verbose="true"');
  });
});

describe("without a brief: the talk and nothing else (2026-11-05)", () => {
  const TALK_ONLY = `## The windows\n\n- They stay cracked an inch through winter, because the fan needs the air.\n\n## The floor\n\n- It can wait until spring.\n`;
  const talkBase = { letterTitle: "What we found upstairs", today: "2026-11-05", writerName: "Susan", talk: "Three things: the windows, the fan, and why the floor can wait.", skill: "skill" };

  it("the prompt is the skill, the title, the writer's name and the talk; it names no brief, no node and no people", () => {
    const system = buildTalkOutlineSystemPrompt("THE TALK SKILL", talkBase);
    expect(system).toContain("THE TALK SKILL");
    expect(system).toContain('The letter: "What we found upstairs".');
    expect(system).toContain("The person writing it, whose talk this is: Susan.");
    expect(system).toContain("The talk-through, Susan's words, unedited:");
    expect(system).toContain("Three things: the windows, the fan, and why the floor can wait.");
    expect(system).not.toMatch(/The brief|Every node|The people:|Its purpose|citation/);
    // Nothing else can ride in: the input has four things to say and the prompt says each once.
    expect(system.split("\n").filter((l) => l.trim()).length).toBe(8);
  });

  it("every section is a topic; a citation, a heading from the brief's tail, no topics or the count over budget send it back", () => {
    const clean = talkOutlineWriteNotes(TALK_ONLY);
    expect(clean.hard).toEqual([]);
    expect(clean.soft).toEqual([]);
    expect(parseOutlineDocument(TALK_ONLY, []).topics.map((t) => t.heading)).toEqual(["The windows", "The floor"]);

    expect(talkOutlineWriteNotes(TALK_ONLY.replace("It can wait until spring.", `It can wait. ${REF}`)).hard).toEqual(["a citation: this outline cites nothing, because it was given nothing to cite"]);
    for (const t of OUTLINE_TAIL) {
      const hard = talkOutlineWriteNotes(`${TALK_ONLY}\n## ${t.heading}\n\n- one\n`).hard;
      expect(hard, t.heading).toEqual([`"${t.heading}" does not belong here: this outline has only the talk behind it, no brief and no graph`]);
    }
    expect(talkOutlineWriteNotes("Just a paragraph.").hard).toEqual(["no topic section: the outline is the writer's topics, in the order they took them"]);
    expect(talkOutlineWriteNotes(`## A topic\n\n- ${words(OUTLINE_WORD_BUDGET + 1)}\n`).hard.some((h) => /words against a budget of 750/.test(h))).toBe(true);
    // A line needs no citation and no Position: here: every line is the writer's.
    expect(talkOutlineWriteNotes("## A topic\n\n- A plain line.\n").hard).toEqual([]);
  });

  it("a clean outline is written first time, in the writer's order; a citation sends it back once and the resend is kept", async () => {
    const provider = scripted([response([write(TALK_ONLY)])]);
    const result = await outlineFromTalkText({ ...talkBase, provider });
    expect(result.turns).toBe(1);
    expect(result.content).toBe(TALK_ONLY);
    expect(result.topics).toEqual(["The windows", "The floor"]);
    expect(result.unmatched).toEqual([]);

    const cited = TALK_ONLY.replace("It can wait until spring.", `It can wait. ${REF}`);
    const bounced = scripted([response([write(cited)]), response([write(TALK_ONLY)])]);
    const again = await outlineFromTalkText({ ...talkBase, provider: bounced });
    expect(bounced.seen[1][0]).toMatch(/^Not written yet\. The outline as sent:\n- a citation: this outline cites nothing/);
    expect(again.bounced.length).toBe(1);
    expect(again.content).toBe(TALK_ONLY);
  });

  it("its skill is a default only: short, never given the number, naming no guide, client, brief or graph, and never a file in a project", () => {
    const defaults = source("packages/robustness-core/src/data/graphLogDefaults.server.ts");
    const skill = defaults.slice(defaults.indexOf("export const DEFAULT_OUTLINE_TALK_SKILL = `"), defaults.indexOf("/** The outline for a letter started from what its writer said"));
    expect(skill).toMatch(/you are not given the number/i);
    expect(skill).not.toMatch(/\b750\b/);
    expect(skill).not.toMatch(/\bguide\b|\bclient\b|\bbrief\b|\bgraph\b|\bnode\b|Go do|Position:/i);
    const outlineSkill = defaults.slice(defaults.indexOf("export const DEFAULT_OUTLINE_SKILL = `"), defaults.indexOf("/** The outline for a letter that has no brief"));
    expect(skill.length).toBeLessThan(outlineSkill.length / 2);
    expect(defaults).toContain("outlineTalk: existing?.outlineTalk ?? null");
    expect(defaults).toMatch(/export type GraphLogDefaultOnlyStage = "outlineTalk"[^;]*;/);
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).not.toMatch(/outlineTalk|OUTLINE[-_]TALK/);
    expect(source("fruits/app/routes/maker_.graphlog_.defaults.tsx")).toContain('stage="outlineTalk"');
  });
});

describe("a letter back: the reflection, the letter read and the sender's older words (2026-11-06)", () => {
  const BACK = `## What you're saying\n\nThe fan comes before the floor, and the windows are why.\n\n## Where it starts\n\n- The fan is undersized.\n- Lucas said so in September.\n\n## The middle\n\n- The gable windows stay cracked.\n\n## Where it lands\n\n- The floor waits for spring.\n\n## Leave for another letter\n\n- The merch.\n`;
  const backBase = {
    letterTitle: "What I make of it",
    today: "2026-11-06",
    writerName: "Gerald",
    reflection: "The fan matters more than the floor.",
    letterRead: { title: "The attic floor", fromName: "Lucas", text: "# The attic floor\n\nWe should do the floor first.\n" },
    senderWords: [{ date: "2026-09-12", quote: "The fan is undersized." }],
    skill: "skill",
  };

  it("the prompt is the skill, the letter being written, the letter read, the reflection and the sender's dated words; with none, it says so", () => {
    const system = buildLetterBackOutlineSystemPrompt("THE LETTER BACK SKILL", backBase);
    for (const held of ["THE LETTER BACK SKILL", 'The letter being written: "What I make of it".', "The person writing it, whose reflection this is: Gerald.", 'The letter they read, "The attic floor", from Lucas:', "We should do the floor first.", "Gerald's reflection on it, their words, unedited:", "The fan matters more than the floor.", "Lucas's own older words on this project, each with the day it was said:", "2026-09-12: The fan is undersized."]) expect(system).toContain(held);
    expect(system).not.toMatch(/The brief|Every node|The people:|Its purpose|:ref\{/);
    const bare = buildLetterBackOutlineSystemPrompt("s", { ...backBase, letterRead: { ...backBase.letterRead, fromName: null }, senderWords: [] });
    expect(bare).toContain('The letter they read, "The attic floor", from the sender:');
    expect(bare).toContain("(None on the record.)");
  });

  it("code holds the shape and the counts: the sentence first and inside its words, three or four moves each inside its words and lines, the leave list last and uncounted, no numbers, no citation", () => {
    const B = LETTER_BACK_BUDGETS;
    expect(B).toEqual({ saying: 30, move: 75, moveLines: 3, movesMin: 3, movesMax: 4 });
    expect(letterBackOutlineWriteNotes(BACK).hard).toEqual([]);
    // The leave list can run long, or be left out.
    expect(letterBackOutlineWriteNotes(BACK.replace("- The merch.", `- ${words(200)}`)).hard).toEqual([]);
    expect(letterBackOutlineWriteNotes(BACK.replace(/## Leave for another letter[\s\S]*$/, "")).hard).toEqual([]);

    expect(letterBackOutlineWriteNotes(BACK.replace("The fan comes before the floor, and the windows are why.", words(31))).hard).toEqual(['"What you\'re saying" is 31 words against a budget of 30']);
    expect(letterBackOutlineWriteNotes(BACK.replace(/## What you're saying[\s\S]*?## Where it starts/, "## Where it starts")).hard).toEqual(['"What you\'re saying" is not written: one plain sentence, first']);
    expect(letterBackOutlineWriteNotes(BACK.replace("## The middle\n\n- The gable windows stay cracked.\n\n", "")).hard).toEqual(["2 move(s); the letter goes in 3 or 4"]);
    expect(letterBackOutlineWriteNotes(BACK.replace("## Where it lands", "## One more\n\n- a\n\n## And another\n\n- b\n\n## Where it lands")).hard).toEqual(["5 move(s); the letter goes in 3 or 4"]);
    expect(letterBackOutlineWriteNotes(BACK.replace("- The gable windows stay cracked.", `- ${words(76)}`)).hard).toEqual(['"The middle" is 76 words against a budget of 75']);
    expect(letterBackOutlineWriteNotes(BACK.replace("- The gable windows stay cracked.", "- a\n- b\n- c\n- d")).hard).toEqual(['"The middle" has 4 lines; a move has at most 3']);
    expect(letterBackOutlineWriteNotes(BACK.replace("## The middle", "## 2. The middle")).hard).toEqual(['"2. The middle" is numbered; headings carry no numbers']);
    expect(letterBackOutlineWriteNotes(BACK.replace("- Lucas said so in September.", `- Lucas said so. ${REF}`)).hard).toEqual(["a citation: put the sender's older words in the line as their words, with no citation"]);
    const leaveFirst = BACK.replace("## Leave for another letter\n\n- The merch.\n", "").replace("## Where it lands", "## Leave for another letter\n\n- The merch.\n\n## Where it lands");
    expect(letterBackOutlineWriteNotes(leaveFirst).hard).toEqual(['"Leave for another letter" is not the last section']);
  });

  it("over its counts it is sent back once with them and the resend is kept as written, with nothing left for the page to warn about", async () => {
    const long = BACK.replace("- The gable windows stay cracked.", `- ${words(80)}`);
    const provider = scripted([response([write(long)]), response([write(long)])]);
    const result = await letterBackOutlineText({ ...backBase, provider });
    expect(provider.seen[1][0]).toMatch(/^Not written yet\. The outline as sent:\n- "The middle" is 80 words against a budget of 75/);
    expect(result.turns).toBe(2);
    expect(result.content).toBe(long);
    expect(result.incomplete).toEqual([]);

    const clean = await letterBackOutlineText({ ...backBase, provider: scripted([response([write(BACK)])]) });
    expect(clean.turns).toBe(1);
    expect(clean.content).toBe(BACK);
    expect(clean.bounced).toEqual([]);
  });

  it("its skill is the hand-tested one, a default only: the friend across the table, three parts, no questions, never given the numbers, and never a reply", () => {
    const defaults = source("packages/robustness-core/src/data/graphLogDefaults.server.ts");
    const skill = defaults.slice(defaults.indexOf("export const DEFAULT_OUTLINE_LETTER_BACK_SKILL = `"), defaults.indexOf("export type GraphLogDefaultStage"));
    for (const held of ["the friend across the table", "What you're saying", "Three or four", "Leave for another letter", "No questions to the writer", "The phrasing of the letter is the writer's", "you are not given the numbers"]) expect(skill, held).toContain(held);
    expect(skill).not.toMatch(/\breply\b|being answered|\bgraph\b|\b30\b|\b75\b/i);
    expect(defaults).toContain('export type GraphLogDefaultOnlyStage = "outlineTalk" | "outlineLetterBack";');
    expect(defaults).toContain("outlineLetterBack: existing?.outlineLetterBack ?? null");
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).not.toMatch(/outlineLetterBack|LETTER[-_]BACK/);
    expect(source("fruits/app/routes/maker_.graphlog_.defaults.tsx")).toContain('stage="outlineLetterBack"');
  });

  it("it runs only from the outline's own control: nothing enqueues one when a reflection is kept or a letter is started from it", () => {
    expect(source("packages/robustness-core/src/data/letterReflection.server.ts")).not.toMatch(/enqueueGraphLogJob|outline\.server/);
    const route = source("fruits/app/routes/api.projects.$folderId.letters.tsx");
    expect(route).not.toMatch(/enqueueGraphLogJob|requestOutline|runOutline/);
    const fromBranch = route.slice(route.indexOf("if (startFrom) {"), route.indexOf("// The brief starts as the letter opens."));
    expect(fromBranch).toContain("reflects_on_letter_file_id: fromLetterId");
    expect(fromBranch).not.toContain("requestBrief");
    expect(source("fruits/app/routes/api.letter.$fileId.reflection.tsx")).not.toMatch(/outline|enqueue/i);
  });
});

describe("the talk goes onto the Card by the daily log's rules, and only when the letter is sent", () => {
  it("appendToCard refuses without dailyLog, holds a suggestion without feeds, adds after what the Card holds, and mounts", () => {
    const daily = source("packages/robustness-core/src/data/dailyLog.server.ts");
    expect(daily).toMatch(/export async function appendToCard\(/);
    expect(daily).toMatch(/if \(!input\.features\.includes\("dailyLog"\)\) throw new Error/);
    expect(daily).toMatch(/const suggestion = !input\.features\.includes\("feeds"\);/);
    expect(daily).toMatch(/saveDailyLogCard\(card\.fileId, addChunk\(card\.content, text\)\)/);
    expect(daily).toMatch(/await mountCardOnDay\(input\.humanId, input\.date, input\.projectFolderId\)/);
  });

  it("appendToCard is called from exactly one place, the landing at Send, which only sendLetter calls; giving the talk writes no Card; the outline is enqueued from the talk and from Write it again; nothing in the pipeline names either", () => {
    const outline = source("packages/robustness-core/src/data/outline.server.ts");
    expect((outline.match(/appendToCard\(/g) ?? []).length).toBe(1);
    const landing = outline.slice(outline.indexOf("export async function landTalkThrough("), outline.indexOf("export async function requestOutline("));
    expect(landing).toContain("appendToCard(");
    expect(landing).toContain("runDailyLogSync(");
    const giving = outline.slice(outline.indexOf("export async function sendTalkThrough("), outline.indexOf("export function talkIsWaiting("));
    expect(giving).not.toMatch(/appendToCard|runDailyLogSync/);
    const stage = outline.slice(outline.indexOf("export async function runOutline("), outline.indexOf("export type TalkResult"));
    expect(stage).not.toMatch(/appendToCard|runDailyLogSync/);
    // The reader's keep is the Card door's other caller, in its own module (2026-11-06).
    const reflection = source("packages/robustness-core/src/data/letterReflection.server.ts");
    expect((reflection.match(/appendToCard\(/g) ?? []).length).toBe(1);
    expect(reflection.slice(reflection.indexOf("export async function keepReflection("), reflection.indexOf("export async function reflectionToStartFrom("))).toContain("appendToCard(");
    const callers = ["packages/robustness-core/src/data/letterSend.server.ts", "packages/robustness-core/src/data/outline.server.ts", "packages/worker/worker.ts", "fruits/app/routes/api.letter.$fileId.talk.tsx", "fruits/app/routes/api.letter.$fileId.outline.tsx"];
    expect(callers.filter((f) => /landTalkThrough\(home\.project|await landTalkThrough\(/.test(source(f)))).toEqual(["packages/robustness-core/src/data/letterSend.server.ts"]);
    // No brief is asked for anywhere on the talk's or the outline's path.
    expect(outline).not.toMatch(/Read the brief first|has no brief yet/);
    expect((outline.match(/enqueueGraphLogJob\("brief", \{[^}]*kind: "outline"/g) ?? []).length).toBe(2);
    expect(source("packages/robustness-core/src/data/graphLogAgent.server.ts")).not.toMatch(/outline|appendToCard/i);
    expect(source("fruits/app/routes/api.vault.$fileId.tsx")).not.toMatch(/outline\.server|appendToCard/);
    // The talk and the outline are the letter's writer's (a guide, or a
    // client on their own: `letterForWriter`, since 2026-11-06); writing
    // the brief stays the manager's.
    for (const route of ["fruits/app/routes/api.letter.$fileId.talk.tsx", "fruits/app/routes/api.letter.$fileId.outline.tsx"]) {
      expect(source(route)).toContain("letterForWriter(request, params.fileId)");
    }
    expect(source("fruits/app/routes/api.letter.$fileId.brief.tsx")).toMatch(/export async function action[\s\S]*letterForManager\(request, params\.fileId\)/);
    expect(source("fruits/app/data/letterManager.server.ts")).toContain("canManageLetters(user, role)");
    expect(source("fruits/app/data/letterWriter.server.ts")).toContain("resolveLetterForWriter(fileId, user)");
  });

  it("the outline is a job kind on the brief's stage, with its own skill seeded and reserved", () => {
    expect(source("packages/robustness-core/src/data/graphLogQueue.server.ts")).toMatch(/kind\?: "brief" \| "outline"/);
    expect(source("packages/worker/worker.ts")).toContain('job.data.kind === "outline"');
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).toContain('"outline.md"');
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).toContain('outline: "OUTLINE.md"');
    const defaults = source("packages/robustness-core/src/data/graphLogDefaults.server.ts");
    expect(defaults).toContain("export const DEFAULT_OUTLINE_SKILL = `");
    expect(defaults).toContain("outline: existing?.outline ?? null");
    const skill = defaults.slice(defaults.indexOf("export const DEFAULT_OUTLINE_SKILL"), defaults.indexOf("export type GraphLogDefaultStage"));
    expect(skill).toMatch(/you are not given the number/i);
    expect(skill).not.toMatch(/\b750\b/);
  });
});
