/**
 * /maker counts personal logs and project Cards apart (2026-10-05). Two
 * Clients on This Healthy House showed "2 logs" on /maker and nothing in
 * its sync folder: the count was their personal Daily Log, welcome sample
 * included, and the one Card either had made was empty. The tally is the
 * part code can hold.
 */
import { describe, expect, it } from "vitest";
import { tallyCards } from "robustness-core/data/makerStats.server";

const names = new Map([
  ["thh", "This Healthy House"],
  ["sunny", "Sunny"],
]);

describe("Cards per person per project", () => {
  it("counts each project apart and an empty Card as empty", () => {
    const tally = tallyCards(
      [
        { humanId: "erica", date: "2026-10-04", projectFolderId: "thh", fed: "" },
        { humanId: "lucas", date: "2026-09-30", projectFolderId: "thh", fed: "walked the house" },
        { humanId: "lucas", date: "2026-10-01", projectFolderId: "thh", fed: "  \n" },
        { humanId: "lucas", date: "2026-10-02", projectFolderId: "sunny", fed: "framing" },
      ],
      names,
    );
    expect(tally.get("erica")).toEqual({
      cards: [{ projectFolderId: "thh", projectName: "This Healthy House", count: 1, empty: 1 }],
      lastDate: "2026-10-04",
    });
    expect(tally.get("lucas")).toEqual({
      cards: [
        { projectFolderId: "thh", projectName: "This Healthy House", count: 2, empty: 1 },
        { projectFolderId: "sunny", projectName: "Sunny", count: 1, empty: 0 },
      ],
      lastDate: "2026-10-02",
    });
  });

  it("someone with only a personal log has no entry", () => {
    expect(tallyCards([], names).get("paul")).toBeUndefined();
  });

  it("a Card on a project that no longer exists still counts", () => {
    const tally = tallyCards([{ humanId: "a", date: "2026-10-01", projectFolderId: "gone", fed: "x" }], names);
    expect(tally.get("a")?.cards[0].projectName).toBe("A removed project");
  });
});
