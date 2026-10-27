/**
 * The letter behind a public link, checked on every request
 * (`resolveSharedLetter`, `letterPageFile`): off, or the wrong
 * folder, or a trashed project, is nothing; and only the ids the page
 * names right now are served. The vault reads are stubbed; the rules
 * are what is under test.
 */
import { describe, expect, it, vi } from "vitest";

const files: Record<string, Record<string, unknown>> = {
  shared1: { _id: "shared1", name: "madison-attic.md", content: "# Attic\n\n![hatch](/api/vault/view/pic1)\n", folder_id: "delivs", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  off1: { _id: "off1", name: "draft.md", content: "# Draft", folder_id: "delivs", shared_at: null, updated_at: "2026-10-21T08:00:00Z" },
  stray1: { _id: "stray1", name: "notes.md", content: "# Notes", folder_id: "docs", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  gone1: { _id: "gone1", name: "old.md", content: "# Old", folder_id: "delivsTrashed", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  legacy1: { _id: "legacy1", name: "attic.md", content: "# Attic", folder_id: "delivsLegacy", shared_at: "2026-10-21T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
  pic1: { _id: "pic1", name: "hatch.jpg", content: null, folder_id: "day", s3_key: "k", content_type: "image/jpeg" },
  pic2: { _id: "pic2", name: "other.jpg", content: null, folder_id: "day", s3_key: "k2", content_type: "image/jpeg" },
};
const folders: Record<string, Record<string, unknown>> = {
  delivs: { _id: "delivs", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "proj" },
  delivsTrashed: { _id: "delivsTrashed", folder_type: "letters", is_folder_type_root: true, parent_folder_id: "projTrashed" },
  // A folder from before the rename (2026-10-27), not yet rewritten by
  // `migrate-deliverables-to-letters`.
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
vi.mock("robustness-core/data/projectSharing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("robustness-core/data/projectSharing.server")>();
  return {
    ...actual,
    findOwningProjectFolder: vi.fn(async (folder: { parent_folder_id: string }) => folders[folder.parent_folder_id] ?? null),
  };
});

const { letterPageFile, resolveSharedLetter } = await import("robustness-core/data/letters.server");
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
});

describe("a render ahead of the click", () => {
  it("is asked for only for a shared markdown file in a Letters folder", async () => {
    // Nothing reaches the queue in these three: the gate answers first.
    expect(await enqueueLetterPdfIfShared(files.off1 as never)).toBeNull();
    expect(await enqueueLetterPdfIfShared(files.stray1 as never)).toBeNull();
    expect(await enqueueLetterPdfIfShared(null)).toBeNull();
  });
});
