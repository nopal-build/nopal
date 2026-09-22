/**
 * The filing record (2026-09-22): the model says what kind of document a
 * file is and reads a cost's values; code decides whether the answer is
 * well formed, and never writes one that is not. Its file sits beside
 * the description sidecar and shares no name with it, so no day hash
 * ever includes it.
 */
import { describe, expect, it } from "vitest";
import {
  COST_KINDS,
  FILING_KINDS,
  buildFilingContent,
  filingFileName,
  filingValuesHash,
  parseFilingYaml,
  readFilingRecord,
  validateFiling,
  type Filing,
} from "robustness-core/data/syncFiling.server";
import { knowledgeFileName } from "robustness-core/data/syncKnowledge.server";

const receipt = {
  kind: "receipt",
  reason: "A printed store receipt with a total line.",
  vendor: "Home Depot",
  amount: "412.18",
  currency: "USD",
  date: "2026-09-09",
  readFrom: ["HOME DEPOT #0472", "TOTAL  $412.18", "09/09/26"],
};

describe("validateFiling: what code checks so the model does not have to", () => {
  it("accepts a well-formed cost document and normalises its values", () => {
    const v = validateFiling({ ...receipt, amount: 412.1, currency: "usd" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.filing.kind).toBe("receipt");
    expect(v.filing.cost).toEqual({ vendor: "Home Depot", amount: "412.10", currency: "USD", date: "2026-09-09", readFrom: receipt.readFrom });
  });

  it("strips the document's own formatting from an amount rather than asking again forever", () => {
    for (const [raw, want] of [["$1,866.83", "1866.83"], ["1,234.5", "1234.50"], ["$412.18", "412.18"], ["  25.16 ", "25.16"]]) {
      const v = validateFiling({ ...receipt, amount: raw });
      expect(v.ok, raw).toBe(true);
      if (v.ok) expect(v.filing.cost?.amount).toBe(want);
    }
  });

  it("accepts a non-cost kind with only a reason, and a missing date on a cost", () => {
    expect(validateFiling({ kind: "drawing", reason: "A plan with dimensions." })).toMatchObject({ ok: true, filing: { kind: "drawing", cost: null } });
    const v = validateFiling({ kind: "invoice", reason: "An invoice.", vendor: "ACME", amount: "10.00" });
    expect(v).toMatchObject({ ok: true, filing: { cost: { date: null, readFrom: [] } } });
  });

  const rejections: [string, Record<string, unknown>, RegExp][] = [
    ["a kind off the list", { kind: "memo", reason: "x" }, /not one of/],
    ["no reason", { kind: "photo" }, /no reason/],
    ["a cost kind with no vendor", { kind: "receipt", reason: "x", amount: "1.00" }, /needs a vendor/],
    ["a negative amount", { ...receipt, amount: "-412.18" }, /not a plain number/],
    ["an amount in words", { ...receipt, amount: "four hundred" }, /not a plain number/],
    ["three decimals", { ...receipt, amount: "412.181" }, /not a plain number/],
    ["a date that is not a day", { ...receipt, date: "2026-02-30" }, /not a real/],
    ["a photo carrying cost fields", { kind: "photo", reason: "x", amount: "1.00" }, /carries no cost fields/],
    ["a currency that is not a code", { ...receipt, currency: "dollars" }, /three-letter/],
    ["readFrom that is not a list", { ...receipt, readFrom: "TOTAL" }, /not a list/],
    ["not a mapping at all", [] as unknown as Record<string, unknown>, /not a YAML mapping/],
  ];
  for (const [name, raw, reason] of rejections) {
    it(`rejects ${name}`, () => {
      const v = validateFiling(raw);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(reason);
    });
  }

  it("keeps the kind vocabulary and the cost kinds in one place", () => {
    expect(FILING_KINDS).toContain("video");
    for (const k of COST_KINDS) expect(FILING_KINDS).toContain(k);
  });
});

describe("parseFilingYaml: the block the model answered with", () => {
  it("takes the fenced block and ignores prose around it", () => {
    const text = "Here is the filing:\n\n```yaml\nkind: permit\nreason: An inspection card.\n```\n\nDone.";
    expect(parseFilingYaml(text)).toEqual({ kind: "permit", reason: "An inspection card." });
  });
  it("takes bare YAML when there is no fence, and null when nothing parses", () => {
    expect(parseFilingYaml("kind: photo\nreason: A wall.")).toEqual({ kind: "photo", reason: "A wall." });
    expect(parseFilingYaml("kind: [unclosed")).toBeNull();
  });
});

describe("the filing file", () => {
  const filing: Filing = {
    kind: "receipt",
    reason: receipt.reason,
    cost: { vendor: "Home Depot", amount: "412.18", currency: "USD", date: "2026-09-09", readFrom: receipt.readFrom },
  };

  it("round-trips through its front matter and validates again on the way back", () => {
    const content = buildFilingContent({ sourceFileId: "abc", hash: "h1", skillFingerprint: "fp", describedFrom: "image", filing });
    const record = readFilingRecord(content);
    expect(record).toEqual({ sourceHash: "h1", skillFingerprint: "fp", describedFrom: "image", filing });
  });

  it("treats a record that no longer validates as absent", () => {
    expect(readFilingRecord("---\nsourceHash: h1\nkind: memo\nreason: x\n---\n")).toBeNull();
    expect(readFilingRecord("no front matter")).toBeNull();
    expect(readFilingRecord(null)).toBeNull();
  });

  it("never shares a name with the description sidecar", () => {
    expect(filingFileName("IMG_1523.jpeg")).toBe("IMG_1523.filing.md");
    expect(filingFileName("receipt")).toBe("receipt.filing.md");
    expect(filingFileName("IMG_1523.jpeg")).not.toBe(knowledgeFileName("IMG_1523.jpeg"));
  });
});

describe("filingValuesHash: what a confirmation names", () => {
  const base: Filing = {
    kind: "receipt",
    reason: "one reason",
    cost: { vendor: "Home Depot", amount: "412.18", currency: "USD", date: "2026-09-09", readFrom: ["a"] },
  };
  it("ignores the reason and the read-from lines", () => {
    const reworded: Filing = { ...base, reason: "another reason", cost: { ...base.cost!, readFrom: ["b", "c"] } };
    expect(filingValuesHash(reworded)).toBe(filingValuesHash(base));
  });
  it("changes when any value a person confirmed changes", () => {
    expect(filingValuesHash({ ...base, cost: { ...base.cost!, amount: "412.19" } })).not.toBe(filingValuesHash(base));
    expect(filingValuesHash({ ...base, kind: "invoice" })).not.toBe(filingValuesHash(base));
    expect(filingValuesHash({ ...base, cost: { ...base.cost!, date: null } })).not.toBe(filingValuesHash(base));
  });
});
