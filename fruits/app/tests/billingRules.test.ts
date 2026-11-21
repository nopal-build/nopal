// Billing's pure rules (payments seed, 2026-11-02). Gates the dates and
// amounts the seed decided: first billing day, the 7-day ACH notice on a
// plan change, the 5- and 6-month pause checks, month-end clamping, and
// the guide's custom amount.
import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  billDueAt,
  cancelEffectiveAt,
  holdStartsAt,
  CUSTOM_AMOUNT_MAX_CENTS,
  dayIn,
  discounted,
  discountNote,
  firstBillingTime,
  isSettableFirstBillingDay,
  formatUsd,
  lookupKeyFor,
  parseDiscountPercent,
  parseUsdToCents,
  pauseMilestone,
  planChangeEffectiveAt,
} from "robustness-core/data/billingRules";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe("addMonthsClamped", () => {
  it("clamps a 31st to the shorter month's last day", () => {
    expect(day(addMonthsClamped(d("2026-01-31"), 1))).toBe("2026-02-28");
    expect(day(addMonthsClamped(d("2028-01-31"), 1))).toBe("2028-02-29");
    expect(day(addMonthsClamped(d("2026-03-31"), 1))).toBe("2026-04-30");
  });
  it("crosses a year", () => {
    expect(day(addMonthsClamped(d("2026-11-15"), 3))).toBe("2027-02-15");
  });
});

describe("the first billing day", () => {
  // 2026-11-03 at 6am UTC is still 2026-11-02 in Mountain time.
  const now = new Date("2026-11-03T06:00:00Z");
  it("reads days in Mountain time", () => {
    expect(dayIn(now)).toBe("2026-11-02");
  });
  it("can be today or later", () => {
    expect(isSettableFirstBillingDay("2026-11-02", now)).toBe(true);
    expect(isSettableFirstBillingDay("2026-12-01", now)).toBe(true);
  });
  it("can't be a day already gone, or something that isn't a day", () => {
    expect(isSettableFirstBillingDay("2026-11-01", now)).toBe(false);
    expect(isSettableFirstBillingDay("", now)).toBe(false);
    expect(isSettableFirstBillingDay("12/01/2026", now)).toBe(false);
  });
  it("bills at noon UTC, so it never lands on the day before in Mountain time", () => {
    expect(dayIn(firstBillingTime("2026-12-01"))).toBe("2026-12-01");
  });
});

describe("planChangeEffectiveAt", () => {
  const periodEnd = d("2026-12-01");
  it("takes the next billing date with exactly 7 days' notice", () => {
    expect(day(planChangeEffectiveAt(periodEnd, d("2026-11-24")))).toBe("2026-12-01");
  });
  it("waits a period longer inside the notice", () => {
    expect(day(planChangeEffectiveAt(periodEnd, new Date(periodEnd.getTime() - 7 * 86400000 + 1)))).toBe(
      "2027-01-01",
    );
  });
});

describe("pauseMilestone", () => {
  const pausedAt = d("2026-01-31");
  it("is quiet before 5 months", () => {
    expect(pauseMilestone(pausedAt, d("2026-06-29"))).toBe("none");
  });
  it("warns at 5 months, clamped to month end", () => {
    expect(pauseMilestone(pausedAt, d("2026-06-30"))).toBe("warn");
  });
  it("alerts the guide at 6 months", () => {
    expect(pauseMilestone(pausedAt, d("2026-07-31"))).toBe("alert");
  });
});

describe("custom amounts", () => {
  it("parses what a guide types", () => {
    expect(parseUsdToCents("$1,000")).toBe(1_000_00);
    expect(parseUsdToCents("1000.5")).toBe(1_000_50);
    expect(parseUsdToCents(" 250 ")).toBe(250_00);
  });
  it("refuses zero, junk, three decimals and anything over the cap", () => {
    for (const bad of ["0", "-5", "abc", "1.005", "", formatUsd(CUSTOM_AMOUNT_MAX_CENTS + 100)]) {
      expect(parseUsdToCents(bad), bad).toBeNull();
    }
  });
  it("formats whole dollars without cents", () => {
    expect(formatUsd(1_000_00)).toBe("$1,000");
    expect(formatUsd(1_000_50)).toBe("$1,000.50");
  });
});

it("keys Stripe prices by item", () => {
  expect(lookupKeyFor("guide")).toBe("nopal_guide");
});

describe("a guide's discount", () => {
  it("takes a whole percent, blank or 0 meaning none", () => {
    expect(parseDiscountPercent("20")).toBe(20);
    expect(parseDiscountPercent(" 15% ")).toBe(15);
    expect(parseDiscountPercent("")).toBeNull();
    expect(parseDiscountPercent("0")).toBeNull();
  });
  it("refuses 100, fractions and junk", () => {
    for (const bad of ["100", "12.5", "-5", "abc"]) expect(parseDiscountPercent(bad), bad).toBe("invalid");
  });
  it("comes off the fixed price to the cent", () => {
    expect(discounted(250_00, 20)).toBe(200_00);
    expect(discounted(333_33, 15)).toBe(283_33);
    expect(discounted(250_00, null)).toBe(250_00);
    expect(discountNote(250_00, 20)).toBe("20% off $250");
    expect(discountNote(null, 20)).toBeNull();
  });
});

describe("the terms' timing", () => {
  it("a bill is due 30 days after it's sent, and holds 10 days after that", () => {
    expect(day(billDueAt("2026-11-03T12:00:00Z"))).toBe("2026-12-03");
    expect(day(holdStartsAt("2026-12-03T12:00:00Z"))).toBe("2026-12-13");
  });
  it("a cancel takes 30 days' notice, then the next billing date", () => {
    // Next billing date 3 days off: ends the one after.
    expect(day(cancelEffectiveAt(d("2026-11-06"), d("2026-11-03")))).toBe("2026-12-06");
    // 31 days off: ends then.
    expect(day(cancelEffectiveAt(d("2026-12-04"), d("2026-11-03")))).toBe("2026-12-04");
  });
});

// The card fee (Austin, 2026-11-17). Only a credit card pays it, and it
// never passes the cap a US credit card may be surcharged.
import { CARD_FEE_CAP_PERCENT, cardFeeCents } from "robustness-core/data/billingRules";
describe("the card fee on a plan", () => {
  it("is Stripe's 2.9% + 30¢ on a credit card", () => {
    expect(cardFeeCents(150000, "card", "credit")).toBe(4380);
    expect(cardFeeCents(300000, "card", "credit")).toBe(8730);
    expect(cardFeeCents(600000, "card", "credit")).toBe(17430);
  });
  it("is nothing on a debit card, a prepaid card, a card Stripe can't place, or a bank account", () => {
    for (const funding of ["debit", "prepaid", "unknown", null] as const) expect(cardFeeCents(300000, "card", funding)).toBe(0);
    expect(cardFeeCents(300000, "bank", null)).toBe(0);
    expect(cardFeeCents(300000, "bank", "credit")).toBe(0);
    expect(cardFeeCents(300000, null, null)).toBe(0);
  });
  it("stays under the surcharge cap at every plan price, and is held to it on a small amount", () => {
    for (const cents of [150000, 300000, 600000]) expect(cardFeeCents(cents, "card", "credit")).toBeLessThanOrEqual((cents * CARD_FEE_CAP_PERCENT) / 100);
    // $5: 2.9% + 30¢ would be 45¢, 9%; the cap makes it 15¢.
    expect(cardFeeCents(500, "card", "credit")).toBe(15);
  });
});

import { refundNote } from "robustness-core/data/billingRules";
it("a refund reads Refunded when all of it went back, with the amounts when part did, and not at all when none did", () => {
  expect(refundNote(100_00, 100_00)).toBe("Refunded");
  expect(refundNote(200_00, 50_00)).toBe("Refunded $50 of $200");
  expect(refundNote(200_00, 0)).toBeNull();
  expect(refundNote(200_00, null)).toBeNull();
});
