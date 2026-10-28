/**
 * The brief (2026-10-28): what code decides around the model's words. A
 * section over its budget comes back once with its count and the resend
 * is kept whatever its length; the shape's headings are held and the one
 * free heading is one; the brief is assembled in the shape's order
 * whatever order the calls arrive in; finish is asked once more when
 * something is missing or a citation matches no node; the trigger is a
 * guide's click and never the pipeline. The model's half is a scripted
 * provider here, as in `sow.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BRIEF_ABOUT_KEY,
  BRIEF_SECTION_BUDGETS,
  BRIEF_TOOLS,
  assembleBrief,
  briefFinishNotes,
  briefHeadingKey,
  briefSectionNote,
  briefText,
  buildBriefSystemPrompt,
  emptyBriefDraft,
} from "robustness-core/data/brief.server";
import type { GraphLogNode } from "robustness-core/data/graphNodeIndex.server";
import type { LlmProvider, LlmResponse, ToolCall } from "robustness-core/data/llmProvider";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (rel: string) => readFileSync(path.join(here, "../../../../", rel), "utf8");

const REF = ':ref{name="Susan" datetime="2026-08-05T12:00:00Z" location="/vault?file=of8igwqbz4urgqtru8i3" origin="seed"}';
const NODES: GraphLogNode[] = [
  { id: "2026-08-05#1", date: "2026-08-05", number: 1, quote: "Better insulation between the attic floor joists.", authorName: "Susan", authorHumanId: null, origin: "seed", refLine: `${REF.replace('" origin', '" verbose="true" origin')}`, links: [] },
];

function response(calls: Omit<ToolCall, "id">[], stopReason: LlmResponse["stopReason"] = "tool_use"): LlmResponse {
  return {
    text: null,
    toolCalls: calls.map((c, i) => ({ ...c, id: `c${i}` })),
    thinking: { blocks: 0, text: "" },
    partialToolCall: null,
    stopReason,
    usage: { inputTokens: 10, outputTokens: 5 },
    model: "scripted",
  } as LlmResponse;
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

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const section = (heading: string, markdown: string) => ({ name: "write_section", input: { heading, markdown } });
const finish = { name: "finish_brief", input: {} };
const base = { letterTitle: "Attic assembly report", purpose: "Settle the attic floor assembly.", today: "2026-10-28", peopleLines: ["Austin T (Austin): Guide on this project"], structureBody: "## The attic\n", nodes: NODES, skill: "skill" };

describe("the shape, held by code", () => {
  it("seven first-half sections in order, one of them the free heading, The ask required", () => {
    expect(BRIEF_SECTION_BUDGETS.map((s) => s.key)).toEqual(["the ask", "the bigger picture", BRIEF_ABOUT_KEY, "where it doesn't fit", "people, timing and money", "what's been explored, and where we lean", "not logged"]);
    expect(BRIEF_SECTION_BUDGETS.filter((s) => s.required).map((s) => s.key)).toEqual(["the ask"]);
    expect(BRIEF_TOOLS.map((t) => t.name)).toEqual(["write_section", "write_reference", "finish_brief"]);
  });

  it("a heading is read as the shape names it: marks, curly quotes and spacing aside", () => {
    expect(briefHeadingKey("## The Ask")).toBe("the ask");
    expect(briefHeadingKey("What’s been  explored, and where we lean")).toBe("what's been explored, and where we lean");
  });

  it("counts a section against its budget with citations and photos free, and says nothing inside it", () => {
    expect(briefSectionNote("the ask", `- ${words(50)} ${REF}\n:::gallery{}\n![a](/api/vault/view/x)\n:::`)).toBeNull();
    expect(briefSectionNote("the ask", `- ${words(120)} ${REF}`)).toBe("120 words against a budget of 90 (citations and photos not counted)");
  });

  it("assembles in the shape's order whatever order the sections were written, Reference last", () => {
    const draft = emptyBriefDraft();
    draft.sections.set("not logged", { heading: "Not logged", markdown: "- gap" });
    draft.sections.set("the ask", { heading: "The ask", markdown: "- problem" });
    draft.sections.set(BRIEF_ABOUT_KEY, { heading: "The attic floor", markdown: "- floor\n\n### The joists\n\n- joists" });
    draft.reference = "## The client's questions\n\n- q";
    expect(assembleBrief(draft)).toBe("## The ask\n\n- problem\n\n## The attic floor\n\n- floor\n\n### The joists\n\n- joists\n\n## Not logged\n\n- gap\n\n---\n\n# Reference\n\n## The client's questions\n\n- q\n");
  });

  it("finish names the required section missing as a refusal, the optional ones as notes, and a citation matching no node", () => {
    const draft = emptyBriefDraft();
    draft.sections.set("the bigger picture", { heading: "The bigger picture", markdown: `- a ${REF}\n- b :ref{name="Nobody" datetime="2026-01-01T12:00:00Z" location="/vault?file=zzz"}` });
    const notes = briefFinishNotes(draft, new Map(NODES.map((n) => [n.id, n])));
    expect(notes.refusals).toEqual(['"The ask" is not written, and the brief opens with it']);
    expect(notes.notes.some((n) => n.includes("Not logged"))).toBe(true);
    expect(notes.notes.some((n) => n.includes("Reference"))).toBe(true);
    expect(notes.unmatched).toEqual([':ref{name="Nobody" datetime="2026-01-01T12:00:00Z" location="/vault?file=zzz"}']);
  });
});

describe("one pass, section by section", () => {
  it("sends an over-budget section back once with its count, keeps the resend whatever its length, and finishes", async () => {
    const long = `- ${words(120)} ${REF}`;
    const provider = scripted([
      response([section("The ask", long)]),
      response([section("The ask", `- ${words(110)} ${REF}`), section("The attic floor", `- floor ${REF}`), { name: "write_reference", input: { markdown: "## The client's questions\n\n- q" } }]),
      response([finish]),
      response([finish]),
    ]);
    const result = await briefText({ ...base, provider });
    expect(provider.seen[1][0]).toMatch(/^Written for now, but "The ask" is 120 words against a budget of 90/);
    // `seen[n]` is every tool result in the conversation at turn n; the resend's is the next one.
    expect(provider.seen[2][1]).toBe('Written: "The ask".');
    expect(result.bounced).toEqual(["The ask"]);
    expect(result.content).toContain(`- ${words(110)}`);
    expect(result.content.startsWith("## The ask\n")).toBe(true);
    expect(result.content).toContain("## The attic floor");
    expect(result.content).toContain("# Reference");
    // Finish was asked once more (optional sections missing), then stood.
    expect(provider.seen[3].at(-1)).toMatch(/^Not finished yet:/);
    expect(result.incomplete).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.turns).toBe(4);
  });

  it("refuses a second free heading and names the shape", async () => {
    const provider = scripted([
      response([section("The ask", `- p ${REF}`), section("The attic floor", `- a ${REF}`), section("The roof", `- r ${REF}`)]),
      response([finish]),
      response([finish]),
    ]);
    const result = await briefText({ ...base, provider });
    expect(provider.seen[1][2]).toMatch(/^Not written: the shape has one free heading, and it is already "The attic floor"/);
    expect(result.content).not.toContain("## The roof");
  });

  it("a brief that ends without finish keeps what stands and says it was not finished; The ask missing is a refusal that stands after the second finish", async () => {
    const ended = await briefText({ ...base, provider: scripted([response([section("The bigger picture", `- b ${REF}`)]), response([], "end_turn")]) });
    expect(ended.incomplete).toEqual(['"The ask" is not written, and the brief opens with it', "the model ended without calling finish_brief"]);
    expect(ended.content).toContain("## The bigger picture");

    const twice = await briefText({ ...base, provider: scripted([response([section("The bigger picture", `- b ${REF}`)]), response([finish]), response([finish])]) });
    expect(twice.incomplete).toEqual(['"The ask" is not written, and the brief opens with it']);
  });

  it("a cut-off turn keeps the calls it finished and asks the model to go on", async () => {
    const provider = scripted([
      response([section("The ask", `- p ${REF}`), section("The bigger picture", `- half`)], "max_tokens"),
      response([finish]),
      response([finish]),
    ]);
    const result = await briefText({ ...base, provider });
    expect(result.content).toContain("## The ask");
    expect(result.content).not.toContain("## The bigger picture");
  });

  it("hands the model the letter, the people, the map and every node verbatim with its citation", () => {
    const system = buildBriefSystemPrompt("THE SKILL", base);
    expect(system).toContain("THE SKILL");
    expect(system).toContain('The letter: "Attic assembly report".');
    expect(system).toContain("Its purpose, in the guide's words: Settle the attic floor assembly.");
    expect(system).toContain("- Austin T (Austin): Guide on this project");
    expect(system).toContain("## The attic");
    expect(system).toContain("Better insulation between the attic floor joists.");
    expect(system).toContain(REF);
    expect(system).not.toContain('verbose="true"');
  });
});

describe("the trigger is a guide's click", () => {
  it("nothing in the pipeline or the nightly names the brief; the two controls are the new-letter path and the brief route", () => {
    expect(source("packages/robustness-core/src/data/graphLogAgent.server.ts")).not.toMatch(/brief/i);
    expect(source("fruits/app/routes/api.graphlog.scheduled-run.tsx")).not.toMatch(/brief/i);
    const letters = source("fruits/app/routes/api.projects.$folderId.letters.tsx");
    expect((letters.match(/requestBrief\(/g) ?? []).length).toBe(1);
    const route = source("fruits/app/routes/api.letter.$fileId.brief.tsx");
    expect((route.match(/requestBrief\(/g) ?? []).length).toBe(1);
    expect(route).toContain("canManageLetters(user, await getProjectRole(home.project, user._id))");
    expect(source("fruits/app/routes/api.vault.$fileId.tsx")).not.toMatch(/requestBrief|brief\.server/);
  });

  it("a letter's row is merged after the first write, never a read record spread back into an upsert", () => {
    const brief = source("packages/robustness-core/src/data/brief.server.ts");
    expect(brief).toMatch(/if \(existing\) await merge\(TABLE, letterFileId, patch\);/);
    expect(brief).not.toMatch(/\.\.\.rest, \.\.\.patch/);
  });

  it("the stage is registered where sow is: the queue, the worker, the skill, the reserved name", () => {
    expect(source("packages/robustness-core/src/data/graphLogQueue.server.ts")).toMatch(/\| "brief"/);
    expect(source("packages/worker/worker.ts")).toContain('case "brief"');
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).toContain('"brief.md"');
    expect(source("packages/robustness-core/src/data/projectN02.server.ts")).toContain('brief: "BRIEF.md"');
    const defaults = source("packages/robustness-core/src/data/graphLogDefaults.server.ts");
    expect(defaults).toContain("export const DEFAULT_BRIEF_SKILL = `");
    expect(defaults).toContain("brief: existing?.brief ?? null");
    // No number in the skill: code holds the budgets (the Janitor pins any a skill states).
    const skill = defaults.slice(defaults.indexOf("export const DEFAULT_BRIEF_SKILL"), defaults.indexOf("export type GraphLogDefaultStage"));
    expect(skill).toMatch(/You are not given the numbers/);
    expect(skill).not.toMatch(/\b(90|100|450|80|150)\b words/);
  });
});
