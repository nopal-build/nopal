/**
 * The replace permission decision shared by the one-body replace route and
 * the chunked (multipart) replace. One decision, two callers; the facts are
 * gathered by the async wrapper, the order of refusals is pinned here.
 */
import { describe, expect, it } from "vitest";
import { replaceRefusalFor, type ReplaceFacts } from "robustness-core/data/fileReplace.server";

const allowed: ReplaceFacts = {
  actsAsOwner: true,
  syncScoped: false,
  underSyncs: false,
  folderWritable: true,
  writeRefusal: "",
  locked: false,
};

describe("replaceRefusalFor", () => {
  it("allows the owner of an unlocked, writable file", () => {
    expect(replaceRefusalFor(allowed)).toBeNull();
  });

  it("refuses someone who is neither owner nor owner-tier on the project", () => {
    expect(replaceRefusalFor({ ...allowed, actsAsOwner: false })).toEqual({ status: 403, error: "Forbidden" });
  });

  it("confines a sync token to syncs/", () => {
    expect(replaceRefusalFor({ ...allowed, syncScoped: true, underSyncs: false })?.status).toBe(403);
    expect(replaceRefusalFor({ ...allowed, syncScoped: true, underSyncs: true })).toBeNull();
  });

  it("explains a folder policy refusal in the policy's own words", () => {
    const refusal = replaceRefusalFor({ ...allowed, folderWritable: false, writeRefusal: "Skills are admin-only" });
    expect(refusal).toEqual({ status: 403, error: "Skills are admin-only" });
  });

  it("refuses a locked daily-log file last, after the ownership checks", () => {
    expect(replaceRefusalFor({ ...allowed, locked: true })?.error).toMatch(/locked/);
    // Ownership wins over locked: a stranger gets the generic refusal.
    expect(replaceRefusalFor({ ...allowed, locked: true, actsAsOwner: false })?.error).toBe("Forbidden");
  });
});
