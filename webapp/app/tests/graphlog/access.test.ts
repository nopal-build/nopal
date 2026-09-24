/**
 * A role on the project is the only answer (ADR-023). A Client is left out
 * of the `shared_with` cache every view check reads; owning a project's
 * folder gets nobody in; nothing reads the retired seat. The refusals over
 * HTTP are `fruits/scripts/campbell-walk.ts` against a running stack.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProjectSharing } from "robustness-core/data/project.types";
import { CLIENT_ROLE, GUIDING_ROLE, reachesProjectWork } from "robustness-core/data/sharingRoles.server";
import { isClientEverywhere, type ProjectMembership } from "robustness-core/data/projectSharing.server";
import { canViewFolder, type VaultFolder } from "robustness-core/data/vault.types";

const AUSTIN = "k3v9x0q2m7w1b5n8c4d6";
const PAUL = "z1x2c3v4b5n6m7l8k9j0";

describe("who reaches a project's work", () => {
  it("everyone but a Client", () => {
    expect(reachesProjectWork("Owner")).toBe(true);
    expect(reachesProjectWork("Crafter")).toBe(true);
    expect(reachesProjectWork("Observer")).toBe(true);
    expect(reachesProjectWork(CLIENT_ROLE)).toBe(false);
    expect(GUIDING_ROLE).toBe("Owner");
  });

  it("the client screen is for someone who is a Client everywhere, and only them", () => {
    const m = (role: string) => ({ role }) as ProjectMembership;
    expect(isClientEverywhere([m("Client")])).toBe(true);
    expect(isClientEverywhere([m("Client"), m("Owner")])).toBe(false);
    expect(isClientEverywhere([])).toBe(false);
  });

  it("an old seat in a README is ignored", () => {
    expect(parseProjectSharing("---\nsharing:\n  - human: a\n    role: Observer\n    seat: client\n---\n")).toEqual([
      { human: "a", role: "Observer" },
    ]);
  });
});

describe("owning a project's folder gets nobody in", () => {
  const folder = (over: Partial<VaultFolder>): VaultFolder =>
    ({
      _id: "a1b2c3d4e5f6g7h8i9j0",
      human_id: AUSTIN,
      name: "Crouch Casita",
      parent_folder_id: "r0o1t2f3o4l5d6e7r8s9",
      vault_root_key: "projects",
      shared_with: [],
      ...over,
    }) as VaultFolder;

  it("a creator who set themselves to Client is refused their own project", () => {
    expect(canViewFolder(AUSTIN, folder({}))).toBe(false);
    expect(canViewFolder(AUSTIN, folder({ shared_with: [AUSTIN] }))).toBe(true);
  });

  it("ownership still decides a personal folder and the projects root", () => {
    expect(canViewFolder(AUSTIN, folder({ vault_root_key: "personal" }))).toBe(true);
    expect(canViewFolder(AUSTIN, folder({ parent_folder_id: null }))).toBe(true);
    expect(canViewFolder(PAUL, folder({ vault_root_key: "personal" }))).toBe(false);
  });
});

describe("nothing reads the retired seat", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const files = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : [],
    );
  it("no seatFor, no seat field, no creator shortcut in a role check", () => {
    const hits: string[] = [];
    for (const f of [...files("fruits/app/routes"), ...files("fruits/app/components"), ...files("packages/robustness-core/src/data")]) {
      const code = readFileSync(path.join(root, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      if (/\bseatFor\b|\bseatFromSharing\b|\bProjectSeat\b|\.seat\b/.test(code)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
