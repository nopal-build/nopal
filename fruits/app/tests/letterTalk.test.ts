/**
 * The talk box and the outline on any letter, brief or no brief, and a
 * talk-through that waits for Send (2026-11-05). Austin: "you could talk
 * it through and then decide that it's not important. Once you send the
 * letter, that is kind of the distinction, that this is something that
 * matters."
 *
 * What is held here: giving the talk writes nothing to a Card; sending
 * the letter puts it on its speaker's Card for the send day, once; an
 * outline asked for without a brief is written from the talk and opens
 * nothing in the graph. The store, the Card door, the queue and the
 * model are stubbed; the rules are what is under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmResponse } from "robustness-core/data/llmProvider";

const here = path.dirname(fileURLToPath(import.meta.url));

const sharing = [
  { human: "guideA", role: "Guide" },
  { human: "guideB", role: "Guide" },
  { human: "crafter", role: "Crafter" },
  { human: "clientA", role: "Client" },
];
const files: Record<string, Record<string, unknown>> = {};
const folders: Record<string, Record<string, unknown>> = {
  letters: { _id: "letters", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  proj: { _id: "proj", human_id: "guideA", project_status: "active" },
};
const rows = new Map<string, Record<string, unknown>>();
const cards: { humanId: string; date: string; projectFolderId: string; text: string }[] = [];
const synced: { projectFolderId: string; date?: string }[] = [];
const jobs: Record<string, unknown>[] = [];
const opened: string[] = [];
const usage: Record<string, unknown>[] = [];
let cardDoor: "open" | "broken" = "open";
let off: string[] = [];

vi.mock("robustness-core/data/vault.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/vault.server")>();
  return {
    ...actual,
    getFileRefById: vi.fn(async (id: string) => files[id]),
    getFolderById: vi.fn(async (id: string) => folders[id]),
    listFolderChildren: vi.fn(async (_humanId: string, parentId: string) => {
      opened.push(`listFolderChildren:${parentId}`);
      return { folders: Object.values(folders).filter((f) => f.parent_folder_id === parentId), files: [] };
    }),
  };
});
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
    getProjectSharing: vi.fn(async () => {
      opened.push("getProjectSharing");
      return sharing;
    }),
    getProjectRole: vi.fn(async (_project: unknown, humanId: string) => {
      const entry = sharing.find((e) => e.human === humanId);
      return entry && !off.includes(humanId) ? actual.resolveRole(entry.role) : null;
    }),
  };
});
vi.mock("robustness-core/data/organizations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/organizations.server")>();
  return { ...actual, getOrganizationMembers: vi.fn(async () => []) };
});
vi.mock("robustness-core/data/humans.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/humans.server")>();
  return { ...actual, getHumansById: vi.fn(async (ids: string[]) => ids.map((id) => ({ _id: id, name: id === "guideB" ? "Gerald Guide" : "Lucas Guide", email: `${id}@example.com` }))) };
});
vi.mock("robustness-core/data/generic.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/generic.server")>();
  return {
    ...actual,
    defineTable: vi.fn(async () => undefined),
    merge: vi.fn(async (_table: string, id: string, data: Record<string, unknown>) => {
      files[id] = { ...files[id], ...data };
      return files[id];
    }),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    query: vi.fn(async () => [[]]),
  };
});
vi.mock("robustness-core/data/brief.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/brief.server")>();
  return {
    ...actual,
    getLetterBriefRow: vi.fn(async (id: string) => rows.get(id) ?? null),
    writeLetterBriefRow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      rows.set(id, { ...(rows.get(id) ?? {}), ...patch });
    }),
    jobIsRunning: vi.fn(async () => false),
  };
});
vi.mock("robustness-core/data/dailyLog.server", () => ({
  appendToCard: vi.fn(async (input: { humanId: string; date: string; projectFolderId: string; text: string; features: readonly string[] }) => {
    if (cardDoor === "broken") throw new Error("the Card could not be written");
    if (!input.features.includes("dailyLog")) throw new Error("You're not on this project's log");
    cards.push({ humanId: input.humanId, date: input.date, projectFolderId: input.projectFolderId, text: input.text });
    return { fileId: `card-${input.humanId}-${input.date}`, suggestion: false };
  }),
}));
vi.mock("robustness-core/data/dailyLogSync.server", () => ({
  runDailyLogSync: vi.fn(async (projectFolderId: string, range: { date?: string }) => {
    synced.push({ projectFolderId, date: range.date });
    return { synced: [], unchanged: [], attachmentsCopied: [], incomplete: [] };
  }),
}));
vi.mock("robustness-core/data/graphLogQueue.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphLogQueue.server")>();
  return {
    ...actual,
    enqueueGraphLogJob: vi.fn(async (_stage: string, data: Record<string, unknown>) => {
      jobs.push(data);
      return `job${jobs.length}`;
    }),
    throwIfGraphLogCancelled: vi.fn(async () => undefined),
  };
});
vi.mock("robustness-core/data/graphLogMetrics.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphLogMetrics.server")>();
  return { ...actual, recordGraphLogUsage: vi.fn(async (event: Record<string, unknown>) => void usage.push(event)) };
});
vi.mock("robustness-core/data/graphLogDefaults.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphLogDefaults.server")>();
  return { ...actual, getEffectiveGraphLogDefaultSkill: vi.fn(async (stage: string) => `SKILL:${stage}`) };
});
vi.mock("robustness-core/data/projectN02.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectN02.server")>();
  return {
    ...actual,
    getProjectStageSkill: vi.fn(async (_project: unknown, name: string) => (name === "OUTLINE.md" ? null : "THE PROJECT'S OWN SKILL")),
    listExtraSkillFiles: vi.fn(async () => {
      opened.push("listExtraSkillFiles");
      return [{ name: "EXTRA.md", content: "AN EXTRA SKILL FILE" }];
    }),
    findProjectGraphFolder: vi.fn(async () => {
      opened.push("findProjectGraphFolder");
      return { _id: "graph" };
    }),
  };
});
vi.mock("robustness-core/data/graphProjectView.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphProjectView.server")>();
  return {
    ...actual,
    loadGraphNodes: vi.fn(async () => {
      opened.push("loadGraphNodes");
      return { allNodes: [{ id: "2026-08-05#1", date: "2026-08-05", number: 1, quote: "THE JOISTS ARE 5.5 INCHES DEEP", authorName: "Susan", authorHumanId: null, origin: "seed", refLine: ':ref{name="Susan"}', links: [] }], issues: [] };
    }),
  };
});
vi.mock("robustness-core/data/seed.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/seed.server")>();
  return { ...actual, findSeedSyncFolder: vi.fn(async () => null) };
});
let projectionDoor: "open" | "broken" = "open";
vi.mock("robustness-core/data/letterSync.server", () => ({
  syncLettersProjection: vi.fn(async () => {
    if (projectionDoor === "broken") throw new Error("the projection folder could not be written");
    return { written: 0 };
  }),
}));
vi.mock("robustness-core/data/letterPdf.server", () => ({ enqueueLetterPdfIfSent: vi.fn(async () => undefined) }));

const { sendTalkThrough, requestOutline, runOutline, landTalkThrough, talkIsWaiting } = await import("robustness-core/data/outline.server");
const { sendLetter } = await import("robustness-core/data/letterSend.server");
const { talkOnRecord } = await import("robustness-core/data/brief.server");
const { resolveRole } = await import("robustness-core/data/projectSharing.server");

const project = folders.proj as never;
const person = (id: string) => ({ _id: id, role: "Human" as const });
const featuresOf = (group: string) => resolveRole(group)?.features ?? [];
const letter = (id: string, over: Record<string, unknown> = {}) => {
  files[id] = { _id: id, name: `${id}.md`, content: `# ${id}\n\nWords.\n`, folder_id: "letters", updated_at: "2026-11-05T10:00:00Z", to_house: "guides", ...over };
  return files[id] as never;
};
const TALK = "Three things for Susan: the windows, the fan, and why the floor can wait.";

/** A model that writes one outline and keeps the prompt it was given. */
function scripted(markdown: string): LlmProvider & { systems: string[] } {
  const systems: string[] = [];
  return {
    systems,
    async complete(input) {
      systems.push(input.system ?? "");
      return { text: null, toolCalls: [{ id: "c0", name: "write_outline", input: { markdown } }], thinking: { blocks: 0, text: "" }, partialToolCall: null, stopReason: "tool_use", usage: { inputTokens: 900, outputTokens: 120 }, model: "scripted" } as LlmResponse;
    },
  };
}

beforeEach(() => {
  for (const id of Object.keys(files)) delete files[id];
  rows.clear();
  cards.length = 0;
  synced.length = 0;
  jobs.length = 0;
  opened.length = 0;
  usage.length = 0;
  cardDoor = "open";
  off = [];
});

describe("giving the talk, with or without a brief", () => {
  it("a letter with no brief takes a talk-through and asks for the outline", async () => {
    const result = await sendTalkThrough(project, letter("l1"), { humanId: "guideB", features: featuresOf("Guide") }, { text: `  ${TALK}  ` });
    expect(result).toMatchObject({ ok: true });
    expect(jobs).toEqual([{ actingHumanId: "guideB", projectFolderId: "proj", fileId: "l1", kind: "outline" }]);
    expect(rows.get("l1")).toMatchObject({ talk_through: TALK, talk_through_by_human_id: "guideB", talk_draft: null });
  });

  it("writes nothing to a Card and claims no day on the record: it waits", async () => {
    await sendTalkThrough(project, letter("l1"), { humanId: "guideB", features: featuresOf("Guide") }, { text: TALK });
    expect(cards).toEqual([]);
    expect(synced).toEqual([]);
    expect(rows.get("l1")).toMatchObject({ talk_through_date: null, talk_through_card_file_id: null });
    expect(talkIsWaiting(rows.get("l1"))).toBe(true);
    expect(talkOnRecord(rows.get("l1") as never)).toBeNull();
  });

  it("someone who could not put it on the record is told now, and nothing is kept", async () => {
    const refused = await sendTalkThrough(project, letter("l1"), { humanId: "stranger", features: [] }, { text: TALK });
    expect(refused).toMatchObject({ ok: false, status: 403 });
    expect(rows.has("l1")).toBe(false);
    expect(jobs).toEqual([]);
    expect(await sendTalkThrough(project, letter("l1"), { humanId: "guideB", features: featuresOf("Guide") }, { text: "   " })).toMatchObject({ ok: false, status: 400 });
  });

  it("Write it again needs a talk and no brief", async () => {
    expect(await requestOutline(project, letter("l1"), "guideB")).toMatchObject({ ok: false, status: 400, error: "Talk it through first." });
    rows.set("l1", { talk_through: TALK });
    expect(await requestOutline(project, letter("l1"), "guideB")).toMatchObject({ ok: true });
  });
});

describe("the talk-through goes on the record when the letter is sent, and not before", () => {
  it("at Send it lands on its speaker's Card for the send day, as their words, and that day is copied into the project", async () => {
    const file = letter("l1");
    await sendTalkThrough(project, file, { humanId: "guideB", features: featuresOf("Guide") }, { text: TALK });
    expect(cards).toEqual([]);
    // Another guide sends it: the talk is still its speaker's.
    const sent = await sendLetter(person("guideA"), file, { date: "2026-11-06" });
    expect(sent).toMatchObject({ ok: true });
    expect(cards).toEqual([{ humanId: "guideB", date: "2026-11-06", projectFolderId: "proj", text: TALK }]);
    expect(synced).toEqual([{ projectFolderId: "proj", date: "2026-11-06" }]);
    expect(rows.get("l1")).toMatchObject({ talk_through_date: "2026-11-06", talk_through_card_file_id: "card-guideB-2026-11-06" });
    expect(talkOnRecord(rows.get("l1") as never)).toBe("2026-11-06");
  });

  it("once: sending again adds nothing", async () => {
    const file = letter("l1");
    await sendTalkThrough(project, file, { humanId: "guideA", features: featuresOf("Guide") }, { text: TALK });
    await sendLetter(person("guideA"), file, { date: "2026-11-06" });
    await sendLetter(person("guideA"), files.l1 as never, { date: "2026-11-07" });
    expect(cards.length).toBe(1);
  });

  it("a talk given before this rule already has its Card and is left alone", async () => {
    const file = letter("l1");
    rows.set("l1", { talk_through: TALK, talk_through_by_human_id: "guideA", talk_through_date: "2026-10-28", talk_through_card_file_id: "card-old" });
    await sendLetter(person("guideA"), file, { date: "2026-11-06" });
    expect(cards).toEqual([]);
    expect(rows.get("l1")).toMatchObject({ talk_through_date: "2026-10-28", talk_through_card_file_id: "card-old" });
  });

  it("a letter nobody talked through, or one with only a half-typed talk, sends with nothing added", async () => {
    await sendLetter(person("guideA"), letter("l1"), { date: "2026-11-06" });
    rows.set("l2", { talk_draft: "so far" });
    await sendLetter(person("guideA"), letter("l2"), { date: "2026-11-06" });
    expect(cards).toEqual([]);
  });

  it("the letter is sent even when the Card can't be written, and the talk lands at the next send", async () => {
    const file = letter("l1");
    await sendTalkThrough(project, file, { humanId: "guideA", features: featuresOf("Guide") }, { text: TALK });
    cardDoor = "broken";
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendLetter(person("guideA"), file, { date: "2026-11-06" })).toMatchObject({ ok: true, missed: ["talk"] });
    quiet.mockRestore();
    expect(talkIsWaiting(rows.get("l1"))).toBe(true);
    cardDoor = "open";
    await sendLetter(person("guideA"), files.l1 as never, { date: "2026-11-07" });
    expect(cards).toEqual([{ humanId: "guideA", date: "2026-11-07", projectFolderId: "proj", text: TALK }]);
  });

  it("the record write is the send: a consequence that fails (the graph's copy here) is named, not reported as a failed send, and the rest still run", async () => {
    const file = letter("l1");
    await sendTalkThrough(project, file, { humanId: "guideA", features: featuresOf("Guide") }, { text: TALK });
    projectionDoor = "broken";
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = await sendLetter(person("guideA"), file, { date: "2026-11-06" });
    quiet.mockRestore();
    projectionDoor = "open";
    expect(sent).toMatchObject({ ok: true, count: 1, missed: ["projection"] });
    expect(files.l1).toMatchObject({ sent_count: 1 });
    // The talk still landed after the failed step.
    expect(cards).toEqual([{ humanId: "guideA", date: "2026-11-06", projectFolderId: "proj", text: TALK }]);
    // A clean send names nothing.
    expect(await sendLetter(person("guideA"), files.l1 as never, { date: "2026-11-07" })).toMatchObject({ ok: true, missed: [] });
    // The route hands `missed` to the page, which says so beside "Sent".
    expect(readFileSync(path.join(here, "../routes/api.letter.$fileId.send.tsx"), "utf8")).toContain("missed: result.missed");
    expect(readFileSync(path.join(here, "../components/LetterSendControl.tsx"), "utf8")).toContain("setError(body.missed?.length ? SEND_FOLLOWUP_MISSED : null);");
  });

  it("a speaker who has left the project's log by Send: the letter goes, their talk stays off the record", async () => {
    const file = letter("l1");
    await sendTalkThrough(project, file, { humanId: "guideB", features: featuresOf("Guide") }, { text: TALK });
    off = ["guideB"];
    expect(await sendLetter(person("guideA"), file, { date: "2026-11-06" })).toMatchObject({ ok: true });
    expect(cards).toEqual([]);
    expect(await landTalkThrough(project, "l1", "2026-11-06")).toEqual({ landed: false });
  });
});

describe("the outline without a brief is given the talk and nothing from the graph", () => {
  it("the call holds the title, the writer's name and the talk; no node, no people, no brief, no project skill, and the graph is never opened", async () => {
    letter("l1", { name: "The attic floor.md", purpose: "THE PURPOSE LINE" });
    rows.set("l1", { content: null, talk_through: TALK, talk_through_by_human_id: "guideB" });
    const provider = scripted("## The windows\n\n- They stay cracked an inch through winter.\n");
    const result = await runOutline(project, "l1", "guideB", { provider, runId: "run1" });
    expect(result).toMatchObject({ ok: true, topics: ["The windows"], unmatched: [] });
    const system = provider.systems[0];
    expect(system).toContain("SKILL:outlineTalk");
    expect(system).toContain(TALK);
    expect(system).toContain("Gerald");
    expect(system).toContain("The attic floor");
    for (const leak of ["THE JOISTS", "SKILL:outline\n", "THE PROJECT'S OWN SKILL", "AN EXTRA SKILL FILE", "THE PURPOSE LINE", "The people:", "The brief", "Every node"]) expect(system, leak).not.toContain(leak);
    expect(opened).toEqual([]);
    expect(rows.get("l1")).toMatchObject({ outline: "## The windows\n\n- They stay cracked an inch through winter.\n", outline_run_id: "run1", outline_pending_job_id: null });
    expect(usage).toEqual([expect.objectContaining({ runId: "run1", stage: "brief", kind: "outline", outcome: "success", usage: expect.objectContaining({ inputTokens: 900, outputTokens: 120 }) })]);
  });

  it("with a brief it runs as it did: the brief, the people and every node go in", async () => {
    letter("l1", { purpose: "THE PURPOSE LINE" });
    rows.set("l1", { content: "## The ask\n\n- THE BRIEF'S WORDS\n", talk_through: TALK, talk_through_by_human_id: "guideB" });
    const provider = scripted("## A topic\n\n- Position: slow, not stop.\n\n## Go do\n\n- Check the windows.\n");
    expect(await runOutline(project, "l1", "guideB", { provider })).toMatchObject({ ok: true });
    const system = provider.systems[0];
    for (const held of ["SKILL:outline\n", "THE BRIEF'S WORDS", "THE JOISTS", "THE PURPOSE LINE", "The people:", TALK]) expect(system, held).toContain(held);
    expect(system).not.toContain("SKILL:outlineTalk");
    expect(opened).toContain("loadGraphNodes");
  });

  it("no talk, no outline; and asking for one never puts the talk on a Card", async () => {
    letter("l1");
    rows.set("l1", { content: null, talk_through: "  " });
    expect(await runOutline(project, "l1", "guideB", { provider: scripted("## x\n\n- y\n") })).toMatchObject({ ok: false, error: "Nothing has been talked through yet." });
    rows.set("l1", { content: null, talk_through: TALK, talk_through_by_human_id: "guideB", talk_through_date: null });
    await runOutline(project, "l1", "guideB", { provider: scripted("## x\n\n- y\n") });
    expect(cards).toEqual([]);
    expect(synced).toEqual([]);
  });
});
