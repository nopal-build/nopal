/**
 * Suggestions (2026-09-28): what an Observer writes waits for a Guide.
 * The rules code holds: a suggestion Card feeds only what a Guide took,
 * later words wait again, and a website is never a GraphLog project. The
 * take and pass over HTTP are `fruits/scripts/campbell-walk.ts`.
 */
import { describe, expect, it } from "vitest";
import { fedContent } from "robustness-core/data/dailyLog.server";
import { cardStatus } from "robustness-core/data/suggestions.server";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";

describe("a suggestion Card feeds only what a Guide took", () => {
  it("anyone else's Card feeds as written", () => {
    expect(fedContent({ content: "poured the slab" })).toBe("poured the slab");
  });

  it("an Observer's feeds nothing until taken, then the words taken", () => {
    expect(fedContent({ content: "the slab looks off", suggestion: true })).toBe("");
    expect(fedContent({ content: "the slab looks off, and more", suggestion: true, taken_content: "the slab looks off" })).toBe(
      "the slab looks off",
    );
  });
});

describe("where a suggestion Card stands", () => {
  it("waiting, taken, passed, and waiting again once more is written", () => {
    expect(cardStatus({ content: "a" })).toBe("pending");
    expect(cardStatus({ content: "a", taken_content: "a" })).toBe("taken");
    expect(cardStatus({ content: "a", passed_content: "a" })).toBe("passed");
    expect(cardStatus({ content: "a b", taken_content: "a" })).toBe("pending");
  });
});

describe("a website isn't a GraphLog project", () => {
  it("by its type alone", () => {
    expect(isWebsiteFolder({ folder_type: "website" })).toBe(true);
    expect(isWebsiteFolder({ folder_type: "project-n02" })).toBe(false);
    expect(isWebsiteFolder({})).toBe(false);
  });
});
