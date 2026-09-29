/**
 * The Maker as the one place for projects and people (ADR-026,
 * 2026-09-28): who may start a project, who gets the Maker, and which
 * groups a Guide may give. The pages and refusals over HTTP are
 * `fruits/scripts/campbell-walk.ts` against a running stack.
 */
import { describe, expect, it } from "vitest";
import { GROUPS, assignableGroups } from "robustness-core/data/features";
import { canStartProject, guidesAny, type ProjectMembership } from "robustness-core/data/projectSharing.server";

const on = (role: string) => ({ role }) as ProjectMembership;

describe("test 4: who starts a project and who gets the Maker", () => {
  it("guiding one project is enough; being on projects isn't", () => {
    expect(guidesAny([on("Client"), on("Crafter"), on("Observer")])).toBe(false);
    expect(guidesAny([on("Client"), on("Guide")])).toBe(true);
    // The old name still guides.
    expect(guidesAny([on("Owner")])).toBe(true);
    expect(guidesAny([])).toBe(false);
  });

  it("an admin starts a project on no memberships at all; a regular needs to guide one", async () => {
    await expect(canStartProject({ _id: "a", role: "Admin" }, [])).resolves.toBe(true);
    await expect(canStartProject({ _id: "s", role: "Super" }, [])).resolves.toBe(true);
    await expect(canStartProject({ _id: "h", role: "Human" }, [on("Crafter")])).resolves.toBe(false);
    await expect(canStartProject({ _id: "h", role: "Human" }, [on("Guide")])).resolves.toBe(true);
  });
});

describe("the groups a person may give", () => {
  it("an admin gives any; a Guide gives everything but Guide", () => {
    expect(assignableGroups(true)).toEqual([...GROUPS]);
    expect(assignableGroups(false)).toEqual(["Crafter", "Observer", "Client"]);
  });
});
