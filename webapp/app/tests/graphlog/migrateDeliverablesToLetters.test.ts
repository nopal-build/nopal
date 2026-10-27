/**
 * Deliverables became Letters (2026-10-27). The code reads a folder
 * stored under the old type as the new one; the admin script rewrites
 * the stored rows so the legacy entry can go. The decision is pure; the
 * writes are read from the source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lettersRewrite } from "robustness-core/data/adminScripts/migrateDeliverablesToLetters.server";
import { getAdminScript } from "robustness-core/data/adminScriptsRegistry.server";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, "../../../../packages/robustness-core/src/data/adminScripts/migrateDeliverablesToLetters.server.ts");

describe("what one stored folder becomes", () => {
  it("a root named Deliverables takes the new type and the new name", () => {
    expect(lettersRewrite({ folder_type: "deliverables", name: "Deliverables", is_folder_type_root: true })).toEqual({ folder_type: "letters", name: "Letters" });
  });

  it("a root somebody named otherwise keeps its name; a folder that inherited the type keeps its name too", () => {
    expect(lettersRewrite({ folder_type: "deliverables", name: "Reports", is_folder_type_root: true })).toEqual({ folder_type: "letters" });
    expect(lettersRewrite({ folder_type: "deliverables", name: "Deliverables", is_folder_type_root: false })).toEqual({ folder_type: "letters" });
  });

  it("every other folder is left alone, a Letters folder already on the new name included", () => {
    expect(lettersRewrite({ folder_type: "letters", name: "Letters", is_folder_type_root: true })).toBeNull();
    expect(lettersRewrite({ folder_type: "skills", name: "Skills", is_folder_type_root: true })).toBeNull();
    expect(lettersRewrite({ folder_type: undefined, name: "Deliverables", is_folder_type_root: false })).toBeNull();
  });
});

describe("the script", () => {
  it("is registered under a stable name and honors a dry run on its one write", () => {
    expect(getAdminScript("migrate-deliverables-to-letters")).toBeDefined();
    const src = readFileSync(scriptPath, "utf8");
    expect(src).toMatch(/if \(!dryRun\) \{\s*await merge\("vault_folders", folder\._id/);
    expect((src.match(/await merge\(/g) ?? []).length).toBe(1);
    // The id never changes: `file_refs.folder_id` points at it.
    expect(src).not.toMatch(/_id:|id:\s/);
  });
});
