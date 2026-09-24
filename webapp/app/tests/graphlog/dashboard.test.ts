/**
 * The dashboard (ADR-023): who sees what is decided by `buildDashboard`
 * on the server, from each person's role on each project.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDashboard, type DashboardProjectInput } from "robustness-core/data/dashboard.server";
import { readSidecarReadAndAsk } from "robustness-core/data/effortReadings.server";
import type { SteepReading } from "robustness-core/data/steepReadings.server";

// Ids shaped like production's (20 lowercase alnum), not `project-a`.
const GUIDE = "k3v9x0q2m7w1b5n8c4d6";
const CLIENT = "p8r2t6y0u4i1o3a5s7d9";
const OTHER_CLIENT = "z1x2c3v4b5n6m7l8k9j0";
const LEAD = "h4g5f6d7s8a9q1w2e3r4";
const CROUCH = "a1b2c3d4e5f6g7h8i9j0";
const CORONADO = "q9w8e7r6t5y4u3i2o1p0";

function project(id: string, name: string, sharing: DashboardProjectInput["sharing"]): DashboardProjectInput {
  return {
    id,
    name,
    status: "active",
    statusAt: null,
    sharing,
    ask: `Pick the ${name} window supplier this week.`,
  };
}

const crouch = project(CROUCH, "Crouch Casita", [
  { human: GUIDE, role: "Owner" },
  { human: CLIENT, role: "Client" },
  { human: LEAD, role: "Observer" },
]);
const coronado = project(CORONADO, "Coronado ADU", [
  { human: GUIDE, role: "Owner" },
  { human: OTHER_CLIENT, role: "Client" },
]);

const reading = (human: string, projectId: string, position: SteepReading["position"], date: string): SteepReading => ({
  human_id: human,
  project_folder_id: projectId,
  position,
  date,
  created_at: `${date}T15:00:00Z`,
});

const readings = [
  reading(CLIENT, CROUCH, "uphill", "2026-09-21"),
  reading(CLIENT, CROUCH, "oh-crap", "2026-09-23"),
  reading(GUIDE, CROUCH, "steep", "2026-09-23"),
  reading(OTHER_CLIENT, CORONADO, "flat", "2026-09-23"),
];
const names = new Map([
  [CLIENT, "Dana"],
  [OTHER_CLIENT, "Sam"],
  [GUIDE, "Austin"],
]);

describe("only your projects", () => {
  it("a guide on two projects sees two", () => {
    const d = buildDashboard({ viewerId: GUIDE, projects: [crouch, coronado], readings, names, status: "active" });
    expect(d.view).toBe("guide");
    expect(d.rows.map((r) => r.id)).toEqual([CROUCH, CORONADO]);
  });

  it("a client on one sees one, and no trace of any other in the payload", () => {
    // Even handed a project they are not on, the builder drops it.
    const d = buildDashboard({ viewerId: CLIENT, projects: [crouch, coronado], readings, names, status: "active" });
    expect(d.view).toBe("client");
    expect(d.rows.map((r) => r.id)).toEqual([CROUCH]);
    const payload = JSON.stringify(d);
    expect(d.counts).toBeNull();
    expect(payload).not.toContain(CORONADO);
    expect(payload).not.toContain("Coronado");
    expect(payload).not.toContain("Sam");
  });

  it("a client gets no read, no ask, no one's readings, only their own tap", () => {
    const d = buildDashboard({ viewerId: CLIENT, projects: [crouch], readings, names, status: "active" });
    const [row] = d.rows;
    expect(row.ask).toBeNull();
    expect(row.notes).toEqual([]);
    expect(row.mine).toEqual({ position: "oh-crap", date: "2026-09-23" });
    expect(JSON.stringify(d)).not.toContain("Austin");
  });

  it("Client on one project and Owner of another: each shows by its own role", () => {
    const mixed = project(CORONADO, "Coronado ADU", [{ human: CLIENT, role: "Owner" }]);
    const d = buildDashboard({ viewerId: CLIENT, projects: [crouch, mixed], readings, names, status: "active" });
    expect(d.view).toBe("guide");
    const byId = new Map(d.rows.map((r) => [r.id, r]));
    expect(byId.get(CROUCH)?.role).toBe("Client");
    expect(byId.get(CROUCH)?.ask).toBeNull();
    expect(byId.get(CORONADO)?.ask).toContain("window supplier");
  });
});

describe("a steep reading is a quiet note for the guides (test 3, server half)", () => {
  it("reaches a guide as words, with the slope, and a guide's own reading stays theirs", () => {
    const d = buildDashboard({ viewerId: GUIDE, projects: [crouch], readings, names, status: "active" });
    expect(d.rows[0].notes).toEqual([{ who: "Dana", position: "oh-crap", date: "2026-09-23", previous: "uphill" }]);
    expect(d.rows[0].mine).toEqual({ position: "steep", date: "2026-09-23" });
  });

  it("does not reach an Observer or a Crafter, who still tap (readings are the Owners')", () => {
    const d = buildDashboard({ viewerId: LEAD, projects: [crouch], readings, names, status: "active" });
    expect(d.view).toBe("guide");
    expect(d.rows[0].notes).toEqual([]);
    expect(d.rows[0].canTap).toBe(true);
  });

  it("a Crafter, the level that does the work, sees the ask but no one's readings", () => {
    const withCrafter = project(CROUCH, "Crouch Casita", [...crouch.sharing, { human: OTHER_CLIENT, role: "Crafter" }]);
    const d = buildDashboard({ viewerId: OTHER_CLIENT, projects: [withCrafter], readings, names, status: "active" });
    expect(d.rows[0].ask).toContain("window supplier");
    expect(d.rows[0].notes).toEqual([]);
  });

  it("a guide's reading never shows on another guide's row", () => {
    const withTwoGuides = project(CROUCH, "Crouch Casita", [
      { human: GUIDE, role: "Owner" },
      { human: LEAD, role: "Owner" },
    ]);
    const d = buildDashboard({ viewerId: LEAD, projects: [withTwoGuides], readings, names, status: "active" });
    expect(d.rows[0].notes).toEqual([]);
  });

  it("the store and the tap route send nothing anywhere", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const sources = [
      "packages/robustness-core/src/data/steepReadings.server.ts",
      "fruits/app/routes/api.steep.tsx",
    ].map((f) => readFileSync(path.join(root, f), "utf8"));
    // Imports and calls, not the comments that explain why they're absent.
    for (const src of sources) {
      const imports = src.split("\n").filter((l) => /^import\b|from "/.test(l)).join("\n");
      expect(imports).not.toMatch(/email\.server|realtime\.server/);
      expect(src).not.toMatch(/\b(createFileRef|createMark|sendMail|sendEmail)\(/);
    }
  });
});

describe("the top of the screen", () => {
  it("one project to tap on puts the meter at the top; two put it on the rows", () => {
    expect(buildDashboard({ viewerId: CLIENT, projects: [crouch], readings, names, status: "active" }).topMeterProjectId).toBe(CROUCH);
    expect(buildDashboard({ viewerId: GUIDE, projects: [crouch, coronado], readings, names, status: "active" }).topMeterProjectId).toBeNull();
  });
});

describe("the sidecar's read and ask", () => {
  it("reads both from Graph/efforts.md, and null when absent or unreadable", () => {
    const sidecar = '---\nasOfGraphHash: x\n---\n```json\n{"read":"Framing is on track.","ask":"Pick a window supplier."}\n```\n';
    expect(readSidecarReadAndAsk(sidecar)).toEqual({ read: "Framing is on track.", ask: "Pick a window supplier." });
    expect(readSidecarReadAndAsk('```json\n{"read":"","ask":null}\n```')).toEqual({ read: null, ask: null });
    expect(readSidecarReadAndAsk("not a sidecar")).toEqual({ read: null, ask: null });
    expect(readSidecarReadAndAsk(null)).toEqual({ read: null, ask: null });
  });
});

// ── The project view's tabs ──────────────────────────────────────────────────
import { PROJECT_TABS, resolveProjectTab } from "robustness-core/data/projectView.server";
import { isOwnCard } from "robustness-core/data/dailyLog.server";

describe("the project view's tabs", () => {
  it("everyone who reaches the page gets every tab; a Client never reaches it (see access.test.ts)", () => {
    expect(PROJECT_TABS).toEqual(["efforts", "photos", "files", "costs", "logbook"]);
    expect(resolveProjectTab("costs")).toBe("costs");
    expect(resolveProjectTab("nonsense")).toBe("efforts");
  });
});

describe("a Card save names one of the saver's own Cards", () => {
  it("refuses a file id that is not theirs for that day", () => {
    const mine = [{ fileId: "c1a2r3d4f5i6l7e8i9d0" }];
    expect(isOwnCard(mine, "c1a2r3d4f5i6l7e8i9d0")).toBe(true);
    expect(isOwnCard(mine, "s0m1e2o3n4e5e6l7s8e9")).toBe(false);
    expect(isOwnCard([], "c1a2r3d4f5i6l7e8i9d0")).toBe(false);
  });
});
