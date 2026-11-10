// Work on hold for a missing bank link (Austin, 2026-11-03). Gates: a
// Client on a held project keeps the role but reaches none of it (every
// project API reads features through `getProjectRole`), whether for a
// plan or a bill unpaid 10 days past its due date; the guide is
// untouched; a Client on a project that isn't held is untouched.
import { describe, expect, it, vi } from "vitest";

const plans = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const bills = vi.hoisted(() => [] as { id: string; project_folder_id: string; status: string; created_at: string }[]);
vi.mock("robustness-core/data/vault.server", () => ({
  getReadmeFileForFolder: async () => ({
    content: "---\nsharing:\n  - human: guide\n    role: Guide\n  - human: sue\n    role: Client\n---\n",
  }),
  cascadeShareVaultFolder: async () => {},
  createFileRef: async () => ({}),
  getFolderAncestry: async () => [],
  getFolderById: async () => null,
  updateFileRef: async () => ({}),
}));
vi.mock("robustness-core/data/generic.server", () => ({
  query: async (_sql: string, vars: { folderId?: string }) => [bills.filter((b) => b.project_folder_id === vars?.folderId)],
  formatRecord: (r: unknown) => r,
  select: async (rid: { tb: string; id: unknown }) => (rid.tb === "billing_plans" ? plans.get(String(rid.id)) : undefined),
}));

import { getProjectRole } from "robustness-core/data/projectSharing.server";
import { projectHold } from "robustness-core/data/planHold.server";

const DAY_MS = 86400000;
const folder = (id: string) => ({ _id: id, human_id: "guide" }) as never;
plans.set("held", { status: "awaiting_setup", start_date: new Date(Date.now() - 40 * DAY_MS).toISOString() });
plans.set("fresh", { status: "awaiting_setup", start_date: new Date(Date.now() - 5 * DAY_MS).toISOString() });
bills.push(
  { id: "billing_charges:late", project_folder_id: "unpaid", status: "open", created_at: new Date(Date.now() - 41 * DAY_MS).toISOString() },
  { id: "billing_charges:recent", project_folder_id: "recent", status: "open", created_at: new Date(Date.now() - 35 * DAY_MS).toISOString() },
);
plans.set("clearing", { status: "active", start_date: new Date(Date.now() - 70 * DAY_MS).toISOString(), hold_since: new Date().toISOString() });

describe("work on hold", () => {
  it("leaves a held project's Client the role and no features", async () => {
    const role = await getProjectRole(folder("held"), "sue");
    expect(role?.role).toBe("Client");
    expect(role?.features).toEqual([]);
  });

  it("holds through a late link until the payment clears", async () => {
    expect((await getProjectRole(folder("clearing"), "sue"))?.features).toEqual([]);
  });

  it("holds a project with a bill unpaid 10 days past its due date, and sends the Client to it", async () => {
    expect((await getProjectRole(folder("unpaid"), "sue"))?.features).toEqual([]);
    expect(await projectHold("unpaid")).toEqual({ kind: "bill", chargeId: "late" });
  });

  it("doesn't hold for a bill inside its due date plus 10 days", async () => {
    expect(await projectHold("recent")).toBeNull();
  });

  it("doesn't touch the guide", async () => {
    expect((await getProjectRole(folder("held"), "guide"))?.features.length).toBeGreaterThan(0);
  });

  it("doesn't touch a Client inside the month", async () => {
    expect((await getProjectRole(folder("fresh"), "sue"))?.features).toContain("photos");
  });
});
