import { describe, it, expect } from "vitest";
import CutStockOptimizer from "./CutStockOptimizer";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mm = (size: number) => ({ size, unit: "mm" as const });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CutStockOptimizer", () => {
  // ── Empty inputs ───────────────────────────────────────────────────────────

  describe("empty inputs", () => {
    it("returns all-empty results when no cuts are requested", () => {
      const result = CutStockOptimizer({
        cuts: [],
        kerf: mm(0),
        newStock: [],
        onHandStock: [],
      });
      expect(result).toEqual({
        missingStock: [],
        remainingStock: [],
        usedStock: [],
        offCuts: [],
        boards: [],
      });
    });
  });

  // ── Single cut ─────────────────────────────────────────────────────────────

  describe("single cut", () => {
    it("uses an on-hand piece and produces the correct off-cut", () => {
      // 1000 - 400 = 600mm off-cut (first cut uses board's natural face, no kerf)
      const result = CutStockOptimizer({
        cuts: [mm(400)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [mm(1000)],
      });
      expect(result.usedStock).toEqual([mm(1000)]);
      expect(result.remainingStock).toEqual([]);
      expect(result.offCuts).toEqual([mm(600)]);
      expect(result.missingStock).toEqual([]);
    });

    it("produces no off-cut when a single cut exactly equals the stock length", () => {
      // 8ft cut from 8ft stock — no saw cut made, no kerf, no waste
      const result = CutStockOptimizer({
        cuts: [{ size: 8, unit: "ft" }],
        kerf: { size: 0.125, unit: "in" },
        newStock: [],
        onHandStock: [{ size: 8, unit: "ft" }],
      });
      expect(result.offCuts).toEqual([]);
      expect(result.missingStock).toEqual([]);
    });
  });

  // ── Kerf accounting ────────────────────────────────────────────────────────

  describe("kerf accounting", () => {
    it("deducts one kerf per cut from the available space", () => {
      // N−1 kerfs for N cuts: 300 + 2×(300+10) = 920mm consumed from 1000mm → 80mm off-cut
      const result = CutStockOptimizer({
        cuts: [mm(300), mm(300), mm(300)],
        kerf: mm(10),
        newStock: [],
        onHandStock: [mm(1000)],
      });
      expect(result.usedStock).toHaveLength(1);
      expect(result.offCuts).toEqual([mm(80)]);
    });

    it("works correctly with zero kerf", () => {
      const result = CutStockOptimizer({
        cuts: [mm(300)],
        kerf: mm(0),
        newStock: [],
        onHandStock: [mm(500)],
      });
      expect(result.offCuts).toEqual([mm(200)]); // 500 - 300
    });
  });

  // ── Bin packing (Best Fit Decreasing) ─────────────────────────────────────

  describe("bin packing — Best Fit Decreasing", () => {
    it("packs multiple cuts into one stock piece when they all fit", () => {
      // Sorted: [400, 300, 200]. 400 + (300+5) + (200+5) = 910 ≤ 1000
      const result = CutStockOptimizer({
        cuts: [mm(300), mm(200), mm(400)],
        kerf: mm(5),
        newStock: [mm(1000)],
        onHandStock: [],
      });
      expect(result.usedStock).toHaveLength(1);
      expect(result.offCuts).toEqual([mm(90)]); // 1000 - 910
    });

    it("opens a second stock piece when cuts cannot all fit in one", () => {
      // Each cut needs 605mm; 605 + 605 = 1210 > 1000, so two pieces required
      const result = CutStockOptimizer({
        cuts: [mm(600), mm(600)],
        kerf: mm(5),
        newStock: [mm(1000)],
        onHandStock: [],
      });
      expect(result.usedStock).toHaveLength(2);
    });

    it("fills an existing open bin before opening a new one", () => {
      // 500 + (300+5) = 805 ≤ 1000 → both cuts fit in the same piece
      const result = CutStockOptimizer({
        cuts: [mm(500), mm(300)],
        kerf: mm(5),
        newStock: [mm(1000)],
        onHandStock: [],
      });
      expect(result.usedStock).toHaveLength(1);
      expect(result.offCuts).toEqual([mm(195)]); // 1000 - 805
    });

    it("efficiently distributes cuts across two on-hand pieces", () => {
      // Sorted cuts: [600, 400, 300].
      // 600 → score 1000mm (off-cut 400, fits 300mm → 95mm waste) vs 700mm (off-cut 100, fits nothing → 100mm waste).
      //        Opens 1000mm. remaining=400.
      // 400+5=405 → bin(1000mm) remaining=400 < 405. Open 700mm. remaining=300.
      // 300+5=305 → bin(1000mm) remaining=400 ≥ 305. Fits. remaining=95.
      const result = CutStockOptimizer({
        cuts: [mm(600), mm(400), mm(300)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [mm(1000), mm(700)],
      });
      expect(result.usedStock).toHaveLength(2);
      expect(result.remainingStock).toEqual([]);
      expect(result.offCuts).toContainEqual(mm(95)); // 1000 - 600 - 305
      expect(result.offCuts).toContainEqual(mm(300)); // 700 - 400
    });
  });

  // ── Stock priority — on-hand before new ───────────────────────────────────

  describe("stock priority — on-hand before new", () => {
    it("prefers on-hand stock over new stock when both can satisfy a cut", () => {
      const result = CutStockOptimizer({
        cuts: [mm(400)],
        kerf: mm(5),
        newStock: [mm(1000)],
        onHandStock: [mm(600)],
      });
      expect(result.usedStock).toEqual([mm(600)]);
      expect(result.remainingStock).toEqual([]);
    });

    it("picks the smallest on-hand piece that still fits, preserving larger pieces", () => {
      // Need 305mm (300+5). Both 400mm and 1000mm fit — prefer the 400mm.
      const result = CutStockOptimizer({
        cuts: [mm(300)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [mm(1000), mm(400)],
      });
      expect(result.usedStock).toEqual([mm(400)]);
      expect(result.remainingStock).toEqual([mm(1000)]);
    });

    it("leaves an on-hand piece that is too short completely untouched", () => {
      // on-hand 300mm is shorter than the 405mm (400+5) needed
      const result = CutStockOptimizer({
        cuts: [mm(400)],
        kerf: mm(5),
        newStock: [mm(600)],
        onHandStock: [mm(300)],
      });
      expect(result.usedStock).toEqual([mm(600)]);
      expect(result.remainingStock).toEqual([mm(300)]);
    });

    it("picks the smallest new-stock length that fits", () => {
      // Input order: [1000, 600]. After sort: [600, 1000]. Need 400mm (first cut, no kerf) → 600 wins.
      const result = CutStockOptimizer({
        cuts: [mm(400)],
        kerf: mm(5),
        newStock: [mm(1000), mm(600)],
        onHandStock: [],
      });
      expect(result.usedStock).toEqual([mm(600)]);
      expect(result.offCuts).toEqual([mm(200)]); // 600 - 400
    });

    it("can open multiple new-stock pieces of the same length", () => {
      // Two 700mm cuts each need 705mm; one 1000mm bin holds only one (remaining 295 < 705)
      const result = CutStockOptimizer({
        cuts: [mm(700), mm(700)],
        kerf: mm(5),
        newStock: [mm(1000)],
        onHandStock: [],
      });
      expect(result.usedStock).toHaveLength(2);
      expect(result.usedStock).toEqual([mm(1000), mm(1000)]);
    });
  });

  // ── Missing stock ──────────────────────────────────────────────────────────

  describe("missing stock", () => {
    it("adds a cut to missingStock when no stock can accommodate it", () => {
      // Need 805mm (800+5). on-hand 400 < 805; new stock 500 < 805 — nothing fits.
      const result = CutStockOptimizer({
        cuts: [mm(800)],
        kerf: mm(5),
        newStock: [mm(500)],
        onHandStock: [mm(400)],
      });
      expect(result.missingStock).toEqual([mm(800)]);
      expect(result.usedStock).toHaveLength(0);
      expect(result.remainingStock).toEqual([mm(400)]); // untouched
    });

    it("only lists unfulfillable cuts in missingStock", () => {
      // Sorted: [800, 200]. 800→missing (805 > 500). 200+5=205 → 500mm fits.
      const result = CutStockOptimizer({
        cuts: [mm(200), mm(800)],
        kerf: mm(5),
        newStock: [mm(500)],
        onHandStock: [],
      });
      expect(result.missingStock).toEqual([mm(800)]);
      expect(result.usedStock).toHaveLength(1);
    });

    it("puts all cuts in missingStock when there is no stock at all", () => {
      const result = CutStockOptimizer({
        cuts: [mm(200), mm(300)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [],
      });
      expect(result.missingStock).toHaveLength(2);
      expect(result.usedStock).toHaveLength(0);
    });
  });

  // ── Remaining stock ────────────────────────────────────────────────────────

  describe("remaining stock", () => {
    it("lists on-hand pieces that were never opened", () => {
      // 200+5=205. Smallest fitting: 500mm. 800mm is untouched.
      const result = CutStockOptimizer({
        cuts: [mm(200)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [mm(500), mm(800)],
      });
      expect(result.remainingStock).toEqual([mm(800)]);
    });

    it("returns all on-hand stock as remaining when it cannot fit any cut", () => {
      // on-hand 100mm is too short for a 205mm need; new stock handles it instead
      const result = CutStockOptimizer({
        cuts: [mm(200)],
        kerf: mm(5),
        newStock: [mm(500)],
        onHandStock: [mm(100)],
      });
      expect(result.remainingStock).toEqual([mm(100)]);
    });

    it("returns an empty remainingStock when all on-hand pieces are consumed", () => {
      // Sorted: [300, 200].
      // 300 → exact fit on-hand: 300mm. Opens it. availableOnHand=[400mm].
      // 200+5=205 → bin(300) has 0 < 205. Smallest fitting on-hand: 400mm. Opens it.
      const result = CutStockOptimizer({
        cuts: [mm(200), mm(300)],
        kerf: mm(5),
        newStock: [],
        onHandStock: [mm(300), mm(400)],
      });
      expect(result.remainingStock).toEqual([]);
    });
  });

  // ── Off-cuts ───────────────────────────────────────────────────────────────

  describe("off-cuts", () => {
    it("expresses the off-cut in the same unit as the originating stock piece", () => {
      // Stock: 1ft (304.8mm). Cut: 3in (76.2mm). Kerf: 0.
      // off-cut = 228.6mm = 0.75ft (exactly, since 228.6/304.8 = 9/12 = 0.75)
      const result = CutStockOptimizer({
        cuts: [{ size: 3, unit: "in" }],
        kerf: mm(0),
        newStock: [],
        onHandStock: [{ size: 1, unit: "ft" }],
      });
      expect(result.offCuts).toHaveLength(1);
      expect(result.offCuts[0].unit).toBe("ft");
      expect(result.offCuts[0].size).toBeCloseTo(0.75);
    });
  });

  // ── Mixed units ────────────────────────────────────────────────────────────

  describe("mixed units", () => {
    it("handles cuts in inches, kerf in inches, and stock in millimeters", () => {
      // 6in = 152.4mm; first cut uses natural face → remaining = 200 − 152.4 = 47.6mm
      const result = CutStockOptimizer({
        cuts: [{ size: 6, unit: "in" }],
        kerf: { size: 0.125, unit: "in" },
        newStock: [],
        onHandStock: [mm(200)],
      });
      expect(result.usedStock).toHaveLength(1);
      expect(result.missingStock).toHaveLength(0);
      expect(result.offCuts[0].unit).toBe("mm");
      expect(result.offCuts[0].size).toBeCloseTo(47.6);
    });

    it("handles stock in feet and cuts in feet with a fractional kerf", () => {
      // 3ft (first) + (3ft + 0.0625ft kerf) = 6.0625ft consumed from 10ft → 3.9375ft off-cut
      const result = CutStockOptimizer({
        cuts: [
          { size: 3, unit: "ft" },
          { size: 3, unit: "ft" },
        ],
        kerf: { size: 0.0625, unit: "ft" }, // 0.75in
        newStock: [],
        onHandStock: [{ size: 10, unit: "ft" }],
      });
      expect(result.usedStock).toHaveLength(1);
      expect(result.offCuts).toHaveLength(1);
      expect(result.offCuts[0].unit).toBe("ft");
      expect(result.offCuts[0].size).toBeCloseTo(3.9375);
    });
  });
});
