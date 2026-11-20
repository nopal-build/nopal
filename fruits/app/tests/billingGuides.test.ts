// Who gets a project's guide mail (payments, 2026-11-17). Guide mail went
// only to people on the project's sharing list, so a Guide who guides
// through the Organization that owns the project, with no entry of their
// own, heard nothing about a resume request or a failed payment. The
// rule is `getProjectRole`'s precedence, held in one pure function.
import { describe, expect, it, vi } from "vitest";
vi.mock("../util/email.server", () => ({ sendEmail: async () => {} }));
import { guideIdsFrom } from "../data/billingNotices.server";

const sharing = [
  { human: "guideA", role: "Owner" },
  { human: "guideB", role: "Guide" },
  { human: "crafter", role: "Crafter" },
  { human: "observer", role: "Observer" },
  { human: "clientA", role: "Client" },
];

describe("who gets guide mail on a project", () => {
  it("the guiding people on the list, and nobody else on it", () => {
    expect(guideIdsFrom(sharing, []).sort()).toEqual(["guideA", "guideB"]);
  });
  it("an Organization's Guide with no entry on the list gets it", () => {
    expect(guideIdsFrom(sharing, ["orgGuide"])).toContain("orgGuide");
  });
  it("an Organization's Guide the list names a Client does not", () => {
    expect(guideIdsFrom(sharing, ["clientA"])).not.toContain("clientA");
  });
  it("an Organization's Guide whose entry is a name nobody knows still does", () => {
    expect(guideIdsFrom([{ human: "orgGuide", role: "Stranger" }], ["orgGuide"])).toEqual(["orgGuide"]);
  });
  it("nobody is listed twice", () => {
    expect(guideIdsFrom(sharing, ["guideB"]).filter((id) => id === "guideB")).toHaveLength(1);
  });
});
