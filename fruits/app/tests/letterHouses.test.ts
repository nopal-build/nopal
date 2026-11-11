/**
 * Letters between houses (2026-11-05, `letterHouses.ts`): a letter is
 * written by a person and delivered to a house. Everyone in the
 * receiving house can open it, everyone in the house it came from sees
 * it at the desk, nobody else is shown the letter. These hold the rule
 * where it lives: the pure module, the send (the one writer of who a
 * letter is from and its houses, and of the flags), and the member's
 * door (a Client's only way to a sent letter). The vault, the project's
 * list and the writes are stubbed; the rules are what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flagRecipients, houseAtSend, houseMayOpen, houseMembersFrom, houseOf, housesOf, addressedTo, houseAtStart, inMailbox, sendAsksForHouse, HOUSE_NOT_CHOSEN } from "robustness-core/data/letterHouses";

// Two clients, two guides (one of them listed under the old name), a
// crafter and an observer; `orgGuide` holds no entry and guides through
// the Organization that owns the project.
const sharing = [
  { human: "guideA", role: "Owner" },
  { human: "guideB", role: "Guide" },
  { human: "crafter", role: "Crafter" },
  { human: "observer", role: "Observer" },
  { human: "clientA", role: "Client" },
  { human: "clientB", role: "Client" },
];
const members = houseMembersFrom(sharing, ["orgGuide"]);

const toClients = { from_human_id: "guideA", from_house: "guides", to_house: "clients" };
const toGuides = { from_human_id: "guideA", from_house: "guides", to_house: "guides" };
const fromClient = { from_human_id: "clientA", from_house: "clients", to_house: "guides" };
const houseless = {};

describe("who is in which house", () => {
  it("clients are the Client group; guides are Guides with Crafters and Observers; an old Owner reads as a Guide; an unknown name is in neither", () => {
    expect(houseOf("Client")).toBe("clients");
    expect(["Guide", "Owner", "Crafter", "Observer"].map(houseOf)).toEqual(["guides", "guides", "guides", "guides"]);
    expect(houseOf("Stranger")).toBeNull();
    expect(houseOf(null)).toBeNull();
  });

  it("is read from the project's list and its Organization's Guides, by getProjectRole's precedence", () => {
    expect(members.filter((m) => m.house === "clients").map((m) => m.human)).toEqual(["clientA", "clientB"]);
    expect(members.filter((m) => m.house === "guides").map((m) => m.human)).toEqual(["guideA", "guideB", "crafter", "observer", "orgGuide"]);
    // The list wins when it names a group: an org Guide listed as a Client is a client.
    expect(houseMembersFrom([{ human: "x", role: "Client" }], ["x"])).toEqual([{ human: "x", house: "clients" }]);
    // A name nobody knows falls through to the Organization, and to nothing without one.
    expect(houseMembersFrom([{ human: "x", role: "Stranger" }], ["x"])).toEqual([{ human: "x", house: "guides" }]);
    expect(houseMembersFrom([{ human: "x", role: "Stranger" }], [])).toEqual([]);
  });

  it("a letter has all three of from, from-house and to-house, or it has no house", () => {
    expect(housesOf(toClients)).toEqual({ fromHumanId: "guideA", fromHouse: "guides", toHouse: "clients" });
    expect(housesOf({ from_human_id: "guideA", to_house: "clients" })).toBeNull();
    expect(housesOf({ from_human_id: "guideA", from_house: "guides", to_house: "everyone" })).toBeNull();
    expect(housesOf(houseless)).toBeNull();
  });
});

describe("the table's rows: whose flag goes up, who is shown the letter where, and who is not", () => {
  it("a guide sends to the clients: each client's flag, and it is in each client's mailbox; the guides' house sees it at the desk, not in a mailbox", () => {
    expect(flagRecipients(members, "clients", ["guideA", "guideA"])).toEqual(["clientA", "clientB"]);
    for (const client of ["clientA", "clientB"]) expect(inMailbox(toClients, { humanId: client, house: "clients" })).toBe(true);
    for (const guide of ["guideA", "guideB", "crafter", "observer"]) {
      expect(inMailbox(toClients, { humanId: guide, house: "guides" })).toBe(false);
      expect(houseMayOpen(toClients, "guides")).toBe(true);
    }
  });

  it("a client sends: every guide, crafter and observer's flag; the other client sees it at the desk and has no flag", () => {
    expect(flagRecipients(members, "guides", ["clientA", "clientA"])).toEqual(["guideA", "guideB", "crafter", "observer", "orgGuide"]);
    expect(inMailbox(fromClient, { humanId: "crafter", house: "guides" })).toBe(true);
    expect(inMailbox(fromClient, { humanId: "clientB", house: "clients" })).toBe(false);
    expect(houseMayOpen(fromClient, "clients")).toBe(true);
  });

  it("a guide sends to the guides: everyone else in the guides' house; the writer has it at the desk only; a client is not shown it anywhere", () => {
    expect(flagRecipients(members, "guides", ["guideA", "guideA"])).toEqual(["guideB", "crafter", "observer", "orgGuide"]);
    expect(inMailbox(toGuides, { humanId: "guideB", house: "guides" })).toBe(true);
    expect(inMailbox(toGuides, { humanId: "guideA", house: "guides" })).toBe(false);
    expect(houseMayOpen(toGuides, "guides")).toBe(true);
    expect(houseMayOpen(toGuides, "clients")).toBe(false);
    expect(inMailbox(toGuides, { humanId: "clientA", house: "clients" })).toBe(false);
  });

  it("a letter with no house shows to everyone, as before, in every mailbox", () => {
    for (const house of ["guides", "clients", null] as const) {
      expect(houseMayOpen(houseless, house)).toBe(true);
      expect(inMailbox(houseless, { humanId: "anyone", house })).toBe(true);
    }
  });

  it("someone with no house is shown no letter that has one", () => {
    expect(houseMayOpen(toClients, null)).toBe(false);
    expect(inMailbox(toClients, { humanId: "x", house: null })).toBe(false);
  });

  it("a send again by another guide flags the receiving house again, never the sender and never the person the letter is from", () => {
    expect(flagRecipients(members, "guides", ["guideB", "guideA"])).toEqual(["crafter", "observer", "orgGuide"]);
    expect(flagRecipients(members, "clients", ["guideB", "guideA"])).toEqual(["clientA", "clientB"]);
  });
});

describe("where a letter goes at Send", () => {
  const ask = (over: Partial<Parameters<typeof houseAtSend>[0]>) => houseAtSend({ current: houseless, senderHouse: "guides", projectHasClients: true, ...over });

  it("a guide on a project with clients says which house, and there is no default", () => {
    expect(ask({})).toEqual({ ok: false, status: 400, error: HOUSE_NOT_CHOSEN });
    expect(ask({ asked: "everyone" })).toEqual({ ok: false, status: 400, error: HOUSE_NOT_CHOSEN });
    expect(ask({ asked: "clients" })).toEqual({ ok: true, toHouse: "clients" });
    expect(ask({ asked: "guides" })).toEqual({ ok: true, toHouse: "guides" });
    expect(sendAsksForHouse({ current: houseless, projectHasClients: true })).toBe(true);
  });

  it("on a project with no clients there is nothing to choose: it goes to the guides", () => {
    expect(ask({ projectHasClients: false })).toEqual({ ok: true, toHouse: "guides" });
    expect(ask({ projectHasClients: false, asked: "clients" })).toEqual({ ok: true, toHouse: "guides" });
    expect(sendAsksForHouse({ current: houseless, projectHasClients: false })).toBe(false);
  });

  it("a client's letter always goes to the guides", () => {
    expect(ask({ senderHouse: "clients", asked: "clients" })).toEqual({ ok: true, toHouse: "guides" });
  });

  it("a draft addressed when it was started goes there, and Send has nothing to ask", () => {
    const addressed = { to_house: "clients" };
    expect(addressedTo(addressed)).toBe("clients");
    // Addressed is not housed: it refuses and flags nobody until it is sent.
    expect(housesOf(addressed)).toBeNull();
    expect(ask({ current: addressed, asked: "guides" })).toEqual({ ok: true, toHouse: "clients" });
    expect(sendAsksForHouse({ current: addressed, projectHasClients: true })).toBe(false);
    expect(addressedTo({ to_house: "everyone" })).toBeNull();
    expect(addressedTo(houseless)).toBeNull();
  });

  it("a letter that has a house keeps it, whatever is asked", () => {
    expect(ask({ current: toGuides, asked: "clients" })).toEqual({ ok: true, toHouse: "guides" });
    expect(sendAsksForHouse({ current: toGuides, projectHasClients: true })).toBe(false);
  });
});

describe("who a letter is for, picked when it is started", () => {
  it("on a project with clients the guide says which, and there is no default", () => {
    expect(houseAtStart({ projectHasClients: true })).toEqual({ ok: false, status: 400, error: HOUSE_NOT_CHOSEN });
    expect(houseAtStart({ projectHasClients: true, asked: "" })).toEqual({ ok: false, status: 400, error: HOUSE_NOT_CHOSEN });
    expect(houseAtStart({ projectHasClients: true, asked: "clients" })).toEqual({ ok: true, toHouse: "clients" });
    expect(houseAtStart({ projectHasClients: true, asked: "guides" })).toEqual({ ok: true, toHouse: "guides" });
  });
  it("with no clients there is nothing to pick: it is the team's", () => {
    expect(houseAtStart({ projectHasClients: false })).toEqual({ ok: true, toHouse: "guides" });
    expect(houseAtStart({ projectHasClients: false, asked: "clients" })).toEqual({ ok: true, toHouse: "guides" });
  });
});

// ─── The send and the member's door, with the store stubbed ─────────────

const files: Record<string, Record<string, unknown>> = {};
const folders: Record<string, Record<string, unknown>> = {
  letters: { _id: "letters", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  lettersNoClients: { _id: "lettersNoClients", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "projNoClients" },
  proj: { _id: "proj", human_id: "guideA", project_status: "active", organization_id: "org" },
  projNoClients: { _id: "projNoClients", human_id: "guideA", project_status: "active" },
};
const lists: Record<string, { human: string; role: string }[]> = {
  proj: sharing,
  projNoClients: [
    { human: "guideA", role: "Guide" },
    { human: "guideB", role: "Guide" },
  ],
};
const merged: { id: string; data: Record<string, unknown> }[] = [];
const flags = new Map<string, Record<string, unknown>>();

vi.mock("robustness-core/data/vault.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/vault.server")>();
  return {
    ...actual,
    getFileRefById: vi.fn(async (id: string) => files[id]),
    getFolderById: vi.fn(async (id: string) => folders[id]),
    listFolderChildren: vi.fn(async (_humanId: string, parentId: string) => ({ folders: Object.values(folders).filter((f) => f.parent_folder_id === parentId), files: [] })),
    getFileRefsByFolderIds: vi.fn(async (ids: string[]) => Object.values(files).filter((f) => ids.includes(String(f.folder_id)))),
    createFileRef: vi.fn(async (data: Record<string, unknown>) => {
      const _id = `new${Object.keys(files).length + 1}`;
      files[_id] = { _id, updated_at: "2026-11-05T12:00:00Z", ...data };
      return files[_id];
    }),
  };
});
vi.mock("robustness-core/data/humans.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/humans.server")>();
  const names: Record<string, string> = { guideA: "Lucas Guide", guideB: "Gerald Guide", clientA: "Susan Client" };
  return { ...actual, getHumanById: vi.fn(async (id: string) => (names[id] ? { _id: id, name: names[id], email: `${id}@example.com` } : undefined)) };
});
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  const roleOn = (projectId: string, humanId: string) => {
    const entry = lists[projectId]?.find((e) => e.human === humanId);
    if (entry) return actual.resolveRole(entry.role);
    return projectId === "proj" && humanId === "orgGuide" ? actual.resolveRole("Guide") : null;
  };
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
    getProjectSharing: vi.fn(async (project: { _id: string }) => lists[project._id] ?? []),
    getProjectRole: vi.fn(async (project: { _id: string }, humanId: string) => roleOn(project._id, humanId)),
  };
});
vi.mock("robustness-core/data/organizations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/organizations.server")>();
  return { ...actual, getOrganizationMembers: vi.fn(async () => [{ human_id: "orgGuide", role: "Guide" }, { human_id: "orgClient", role: "Client" }]) };
});
vi.mock("robustness-core/data/generic.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/generic.server")>();
  return {
    ...actual,
    defineTable: vi.fn(async () => undefined),
    merge: vi.fn(async (_table: string, id: string, data: Record<string, unknown>) => {
      merged.push({ id, data });
      files[id] = { ...files[id], ...data };
      return files[id];
    }),
    upsert: vi.fn(async (record: { id: string }, data: Record<string, unknown>) => {
      flags.set(String(record.id), data);
      return data;
    }),
    remove: vi.fn(async (_table: string, id: string) => {
      flags.delete(id);
    }),
    query: vi.fn(async (_sql: string, params: { projectFolderId: string; humanId: string }) => [
      [...flags.values()].filter((f) => f.project_folder_id === params.projectFolderId && f.human_id === params.humanId),
    ]),
  };
});
vi.mock("robustness-core/data/letterSync.server", () => ({ syncLettersProjection: vi.fn(async () => ({ written: 0 })) }));
vi.mock("robustness-core/data/letterPdf.server", () => ({ enqueueLetterPdfIfSent: vi.fn(async () => undefined) }));
// The talk-through landing at Send has its own tests (`letterTalk.test.ts`).
vi.mock("robustness-core/data/outline.server", () => ({ landTalkThrough: vi.fn(async () => ({ landed: false })) }));

const { sendLetter, letterSendStateFor } = await import("robustness-core/data/letterSend.server");
const { flaggedLetterIds, lowerLetterFlag } = await import("robustness-core/data/letterFlags.server");
const { resolveSentLetterForHouse, resolveReadableLetter, letterPageFile, mailboxLines, listLetters } = await import("robustness-core/data/letters.server");
const { readLetter } = await import("robustness-core/data/letterReading.server");
const { writesInFolder, resolveRole } = await import("robustness-core/data/projectSharing.server");

const guide = (id: string) => ({ _id: id, role: "Human" as const });
const draft = (id: string, over: Record<string, unknown> = {}) => {
  files[id] = { _id: id, name: `${id}.md`, content: `# ${id}\n\nWords.\n`, folder_id: "letters", updated_at: "2026-11-05T10:00:00Z", ...over };
  return files[id] as never;
};
const flagsOf = async (humanId: string, project = "proj") => [...(await flaggedLetterIds(project, humanId))].sort();

beforeEach(() => {
  for (const id of Object.keys(files)) delete files[id];
  merged.length = 0;
  flags.clear();
});

describe("sendLetter writes who a letter is from and its houses, once", () => {
  it("refuses a guide on a project with clients who hasn't said which house, and writes nothing", async () => {
    const result = await sendLetter(guide("guideA"), draft("l1"), { date: "2026-11-05" });
    expect(result).toEqual({ ok: false, status: 400, error: HOUSE_NOT_CHOSEN });
    expect(merged).toEqual([]);
    expect(flags.size).toBe(0);
  });

  it("to the clients: the letter is from the sender, guides to clients, and each client's flag goes up and nobody else's", async () => {
    const result = await sendLetter(guide("guideA"), draft("l1"), { date: "2026-11-05", toHouse: "clients" });
    expect(result.ok && result.toHouse).toBe("clients");
    expect(merged[0].data).toMatchObject({ from_human_id: "guideA", from_house: "guides", to_house: "clients", sent_by_human_id: "guideA", sent_count: 1 });
    expect(await flagsOf("clientA")).toEqual(["l1"]);
    expect(await flagsOf("clientB")).toEqual(["l1"]);
    for (const other of ["guideA", "guideB", "crafter", "observer", "orgGuide"]) expect(await flagsOf(other)).toEqual([]);
  });

  it("to the guides: everyone else in the guides' house, an org Guide included; no client and not the writer", async () => {
    await sendLetter(guide("guideA"), draft("l2"), { date: "2026-11-05", toHouse: "guides" });
    for (const reader of ["guideB", "crafter", "observer", "orgGuide"]) expect(await flagsOf(reader)).toEqual(["l2"]);
    for (const other of ["guideA", "clientA", "clientB", "orgClient"]) expect(await flagsOf(other)).toEqual([]);
  });

  it("on a project with no clients it goes to the guides without asking", async () => {
    const result = await sendLetter(guide("guideA"), draft("l3", { folder_id: "lettersNoClients" }), { date: "2026-11-05" });
    expect(result.ok && result.toHouse).toBe("guides");
    expect(await flagsOf("guideB", "projNoClients")).toEqual(["l3"]);
  });

  it("one client opening the letter leaves the other client's flag up", async () => {
    await sendLetter(guide("guideA"), draft("l1"), { date: "2026-11-05", toHouse: "clients" });
    await lowerLetterFlag("l1", "clientA");
    expect(await flagsOf("clientA")).toEqual([]);
    expect(await flagsOf("clientB")).toEqual(["l1"]);
  });

  it("sending again raises the flag again for the receiving house, keeps who it is from and its houses, and can't be pointed at another house", async () => {
    await sendLetter(guide("guideA"), draft("l1"), { date: "2026-11-05", toHouse: "clients" });
    await lowerLetterFlag("l1", "clientA");
    await lowerLetterFlag("l1", "clientB");
    const again = await sendLetter(guide("guideB"), files.l1 as never, { date: "2026-11-06", toHouse: "guides" });
    expect(again.ok && again.toHouse).toBe("clients");
    expect(merged[1].data).not.toHaveProperty("from_human_id");
    expect(merged[1].data).not.toHaveProperty("to_house");
    expect(merged[1].data).toMatchObject({ sent_by_human_id: "guideB", sent_count: 2 });
    expect(files.l1).toMatchObject({ from_human_id: "guideA", from_house: "guides", to_house: "clients" });
    expect(await flagsOf("clientA")).toEqual(["l1"]);
    expect(await flagsOf("clientB")).toEqual(["l1"]);
    expect(await flagsOf("guideA")).toEqual([]);
  });

  it("a letter sent before houses is asked like any other when it is sent again, and is from whoever last sent it", async () => {
    const old = draft("old1", { sent_content: "# old", sent_at: "2026-10-28T10:00:00Z", sent_date: "2026-10-28", sent_by_human_id: "guideB", sent_count: 1 });
    expect((await sendLetter(guide("guideA"), old, { date: "2026-11-05" })).ok).toBe(false);
    await sendLetter(guide("guideA"), old, { date: "2026-11-05", toHouse: "guides" });
    expect(files.old1).toMatchObject({ from_human_id: "guideB", from_house: "guides", to_house: "guides", sent_by_human_id: "guideA", sent_count: 2 });
    // From guideB, re-sent by guideA: neither is flagged for it.
    expect(await flagsOf("guideB")).toEqual([]);
    expect(await flagsOf("crafter")).toEqual(["old1"]);
  });

  it("a draft addressed when it was started is delivered there, and Send can't point it elsewhere", async () => {
    const addressed = draft("l4", { to_house: "guides" });
    expect(await letterSendStateFor(addressed)).toMatchObject({ asksHouse: false, toHouse: "guides" });
    const result = await sendLetter(guide("guideA"), addressed, { date: "2026-11-05", toHouse: "clients" });
    expect(result.ok && result.toHouse).toBe("guides");
    expect(files.l4).toMatchObject({ from_human_id: "guideA", from_house: "guides", to_house: "guides" });
    expect(await flagsOf("clientA")).toEqual([]);
    expect(await flagsOf("guideB")).toEqual(["l4"]);
  });

  it("the send control is told when to ask and where a decided letter goes", async () => {
    expect(await letterSendStateFor(draft("l1"))).toMatchObject({ asksHouse: true, toHouse: null, sentDate: null });
    expect(await letterSendStateFor(draft("l3", { folder_id: "lettersNoClients" }))).toMatchObject({ asksHouse: false, toHouse: "guides" });
  });

  it("crafters, observers and clients are refused the send", async () => {
    for (const who of ["crafter", "observer", "clientA"]) {
      const result = await sendLetter(guide(who), draft("l1"), { date: "2026-11-05", toHouse: "guides" });
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
    expect(merged).toEqual([]);
  });
});

describe("the member's door, by house", () => {
  const sentTo = (id: string, houses: Record<string, unknown>) =>
    draft(id, { sent_content: `# ${id}\n\n![p](/api/vault/view/pic1)\n`, sent_at: "2026-11-05T10:00:00Z", sent_date: "2026-11-05", sent_count: 1, ...houses });

  it("a client is refused a letter the guides sent to the guides: its page, its pictures and its PDF's door", async () => {
    sentTo("g2g", toGuides);
    files.pic1 = { _id: "pic1", name: "p.jpg" };
    expect(await resolveSentLetterForHouse("g2g", "clientA")).toBeNull();
    expect(await resolveReadableLetter("g2g", { viewerHumanId: "clientA" })).toBeNull();
    expect(await letterPageFile("g2g", "pic1", "clientA")).toBeNull();
  });

  it("everyone in the guides' house opens it: a guide, a crafter, an observer, an org Guide", async () => {
    sentTo("g2g", toGuides);
    for (const reader of ["guideA", "guideB", "crafter", "observer", "orgGuide"]) {
      expect((await resolveSentLetterForHouse("g2g", reader))?.file._id).toBe("g2g");
    }
  });

  it("both houses open a letter between them, in either direction", async () => {
    sentTo("g2c", toClients);
    sentTo("c2g", fromClient);
    for (const reader of ["clientA", "clientB", "guideB", "crafter", "observer"]) {
      expect((await resolveSentLetterForHouse("g2c", reader))?.file._id).toBe("g2c");
      expect((await resolveSentLetterForHouse("c2g", reader))?.file._id).toBe("c2g");
    }
  });

  it("a letter with no house opens for anyone on the project, a client included, and for nobody off it", async () => {
    sentTo("old", {});
    expect((await resolveSentLetterForHouse("old", "clientA"))?.file._id).toBe("old");
    expect((await resolveSentLetterForHouse("old", "crafter"))?.file._id).toBe("old");
    expect(await resolveSentLetterForHouse("old", "stranger")).toBeNull();
  });

  it("the public link still opens a guides' letter for anyone who has it, as before", async () => {
    sentTo("g2g", { ...toGuides, shared_at: "2026-11-05T11:00:00Z" });
    expect((await resolveReadableLetter("g2g", {}))?.file._id).toBe("g2g");
  });
});

describe("what is in a mailbox", () => {
  it("lists the mail that came to the viewer's house and every letter from before houses, marks only the viewer's own unopened ones, and holds no count", async () => {
    draft("g2c", { sent_content: "# a", sent_at: "2026-11-04T10:00:00Z", sent_date: "2026-11-04", sent_count: 2, ...toClients });
    draft("g2g", { sent_content: "# b", sent_at: "2026-11-05T10:00:00Z", sent_date: "2026-11-05", sent_count: 1, ...toGuides });
    draft("old", { sent_content: "# c", sent_at: "2026-10-28T10:00:00Z", sent_date: "2026-10-28", sent_count: 1 });
    draft("unsent");
    const rows = await listLetters(folders.proj as never);

    const client = mailboxLines(rows, { humanId: "clientA", house: "clients" }, new Set(["g2c", "old"]));
    expect(client.map((l) => l.fileId)).toEqual(["g2c", "old"]);
    expect(client[0]).toMatchObject({ unopened: true, updated: true, fromHumanId: "guideA", path: "/public/letter/g2c" });
    // A letter with no house raises nothing, whatever rows exist.
    expect(client[1]).toMatchObject({ unopened: false, fromHumanId: null });

    const otherGuide = mailboxLines(rows, { humanId: "guideB", house: "guides" }, new Set());
    expect(otherGuide.map((l) => l.fileId)).toEqual(["g2g", "old"]);
    expect(otherGuide.every((l) => !l.unopened)).toBe(true);
    // The writer's own letter is at the desk, not in their mailbox.
    expect(mailboxLines(rows, { humanId: "guideA", house: "guides" }).map((l) => l.fileId)).toEqual(["old"]);
    expect(Object.keys(client[0])).not.toContain("count");
  });
});

describe("what a reader is told around the letter", () => {
  const sentTo = (id: string, extra: Record<string, unknown>) =>
    draft(id, { sent_content: `# ${id}\n`, sent_at: "2026-11-05T10:00:00Z", sent_date: "2026-11-05", sent_count: 1, ...extra });

  it("everyone is told who it is from; only someone it is shown to is told where it went", async () => {
    const letter = sentTo("g2c", toClients);
    expect(await readLetter(letter, folders.proj as never, null, { lowers: false })).toEqual({ from: "Lucas", toHouse: null, reflection: null, writeBackIn: null });
    expect(await readLetter(letter, folders.proj as never, { _id: "stranger" }, { lowers: true })).toMatchObject({ from: "Lucas", toHouse: null });
    expect(await readLetter(letter, folders.proj as never, { _id: "clientA" }, { lowers: false })).toMatchObject({ from: "Lucas", toHouse: "clients" });
  });

  it("opening the letter lowers that reader's flag and nobody else's; a render, a preview or an admin looking as them lowers nothing", async () => {
    await sendLetter(guide("guideA"), draft("l1"), { date: "2026-11-05", toHouse: "clients" });
    await readLetter(files.l1 as never, folders.proj as never, { _id: "clientA" }, { lowers: false });
    expect(await flagsOf("clientA")).toEqual(["l1"]);
    await readLetter(files.l1 as never, folders.proj as never, { _id: "clientA" }, { lowers: true });
    expect(await flagsOf("clientA")).toEqual([]);
    expect(await flagsOf("clientB")).toEqual(["l1"]);
  });

  it("says nothing of other letters and offers no reply: who it is from, where it went, and the reader's own talk-through of it (`letterReflection.test.ts`), none here", async () => {
    const letter = sentTo("g2g", toGuides);
    const reading = await readLetter(letter, folders.proj as never, { _id: "guideB" }, { lowers: false });
    expect(Object.keys(reading).sort()).toEqual(["from", "reflection", "toHouse", "writeBackIn"]);
    expect(reading).toMatchObject({ reflection: null, writeBackIn: null });
  });

  it("a letter with no house says nothing around it, as before", async () => {
    expect(await readLetter(sentTo("old", {}), folders.proj as never, { _id: "clientA" }, { lowers: true })).toEqual({ from: null, toHouse: null, reflection: null, writeBackIn: null });
  });
});

describe("crafters and observers read, and do not write letters", () => {
  const lettersFolder = { folder_type: "letters" } as const;
  it("in the Letters folder only a Guide writes; everywhere else a Crafter still does", () => {
    expect(writesInFolder(resolveRole("Guide"), lettersFolder)).toBe(true);
    expect(writesInFolder(resolveRole("Owner"), lettersFolder)).toBe(true);
    expect(writesInFolder(resolveRole("Crafter"), lettersFolder)).toBe(false);
    expect(writesInFolder(resolveRole("Observer"), lettersFolder)).toBe(false);
    expect(writesInFolder(resolveRole("Client"), lettersFolder)).toBe(false);
    expect(writesInFolder(resolveRole("Crafter"), { folder_type: "deliverables" } as never)).toBe(false);
    expect(writesInFolder(resolveRole("Crafter"), { folder_type: "project-n02" } as never)).toBe(true);
    expect(writesInFolder(resolveRole("Observer"), { folder_type: "project-n02" } as never)).toBe(false);
    expect(writesInFolder(null, lettersFolder)).toBe(false);
  });
});
