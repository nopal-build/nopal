/**
 * Sow (2026-09-30): one file from a seed packet becomes seed. These pin
 * what code decides: a line is kept only when it is in the file word for
 * word, a long file is cut at blank lines and never mid-line, a cut-off
 * turn keeps the calls it finished, and the week grid's count means what
 * it says (`sowScore.ts`). The model's half is a scripted provider here.
 */

import { describe, expect, it } from "vitest";
import { findLoggedCard, isVerbatim, knownSpeaker, matchesCard, planSow, sowFlat, sowText, splitForSow, SOW_TOOLS, type SowLine } from "robustness-core/data/sow.server";
import { isPacketText, seedQuestionMeaning, seedQuestionSentence } from "robustness-core/data/seedPackets.server";
import { notedMatches, scoreSow, SOW_WEIGHTS, type SowCandidate, type SowKey } from "robustness-core/data/sowScore";
import type { LlmProvider, LlmResponse, ToolCall } from "robustness-core/data/llmProvider";

const FILE = `## Daily capture — 2026-07-22 run (7/20 messages)

- **[decision]** Ceiling demo scope, and why the floor stays. Austin: "We need to remove all of the ceilings to see the critical structure for engineering." *(conf: high)*
  - ↳ Austin · "This Healthy House" client thread · 7/20
- **[open-thread]** The floor may be doing structural work. Contractor: "Maybe we just keep a 18″ perimeter of the floor in place to keep the joists locked in." *(conf: high)*
  - ↳ demo contractor (likely Beaudy) · demo-contractor thread · 7/20
`;

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

const base = { fileName: "cards.md", uploaderName: "Austin", knownNames: ["Austin", "Lucas"], skill: "skill" };

describe("a line is kept only when it is in the file word for word", () => {
  it("whitespace and a bullet's marker aside, the words must match", () => {
    const flat = sowFlat(FILE);
    expect(isVerbatim("We need to remove all of the ceilings to see the critical structure for engineering.", flat)).toBe(true);
    expect(isVerbatim("We need to remove   all of the ceilings\n to see the critical structure for engineering.", flat)).toBe(true);
    expect(isVerbatim("We need to remove all the ceilings to see the structure.", flat)).toBe(false);
    expect(isVerbatim("", flat)).toBe(false);
  });

  it("a paraphrase is refused and the model is told why; the exact words are kept", async () => {
    const provider = scripted([
      response([
        { name: "file_kind", input: { kind: "conversation" } },
        { name: "add_line", input: { date: "2026-07-20", speaker: "Austin", text: "We should remove every ceiling for the engineers.", speaker_sure: true, date_sure: true } },
        { name: "add_line", input: { date: "2026-07-20", speaker: "Austin", text: "We need to remove all of the ceilings to see the critical structure for engineering.", speaker_sure: true, date_sure: true } },
        { name: "add_line", input: { date: "2026-07-20", speaker: "Beaudy", text: "Maybe we just keep a 18″ perimeter of the floor in place to keep the joists locked in.", speaker_sure: false, date_sure: true } },
        { name: "add_noted", input: { date: "7/20", text: "Demo starts 7/21.", date_sure: true } },
        { name: "add_noted", input: { date: "2026-07-20", text: "Demo starts 7/21.", date_sure: true } },
      ]),
    ]);
    const result = await sowText({ ...base, text: FILE, provider });
    expect(result.fileKind?.kind).toBe("conversation");
    expect(result.lines.map((l) => [l.speaker, l.speakerSure])).toEqual([["Austin", true], ["Beaudy", false]]);
    expect(result.noted).toEqual([{ date: "2026-07-20", text: "Demo starts 7/21.", dateSure: true }]);
    expect(result.refused.map((r) => r.reason)).toEqual(["not verbatim", "date"]);
    // The refusal went back to the model as the tool's result.
    expect(provider.seen[1].some((t) => /not in the file word for word/.test(t))).toBe(true);
  });

  it("the same line twice is one line; a document takes no lines and ends the file", async () => {
    const line = { name: "add_line", input: { date: "2026-07-20", speaker: "Austin", text: "We need to remove all of the ceilings to see the critical structure for engineering.", speaker_sure: true, date_sure: true } };
    const twice = await sowText({ ...base, text: FILE, provider: scripted([response([{ name: "file_kind", input: { kind: "conversation" } }, line, line])]) });
    expect(twice.lines).toHaveLength(1);
    const doc = scripted([response([{ name: "file_kind", input: { kind: "document", date: "2026-04-22", author: "Austin" } }]), response([line])]);
    const result = await sowText({ ...base, text: FILE, provider: doc });
    expect(result.fileKind).toEqual({ kind: "document", date: "2026-04-22", author: "Austin" });
    expect(result.lines).toEqual([]);
    expect(result.turns).toBe(1);
  });

  it("a cut-off turn keeps every call it finished and goes on", async () => {
    const good = { name: "add_line", input: { date: "2026-07-20", speaker: "Austin", text: "We need to remove all of the ceilings to see the critical structure for engineering.", speaker_sure: true, date_sure: true } };
    const half = { name: "add_line", input: { date: "2026-07-20", speaker: "Beaudy" } };
    const provider = scripted([response([{ name: "file_kind", input: { kind: "conversation" } }, good, half], "max_tokens"), response([], "end_turn")]);
    const result = await sowText({ ...base, text: FILE, provider });
    expect(result.lines.map((l) => l.speaker)).toEqual(["Austin"]);
    expect(result.turns).toBe(2);
    expect(result.incomplete).toEqual([]);
  });

  it("the tools are the three the skill names", () => {
    expect(SOW_TOOLS.map((t) => t.name)).toEqual(["file_kind", "add_line", "add_noted"]);
  });
});

describe("a long file is cut at blank lines, never mid-line", () => {
  it("a short file is one part; a long one splits and loses nothing", () => {
    expect(splitForSow("short")).toEqual(["short"]);
    const para = (n: number) => `## Day ${n}\n\n${"- a line of words that someone said on that day\n".repeat(20)}`;
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n");
    const parts = splitForSow(text, 3000);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3000);
    expect(parts.join("\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});

describe("the week grid's count", () => {
  const key: SowKey = {
    lines: [
      { date: "2026-07-20", heading: "Austin", text: "We need to remove all of the ceilings to see the critical structure for engineering." },
      { date: "2026-07-20", heading: "Beaudy", text: "Maybe we just keep a 18″ perimeter of the floor in place to keep the joists locked in." },
      { date: "2026-07-29", heading: "Erica", text: "Ok I just reached out to her because you never know." },
    ],
    noted: [{ date: "2026-07-20", text: "Ceiling demo priced at $11,700 by Beaudy (verbal ~$9,500 via Lucas)." }],
  };
  const window = { from: "2026-07-20", to: "2026-07-29" };
  const perfect: SowCandidate = {
    lines: key.lines.map((l) => ({ ...l })),
    noted: [{ date: "2026-07-20", text: "Beaudy priced the ceiling demo at $11,700; his verbal number via Lucas was about $9,500." }],
    held: [],
  };

  it("a perfect run scores every line and the Noted fact at half", () => {
    const s = scoreSow({ key, candidate: perfect, window });
    expect(s).toMatchObject({ recovered: 3, wrongName: 0, heldBack: 0, extra: 0, notedHit: 1, notedExtra: 0 });
    expect(s.score).toBe(3 * SOW_WEIGHTS.recovered + SOW_WEIGHTS.noted);
  });

  it("a wrong name costs double, a held-back line one; a line the key left out is counted and costs nothing", () => {
    const candidate: SowCandidate = {
      lines: [
        { ...key.lines[0], heading: "Austin Trautman" },
        { ...key.lines[1], heading: "Lucas" },
        { date: "2026-07-23", heading: "Austin", text: "Fast! That's crazy." },
      ],
      noted: [],
      held: [{ date: "2026-07-29", text: key.lines[2].text }],
    };
    const s = scoreSow({ key, candidate, window });
    expect(s).toMatchObject({ recovered: 1, wrongName: 1, heldBack: 1, extra: 1, notedHit: 0 });
    expect(s.score).toBe(1 - 2 - 1);
    expect(s.detail.wrongName[0].as).toBe("Lucas");
    expect(s.detail.extra[0].text).toBe("Fast! That's crazy.");
    expect(s.detail.notedMissing).toHaveLength(1);
  });

  it("an excused line and a line outside the window score nothing either way", () => {
    const candidate: SowCandidate = {
      lines: [
        ...perfect.lines,
        { date: "2026-07-29", heading: "Lucas", text: "rather than being stuck in the Bonfire of the Vanities" },
        { date: "2026-07-30", heading: "Austin", text: "Beaudy for sure didn't pull a permit for demo." },
      ],
      noted: perfect.noted,
      held: [],
    };
    const s = scoreSow({ key, candidate, window, excused: ["Bonfire of the Vanities"] });
    expect(s).toMatchObject({ recovered: 3, extra: 0, excused: 1 });
  });

  it("the same words a day off still count: the key files two adjacent days together", () => {
    const candidate: SowCandidate = { ...perfect, lines: perfect.lines.map((l, i) => (i === 2 ? { ...l, date: "2026-07-28" } : l)) };
    expect(scoreSow({ key, candidate, window }).recovered).toBe(3);
    const far: SowCandidate = { ...perfect, lines: perfect.lines.map((l, i) => (i === 2 ? { ...l, date: "2026-07-25" } : l)) };
    expect(scoreSow({ key, candidate: far, window })).toMatchObject({ recovered: 2, extra: 1 });
  });

  it("a key line written as two lines is recovered once and the rest is not an extra", () => {
    const long: SowKey = { lines: [{ date: "2026-07-20", heading: "Austin", text: "The city considers 7th Ave the front, so that helps us with zoning. It should also avoid the need for a proper survey, which saves time and costs." }], noted: [] };
    const candidate: SowCandidate = {
      lines: [
        { date: "2026-07-20", heading: "Austin", text: "The city considers 7th Ave the front, so that helps us with zoning." },
        { date: "2026-07-20", heading: "Austin", text: "It should also avoid the need for a proper survey, which saves time and costs." },
      ],
      noted: [],
      held: [],
    };
    expect(scoreSow({ key: long, candidate, window })).toMatchObject({ recovered: 1, extra: 0, split: 1, score: 1 });
  });

  it("a Noted fact matches on its numbers and half its words, not its wording", () => {
    expect(notedMatches("Ceiling demo priced at $11,700 by Beaudy.", "Beaudy's price for the ceiling demo: $11,700.")).toBe(true);
    expect(notedMatches("Ceiling demo priced at $11,700 by Beaudy.", "Beaudy's price for the ceiling demo: $9,500.")).toBe(false);
    expect(notedMatches("Michelle Meisenbach (M5) signed her contract.", "Demo starts 7/21.")).toBe(false);
  });
});

describe("already logged? a line against the project's Cards", () => {
  const card = "## Campbell\n\nHVAC plan: ceiling-mounted heat pumps in the office and living room. Erica is fine with the Intellibalance exposed in the office.\n\n::file{name=\"a.jpg\" fileId=\"x\"}";

  it("the same sentence matches, punctuation and case aside; the same topic does not", () => {
    expect(matchesCard("HVAC plan: ceiling-mounted heat pumps in the office and living room.", card)).toBe(true);
    expect(matchesCard("hvac plan, ceiling mounted heat pumps in the office and living room", card)).toBe(true);
    expect(matchesCard("We talked about putting heat pumps somewhere in the office, maybe the living room too.", card)).toBe(false);
  });

  it("a short line matches only whole; two words never do", () => {
    expect(matchesCard("Erica is fine with the Intellibalance exposed", card)).toBe(true);
    expect(matchesCard("Erica is fine with it", card)).toBe(false);
    expect(matchesCard("heat pumps", card)).toBe(false);
  });

  it("only a Card within two days either side counts", () => {
    const cards = [{ date: "2026-09-10", content: card }];
    const text = "HVAC plan: ceiling-mounted heat pumps in the office and living room.";
    expect(findLoggedCard({ date: "2026-09-12", text }, cards)).toBe(cards[0]);
    expect(findLoggedCard({ date: "2026-09-13", text }, cards)).toBeNull();
    expect(findLoggedCard({ date: "2026-09-08", text }, cards)).toBe(cards[0]);
  });
});

describe("where each proposed line goes (the seed packets guide, 2026-09-30)", () => {
  const known = ["Austin", "Lucas", "Erica", "Beaudy"];
  const line = (over: Partial<SowLine>): SowLine => ({ date: "2026-08-05", speaker: "Erica", text: "Do the beams upstairs have to come down too?", speakerSure: true, dateSure: true, ...over });
  const cards = [{ date: "2026-08-05", humanId: "h_lucas", content: "HVAC plan: ceiling-mounted heat pumps in the office and living room." }];
  const base = { noted: [], known, cards, present: () => false, src: "Erica's seed packet, thread.txt" };

  it("a sure line from a known speaker goes under the name the project already uses", () => {
    const plan = planSow({ ...base, lines: [line({ speaker: "Erica C." })] });
    expect(plan.days.get("2026-08-05")).toEqual({ lines: [{ speaker: "Erica", text: "Do the beams upstairs have to come down too?", src: "Erica's seed packet, thread.txt" }], noted: [] });
    expect(plan.questions).toEqual([]);
  });

  it("an unsure speaker, or one nobody knows, sits in Noted and raises who-said-this", () => {
    const plan = planSow({ ...base, lines: [line({ speakerSure: false, speaker: "Erica", text: "E: ok with the exposed unit" }), line({ speaker: "Dallas", text: "Four guys on it tomorrow." })] });
    expect(plan.days.get("2026-08-05")).toEqual({ lines: [], noted: ["E: ok with the exposed unit", "Four guys on it tomorrow."] });
    expect(plan.questions.map((q) => [q.kind, q.speaker, q.speakerSettled])).toEqual([["who", "Erica", false], ["who", "Dallas", false]]);
  });

  it("a line a Card already says is held out, not written, and asks already-logged", () => {
    const plan = planSow({ ...base, lines: [line({ speaker: "Lucas", date: "2026-08-06", text: "HVAC plan: ceiling-mounted heat pumps in the office and living room." })] });
    expect(plan.days.size).toBe(0);
    expect(plan.questions).toEqual([{ kind: "logged", date: "2026-08-06", text: "HVAC plan: ceiling-mounted heat pumps in the office and living room.", speaker: "Lucas", speakerSettled: true, card: { date: "2026-08-05", humanId: "h_lucas" } }]);
  });

  it("an estimated date is held out and asks when; a line already in the seed is written by nobody twice", () => {
    const plan = planSow({
      ...base,
      present: (date, text) => date === "2026-08-05" && text.startsWith("Do the beams"),
      lines: [line({}), line({ dateSure: false, date: "2026-07-22", text: "We should walk the attic first." })],
      noted: [{ date: "2026-08-05", text: "The bid was $18,400.", dateSure: true }, { date: "2026-08-01", text: "Permit fee paid.", dateSure: false }],
    });
    expect(plan.alreadyThere).toBe(1);
    expect(plan.days.get("2026-08-05")).toEqual({ lines: [], noted: ["The bid was $18,400."] });
    expect(plan.questions.map((q) => [q.kind, q.date, q.speaker])).toEqual([["when", "2026-07-22", "Erica"], ["when", "2026-08-01", null]]);
  });

  it("a known speaker is matched by first name, whole name first", () => {
    expect(knownSpeaker("Austin Trautman", known)).toBe("Austin");
    expect(knownSpeaker("beaudy", known)).toBe("Beaudy");
    expect(knownSpeaker("Michelle Meisenbach", [...known, "Michelle Meisenbach"])).toBe("Michelle Meisenbach");
    expect(knownSpeaker("Dallas", known)).toBeNull();
    expect(knownSpeaker("", known)).toBeNull();
  });
});

describe("a packet file and a question, as code reads them", () => {
  it("text is read by the stage; a PDF or a photo is kept as a document", () => {
    expect(isPacketText("thread.txt", "application/octet-stream")).toBe(true);
    expect(isPacketText("export.eml", "message/rfc822")).toBe(true);
    expect(isPacketText("notes.md", "text/markdown")).toBe(true);
    expect(isPacketText("inspection.pdf", "application/pdf")).toBe(false);
    expect(isPacketText("IMG_4509.jpeg", "image/jpeg")).toBe(false);
  });

  it("each kind of question asks its own thing and says what yes and no do", () => {
    expect(seedQuestionSentence({ kind: "who", speaker: "Erica", date: "2026-08-05", card: null })).toBe("I think this is Erica. Is it?");
    expect(seedQuestionSentence({ kind: "logged", speaker: "Lucas", date: "2026-08-06", card: { date: "2026-08-05", humanId: "h", name: "Lucas" } })).toBe("This matches Lucas's 8/5 Card. Skip it?");
    expect(seedQuestionSentence({ kind: "when", speaker: null, date: "2026-07-22", card: null })).toBe("Is this from about 7/22?");
    expect(seedQuestionMeaning({ kind: "who", speaker: "Erica" })).toEqual({ yes: "Yes puts it under Erica.", no: "No leaves it as a noted fact, nobody's words." });
    expect(seedQuestionMeaning({ kind: "logged", speaker: "Lucas" }).yes).toBe("Yes leaves it out.");
  });
});
