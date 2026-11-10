// Who may pay, and what may be raised (payments seed, 2026-11-03). Gates:
//   - only a Client on the project may pay: Guide, Observer, Crafter and
//     someone on another project may not
//   - an emailed pay link opens only the bill and person it was signed for
//   - Stripe in live mode refuses a bill under draft terms
//   - nothing in billing charges a saved payment method off-session
//     (cards.md: a stored mandate is not an authorization for a debit
//     outside the pattern)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "unit-secret";
});

vi.mock("robustness-core/data/projectSharing.server", () => ({
  getProjectSharing: async () => [
    { human: "guide", role: "Guide" },
    { human: "sue", role: "Client" },
    { human: "tom", role: "Client" },
    { human: "obs", role: "Observer" },
    { human: "crafter", role: "Crafter" },
  ],
  listProjectsFor: async () => [],
}));
vi.mock("robustness-core/data/humans.server", () => ({
  getHumanById: async (id: string) => ({ _id: id, email: `${id}@example.com` }),
  getHumansById: async (ids: string[]) => ids.map((id) => ({ _id: id, email: `${id}@example.com` })),
}));
vi.mock("../util/email.server", () => ({ sendEmail: async () => {} }));
vi.mock("robustness-core/data/fileFolders.server", () => ({
  loadProjectFiles: async () => [
    { serveId: "r1", name: "Lumber.jpg", contentType: "image/jpeg", folders: ["photos", "costs"], filing: { kind: "receipt", cost: { amount: "412.18", currency: "USD" } } },
    { serveId: "s1", name: "Spec.pdf", contentType: "application/pdf", folders: ["files"], filing: { kind: "spec", cost: null } },
    { serveId: "p1", name: "Attic.jpg", contentType: "image/jpeg", folders: ["photos"], filing: { kind: "photo", cost: null } },
  ],
}));

import { attachableFiles, isClientOn, personFromPayLink, signedPayLink } from "../data/payments.server";
import { assertTermsUsable, PAYMENT_TERMS } from "robustness-core/data/billingTerms";
import { PAYMENT_CATEGORIES } from "robustness-core/data/billingRules";

const folder = { _id: "madison-attic", name: "Madison Attic" } as never;
const origin = "https://o.nopal.dev";

describe("who may pay", () => {
  it.each([
    ["sue", true],
    ["tom", true],
    ["guide", false],
    ["obs", false],
    ["crafter", false],
    ["stranger", false],
  ])("%s → %s", async (human, allowed) => {
    expect(await isClientOn(folder, human)).toBe(allowed);
  });
});

describe("what a bill can carry", () => {
  it("offers the project's cost files and PDFs, not its photos", async () => {
    const files = await attachableFiles(folder);
    expect(files.map((f) => f.fileId)).toEqual(["r1", "s1"]);
    expect(files[0].amount).toBe("412.18 USD");
  });
});

describe("the emailed pay link", () => {
  const url = (href: string) => new URL(href);

  it("opens its own bill as the person it was signed for", async () => {
    const link = signedPayLink(origin, "bill1", "sue");
    expect((await personFromPayLink("bill1", url(link)))?._id).toBe("sue");
  });

  it("doesn't open another bill", async () => {
    expect(await personFromPayLink("bill2", url(signedPayLink(origin, "bill1", "sue")))).toBeNull();
  });

  it("can't be changed to name someone else", async () => {
    const forged = url(signedPayLink(origin, "bill1", "sue"));
    forged.searchParams.set("for", "tom");
    expect(await personFromPayLink("bill1", forged)).toBeNull();
  });

  it("is refused without a signature, or with a cut-down one", async () => {
    const link = url(signedPayLink(origin, "bill1", "sue"));
    const bare = new URL(link);
    bare.searchParams.delete("sig");
    expect(await personFromPayLink("bill1", bare)).toBeNull();
    link.searchParams.set("sig", (link.searchParams.get("sig") ?? "").slice(0, 10));
    expect(await personFromPayLink("bill1", link)).toBeNull();
  });
});

describe("terms", () => {
  it("every category has terms with a version", () => {
    for (const c of PAYMENT_CATEGORIES) {
      expect(PAYMENT_TERMS[c].version).toMatch(/\S/);
      expect(PAYMENT_TERMS[c].text.length).toBeGreaterThan(0);
    }
  });

  it("live mode refuses draft terms; test mode allows them", () => {
    const draft = PAYMENT_CATEGORIES.find((c) => PAYMENT_TERMS[c].version.startsWith("draft-"));
    if (!draft) return; // every text approved: nothing to refuse
    expect(() => assertTermsUsable(draft, "sk_live_x")).toThrow(/draft/);
    expect(() => assertTermsUsable(draft, "sk_test_x")).not.toThrow();
  });
});

it("billing never charges a saved payment method off-session", () => {
  for (const file of ["billing.server.ts", "billingPlans.server.ts", "stripe.server.ts"]) {
    const src = readFileSync(resolve(__dirname, "../../../packages/robustness-core/src/data", file), "utf8");
    expect(src, file).not.toMatch(/off_session/);
  }
});
