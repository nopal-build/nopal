/**
 * `buildOwnedFolderAncestry` is the one BEHAVIOR-changing piece of the
 * `fruits-performance-followup` garden seed's round-trip reduction work
 * (vs. the other three fixes, which are pure timing changes): it answers
 * `getFolderAncestry`'s same question from an already-fetched flat folder
 * list instead of one DB round trip per level. Pinned here since a bug in
 * it would surface as wrong breadcrumbs/tree-reveal for real users, not
 * just a slower page.
 */
import { describe, expect, it } from "vitest";
import { buildOwnedFolderAncestry } from "robustness-core/data/vault.server";
import type { VaultFolder } from "robustness-core/data/vault.types";

function folder(id: string, parentId: string | null, overrides: Partial<VaultFolder> = {}): VaultFolder {
  return {
    id: { tb: "vault_folders", id },
    _id: id,
    human_id: "human1",
    name: id,
    parent_folder_id: parentId,
    shared_with: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildOwnedFolderAncestry", () => {
  it("orders root container → … → the folder itself, same as getFolderAncestry", () => {
    const folders = [
      folder("root", null, { vault_root_key: "projects" }),
      folder("mid", "root"),
      folder("leaf", "mid"),
    ];
    expect(buildOwnedFolderAncestry("leaf", folders).map((f) => f._id)).toEqual(["root", "mid", "leaf"]);
  });

  it("returns just the folder itself when it's already a root", () => {
    const folders = [folder("root", null, { vault_root_key: "projects" })];
    expect(buildOwnedFolderAncestry("root", folders).map((f) => f._id)).toEqual(["root"]);
  });

  it("stops (doesn't throw) when the chain references a folder not in the list", () => {
    // e.g. a shared folder passed in by mistake, or a stale list — the
    // caller is responsible for only using this for an owned folder's own
    // complete list, but a partial list should degrade to a partial chain
    // rather than crash the page render.
    const folders = [folder("mid", "missing-root"), folder("leaf", "mid")];
    expect(buildOwnedFolderAncestry("leaf", folders).map((f) => f._id)).toEqual(["mid", "leaf"]);
  });

  it("returns an empty chain for an id with no matching folder at all", () => {
    expect(buildOwnedFolderAncestry("nowhere", [folder("root", null)])).toEqual([]);
  });

  it("terminates on a cyclic parent_folder_id instead of looping forever", () => {
    // Corrupt data: a points to b, b points back to a.
    const folders = [folder("a", "b"), folder("b", "a")];
    const result = buildOwnedFolderAncestry("a", folders);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result.map((f) => f._id).sort()).toEqual(["a", "b"]);
  });

  it("caps depth at 50 even without an exact 2-cycle, matching getFolderAncestry's own guard", () => {
    const folders: VaultFolder[] = [];
    for (let i = 0; i < 100; i++) {
      folders.push(folder(`f${i}`, i === 0 ? null : `f${i - 1}`));
    }
    const result = buildOwnedFolderAncestry("f99", folders);
    expect(result.length).toBe(50);
    expect(result[result.length - 1]._id).toBe("f99");
  });
});
