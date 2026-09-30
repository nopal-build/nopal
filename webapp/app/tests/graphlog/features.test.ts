/**
 * The features list (2026-09-25): what each group gets, read by the
 * server and the screen alike. Gates test 2 (one row), test 4 (promotion
 * limits) and the logic half of tests 1 and 9. The refusals over HTTP
 * are `fruits/scripts/campbell-walk.ts` against a running stack.
 */
import { describe, expect, it } from "vitest";
import { GROUPS, GROUP_FEATURES, featuresOf, groupOf, type Feature, type Group } from "robustness-core/data/features";
import { changedHumans, promotionRefusal, resolveRole } from "robustness-core/data/projectSharing.server";
import { isReachablePhoto, resolveProjectTab, rowsForReader, seesSuggestions, tabsFor } from "robustness-core/data/projectView.server";
import type { ProjectFileRow } from "robustness-core/data/fileFolders.server";

const row = (id: string, folders: ProjectFileRow["folders"], cost: ProjectFileRow["cost"] = null): ProjectFileRow =>
  ({ fileId: id, serveId: id, folders, cost, context: "what Lucas wrote around it" }) as ProjectFileRow;

const photo = row("photo", ["gallery"]);
const receiptPhoto = row("receipt", ["gallery", "costs"], {
  vendor: "Home Depot",
  amount: "412.00",
  currency: "USD",
  date: null,
  readFrom: [],
  status: "unconfirmed",
  by: null,
  on: null,
});
const drawing = row("drawing", ["documents"]);
const rows = [photo, receiptPhoto, drawing];

describe("the groups", () => {
  it("Owner reads as Guide; an unknown name is no group and gets nothing", () => {
    expect(groupOf("Owner")).toBe("Guide");
    expect(groupOf("Foreman")).toBeNull();
    expect(featuresOf("Foreman")).toEqual([]);
    expect(featuresOf(null)).toEqual([]);
  });

  it("test 9: a Guide reaches what an Owner did, a Crafter what a Crafter did", () => {
    const guide = resolveRole("Owner");
    expect(guide).toMatchObject({ isOwner: true, guiding: true });
    expect(tabsFor(guide.features)).toEqual(["efforts", "photos", "files", "costs", "logbook", "suggestions"]);
    expect(guide.features).toEqual(expect.arrayContaining(["marks", "steepTap", "steepReadings", "dailyLog"]));

    const crafter = resolveRole("Crafter");
    expect(crafter).toMatchObject({ isOwner: true, guiding: false });
    expect(tabsFor(crafter.features)).toEqual(["efforts", "photos", "files", "costs", "logbook"]);
    expect(crafter.features).not.toContain("steepReadings");
  });

  it("an Observer reads what a Crafter reads, writes Cards and notes, and what they write waits for a Guide", () => {
    const observer = resolveRole("Observer");
    expect(tabsFor(observer.features)).toEqual([...tabsFor(resolveRole("Crafter").features), "suggestions"]);
    expect(observer).toMatchObject({ isOwner: false, guiding: false });
    expect(observer.features).toEqual(expect.arrayContaining(["marks", "dailyLog"]));
    // Moving an entry, filing a file and confirming a cost are `edit`;
    // without `feeds` what they write is a suggestion.
    for (const f of ["edit", "feeds", "suggestions"] as Feature[]) expect(observer.features).not.toContain(f);
  });

  it("only a Guide reaches the Budget (2026-09-29), and it is a view under Costs, not a tab", () => {
    expect(GROUPS.filter((g) => featuresOf(g).includes("budget"))).toEqual(["Guide"]);
    expect(tabsFor(featuresOf("Guide"))).not.toContain("budget");
  });

  it("only a Guide takes suggestions; everyone but an Observer feeds the project", () => {
    for (const g of ["Guide", "Crafter", "Client"] as Group[]) expect(featuresOf(g)).toContain("feeds");
    expect(GROUPS.filter((g) => featuresOf(g).includes("suggestions"))).toEqual(["Guide"]);
    expect(seesSuggestions(featuresOf("Crafter"))).toBe(false);
    expect(seesSuggestions(featuresOf("Client"))).toBe(false);
    expect(seesSuggestions(featuresOf("Observer"))).toBe(true);
  });

  it("a Client gets Efforts, Photos, the pen, their own tap and their own log, and runs nothing", () => {
    const client = resolveRole("Client");
    expect(tabsFor(client.features)).toEqual(["efforts", "photos"]);
    expect(client.features).toEqual(expect.arrayContaining(["steepTap", "dailyLog"]));
    expect(client).toMatchObject({ isOwner: false, guiding: false });
    expect(client.features).not.toContain("steepReadings");
    // A note with the pen (Austin, 2026-09-28); moving, filing and
    // confirming a cost are `edit`, which a Client never has.
    expect(client.features).toContain("marks");
    for (const f of ["edit", "files", "costs", "people", "suggestions"] as Feature[]) expect(client.features).not.toContain(f);
  });
});

describe("test 1: what a Client is sent", () => {
  const client = featuresOf("Client");

  it("the Photos rows only: no receipt photo, no document, no cost, not the log's words", () => {
    const sent = rowsForReader(rows, client);
    expect(sent.map((r) => r.fileId)).toEqual(["photo"]);
    expect(sent[0].cost).toBeNull();
    expect(sent[0].context).toBe("");
  });

  it("opens a photo, never a photo of a receipt", () => {
    expect(isReachablePhoto(photo, client)).toBe(true);
    expect(isReachablePhoto(receiptPhoto, client)).toBe(false);
    expect(isReachablePhoto(drawing, client)).toBe(false);
  });

  it("a typed tab it isn't given is refused", () => {
    const allowed = tabsFor(client);
    expect(resolveProjectTab("costs", allowed)).toBeNull();
    expect(resolveProjectTab("files", allowed)).toBeNull();
    expect(resolveProjectTab("logbook", allowed)).toBeNull();
    expect(resolveProjectTab("photos", allowed)).toBe("photos");
    expect(resolveProjectTab(null, allowed)).toBe("efforts");
  });

  it("a Guide is sent every row as it was", () => {
    expect(rowsForReader(rows, featuresOf("Guide"))).toEqual(rows);
  });
});

describe("test 2: one row", () => {
  const withoutPhotos: Record<Group, readonly Feature[]> = {
    ...GROUP_FEATURES,
    Client: GROUP_FEATURES.Client.filter((f) => f !== "photos"),
  };
  const client = featuresOf("Client", withoutPhotos);

  it("taking Photos from clients takes the tab, the rows and the files, and nothing else", () => {
    expect(tabsFor(client)).toEqual(["efforts"]);
    expect(resolveProjectTab("photos", tabsFor(client))).toBeNull();
    expect(rowsForReader(rows, client)).toEqual([]);
    expect(isReachablePhoto(photo, client)).toBe(false);
    expect(client).toEqual(expect.arrayContaining(["efforts", "steepTap", "dailyLog"]));
    for (const g of ["Guide", "Crafter", "Observer"] as Group[]) {
      expect(featuresOf(g, withoutPhotos)).toEqual(featuresOf(g));
    }
  });
});

describe("test 4: only an admin makes a Guide", () => {
  const LUCAS = "l1u2c3a4s5l6u7c8a9s0";
  const AARON = "a1a2r3o4n5a6a7r8o9n0";
  const GERALD = "g1e2r3a4l5d6g7e8r9a0";
  const PAUL = "p1a2u3l4p5a6u7l8p9a0";
  const before = [
    { human: LUCAS, role: "Guide" },
    { human: AARON, role: "Crafter" },
    { human: GERALD, role: "Observer" },
    { human: PAUL, role: "Observer" },
  ];
  const staff = new Set([GERALD]);
  const after = (change: Record<string, string | null>) =>
    before.flatMap((e) => (e.human in change ? (change[e.human] ? [{ human: e.human, role: change[e.human]! }] : []) : [e]));

  it("a Guide moves people below Guide: Observer to Client, a Crafter off the project", () => {
    expect(promotionRefusal(changedHumans(before, after({ [PAUL]: "Client" })), staff)).toBeNull();
    expect(promotionRefusal(changedHumans(before, after({ [AARON]: null })), staff)).toBeNull();
  });

  it("makes nobody a Guide, changes no Guide, touches no admin", () => {
    expect(promotionRefusal(changedHumans(before, after({ [AARON]: "Guide" })), staff)).toMatch(/Guide/);
    expect(promotionRefusal(changedHumans(before, [...before, { human: "n1e2w3", role: "Guide" }]), staff)).toMatch(/Guide/);
    expect(promotionRefusal(changedHumans(before, after({ [LUCAS]: "Crafter" })), staff)).toMatch(/Guide/);
    expect(promotionRefusal(changedHumans(before, after({ [LUCAS]: null })), staff)).toMatch(/Guide/);
    expect(promotionRefusal(changedHumans(before, after({ [GERALD]: "Client" })), staff)).toMatch(/admin/);
  });

  it("saving the same list changes nobody", () => {
    expect(changedHumans(before, before)).toEqual([]);
  });
});
