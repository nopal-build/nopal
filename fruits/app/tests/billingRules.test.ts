// Billing's pure rules (payments seed, 2026-11-02). Gates the dates and
// amounts the seed decided: first billing day, the 7-day ACH notice on a
// plan change, the 5- and 6-month pause checks, month-end clamping, and
// the guide's custom amount.
import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  CUSTOM_AMOUNT_MAX_CENTS,
  firstBillingDay,
  formatUsd,
  lookupKeyFor,
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

describe("firstBillingDay", () => {
  it("is the day the form was finished when the guide set no start", () => {
    expect(day(firstBillingDay(d("2026-10-31")))).toBe("2026-10-31");
  });
  it("is the guide's start date when it is still ahead", () => {
    expect(day(firstBillingDay(d("2026-11-02"), d("2026-11-15")))).toBe("2026-11-15");
  });
  it("ignores a guide start date already passed", () => {
    expect(day(firstBillingDay(d("2026-11-02"), d("2026-10-01")))).toBe("2026-11-02");
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
