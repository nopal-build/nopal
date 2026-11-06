/**
 * The desk: a letter written inside its project, on a page of its own,
 * not in the Vault (2026-11-06; `letterDesk.server.ts`). Austin: "The
 * whole letters workflow shouldn't go to the vault, it should feel like
 * you are still in the project, at the desk and writing a letter."
 *
 * Held here: who the writing page opens for, in the one function the
 * page and the delete both ask; that a draft's words and workings are
 * read for nobody it refuses; that Delete takes a draft with its
 * workings and refuses a letter that has gone out; and that the
 * workflow's links lead to the desk and name the Vault nowhere. The
 * store is stubbed; the rules are what is under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = (rel: string) => readFileSync(path.join(here, "..", rel), "utf8");
const core = (name: string) => readFileSync(path.join(here, "../../../packages/robustness-core/src/data", name), "utf8");

const lists: Record<string, { human: string; role: string }[]> = {
  proj: [
    { human: "guideA", role: "Guide" },
    { human: "guideB", role: "Guide" },
    { human: "crafter", role: "Crafter" },
    { human: "observer", role: "Observer" },
    { human: "clientA", role: "Client" },
    { human: "clientB", role: "Client" },
    { human: "staffCrafter", role: "Crafter" },
  ],
  other: [{ human: "guideA", role: "Guide" }],
};
const files: Record<string, Record<string, unknown>> = {};
const folders: Record<string, Record<string, unknown>> = {
  proj: { _id: "proj", human_id: "owner", project_status: "active" },
  other: { _id: "other", human_id: "owner", project_status: "active" },
  gone: { _id: "gone", human_id: "owner", project_status: "trashed" },
  letters: { _id: "letters", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  lettersOther: { _id: "lettersOther", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "other" },
  lettersGone: { _id: "lettersGone", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "gone" },
  photos: { _id: "photos", folder_type: "photos", is_folder_type_root: true, parent_folder_id: "proj" },
};
const deleted: string[] = [];
const workingsRemoved: string[] = [];
const workingsRead: string[] = [];

vi.mock("robustness-core/data/vault.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/vault.server")>();
  return {
    ...actual,
    getFileRefById: vi.fn(async (id: string) => files[id]),
    getFolderById: vi.fn(async (id: string) => folders[id]),
    listFolderChildren: vi.fn(async (_humanId: string, parentId: string) => ({ folders: Object.values(folders).filter((f) => f.parent_folder_id === parentId), files: [] })),
    deleteFileRef: vi.fn(async (id: string) => {
      deleted.push(id);
      delete files[id];
    }),
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
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
    getProjectSharing: vi.fn(async (project: { _id: string }) => lists[project._id] ?? []),
    getProjectRole: vi.fn(async (project: { _id: string }, humanId: string) => roleOn(project._id, humanId)),
    // What the real one does for a file in a project: the acting person's
    // role on that project, asked of `writesInFolder` for that folder.
    canActAsProjectOwner: vi.fn(async (actingHumanId: string, _ownerHumanId: string, folderId: string | null | undefined) => {
      const folder = folderId ? folders[folderId] : null;
      const project = folder ? folders[String(folder.parent_folder_id)] : null;
      return !!folder && !!project && actual.writesInFolder(roleOn(String(project._id), actingHumanId), folder as never);
    }),
  };
});
vi.mock("robustness-core/data/organizations.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/organizations.server")>();
  return { ...actual, getOrganizationMembers: vi.fn(async () => []) };
});
vi.mock("robustness-core/data/brief.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/brief.server")>();
  return {
    ...actual,
    getLetterBriefForPage: vi.fn(async (id: string) => {
      workingsRead.push(id);
      return { brief: null, job: null, talk: { draft: "THE TALK SO FAR", sent: null }, outline: null, outlineJob: null };
    }),
    removeLetterBriefRow: vi.fn(async (id: string) => void workingsRemoved.push(id)),
  };
});

const { letterWriter, letterWritingFor, removeDraftLetter, letterHasGoneOut, LETTER_SENT_STAYS } = await import("robustness-core/data/letterDesk.server");

const project = folders.proj as never;
const person = (id: string, role = "Human") => ({ _id: id, role: role as never });
const draft = (id: string, over: Record<string, unknown> = {}) => {
  files[id] = { _id: id, human_id: "owner", name: `${id}.md`, content: `# ${id}\n\nTHE DRAFT'S WORDS.\n`, folder_id: "letters", updated_at: "2026-11-06T10:00:00Z", ...over };
  return files[id];
};
const sent = { sent_content: "# s\n", sent_at: "2026-11-05T10:00:00Z", sent_date: "2026-11-05", sent_count: 1 };

beforeEach(() => {
  for (const id of Object.keys(files)) delete files[id];
  deleted.length = 0;
  workingsRemoved.length = 0;
  workingsRead.length = 0;
});

describe("who the writing page opens for", () => {
  it("a Guide on the project, for the guides' letters; not a Crafter, an Observer, a Client or a stranger", async () => {
    draft("l1");
    for (const guide of ["guideA", "guideB"]) expect((await letterWriter(project, "l1", person(guide)))?.file._id, guide).toBe("l1");
    for (const other of ["crafter", "observer", "clientA", "stranger"]) expect(await letterWriter(project, "l1", person(other)), other).toBeNull();
    expect((await letterWriter(project, "l1", person("guideA")))?.writer).toBe("guide");
  });

  it("staff who are not on the project, or on it as a Crafter, get nothing: writing means a role on the project (Austin, 2026-11-06)", async () => {
    draft("l1");
    expect(await letterWriter(project, "l1", person("staffOutside", "Admin"))).toBeNull();
    expect(await letterWriter(project, "l1", person("staffCrafter", "Admin"))).toBeNull();
    // The page, its save and every write route ask one rule, not the Vault's.
    expect(core("letterDesk.server.ts")).toContain("resolveLetterForWriter(fileId, user)");
    expect(core("letterDesk.server.ts")).not.toContain("canActAsProjectOwner");
    expect(app("routes/api.letter.$fileId.tsx")).toContain("letterForWriter(request, params.fileId)");
    expect(app("components/LetterDesk.tsx")).toContain("fetch(`/api/letter/${fileId}`");
    expect(app("components/LetterDesk.tsx")).not.toContain("/api/vault/");
  });

  it("a client, for a letter from them and no other; a guide never for a client's draft (Austin, 2026-11-05: a client's draft is theirs alone)", async () => {
    draft("mine", { from_human_id: "clientA" });
    expect((await letterWriter(project, "mine", person("clientA")))?.writer).toBe("client");
    for (const other of ["clientB", "guideA", "crafter", "observer", "staffOutside"]) expect(await letterWriter(project, "mine", person(other, other === "staffOutside" ? "Admin" : "Human")), other).toBeNull();
    // Owning the file in the Vault's sense is not the rule: a client's
    // letter is theirs by who it is from.
    draft("owned", { human_id: "clientA" });
    expect(await letterWriter(project, "owned", person("clientA"))).toBeNull();
    // Sent, a client's letter stays theirs to send again, by its house.
    draft("sentMine", { ...sent, from_human_id: "clientA", from_house: "clients", to_house: "guides" });
    expect((await letterWriter(project, "sentMine", person("clientA")))?.writer).toBe("client");
    expect(await letterWriter(project, "sentMine", person("guideA"))).toBeNull();
  });

  it("only this project's letters under this project's address, and only a letter: not one in another project, an archived one, one in a trashed project, a file that is not markdown, or a file outside the Letters folder", async () => {
    draft("elsewhere", { folder_id: "lettersOther" });
    expect(await letterWriter(project, "elsewhere", person("guideA"))).toBeNull();
    expect((await letterWriter(folders.other as never, "elsewhere", person("guideA")))?.file._id).toBe("elsewhere");
    draft("archived", { archived_at: "2026-11-06T00:00:00Z" });
    expect(await letterWriter(project, "archived", person("guideA"))).toBeNull();
    draft("trashed", { folder_id: "lettersGone" });
    expect(await letterWriter(folders.gone as never, "trashed", person("guideA"))).toBeNull();
    draft("picture", { name: "roof.jpg" });
    expect(await letterWriter(project, "picture", person("guideA"))).toBeNull();
    draft("note", { folder_id: "photos" });
    expect(await letterWriter(project, "note", person("guideA"))).toBeNull();
    expect(await letterWriter(project, undefined, person("guideA"))).toBeNull();
    expect(await letterWriter(project, "nothing", person("guideA"))).toBeNull();
  });

  it("a draft's words and its workings are read for the page only after the gate: nobody it refuses is handed either", async () => {
    draft("l1");
    const page = await letterWritingFor(project, "l1", person("guideB"));
    expect(page?.file).toMatchObject({ _id: "l1", content: "# l1\n\nTHE DRAFT'S WORDS.\n" });
    expect(page?.brief.talk.draft).toBe("THE TALK SO FAR");
    expect(page?.send).toMatchObject({ sentDate: null, sentCount: 0 });
    workingsRead.length = 0;
    for (const other of ["crafter", "observer", "clientA", "stranger"]) expect(await letterWritingFor(project, "l1", person(other)), other).toBeNull();
    expect(await letterWritingFor(folders.other as never, "l1", person("guideA"))).toBeNull();
    expect(workingsRead).toEqual([]);
    // The route asks the function before it reads anything of the letter, and 404s on null.
    const route = app("routes/newspaper.$folderId_.letter.$fileId.tsx");
    expect(route).toMatch(/const writing = project \? await letterWritingFor\(project, params\.fileId, user\) : null;\s*if \(!project \|\| !writing\) throw new Response\("Not found", \{ status: 404 \}\);/);
    expect(route.indexOf("letterWritingFor(project")).toBeLessThan(route.indexOf("resolveProjectManifest("));
    expect(route).toContain('if (!user) return redirect("/login");');
  });
});

describe("Delete is for a draft", () => {
  it("a draft goes with its workings", async () => {
    draft("l1");
    expect(await removeDraftLetter("l1", person("guideB"))).toEqual({ ok: true });
    expect(deleted).toEqual(["l1"]);
    expect(workingsRemoved).toEqual(["l1"]);
  });

  it("a letter that was sent, or whose link was ever on, stays: refused on the server, with nothing removed", async () => {
    draft("sentOne", sent);
    draft("linked", { shared_at: "2026-10-20T10:00:00Z" });
    for (const id of ["sentOne", "linked"]) {
      expect(letterHasGoneOut(files[id] as never), id).toBe(true);
      expect(await removeDraftLetter(id, person("guideA")), id).toEqual({ ok: false, status: 400, error: LETTER_SENT_STAYS });
    }
    expect(letterHasGoneOut(draft("plain") as never)).toBe(false);
    expect(deleted).toEqual([]);
    expect(workingsRemoved).toEqual([]);
  });

  it("nobody who could not write the letter deletes it", async () => {
    draft("l1");
    for (const other of ["crafter", "observer", "clientA", "stranger"]) expect(await removeDraftLetter("l1", person(other)), other).toMatchObject({ ok: false, status: 404 });
    expect(await removeDraftLetter("l1", person("staffOutside", "Admin"))).toMatchObject({ ok: false, status: 404 });
    expect(await removeDraftLetter(undefined, person("guideA"))).toMatchObject({ ok: false, status: 404 });
    expect(deleted).toEqual([]);
    const route = app("routes/api.letter.$fileId.remove.tsx");
    expect(route).toContain("const result = await removeDraftLetter(params.fileId, user);");
    expect(route).toContain('if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });');
  });
});

describe("the workflow leads to the desk and names the Vault nowhere", () => {
  it("starting a letter, Edit on a row, Write a letter from this, and a guide's own preview all point at the desk", () => {
    const view = app("components/LettersView.tsx");
    expect(view).toContain("return `/newspaper/${projectFolderId}/letter/${fileId}`;");
    expect(view).toContain("if (data?.fileId) window.location.assign(letterDeskPath(projectFolderId, data.fileId));");
    expect(view).toContain("const deskPath = letterDeskPath(projectFolderId, row.fileId);");
    for (const file of ["components/LettersView.tsx", "components/LetterReflection.tsx", "components/LetterDesk.tsx", "components/LetterWriting.tsx", "components/LetterBrief.tsx", "components/ProjectMailbox.tsx", "routes/public.letter.$fileId.tsx", "routes/newspaper.$folderId_.letter.$fileId.tsx"]) {
      expect(app(file), file).not.toMatch(/\/vault\?file=|openInVault/);
    }
    expect(app("routes/public.letter.$fileId.tsx")).toContain("writeAt: letterDeskPath(mine.project._id, mine.file._id)");
  });

  it("the Vault is the back room: it still mounts the same writing component, and both places give the editor a key made of the letter and its last save", () => {
    const vault = app("routes/vault.tsx");
    expect(vault).toContain("<LetterWriting");
    expect(vault).not.toMatch(/function (MarkdownSplitEditor|LetterSplitEditor|PhotoPickerLoader|CopyLinkButton)\(/);
    expect(app("components/LetterDesk.tsx")).toContain("<LetterWriting");
    const writing = app("components/LetterWriting.tsx");
    expect(writing).toContain("return `${file._id}-${file.updated_at}`;");
    expect(writing).toMatch(/<LetterSplitEditor\s+key=\{loadedKey\}/);
    // The Actions menu is the Vault's and is handed in, never built into the shared component.
    expect(writing).not.toMatch(/MoreMenu|Rename|Move/);
  });

  it("the desk's page saves through the letter's own route and never throws: a failed save is said on the page", () => {
    const desk = app("components/LetterDesk.tsx");
    expect(desk).toMatch(/fetch\(`\/api\/letter\/\$\{fileId\}`, \{ method: "PATCH"/);
    expect(desk).toMatch(/if \(!res\.ok\) \{\s*setProblem\(data\?\.error \?\? LETTER_SAVE_FAILED\);\s*return null;/);
    expect(desk).toMatch(/\} catch \{\s*setProblem\(LETTER_SAVE_FAILED\);\s*return null;/);
    expect(desk).toContain('role="alert" data-desk-problem');
    // Delete is offered only on a letter that has never gone out; the route refuses the rest anyway.
    expect(desk).toMatch(/\{!letter\.goneOut && \(\s*<button [^\n]*data-desk-delete>/);
  });
});
