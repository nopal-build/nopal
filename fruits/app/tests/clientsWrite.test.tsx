/**
 * Clients write (2026-11-06; the letters base round guide's step 5,
 * Austin 2026-11-05: "both houses write"). A client starts a letter,
 * talks it through, gets an outline, writes with pictures, records and
 * sends, at the same desk a guide uses, with less on it: no purpose
 * line, no brief, no link, no Upload or Replace.
 *
 * Held here: the one rule for who writes which letter (`mayWriteLetter`)
 * and who starts one; the desk's rows for a client and for a guide
 * (`deskRows`: a client's draft to that client alone); the doors the rule
 * stands behind (the upload door, the letter's file routes for a draft,
 * every write route by source); what a client's form and page leave out;
 * and that a client's letter and talk-through enter the record as theirs.
 * The store is stubbed; the rules are what is under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = (rel: string) => readFileSync(path.join(here, "..", rel), "utf8");
const core = (name: string) => readFileSync(path.join(here, "../../../packages/robustness-core/src/data", name), "utf8");

const lists: Record<string, { human: string; role: string }[]> = {
  proj: [
    { human: "guideA", role: "Guide" },
    { human: "crafter", role: "Crafter" },
    { human: "observer", role: "Observer" },
    { human: "clientA", role: "Client" },
    { human: "clientB", role: "Client" },
  ],
};
const files: Record<string, Record<string, unknown>> = {};
const folders: Record<string, Record<string, unknown>> = {
  proj: { _id: "proj", human_id: "owner", project_status: "active" },
  letters: { _id: "letters", human_id: "owner", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  photos: { _id: "photos", human_id: "owner", folder_type: "photos", is_folder_type_root: true, parent_folder_id: "proj" },
  elsewhere: { _id: "elsewhere", human_id: "someone", folder_type: "personal", parent_folder_id: null },
};
const readable = new Set<string>();

vi.mock("robustness-core/data/vault.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/vault.server")>();
  return {
    ...actual,
    getFileRefById: vi.fn(async (id: string) => files[id]),
    getFolderById: vi.fn(async (id: string) => folders[id]),
    listFolderChildren: vi.fn(async (_humanId: string, parentId: string) => ({ folders: Object.values(folders).filter((f) => f.parent_folder_id === parentId), files: [] })),
  };
});
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  const roleOn = (projectId: string | undefined, humanId: string) => {
    const entry = projectId ? lists[projectId]?.find((e) => e.human === humanId) : undefined;
    return entry ? actual.resolveRole(entry.role) : null;
  };
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string | null }) => (folder.parent_folder_id ? folders[folder.parent_folder_id] ?? null : null)),
    getProjectSharing: vi.fn(async (project: { _id: string }) => lists[project._id] ?? []),
    getProjectRole: vi.fn(async (project: { _id: string }, humanId: string) => roleOn(project._id, humanId)),
    canActAsProjectOwner: vi.fn(async (actingHumanId: string, _ownerHumanId: string, folderId: string | null | undefined) => {
      const folder = folderId ? folders[folderId] : null;
      const project = folder?.parent_folder_id ? folders[String(folder.parent_folder_id)] : null;
      return !!folder && !!project && actual.writesInFolder(roleOn(String(project._id), actingHumanId), folder as never);
    }),
  };
});
vi.mock("robustness-core/data/featureAccess.server", () => ({
  canReadFile: vi.fn(async (humanId: string, file: { _id: string }) => readable.has(`${humanId}:${file._id}`)),
}));

const { mayWriteLetter, mayStartLetter, isClientsLetter, deskRows } = await import("robustness-core/data/letterHouses");
const { resolveLetterForWriter, letterDraftFile, letterViewerOf } = await import("robustness-core/data/letters.server");
const { canUploadToFolder } = await import("robustness-core/data/letterUpload.server");
const { featuresOf } = await import("robustness-core/data/features");
const { LettersView, NewLetterModal, LETTER_TO_TEAM_NOTE } = await import("../components/LettersView");
const { LetterBrief } = await import("../components/LetterBrief");
const { resolveRole } = await import("robustness-core/data/projectSharing.server");

const members = [
  { human: "guideA", house: "guides" as const },
  { human: "crafter", house: "guides" as const },
  { human: "observer", house: "guides" as const },
  { human: "clientA", house: "clients" as const },
  { human: "clientB", house: "clients" as const },
];
const viewer = (humanId: string) => letterViewerOf(humanId, lists.proj.find((e) => e.human === humanId) ? resolveRole(lists.proj.find((e) => e.human === humanId)!.role) : null);
const person = (id: string, role = "Human") => ({ _id: id, role: role as never });
const file = (id: string, over: Record<string, unknown> = {}) => {
  files[id] = { _id: id, human_id: "owner", name: `${id}.md`, content: `# ${id}\n`, folder_id: "letters", updated_at: "2026-11-06T10:00:00Z", ...over };
  return files[id];
};

beforeEach(() => {
  for (const id of Object.keys(files)) delete files[id];
  readable.clear();
});

describe("who writes which letter (mayWriteLetter, pure)", () => {
  const guidesDraft = {};
  const guidesSent = { from_human_id: "guideA", from_house: "guides", to_house: "clients" };
  const guideToGuide = { from_human_id: "guideA", from_house: "guides", to_house: "guides" };
  const clientsDraft = { from_human_id: "clientA" };
  const clientsSent = { from_human_id: "clientA", from_house: "clients", to_house: "guides" };

  it("a Guide on the project writes any letter but a client's", () => {
    const g = viewer("guideA");
    expect(g.guiding).toBe(true);
    for (const letter of [guidesDraft, guidesSent, guideToGuide]) expect(mayWriteLetter(g, letter, members)).toBe(true);
    for (const letter of [clientsDraft, clientsSent]) expect(mayWriteLetter(g, letter, members)).toBe(false);
  });

  it("a client writes a letter from them and nothing else: not the other client's draft, not a guide's letter to them, not a guide-to-guide letter", () => {
    const a = viewer("clientA");
    expect(a.house).toBe("clients");
    expect(mayWriteLetter(a, clientsDraft, members)).toBe(true);
    expect(mayWriteLetter(a, clientsSent, members)).toBe(true);
    for (const letter of [guidesDraft, guidesSent, guideToGuide, { from_human_id: "clientB" }]) expect(mayWriteLetter(a, letter, members)).toBe(false);
    expect(mayWriteLetter(viewer("clientB"), clientsDraft, members)).toBe(false);
  });

  it("a Crafter, an Observer and staff with no role on the project write nothing (Austin, 2026-11-06: they join the project to write there)", () => {
    for (const who of ["crafter", "observer", "stranger"]) {
      const v = viewer(who);
      for (const letter of [guidesDraft, guidesSent, clientsDraft, clientsSent]) expect(mayWriteLetter(v, letter, members), who).toBe(false);
    }
    expect(mayWriteLetter({ humanId: "admin", house: null, guiding: false }, guidesDraft, members)).toBe(false);
  });

  it("a client's letter is one from the clients' house, or a draft from someone in it now; a letter from a client who left is a guide's to write", () => {
    expect(isClientsLetter(clientsSent, [])).toBe(true);
    expect(isClientsLetter(clientsDraft, members)).toBe(true);
    expect(isClientsLetter(clientsDraft, [])).toBe(false);
    expect(isClientsLetter(guidesDraft, members)).toBe(false);
  });

  it("starting a letter is a Guide's or a client's", () => {
    expect(mayStartLetter(viewer("guideA"))).toBe(true);
    expect(mayStartLetter(viewer("clientA"))).toBe(true);
    for (const who of ["crafter", "observer", "stranger"]) expect(mayStartLetter(viewer(who)), who).toBe(false);
  });
});

describe("the desk's rows (deskRows, pure)", () => {
  const row = (fileId: string, over: Record<string, unknown> = {}) => ({ fileId, sentDate: null as string | null, houses: null, fromHumanId: null as string | null, toHouse: null, editedSinceSent: false, purpose: null as string | null, ...over });
  const rows = [
    row("gd", { toHouse: "clients", purpose: "Tell them about the floor." }),
    row("ad", { fromHumanId: "clientA", toHouse: "guides" }),
    row("bd", { fromHumanId: "clientB", toHouse: "guides" }),
    row("g2c", { sentDate: "2026-11-04", houses: { fromHumanId: "guideA", fromHouse: "guides", toHouse: "clients" }, fromHumanId: "guideA", toHouse: "clients", editedSinceSent: true, purpose: "The attic." }),
    row("g2g", { sentDate: "2026-11-04", houses: { fromHumanId: "guideA", fromHouse: "guides", toHouse: "guides" }, fromHumanId: "guideA", toHouse: "guides" }),
    row("a2g", { sentDate: "2026-11-05", houses: { fromHumanId: "clientA", fromHouse: "clients", toHouse: "guides" }, fromHumanId: "clientA", toHouse: "guides", editedSinceSent: true }),
    row("old", { sentDate: "2026-10-12" }),
  ];
  const ids = (out: { fileId: string }[]) => out.map((r) => r.fileId);

  it("a client sees their own drafts and no other draft, and the letters between the houses; never a guide-to-guide letter", () => {
    const a = deskRows(rows, viewer("clientA"), members);
    expect(ids(a)).toEqual(["ad", "g2c", "a2g", "old"]);
    const b = deskRows(rows, viewer("clientB"), members);
    expect(ids(b)).toEqual(["bd", "g2c", "a2g", "old"]);
  });

  it("a guide's desk lists the guides' drafts and every sent letter, and never a client's draft", () => {
    expect(ids(deskRows(rows, viewer("guideA"), members))).toEqual(["gd", "g2c", "g2g", "a2g", "old"]);
    expect(ids(deskRows(rows, viewer("crafter"), members))).toEqual(["gd", "g2c", "g2g", "a2g", "old"]);
  });

  it("each row says whether the viewer may write it, and 'edited since' and the purpose line reach only who they are for", () => {
    const a = deskRows(rows, viewer("clientA"), members);
    expect(a.map((r) => [r.fileId, r.writes, r.editedSinceSent, r.purpose])).toEqual([
      ["ad", true, false, null],
      ["g2c", false, false, null],
      ["a2g", true, true, null],
      ["old", false, false, null],
    ]);
    const g = deskRows(rows, viewer("guideA"), members);
    expect(g.map((r) => [r.fileId, r.writes, r.editedSinceSent, r.purpose])).toEqual([
      ["gd", true, false, "Tell them about the floor."],
      ["g2c", true, true, "The attic."],
      ["g2g", true, false, null],
      ["a2g", false, false, null],
      ["old", true, false, null],
    ]);
    expect(deskRows(rows, viewer("crafter"), members).every((r) => !r.writes && !r.editedSinceSent)).toBe(true);
  });
});

describe("the doors the rule stands behind", () => {
  it("resolveLetterForWriter: a guide for the guides' letters, a client for their own, and who is writing", async () => {
    file("g1");
    file("a1", { from_human_id: "clientA" });
    expect((await resolveLetterForWriter("g1", person("guideA")))?.writer).toBe("guide");
    expect(await resolveLetterForWriter("a1", person("guideA"))).toBeNull();
    expect((await resolveLetterForWriter("a1", person("clientA")))?.writer).toBe("client");
    expect(await resolveLetterForWriter("g1", person("clientA"))).toBeNull();
    expect(await resolveLetterForWriter("a1", person("clientB"))).toBeNull();
    expect(await resolveLetterForWriter("g1", person("admin", "Admin"))).toBeNull();
  });

  it("the upload door: the letter's writer may put a picture or a video beside their letter, in the letter's folder and nowhere else; never a markdown file (a planted letter); a Guide as before", async () => {
    file("a1", { from_human_id: "clientA" });
    const pic = { type: "image/png" };
    const clip = { type: "video/webm" };
    const md = { type: "text/markdown" };
    expect(await canUploadToFolder(person("clientA"), folders.letters as never, { letterFileId: "a1", file: pic })).toBe(true);
    expect(await canUploadToFolder(person("clientA"), folders.letters as never, { letterFileId: "a1", file: clip })).toBe(true);
    expect(await canUploadToFolder(person("clientA"), folders.letters as never, { letterFileId: "a1", file: md })).toBe(false);
    expect(await canUploadToFolder(person("clientA"), folders.letters as never, { letterFileId: "a1", file: { type: "application/pdf" } })).toBe(false);
    expect(await canUploadToFolder(person("clientA"), folders.letters as never)).toBe(false);
    expect(await canUploadToFolder(person("clientA"), folders.photos as never, { letterFileId: "a1", file: pic })).toBe(false);
    expect(await canUploadToFolder(person("clientB"), folders.letters as never, { letterFileId: "a1", file: pic })).toBe(false);
    expect(await canUploadToFolder(person("guideA"), folders.letters as never, { file: md })).toBe(true);
    expect(await canUploadToFolder(person("crafter"), folders.letters as never, { letterFileId: "a1", file: pic })).toBe(false);
    // The recording the worker is pointed at must be the writer's own.
    expect(app("routes/api.letter.$fileId.recording.tsx")).toContain("!recording.s3_key?.startsWith(`vault/${got.user._id}/`)");
  });

  it("a draft's files, to its writer: what they put beside it themselves whether or not the draft names it yet, a file elsewhere only when they may read it anyway, and nothing to anyone else", async () => {
    file("a1", { from_human_id: "clientA", content: "# a1\n" });
    files.pic = { _id: "pic", human_id: "owner", name: "roof.jpg", folder_id: "letters", s3_key: "vault/clientA/letters/1-roof.jpg" };
    files.theirs = { _id: "theirs", human_id: "owner", name: "team.jpg", folder_id: "letters", s3_key: "vault/guideA/letters/2-team.jpg" };
    files.photo = { _id: "photo", human_id: "owner", name: "day.jpg", folder_id: "photos" };
    files.foreign = { _id: "foreign", human_id: "someone", name: "costs.pdf", folder_id: "elsewhere" };
    expect((await letterDraftFile("a1", "pic", person("clientA")))?._id).toBe("pic");
    // A picture a guide put beside another letter in the same folder is not theirs.
    expect(await letterDraftFile("a1", "theirs", person("clientA"))).toBeNull();
    expect(await letterDraftFile("a1", "photo", person("clientA"))).toBeNull();
    readable.add("clientA:photo");
    expect((await letterDraftFile("a1", "photo", person("clientA")))?._id).toBe("photo");
    expect(await letterDraftFile("a1", "foreign", person("clientA"))).toBeNull();
    expect(await letterDraftFile("a1", "pic", person("clientB"))).toBeNull();
    expect(await letterDraftFile("a1", "pic", person("guideA"))).toBeNull();
    // The routes ask the page's doors first, then this one.
    for (const route of ["api.letter.$fileId.view.$id.tsx", "api.letter.$fileId.rendition.$id.tsx"]) {
      expect(app(`routes/${route}`), route).toContain("(viewer ? await letterDraftFile(fileId, id, viewer) : null)");
    }
  });

  it("every write route asks the writer's gate; the brief's writing, the link, Upload and Replace stay the manager's", () => {
    for (const route of ["api.letter.$fileId.tsx", "api.letter.$fileId.talk.tsx", "api.letter.$fileId.outline.tsx", "api.letter.$fileId.send.tsx", "api.letter.$fileId.recording.tsx"]) {
      expect(app(`routes/${route}`), route).toMatch(/letterForWriter\(request, (params\.)?fileId\)/);
      expect(app(`routes/${route}`), route).not.toContain("letterForManager");
    }
    expect(app("routes/api.dictation.start.tsx")).toContain("letterForWriter(request, body.letterFile)");
    expect(app("routes/api.letter.$fileId.brief.tsx")).toMatch(/export async function loader[\s\S]*letterForWriter\(request, params\.fileId\)[\s\S]*export async function action[\s\S]*letterForManager\(request, params\.fileId\)/);
    expect(core("letters.server.ts")).toMatch(/export async function setLetterShared[\s\S]*manages: canManageLetters\(actor, role\)/);
    expect(app("routes/api.projects.$folderId.letters.tsx")).toContain("if (files.length > 0 && !manages) return Response.json({ error: LETTER_START_REFUSED }, { status: 403 });");
    expect(core("fileReplace.server.ts")).toContain("canActAsProjectOwner");
    // The uploads carry the letter they are for.
    for (const route of ["api.vault.upload.tsx", "api.vault.multipart-init.tsx", "api.vault.multipart-complete.tsx"]) {
      expect(app(`routes/${route}`), route).toContain("canUploadToFolder(user, folder,");
      expect(app(`routes/${route}`), route).not.toContain("canActAsProjectOwner(");
    }
    expect(app("components/LetterSplitEditor.tsx")).toContain('form.append("letterFileId", fileId)');
    expect(app("components/LetterRecorder.tsx")).toContain("{ letterFileId }");
    expect(app("components/vaultUpload.ts")).toContain('form.append("letterFileId", meta.letterFileId)');
  });

  it("the Vault's own write rule is untouched: the Letters folder is still a Guide's there", () => {
    expect(core("projectSharing.server.ts")).toContain("if (project) return writesInFolder(await getProjectRole(project, actingHumanId), folder!);");
    expect(app("routes/api.vault.$fileId.tsx")).toContain("isOwner || (await canActAsProjectOwner(user._id, file.human_id, file.folder_id))");
  });
});

describe("starting a letter as a client", () => {
  it("goes to the team whatever was asked, says who it is from, needs no purpose line, records none and runs no brief", () => {
    const src = app("routes/api.projects.$folderId.letters.tsx");
    expect(src).toContain('const asClient = viewer.house === "clients";');
    // Starting is the desk's rule, so nobody can start a letter they could not open.
    expect(src).toMatch(/if \(!mayStartLetter\(viewer\)\) \{\s*return Response\.json\(\{ error: LETTER_START_REFUSED \}, \{ status: 403 \}\);/);
    expect(src).toContain('const purpose = !asClient && typeof form.get("purpose") === "string" ? String(form.get("purpose")).trim() : "";');
    expect(src).toContain('if (!purpose && !asClient) return Response.json({ error: "Say what this letter is for first." }');
    expect(src).toMatch(/const address = asClient\s*\? \(\{ ok: true, toHouse: "guides" \} as const\)\s*: houseAtStart\(/);
    expect(src).toContain("...(asClient ? { from_human_id: user._id } : {})");
    expect(src).toContain("if (purpose) await recordPurpose(fileRef);");
    expect(src).toContain('if (!asClient && String(form.get("brief") ?? "") !== "skip")');
  });

  it("the form asks a client for a title and nothing else, and says where the letter goes", () => {
    const html = renderToStaticMarkup(<NewLetterModal open busy={false} error={null} asClient asksHouse onClose={() => {}} onStart={() => {}} />);
    expect(html).toContain('name="name"');
    expect(html).not.toContain('name="purpose"');
    expect(html).not.toContain("data-letter-for");
    expect(html).not.toContain("data-brief-run-note");
    expect(html).not.toContain("Write the brief first");
    expect(html).toContain("data-letter-start");
    expect(html).toContain(LETTER_TO_TEAM_NOTE.replaceAll("'", "&#x27;"));
    expect(LETTER_TO_TEAM_NOTE).not.toMatch(/—|\bhouse\b/);
  });

  it("a client's desk has New letter and not Upload; their own draft has Edit and Delete, a guide's letter to them has neither", () => {
    const row = (over: Record<string, unknown>) => ({ fileId: "x", name: "x.md", title: "X", updatedAt: "2026-11-05T08:00:00Z", size: 10, sharedAt: null, contentHash: "h", purpose: null, sentDate: null, sentCount: 0, sentHash: null, editedSinceSent: false, houses: null, fromHumanId: null, toHouse: null, writes: false, pdf: null, ...over });
    const rows = [
      row({ fileId: "ad", title: "Mine", fromHumanId: "clientA", toHouse: "guides", writes: true }),
      row({ fileId: "g2c", title: "Theirs", sentDate: "2026-11-04", sentCount: 1, from: "Lucas", houses: { fromHumanId: "guideA", fromHouse: "guides", toHouse: "clients" } }),
    ];
    const html = renderToStaticMarkup(<LettersView projectFolderId="p" rows={rows as never} manage={false} writes asClient onChanged={() => {}} />);
    expect(html).toContain("New letter");
    expect(html).not.toMatch(/Upload a letter|>Replace<|Share link|Send it first/);
    expect((html.match(/data-letter-edit/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/newspaper/p/letter/ad"');
    expect((html.match(/data-letter-delete/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/public/letter/g2c"');
  });

  it("a client's writing page has the talk box and the outline and no brief block, not even greyed", () => {
    const initial = { brief: null, job: null, talk: { draft: null, sent: null }, outline: null, outlineJob: null };
    const client = renderToStaticMarkup(<LetterBrief fileId="l1" initial={initial} hasPurpose={false} withBrief={false} openByDefault />);
    expect(client).toContain("data-letter-talk");
    expect(client).not.toMatch(/The brief|Write the brief|Say what it is for first/);
    const guide = renderToStaticMarkup(<LetterBrief fileId="l1" initial={initial} hasPurpose={false} openByDefault />);
    expect(guide).toContain("Write the brief");
    expect(app("components/LetterWriting.tsx")).toContain('withBrief={writer !== "client"}');
    expect(app("routes/newspaper.$folderId_.letter.$fileId.tsx")).toContain("writer: writing.writer");
  });
});

describe("a client's letter on the record", () => {
  it("enters the graph with the client as the speaker, and their talk-through lands straight on (a Client has feeds)", () => {
    expect(core("letterSync.server.ts")).toContain("senderHumanId: f.from_human_id ?? sent.byHumanId ?? projectFolder.human_id");
    expect(featuresOf("Client")).toContain("feeds");
    expect(core("dailyLog.server.ts")).toContain('const suggestion = !input.features.includes("feeds");');
    // Send keeps who a client's draft is from.
    expect(core("letterSend.server.ts")).toContain("const fromHumanId = kept?.fromHumanId ?? file.from_human_id ?? file.sent_by_human_id ?? actor._id;");
    expect(core("letterSend.server.ts")).toContain("writes: mayWriteLetter(letterViewerOf(actor._id, role), file, members)");
  });
});
