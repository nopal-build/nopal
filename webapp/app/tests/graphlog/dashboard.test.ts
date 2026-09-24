/**
 * The dashboard (ADR-022): who sees what is decided by `buildDashboard`
 * on the server, from where each person sits on each project.
 *
 * Gates for the 2026-09-23 round: test 7 (only your projects) and the
 * server half of test 3 (a steep reading is a quiet note, reaches the
 * guides, and nothing about it travels anywhere else).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDashboard, type DashboardProjectInput } from "robustness-core/data/dashboard.server";
import { keepExistingSeats, seatFromSharing, seatsFromActor } from "robustness-core/data/projectSharing.server";
import { parseProjectSharing, withProjectSharing } from "robustness-core/data/project.types";
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
    ownerId: GUIDE,
    status: "active",
    statusAt: null,
    sharing,
    read: `${name} is framing the second floor.`,
    ask: `Pick the ${name} window supplier this week.`,
  };
}

const crouch = project(CROUCH, "Crouch Casita", [
  { human: CLIENT, role: "Observer", seat: "client" },
  { human: LEAD, role: "Observer", seat: "observer" },
]);
const coronado = project(CORONADO, "Coronado ADU", [{ human: OTHER_CLIENT, role: "Observer", seat: "client" }]);

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

describe("seats", () => {
  it("the creator is a guide; an unmarked member sits where their role does; a stranger has none", () => {
    const ownerTier = new Set(["Owner", "Crafter"]);
    expect(seatFromSharing({ human_id: GUIDE }, [], GUIDE)).toBe("guide");
    // The team, unmarked, keeps working as a guide; an unmarked Observer is a client.
    expect(seatFromSharing({ human_id: GUIDE }, [{ human: LEAD, role: "Owner" }], LEAD, ownerTier)).toBe("guide");
    expect(seatFromSharing({ human_id: GUIDE }, [{ human: LEAD, role: "Observer" }], LEAD, ownerTier)).toBe("client");
    // Without the role names, unmarked falls to the least.
    expect(seatFromSharing({ human_id: GUIDE }, [{ human: LEAD, role: "Owner" }], LEAD)).toBe("client");
    expect(seatFromSharing({ human_id: GUIDE }, crouch.sharing, CLIENT)).toBe("client");
    expect(seatFromSharing({ human_id: GUIDE }, crouch.sharing, OTHER_CLIENT)).toBeNull();
  });

  it("round-trips through README front matter, and a bad seat is dropped", () => {
    const md = withProjectSharing("# Crouch\n", crouch.sharing);
    expect(parseProjectSharing(md)).toEqual(crouch.sharing);
    expect(parseProjectSharing("---\nsharing:\n  - human: x\n    role: Observer\n    seat: boss\n---\n")).toEqual([
      { human: "x", role: "Observer" },
    ]);
  });

  it("a reshare that names only roles keeps each person's seat", () => {
    const incoming = [{ human: CLIENT, role: "Crafter" }, { human: LEAD, role: "Observer", seat: "guide" as const }];
    expect(keepExistingSeats(incoming, crouch.sharing)).toEqual([
      { human: CLIENT, role: "Crafter", seat: "client" },
      { human: LEAD, role: "Observer", seat: "guide" },
    ]);
  });
});

describe("who may change a seat", () => {
  it("a guide's save sets seats; anyone else's keeps every seat as it was", () => {
    const selfPromotion = [{ human: CLIENT, role: "Crafter", seat: "guide" as const }];
    expect(seatsFromActor(selfPromotion, crouch.sharing, false)).toEqual([{ human: CLIENT, role: "Crafter", seat: "client" }]);
    expect(seatsFromActor(selfPromotion, crouch.sharing, true)).toEqual(selfPromotion);
  });
});

describe("only your projects (test 7)", () => {
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

  it("a client sees where it stands, not the guides' ask, and no one's readings", () => {
    const d = buildDashboard({ viewerId: CLIENT, projects: [crouch], readings, names, status: "active" });
    const [row] = d.rows;
    expect(row.read).toBe("Crouch Casita is framing the second floor.");
    expect(row.ask).toBeNull();
    expect(row.notes).toEqual([]);
    // Their own tap comes back so the meter shows it; nobody else's does.
    expect(row.mine).toEqual({ position: "oh-crap", date: "2026-09-23" });
    expect(JSON.stringify(d)).not.toContain("Austin");
  });
});

describe("a steep reading is a quiet note for the guides (test 3, server half)", () => {
  it("reaches a guide as words, with the slope, and a guide's own reading stays theirs", () => {
    const d = buildDashboard({ viewerId: GUIDE, projects: [crouch], readings, names, status: "active" });
    expect(d.rows[0].notes).toEqual([{ who: "Dana", position: "oh-crap", date: "2026-09-23", previous: "uphill" }]);
    expect(d.rows[0].mine).toEqual({ position: "steep", date: "2026-09-23" });
  });

  it("reaches an observer too, who does not tap", () => {
    const d = buildDashboard({ viewerId: LEAD, projects: [crouch], readings, names, status: "active" });
    expect(d.view).toBe("guide");
    expect(d.rows[0].notes.map((n) => n.who)).toEqual(["Dana"]);
    expect(d.rows[0].canTap).toBe(false);
    expect(d.topMeterProjectId).toBeNull();
  });

  it("a guide's reading never shows on another guide's row", () => {
    const withTwoGuides = project(CROUCH, "Crouch Casita", [{ human: LEAD, role: "Crafter", seat: "guide" }]);
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

// ── The project view's tabs (round 2) ────────────────────────────────────────
import { filesForSeat, projectTabsFor, resolveProjectTab } from "robustness-core/data/projectView.server";
import type { ProjectFileRow } from "robustness-core/data/fileFolders.server";
import { isOwnCard } from "robustness-core/data/dailyLog.server";

describe("the project view's tabs, by seat", () => {
  it("a client gets no Costs tab, and asking for it lands on Efforts", () => {
    expect(projectTabsFor("client")).toEqual(["efforts", "photos", "files", "logbook"]);
    expect(projectTabsFor("guide")).toEqual(["efforts", "photos", "files", "costs", "logbook"]);
    expect(projectTabsFor("observer")).toContain("costs");
    expect(resolveProjectTab("costs", "client")).toBe("efforts");
    expect(resolveProjectTab("costs", "guide")).toBe("costs");
    expect(resolveProjectTab("nonsense", "guide")).toBe("efforts");
  });

  it("in the project view, a client gets no file filed as a cost, even a receipt photo also in Gallery", () => {
    const row = (fileId: string, folders: ProjectFileRow["folders"]) => ({ fileId, folders }) as ProjectFileRow;
    const rows = [row("k1m2n3b4v5c6x7z8l9j0", ["gallery"]), row("r5t6y7u8i9o0p1a2s3d4", ["gallery", "costs"]), row("q1w2e3r4t5y6u7i8o9p0", ["documents"])];
    expect(filesForSeat(rows, "client").map((r) => r.fileId)).toEqual(["k1m2n3b4v5c6x7z8l9j0", "q1w2e3r4t5y6u7i8o9p0"]);
    expect(filesForSeat(rows, "guide")).toHaveLength(3);
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
