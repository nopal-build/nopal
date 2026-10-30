/**
 * The outline (2026-10-28): what code decides around the model's words. A
 * topic line is a cited fact or a Position: line, anything else is the
 * model's own and is named back once; every citation is a node's own;
 * Go do is last and one line; the whole outline is counted and sent back
 * once; the shape's tail keeps its order whatever order the model wrote
 * it in; the talk goes onto the guide's Card by the daily log's own
 * rules, and only from the guide's click.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OUTLINE_TAIL,
  OUTLINE_WORD_BUDGET,
  assembleOutline,
  buildOutlineSystemPrompt,
  isOwnLine,
  outlineText,
  outlineWriteNotes,
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

describe("the talk goes onto the Card by the daily log's rules, from the guide's click alone", () => {
  it("appendToCard refuses without dailyLog, holds a suggestion without feeds, adds after what the Card holds, and mounts", () => {
    const daily = source("packages/robustness-core/src/data/dailyLog.server.ts");
    expect(daily).toMatch(/export async function appendToCard\(/);
    expect(daily).toMatch(/if \(!input\.features\.includes\("dailyLog"\)\) throw new Error/);
    expect(daily).toMatch(/const suggestion = !input\.features\.includes\("feeds"\);/);
    expect(daily).toMatch(/saveDailyLogCard\(card\.fileId, addChunk\(card\.content, text\)\)/);
    expect(daily).toMatch(/await mountCardOnDay\(input\.humanId, input\.date, input\.projectFolderId\)/);
  });

  it("appendToCard is called from exactly one place, the talk's send; the outline is enqueued from the send and from Write it again; nothing in the pipeline names either", () => {
    const outline = source("packages/robustness-core/src/data/outline.server.ts");
    expect((outline.match(/appendToCard\(/g) ?? []).length).toBe(1);
    expect((outline.match(/enqueueGraphLogJob\("brief", \{[^}]*kind: "outline"/g) ?? []).length).toBe(2);
    expect(source("packages/robustness-core/src/data/graphLogAgent.server.ts")).not.toMatch(/outline|appendToCard/i);
    expect(source("fruits/app/routes/api.vault.$fileId.tsx")).not.toMatch(/outline\.server|appendToCard/);
    for (const route of ["fruits/app/routes/api.letter.$fileId.talk.tsx", "fruits/app/routes/api.letter.$fileId.outline.tsx", "fruits/app/routes/api.letter.$fileId.brief.tsx"]) {
      expect(source(route)).toContain("letterForManager(request, params.fileId)");
    }
    expect(source("fruits/app/data/letterManager.server.ts")).toContain("canManageLetters(user, role)");
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
