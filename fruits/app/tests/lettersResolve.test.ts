/**
 * The letter behind a public link, checked on every request
 * (`resolveSharedLetter`, `letterPageFile`): off, or the wrong
 * folder, or a trashed project, is nothing; and only the ids the sent
 * copy names are served. Since 2026-10-28 a second door: someone on the
 * project, logged in, once the letter is sent
 * (`resolveSentLetterForMember`); and a letter whose link was on before
 * letters had a send gets its sent copy written down on first read
 * (`ensureSentCopy`). The vault reads and the one write are stubbed;
 * the rules are what is under test.
 */
import { describe, expect, it, vi } from "vitest";

const files: Record<string, Record<string, unknown>> = {
  shared1: { _id: "shared1", name: "madison-attic.md", content: "# Attic\n\n![hatch](/api/vault/view/pic1)\n", folder_id: "delivs", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  off1: { _id: "off1", name: "draft.md", content: "# Draft", folder_id: "delivs", shared_at: null, updated_at: "2026-10-21T08:00:00Z" },
  // Sent, link off, and edited since: the draft names pic2, the sent copy pic1.
  sent1: { _id: "sent1", name: "sent.md", content: "# Attic v2\n\n![other](/api/vault/view/pic2)\n", content_hash: "v2", folder_id: "delivs", shared_at: null, updated_at: "2026-10-22T08:00:00Z", sent_content: "# Attic\n\n![hatch](/api/vault/view/pic1)\n", sent_content_hash: "v1", sent_at: "2026-10-22T07:00:00Z", sent_date: "2026-10-22", sent_by_human_id: "guide1", sent_count: 1 },
  stray1: { _id: "stray1", name: "notes.md", content: "# Notes", folder_id: "docs", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  gone1: { _id: "gone1", name: "old.md", content: "# Old", folder_id: "delivsTrashed", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  legacy1: { _id: "legacy1", name: "attic.md", content: "# Attic", folder_id: "delivsLegacy", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  pic1: { _id: "pic1", name: "hatch.jpg", content: null, folder_id: "day", s3_key: "k", content_type: "image/jpeg" },
  pic2: { _id: "pic2", name: "other.jpg", content: null, folder_id: "day", s3_key: "k2", content_type: "image/jpeg" },
};
const folders: Record<string, Record<string, unknown>> = {
  delivs: { _id: "delivs", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  delivsTrashed: { _id: "delivsTrashed", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "projTrashed" },
  // A folder from before the rename (2026-10-27), as a local or staging
  // database may still hold one.
  delivsLegacy: { _id: "delivsLegacy", folder_type: "deliverables", is_folder_type_root: true, parent_folder_id: "proj" },
  docs: { _id: "docs", folder_type: "project-n02", is_folder_type_root: false, parent_folder_id: "proj" },
  proj: { _id: "proj", project_status: "active" },
  projTrashed: { _id: "projTrashed", project_status: "trashed" },
};

vi.mock("robustness-core/data/vault.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/vault.server")>();
  return {
    ...actual,
    getFileRefById: vi.fn(async (id: string) => files[id]),
    getFolderById: vi.fn(async (id: string) => folders[id]),
  };
});
const roles: Record<string, string[]> = { proj: ["guide1", "client1"] };
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
    getProjectRole: vi.fn(async (project: { _id: string }, humanId: string) => (roles[project._id]?.includes(humanId) ? { group: "Client", features: [] } : null)),
  };
});
const merged: { table: string; id: string; data: Record<string, unknown> }[] = [];
vi.mock("robustness-core/data/generic.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/generic.server")>();
  return {
    ...actual,
    merge: vi.fn(async (table: string, id: string, data: Record<string, unknown>) => {
      merged.push({ table, id, data });
      return { ...files[id], ...data };
    }),
  };
});

const { letterPageFile, resolveSentLetterForMember, resolveSharedLetter } = await import("robustness-core/data/letters.server");
const { enqueueLetterPdfIfShared } = await import("robustness-core/data/letterPdf.server");

describe("resolveSharedLetter", () => {
  it("finds a shared markdown file in a Letters folder of a live project", async () => {
    const found = await resolveSharedLetter("shared1");
    expect(found?.file._id).toBe("shared1");
    expect(found?.project._id).toBe("proj");
  });

  it("finds one in a folder still stored as `deliverables`, so a link from before the rename keeps answering", async () => {
    const found = await resolveSharedLetter("legacy1");
    expect(found?.file._id).toBe("legacy1");
    expect(found?.project._id).toBe("proj");
  });

  it("is nothing when the link is off, the file sits outside Letters, the project is trashed, or the id is unknown", async () => {
    expect(await resolveSharedLetter("off1")).toBeNull();
    expect(await resolveSharedLetter("stray1")).toBeNull();
    expect(await resolveSharedLetter("gone1")).toBeNull();
    expect(await resolveSharedLetter("nope")).toBeNull();
  });
});

describe("letterPageFile", () => {
  it("serves an id the page names, and nothing else", async () => {
    expect((await letterPageFile("shared1", "pic1"))?._id).toBe("pic1");
    expect(await letterPageFile("shared1", "pic2")).toBeNull();
    expect(await letterPageFile("off1", "pic1")).toBeNull();
  });

  it("with the link off, serves the sent copy's pictures to someone on the project, never the draft's, and nothing to anyone else", async () => {
    expect((await letterPageFile("sent1", "pic1", "client1"))?._id).toBe("pic1");
    expect(await letterPageFile("sent1", "pic2", "client1")).toBeNull();
    expect(await letterPageFile("sent1", "pic1", "stranger")).toBeNull();
    expect(await letterPageFile("sent1", "pic1")).toBeNull();
    expect(await letterPageFile("off1", "pic1", "client1")).toBeNull();
  });
});

describe("the member's door (2026-10-28)", () => {
  it("opens for someone on the project once the letter is sent, and for nobody on a draft", async () => {
    expect((await resolveSentLetterForMember("sent1", "client1"))?.file._id).toBe("sent1");
    expect(await resolveSentLetterForMember("sent1", "stranger")).toBeNull();
    expect(await resolveSentLetterForMember("off1", "client1")).toBeNull();
    expect(await resolveSentLetterForMember("gone1", "client1")).toBeNull();
  });

  it("a letter whose link was on before letters had a send gets its live content written down as the sent copy, once", async () => {
    merged.length = 0;
    const found = await resolveSharedLetter("shared1");
    expect(found?.file.sent_at).toBe("2026-10-21T09:00:00Z");
    expect(found?.file.sent_content).toBe(files.shared1.content);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ table: "file_refs", id: "shared1", data: { sent_at: "2026-10-21T09:00:00Z", sent_date: "2026-10-21", sent_count: 1, sent_by_human_id: null } });
    // Already sent: nothing written.
    merged.length = 0;
    await resolveSentLetterForMember("sent1", "client1");
    expect(merged).toHaveLength(0);
  });
});

describe("a render ahead of the click", () => {
  it("is asked for only for a sent markdown file in a Letters folder with its link on", async () => {
    // Nothing reaches the queue in these: the gate answers first.
    expect(await enqueueLetterPdfIfShared(files.off1 as never)).toBeNull();
    expect(await enqueueLetterPdfIfShared(files.stray1 as never)).toBeNull();
    expect(await enqueueLetterPdfIfShared(files.sent1 as never)).toBeNull();
    expect(await enqueueLetterPdfIfShared(null)).toBeNull();
  });
});
