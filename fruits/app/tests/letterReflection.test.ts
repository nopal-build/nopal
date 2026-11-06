/**
 * Talking a letter through while reading it, and a letter started from
 * what was said (2026-11-06; `letterReflection.server.ts`). Austin:
 * "There should be an option to talk through the letter while you are
 * viewing it ... It wouldn't be 'reply to this,' but it would be
 * something about spending the time to sit down and write a letter back,
 * based on those thoughts."
 *
 * Held here: who may reflect and who is refused; a draft is on no Card,
 * keeping it puts it on its speaker's own Card once, by the daily log's
 * rules; the page is handed the viewer's own and nobody else's; a letter
 * is started only from one's own kept reflection on a letter in the same
 * project, and carries it as already on the record; its outline is given
 * the reflection, the letter read and the sender's older words, and
 * nothing else. The store, the Card door, the queue and the model are
 * stubbed; the rules are what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmResponse } from "robustness-core/data/llmProvider";
import { mayReflect } from "robustness-core/data/letterHouses";

const lists: Record<string, { human: string; role: string }[]> = {
  proj: [
    { human: "guideA", role: "Guide" },
    { human: "guideB", role: "Guide" },
    { human: "crafter", role: "Crafter" },
    { human: "observer", role: "Observer" },
    { human: "clientA", role: "Client" },
    { human: "clientB", role: "Client" },
  ],
  other: [{ human: "guideA", role: "Guide" }],
};
const files: Record<string, Record<string, unknown>> = {};
const folders: Record<string, Record<string, unknown>> = {
  root: { _id: "root", vault_root_key: "projects" },
  proj: { _id: "proj", human_id: "guideA", project_status: "active", vault_root_key: "projects", parent_folder_id: "root" },
  other: { _id: "other", human_id: "guideA", project_status: "active", vault_root_key: "projects", parent_folder_id: "root" },
  letters: { _id: "letters", human_id: "guideA", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  lettersOther: { _id: "lettersOther", human_id: "guideA", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "other" },
};
const tables: Record<string, Map<string, Record<string, unknown>>> = {};
const table = (name: string) => (tables[name] ??= new Map());
const briefRows = new Map<string, Record<string, unknown>>();
const cards: { humanId: string; date: string; projectFolderId: string; text: string; suggestion: boolean }[] = [];
const synced: { projectFolderId: string; date?: string }[] = [];
const opened: string[] = [];
let cardDoor: "open" | "broken" = "open";
let session: { user: string | null; lookingAs: boolean } = { user: null, lookingAs: false };
const names: Record<string, string> = { guideA: "Lucas Guide", guideB: "Gerald Guide", clientA: "Susan Client", clientB: "Jon Client", crafter: "Cam Crafter", observer: "Olive Observer" };

vi.mock("../modules/auth/auth.server", () => ({
  getUserFromRequest: vi.fn(async () => (session.user ? { _id: session.user, role: "Human", name: names[session.user] } : null)),
  isImpersonating: vi.fn(async () => session.lookingAs),
}));
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
    getFileRefsByFolderIds: vi.fn(async (ids: string[]) => Object.values(files).filter((f) => ids.includes(String(f.folder_id)))),
    createFileRef: vi.fn(async (data: Record<string, unknown>) => {
      const _id = `new${Object.keys(files).length + 1}`;
      files[_id] = { _id, updated_at: "2026-11-06T12:00:00Z", ...data };
      return files[_id];
    }),
  };
});
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
    getProjectSharing: vi.fn(async (project: { _id: string }) => {
      opened.push("getProjectSharing");
      return lists[project._id] ?? [];
    }),
    getProjectRole: vi.fn(async (project: { _id: string }, humanId: string) => {
      const entry = lists[project._id]?.find((e) => e.human === humanId);
      return entry ? actual.resolveRole(entry.role) : null;
    }),
  };
});
vi.mock("robustness-core/data/organizations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/organizations.server")>();
  return { ...actual, getOrganizationMembers: vi.fn(async () => []) };
});
vi.mock("robustness-core/data/humans.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/humans.server")>();
  const human = (id: string) => (names[id] ? { _id: id, name: names[id], email: `${id}@example.com` } : undefined);
  return { ...actual, getHumanById: vi.fn(async (id: string) => human(id)), getHumansById: vi.fn(async (ids: string[]) => ids.map(human).filter(Boolean)) };
});
vi.mock("robustness-core/data/generic.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/generic.server")>();
  return {
    ...actual,
    defineTable: vi.fn(async () => undefined),
    select: vi.fn(async (record: { tb: string; id: string }) => {
      const row = table(record.tb).get(String(record.id));
      return row ? { id: { tb: record.tb, id: String(record.id) }, ...row } : undefined;
    }),
    merge: vi.fn(async (name: string, id: string, data: Record<string, unknown>) => {
      if (name === "file_refs") files[id] = { ...files[id], ...data };
      else table(name).set(id, { ...(table(name).get(id) ?? {}), ...data });
    }),
    upsert: vi.fn(async (record: { tb: string; id: string }, data: Record<string, unknown>) => {
      table(record.tb).set(String(record.id), data);
    }),
    remove: vi.fn(async () => undefined),
    query: vi.fn(async () => [[]]),
  };
});
vi.mock("robustness-core/data/brief.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/brief.server")>();
  return {
    ...actual,
    getLetterBriefRow: vi.fn(async (id: string) => briefRows.get(id) ?? null),
    writeLetterBriefRow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      briefRows.set(id, { ...(briefRows.get(id) ?? {}), ...patch });
    }),
    requestBrief: vi.fn(async () => ({ ok: true, jobId: "briefJob" })),
    jobIsRunning: vi.fn(async () => false),
  };
});
vi.mock("robustness-core/data/dailyLog.server", () => ({
  appendToCard: vi.fn(async (input: { humanId: string; date: string; projectFolderId: string; text: string; features: readonly string[] }) => {
    if (cardDoor === "broken") throw new Error("the Card could not be written");
    if (!input.features.includes("dailyLog")) throw new Error("You're not on this project's log");
    const suggestion = !input.features.includes("feeds");
    cards.push({ humanId: input.humanId, date: input.date, projectFolderId: input.projectFolderId, text: input.text, suggestion });
    return { fileId: `card-${input.humanId}-${input.date}`, suggestion };
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
  return { ...actual, enqueueGraphLogJob: vi.fn(async () => "job1"), throwIfGraphLogCancelled: vi.fn(async () => undefined) };
});
vi.mock("robustness-core/data/graphLogMetrics.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphLogMetrics.server")>();
  return { ...actual, recordGraphLogUsage: vi.fn(async () => undefined) };
});
vi.mock("robustness-core/data/graphLogMarks.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphLogMarks.server")>();
  return { ...actual, createMark: vi.fn(async () => ({ _id: "mark1" })) };
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
    listExtraSkillFiles: vi.fn(async () => [{ name: "EXTRA.md", content: "AN EXTRA SKILL FILE" }]),
    findProjectGraphFolder: vi.fn(async () => {
      opened.push("findProjectGraphFolder");
      return { _id: "graph" };
    }),
  };
});
vi.mock("robustness-core/data/graphProjectView.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/graphProjectView.server")>();
  const node = (number: number, date: string, quote: string, authorHumanId: string | null, authorName: string) => ({ id: `${date}#${number}`, date, number, quote, authorName, authorHumanId, origin: null, refLine: `:ref{name="${authorName}"}`, links: [] });
  return {
    ...actual,
    loadGraphNodes: vi.fn(async () => {
      opened.push("loadGraphNodes");
      return {
        allNodes: [
          node(2, "2026-09-12", "LUCAS SAID THE FAN IS UNDERSIZED", "guideA", "Lucas"),
          node(1, "2026-08-20", "LUCAS SAID PHASES CHANGE THE OUTPUT", "guideA", "Lucas"),
          node(3, "2026-09-14", "SUSAN ASKED WHAT THE RECEIPT WAS FOR", "clientA", "Susan"),
          node(4, "2026-09-15", "A SEED PACKET LINE UNDER LUCAS'S NAME", null, "Lucas"),
        ],
        issues: [],
      };
    }),
  };
});
vi.mock("robustness-core/data/seed.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/seed.server")>();
  return { ...actual, findSeedSyncFolder: vi.fn(async () => null) };
});
vi.mock("robustness-core/data/letterSync.server", () => ({ syncLettersProjection: vi.fn(async () => ({ written: 0 })) }));
vi.mock("robustness-core/data/letterPdf.server", () => ({ enqueueLetterPdfIfSent: vi.fn(async () => undefined) }));
vi.mock("robustness-core/data/letterFlags.server", () => ({ raiseLetterFlags: vi.fn(async () => undefined), lowerLetterFlag: vi.fn(async () => undefined), flaggedLetterIds: vi.fn(async () => new Set()) }));

const { getReflection, keepReflection, saveReflectionDraft, reflectionForPage, reflectionLead, reflectionToStartFrom, REFLECTION_KEPT_ALREADY } = await import("robustness-core/data/letterReflection.server");
const { readLetter } = await import("robustness-core/data/letterReading.server");
const { sendLetter } = await import("robustness-core/data/letterSend.server");
const { sendTalkThrough, requestOutline, runOutline } = await import("robustness-core/data/outline.server");
const { resolveRole } = await import("robustness-core/data/projectSharing.server");
const { letterForReader } = await import("../data/letterReader.server");
const lettersRoute = await import("../routes/api.projects.$folderId.letters");

const project = folders.proj as never;
const featuresOf = (group: string) => resolveRole(group)?.features ?? [];
const speaker = (id: string) => ({ humanId: id, features: featuresOf(lists.proj.find((e) => e.human === id)!.role) });
const toClients = { from_human_id: "guideA", from_house: "guides", to_house: "clients" };
const toTeam = { from_human_id: "guideA", from_house: "guides", to_house: "guides" };
const fromClient = { from_human_id: "clientA", from_house: "clients", to_house: "guides" };
/** A sent letter in the walk project's Letters folder. */
const sent = (id: string, over: Record<string, unknown> = {}) => {
  files[id] = { _id: id, name: `${id}.md`, content: `# ${id}\n\nWords.\n`, folder_id: "letters", updated_at: "2026-11-05T10:00:00Z", sent_content: `# ${id}\n\nTHE LETTER AS SENT.\n`, sent_at: "2026-11-05T10:00:00Z", sent_date: "2026-11-05", sent_count: 1, sent_by_human_id: "guideA", ...over };
  return files[id] as never;
};
const WORDS = "The fan matters more than the floor, and I keep thinking about the gable windows.";
const asUser = (user: string | null, lookingAs = false) => (session = { user, lookingAs });
const request = () => new Request("http://localhost/x", { method: "POST" });
const startLetter = async (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: "What I make of it", purpose: "Say where I land on the attic.", to: "clients", date: "2026-11-06", ...fields })) form.append(k, v);
  const res = (await lettersRoute.action({ request: new Request("http://localhost/api/projects/proj/letters", { method: "POST", body: form }), params: { folderId: "proj" }, context: {} } as never)) as Response;
  return { status: res.status, body: (await res.json()) as { fileId?: string; error?: string } };
};
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
const BACK = `## What you're saying\n\nThe fan comes first.\n\n## Where it starts\n\n- The fan.\n\n## The middle\n\n- The windows.\n\n## Where it lands\n\n- The floor can wait.\n`;

beforeEach(() => {
  for (const id of Object.keys(files)) delete files[id];
  for (const name of Object.keys(tables)) delete tables[name];
  briefRows.clear();
  cards.length = 0;
  synced.length = 0;
  opened.length = 0;
  cardDoor = "open";
  session = { user: null, lookingAs: false };
});

describe("who may talk a letter through", () => {
  it("anyone the sent letter is shown to: both houses of a letter between them, the team on a team letter, anyone on the project for a letter with no house; never a draft, never someone with no place", () => {
    for (const house of ["guides", "clients"] as const) {
      expect(mayReflect(toClients, house, true)).toBe(true);
      expect(mayReflect(fromClient, house, true)).toBe(true);
      expect(mayReflect({}, house, true)).toBe(true);
      expect(mayReflect(toClients, house, false)).toBe(false);
    }
    expect(mayReflect(toTeam, "guides", true)).toBe(true);
    expect(mayReflect(toTeam, "clients", true)).toBe(false);
    expect(mayReflect(toClients, null, true)).toBe(false);
  });

  it("the reader's gate: a client is refused a letter the team sent the team, someone off the project and a draft are refused, and so is an admin looking as someone", async () => {
    sent("g2g", toTeam);
    sent("g2c", toClients);
    sent("old", {});
    files.draft = { _id: "draft", name: "draft.md", content: "# draft\n", folder_id: "letters" };
    const status = async (fileId: string) => {
      const got = await letterForReader(request(), fileId);
      return got instanceof Response ? got.status : 200;
    };
    asUser(null);
    expect(await status("g2c")).toBe(401);
    asUser("clientA");
    expect(await status("g2g")).toBe(404);
    expect(await status("g2c")).toBe(200);
    expect(await status("old")).toBe(200);
    expect(await status("draft")).toBe(404);
    for (const member of ["guideB", "crafter", "observer"]) {
      asUser(member);
      expect(await status("g2g"), member).toBe(200);
    }
    asUser("stranger");
    expect(await status("g2c")).toBe(404);
    asUser("clientA", true);
    expect(await status("g2c")).toBe(404);
  });
});

describe("a draft is the reader's alone; keeping it is what puts it on the record", () => {
  it("what is typed or said is kept as a draft on no Card and in no synced day", async () => {
    const letter = sent("g2c", toClients);
    expect(await saveReflectionDraft(project, letter, "clientA", "so far")).toEqual({ ok: true });
    expect(cards).toEqual([]);
    expect(synced).toEqual([]);
    expect(reflectionForPage(await getReflection("g2c", "clientA"))).toEqual({ draft: "so far", kept: null });
  });

  it("keeping it writes it to the speaker's own Card for that day, under one line saying which letter they were reading, and copies the day into the project", async () => {
    const letter = sent("g2c", { ...toClients, name: "The attic floor.md" });
    expect(await keepReflection(project, letter, speaker("clientA"), { text: `  ${WORDS}  `, date: "2026-11-06" })).toMatchObject({ ok: true, suggestion: false });
    expect(cards).toEqual([{ humanId: "clientA", date: "2026-11-06", projectFolderId: "proj", text: `Reading "The attic floor", from Lucas:\n\n${WORDS}`, suggestion: false }]);
    expect(synced).toEqual([{ projectFolderId: "proj", date: "2026-11-06" }]);
    // The row holds their words only; the line naming the letter is on the Card.
    expect(reflectionForPage(await getReflection("g2c", "clientA"))).toEqual({ draft: null, kept: { text: WORDS, date: "2026-11-06", suggestion: false } });
    expect(reflectionLead("Old news", null)).toBe('Reading "Old news":');
  });

  it("once: a second keep is refused, and so is a draft over what is kept", async () => {
    const letter = sent("g2c", toClients);
    await keepReflection(project, letter, speaker("clientA"), { text: WORDS, date: "2026-11-06" });
    expect(await keepReflection(project, letter, speaker("clientA"), { text: "More.", date: "2026-11-07" })).toMatchObject({ ok: false, status: 409, error: REFLECTION_KEPT_ALREADY });
    expect(await saveReflectionDraft(project, letter, "clientA", "More.")).toMatchObject({ ok: false, status: 409 });
    expect(cards.length).toBe(1);
  });

  it("by the daily log's own rule: an Observer's is a suggestion for a guide, a Client's and a Crafter's go straight on", async () => {
    const letter = sent("c2g", fromClient);
    expect(await keepReflection(project, letter, speaker("observer"), { text: WORDS, date: "2026-11-06" })).toMatchObject({ ok: true, suggestion: true });
    expect(await keepReflection(project, letter, speaker("crafter"), { text: WORDS, date: "2026-11-06" })).toMatchObject({ ok: true, suggestion: false });
    expect(await keepReflection(project, letter, speaker("clientB"), { text: WORDS, date: "2026-11-06" })).toMatchObject({ ok: true, suggestion: false });
    expect(cards.map((c) => [c.humanId, c.suggestion])).toEqual([["observer", true], ["crafter", false], ["clientB", false]]);
    expect(reflectionForPage(await getReflection("c2g", "observer")).kept?.suggestion).toBe(true);
  });

  it("nothing said, or no place on the project's log, keeps nothing; and when the Card can't be written nothing is kept and the draft is still there", async () => {
    const letter = sent("g2c", toClients);
    expect(await keepReflection(project, letter, speaker("clientA"), { text: "   " })).toMatchObject({ ok: false, status: 400 });
    expect(await keepReflection(project, letter, { humanId: "stranger", features: [] }, { text: WORDS })).toMatchObject({ ok: false, status: 403 });
    await saveReflectionDraft(project, letter, "clientA", WORDS);
    cardDoor = "broken";
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await keepReflection(project, letter, speaker("clientA"), { text: WORDS, date: "2026-11-06" })).toMatchObject({ ok: false, status: 500 });
    quiet.mockRestore();
    expect(cards).toEqual([]);
    expect(reflectionForPage(await getReflection("g2c", "clientA"))).toEqual({ draft: WORDS, kept: null });
  });
});

describe("the letter's page is handed the viewer's own reflection and nobody else's", () => {
  const as = (id: string) => ({ _id: id, role: "Human" });
  const here = { lowers: false, reflects: true };

  it("each reader gets their own; another reader's kept words are never in what the page is given", async () => {
    const letter = sent("g2c", toClients);
    await keepReflection(project, letter, speaker("clientA"), { text: "CLIENT A'S WORDS", date: "2026-11-06" });
    await saveReflectionDraft(project, letter, "guideB", "GUIDE B'S DRAFT");
    expect((await readLetter(letter, project, as("clientA"), here)).reflection).toEqual({ draft: null, kept: { text: "CLIENT A'S WORDS", date: "2026-11-06", suggestion: false } });
    expect((await readLetter(letter, project, as("guideB"), here)).reflection).toEqual({ draft: "GUIDE B'S DRAFT", kept: null });
    const other = await readLetter(letter, project, as("clientB"), here);
    expect(other.reflection).toEqual({ draft: null, kept: null });
    expect(JSON.stringify(other)).not.toMatch(/CLIENT A|GUIDE B/);
  });

  it("no box for a visitor off the project, a signed-out reader, a client on a team letter, or when the caller says this is not the reader themself (a render, a preview, an admin looking as them)", async () => {
    const letter = sent("g2c", toClients);
    await keepReflection(project, letter, speaker("clientA"), { text: WORDS, date: "2026-11-06" });
    expect((await readLetter(letter, project, null, here)).reflection).toBeNull();
    expect((await readLetter(letter, project, as("stranger"), here)).reflection).toBeNull();
    expect((await readLetter(letter, project, as("clientA"), { lowers: false, reflects: false })).reflection).toBeNull();
    expect((await readLetter(letter, project, as("clientA"), { lowers: false })).reflection).toBeNull();
    expect((await readLetter(sent("g2g", toTeam), project, as("clientA"), here)).reflection).toBeNull();
  });

  it("a letter from before houses gets the box for anyone on the project, and still says nothing else around it", async () => {
    const reading = await readLetter(sent("old", {}), project, as("clientA"), here);
    expect(reading).toMatchObject({ from: null, toHouse: null, reflection: { draft: null, kept: null } });
  });

  it("only someone who may write letters is told where a letter can be started from it", async () => {
    const letter = sent("c2g", fromClient);
    expect((await readLetter(letter, project, as("guideB"), here)).writeBackIn).toBe("proj");
    for (const reader of ["crafter", "observer", "clientB"]) expect((await readLetter(letter, project, as(reader), here)).writeBackIn, reader).toBeNull();
  });
});

describe("starting a letter from a kept reflection", () => {
  it("only from one's own, kept, on a letter in this project that they may still open", async () => {
    const letter = sent("c2g", fromClient);
    expect(await reflectionToStartFrom(project, "c2g", "guideB")).toBeNull();
    await saveReflectionDraft(project, letter, "guideB", WORDS);
    expect(await reflectionToStartFrom(project, "c2g", "guideB")).toBeNull();
    await keepReflection(project, letter, speaker("guideB"), { text: WORDS, date: "2026-11-06" });
    expect(await reflectionToStartFrom(project, "c2g", "guideB")).toMatchObject({ title: "c2g", from: "Susan", row: { text: WORDS } });
    // Somebody else's kept words are not theirs to start from.
    expect(await reflectionToStartFrom(project, "c2g", "guideA")).toBeNull();
    // The same letter asked for from another project: refused.
    expect(await reflectionToStartFrom(folders.other as never, "c2g", "guideB")).toBeNull();
    // Moved to another project, or archived, since: refused.
    files.c2g.folder_id = "lettersOther";
    expect(await reflectionToStartFrom(project, "c2g", "guideB")).toBeNull();
    files.c2g.folder_id = "letters";
    files.c2g.archived_at = "2026-11-07T00:00:00Z";
    expect(await reflectionToStartFrom(project, "c2g", "guideB")).toBeNull();
  });

  it("the route makes an ordinary new letter that carries the reflection as its talk-through, already on the record, and remembers the letter read on its workings alone", async () => {
    const letter = sent("c2g", { ...fromClient, name: "From Susan.md" });
    await keepReflection(project, letter, speaker("guideB"), { text: WORDS, date: "2026-11-06" });
    asUser("guideB");
    const made = await startLetter({ from: "c2g" });
    expect(made.status).toBe(201);
    const id = made.body.fileId!;
    expect(briefRows.get(id)).toMatchObject({ talk_through: WORDS, talk_through_by_human_id: "guideB", talk_through_date: "2026-11-06", talk_through_card_file_id: "card-guideB-2026-11-06", reflects_on_letter_file_id: "c2g" });
    // The letter itself names no other letter, and is addressed as its form said.
    expect(Object.keys(files[id]).filter((k) => /reflect|answer|reply|from_letter/i.test(k))).toEqual([]);
    expect(files[id]).toMatchObject({ to_house: "clients" });
    expect(JSON.stringify(files[id])).not.toContain("c2g");
  });

  it("Send lands nothing twice, through the routes the page's button calls, and a second talk on the letter is refused", async () => {
    const letter = sent("c2g", fromClient);
    await keepReflection(project, letter, speaker("guideB"), { text: WORDS, date: "2026-11-06" });
    asUser("guideB");
    const id = (await startLetter({ from: "c2g" })).body.fileId!;
    expect(cards.length).toBe(1);
    // The page's button on such a letter is "Write the outline": the outline route.
    expect(await requestOutline(project, files[id] as never, "guideB")).toMatchObject({ ok: true });
    // The talk route, asked anyway, takes no second talk and clears nothing.
    expect(await sendTalkThrough(project, files[id] as never, speaker("guideB"), { text: WORDS })).toMatchObject({ ok: false, status: 409 });
    expect(briefRows.get(id)).toMatchObject({ talk_through_card_file_id: "card-guideB-2026-11-06" });
    expect(await sendLetter({ _id: "guideB", role: "Human" }, files[id] as never, { date: "2026-11-08" })).toMatchObject({ ok: true });
    expect(cards.length).toBe(1);
  });

  it("the route refuses a reflection that isn't theirs, isn't kept, is on a letter in another project, or when an admin is looking as them; and whoever can't write letters at all", async () => {
    const letter = sent("c2g", fromClient);
    asUser("guideB");
    expect(await startLetter({ from: "c2g" })).toMatchObject({ status: 400 });
    await saveReflectionDraft(project, letter, "guideB", WORDS);
    expect(await startLetter({ from: "c2g" })).toMatchObject({ status: 400 });
    await keepReflection(project, letter, speaker("guideB"), { text: WORDS, date: "2026-11-06" });
    asUser("guideA");
    expect(await startLetter({ from: "c2g" })).toMatchObject({ status: 400 });
    asUser("guideB", true);
    expect(await startLetter({ from: "c2g" })).toMatchObject({ status: 400 });
    asUser("guideB");
    sent("elsewhere", { ...fromClient, folder_id: "lettersOther" });
    expect(await startLetter({ from: "elsewhere" })).toMatchObject({ status: 400 });
    await keepReflection(project, letter, speaker("crafter"), { text: WORDS, date: "2026-11-06" });
    asUser("crafter");
    expect(await startLetter({ from: "c2g" })).toMatchObject({ status: 403 });
    // None of the refusals left a letter behind.
    expect(Object.keys(files).filter((id) => id.startsWith("new"))).toEqual([]);
    // And the plain form still works, with no workings row written for it.
    asUser("guideB");
    const plain = await startLetter({ brief: "skip" });
    expect(plain.status).toBe(201);
    expect(briefRows.has(plain.body.fileId!)).toBe(false);
  });
});

describe("the outline for a letter back is given the reflection, the letter read and the sender's older words, and nothing else", () => {
  const started = async (by: string, readId: string) => {
    files.back = { _id: "back", name: "What I make of it.md", content: "# What I make of it\n", folder_id: "letters", purpose: "THE PURPOSE LINE" };
    briefRows.set("back", { content: null, talk_through: WORDS, talk_through_by_human_id: by, reflects_on_letter_file_id: readId });
  };

  it("a guide's: the letter as sent, their reflection, and the sender's own nodes as dated words in the order they were said", async () => {
    sent("g2g", { ...toTeam, name: "The attic floor.md" });
    await started("guideB", "g2g");
    const provider = scripted(BACK);
    expect(await runOutline(project, "back", "guideB", { provider })).toMatchObject({ ok: true, topics: ["What you're saying", "Where it starts", "The middle", "Where it lands"] });
    const system = provider.systems[0];
    for (const held of ["SKILL:outlineLetterBack", WORDS, "THE LETTER AS SENT.", 'The letter they read, "The attic floor", from Lucas:', "Gerald's reflection on it", "2026-08-20: LUCAS SAID PHASES CHANGE THE OUTPUT", "2026-09-12: LUCAS SAID THE FAN IS UNDERSIZED"]) expect(system, held).toContain(held);
    expect(system.indexOf("2026-08-20")).toBeLessThan(system.indexOf("2026-09-12"));
    for (const leak of ["SUSAN ASKED", "A SEED PACKET LINE", "SKILL:outline\n", "SKILL:outlineTalk", "THE PROJECT'S OWN SKILL", "AN EXTRA SKILL FILE", "THE PURPOSE LINE", "The people:", ":ref{", "Words.\n"]) expect(system, leak).not.toContain(leak);
    expect(opened).not.toContain("getProjectSharing");
    expect(briefRows.get("back")).toMatchObject({ outline: BACK });
  });

  it("someone in the clients' house writing gets the letter and their reflection, and the graph is never opened for them", async () => {
    sent("g2c", toClients);
    await started("clientA", "g2c");
    const provider = scripted(BACK);
    expect(await runOutline(project, "back", "clientA", { provider })).toMatchObject({ ok: true });
    expect(provider.systems[0]).toContain("THE LETTER AS SENT.");
    expect(provider.systems[0]).toContain("(None on the record.)");
    expect(provider.systems[0]).not.toMatch(/LUCAS SAID|SUSAN ASKED/);
    expect(opened.filter((o) => o === "loadGraphNodes" || o === "findProjectGraphFolder")).toEqual([]);
  });

  it("when the letter read has left the project, was archived, or was never theirs to open, the outline is made from the talk alone and that letter is not in it", async () => {
    sent("g2g", toTeam);
    for (const [why, change] of [["moved", { folder_id: "lettersOther" }], ["archived", { archived_at: "2026-11-07T00:00:00Z" }]] as const) {
      sent("g2g", { ...toTeam, ...change });
      await started("guideB", "g2g");
      const provider = scripted("## The fan\n\n- It comes first.\n");
      expect(await runOutline(project, "back", "guideB", { provider }), why).toMatchObject({ ok: true });
      expect(provider.systems[0], why).toContain("SKILL:outlineTalk");
      expect(provider.systems[0], why).not.toMatch(/THE LETTER AS SENT|LUCAS SAID|SKILL:outlineLetterBack/);
    }
    // A client's workings pointing at a team letter: not theirs to open, so not in the prompt.
    sent("g2g", toTeam);
    await started("clientA", "g2g");
    const provider = scripted("## The fan\n\n- It comes first.\n");
    await runOutline(project, "back", "clientA", { provider });
    expect(provider.systems[0]).not.toMatch(/THE LETTER AS SENT|LUCAS SAID/);
  });

  it("the check is for the reflection's speaker, whoever clicks", async () => {
    sent("c2g", fromClient);
    await started("guideB", "c2g");
    const provider = scripted(BACK);
    await runOutline(project, "back", "guideA", { provider });
    expect(provider.systems[0]).toContain("Gerald's reflection on it");
    expect(provider.systems[0]).toContain("2026-09-14: SUSAN ASKED WHAT THE RECEIPT WAS FOR");
    expect(provider.systems[0]).not.toContain("LUCAS SAID");
  });
});
