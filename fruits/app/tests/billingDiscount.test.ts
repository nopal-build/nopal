// A guide's discount on a one-off (Austin, 2026-11-03: a percent off a
// one-hour decision or a letter, to get someone started; plans and typed
// amounts take none). Gates: the bill keeps the price and the percent and
// asks the discounted amount; a typed amount ignores any discount.
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("robustness-core/data/generic.server", () => ({
  defineTable: async () => {},
  query: async () => [[]],
  formatRecord: (r: unknown) => r,
  newRecordId: () => `r${store.size + 1}`,
  select: async () => undefined,
  upsert: async (rid: { tb: string; id: unknown }, data: Record<string, unknown>) => {
    store.set(`${rid.tb}:${String(rid.id)}`, { ...data });
  },
  merge: async () => {},
}));
vi.mock("robustness-core/data/stripe.server", () => ({
  stripe: () => ({}),
  priceFor: async () => ({ id: "price_one_hour", unit_amount: 500_00 }),
  ONE_TIME_METHODS: ["card", "us_bank_account"],
}));

import { createCharge } from "robustness-core/data/billing.server";

describe("a discount on a one-off", () => {
  it("bills the priced item less the percent, and keeps both", async () => {
    const c = await createCharge({ projectFolderId: "attic", createdBy: "guide", kind: "one_hour", discountPercent: 20, note: "Attic beam sizing" });
    expect([c.amount_cents, c.list_amount_cents, c.discount_percent]).toEqual([400_00, 500_00, 20]);
  });

  it("bills the full price with none", async () => {
    const c = await createCharge({ projectFolderId: "attic", createdBy: "guide", kind: "one_hour_deliverable", note: "Attic beam sizing, with a letter" });
    expect([c.amount_cents, c.list_amount_cents, c.discount_percent]).toEqual([500_00, null, null]);
  });

  it("refuses a bill that doesn't say what it's for", async () => {
    await expect(createCharge({ projectFolderId: "attic", createdBy: "guide", kind: "one_hour", note: "  " })).rejects.toThrow(/what the bill is for/);
  });

  it("ignores a discount on a typed amount", async () => {
    const c = await createCharge({ projectFolderId: "attic", createdBy: "guide", kind: "reimbursement", typedAmountCents: 120_00, discountPercent: 20, note: "Lumber" });
    expect([c.amount_cents, c.discount_percent]).toEqual([120_00, null]);
  });
});
