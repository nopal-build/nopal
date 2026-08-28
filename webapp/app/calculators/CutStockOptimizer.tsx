type Measurement = {
  size: number;
  unit: "in" | "ft" | "mm" | "cm" | "m";
  label?: string;
};

type Board = {
  stock: Measurement;
  cuts: Measurement[];
  offCutMM: number;
};

type Options = {
  cuts: Measurement[];
  kerf: Measurement;
  newStock: Measurement[];
  onHandStock: Measurement[];
};

type Result = {
  missingStock: Measurement[];
  remainingStock: Measurement[];
  usedStock: Measurement[];
  offCuts: Measurement[];
  boards: Board[];
};

/**
 * A bin represents one physical stock piece that has been opened for cutting.
 * As cuts are assigned to it, `remainingMM` shrinks by (cutSize + kerf) per cut.
 */
type Bin = {
  stock: Measurement;
  cuts: Measurement[];
  remainingMM: number;
};

function CutStockOptimizer({
  cuts,
  kerf,
  newStock,
  onHandStock,
}: Options): Result {
  // ── Unit helpers ─────────────────────────────────────────────────────────────

  const MM_PER_UNIT: Record<Measurement["unit"], number> = {
    mm: 1,
    cm: 10,
    m: 1000,
    in: 25.4,
    ft: 304.8,
  };

  const toMM = (m: Measurement): number => m.size * MM_PER_UNIT[m.unit];

  const fromMM = (mm: number, unit: Measurement["unit"]): Measurement => ({
    size: mm / MM_PER_UNIT[unit],
    unit,
  });

  // ── Setup ─────────────────────────────────────────────────────────────────────

  const kerfMM = toMM(kerf);

  /** Floating-point guard: differences smaller than this are treated as zero. */
  const TOLERANCE = 0.01; // mm

  /**
   * Best Fit Decreasing (BFD):
   * Process cuts from longest to shortest so the hardest-to-place pieces are
   * handled first, leaving flexible gaps for shorter cuts.
   */
  const sortedCuts = [...cuts].sort((a, b) => toMM(b) - toMM(a));

  // On-hand stock is finite — we remove pieces as they are consumed.
  const availableOnHand = [...onHandStock];

  // New stock is infinite per length option; sort smallest → largest so the
  // tiebreaker (smallest stock for equal waste scores) is baked into iteration
  // order.
  const sortedNewStock = [...newStock].sort((a, b) => toMM(a) - toMM(b));

  const bins: Bin[] = [];
  const missingStock: Measurement[] = [];

  /**
   * Simulate placing `pendingCuts` (already sorted largest-first) greedily into
   * `offCutMM` of remaining space. Returns how much space is left over (waste);
   * 0 is a perfect fit.
   *
   * This is used to score candidate stock pieces when opening a new bin: the
   * piece whose off-cut is best utilised by still-unplaced cuts wins.
   */
  const simulateOffCut = (
    offCutMM: number,
    pendingCuts: Measurement[],
  ): number => {
    let remaining = offCutMM;
    for (const c of pendingCuts) {
      const needed = toMM(c) + kerfMM;
      if (remaining >= needed - TOLERANCE) {
        remaining -= needed;
        if (remaining <= TOLERANCE) return 0;
      }
    }
    return Math.max(0, remaining);
  };

  // ── Main loop ─────────────────────────────────────────────────────────────────

  for (let cutIndex = 0; cutIndex < sortedCuts.length; cutIndex++) {
    const cut = sortedCuts[cutIndex];
    const cutMM = toMM(cut);

    /**
     * Space needed when adding this cut to an EXISTING open bin: the kerf is the
     * saw cut that separates this piece from the one before it in the board.
     * When OPENING a new bin the first cut uses the board's natural face — no kerf
     * is consumed — so minimum stock = cutMM and off-cut = stockMM − cutMM.
     */
    const spaceNeeded = cutMM + kerfMM;

    // 1. Best Fit: find the open bin with the least remaining space that still
    //    accommodates this cut. Minimises off-cut waste; exact fits (remaining ≈ 0)
    //    win automatically because they produce the smallest remainingAfter.
    let bestBin: Bin | null = null;
    let bestRemainingAfter = Infinity;

    for (const bin of bins) {
      if (bin.remainingMM >= spaceNeeded - TOLERANCE) {
        const remainingAfter = bin.remainingMM - spaceNeeded;
        if (remainingAfter < bestRemainingAfter) {
          bestBin = bin;
          bestRemainingAfter = remainingAfter;
        }
      }
    }

    if (bestBin !== null) {
      bestBin.cuts.push(cut);
      bestBin.remainingMM = Math.max(0, bestBin.remainingMM - spaceNeeded);
      continue;
    }

    // Cuts not yet assigned — used to score candidate new stock lengths.
    const pendingCuts = sortedCuts.slice(cutIndex + 1);

    // 2. No open bin fits — try to open a new one from on-hand stock first.
    //    Priority order:
    //      a. Exact fit: stock ≈ cutMM (first cut uses natural face, no kerf) → zero off-cut waste.
    //      b. Best-scored fit: off-cut is best consumed by pending cuts.
    //      c. Smallest fitting piece (implicit tiebreaker via score comparison).
    let exactOnHandIdx = -1;
    let bestOnHandIdx = -1;
    let bestOnHandScore = Infinity;
    let bestOnHandMM = Infinity;

    for (let i = 0; i < availableOnHand.length; i++) {
      const stockMM = toMM(availableOnHand[i]);
      if (stockMM < cutMM - TOLERANCE) continue;

      const offCutMM = stockMM - cutMM;

      if (offCutMM <= TOLERANCE) {
        // Exact fit — nothing can beat zero waste.
        exactOnHandIdx = i;
        break;
      }

      const score = simulateOffCut(offCutMM, pendingCuts);
      if (
        score < bestOnHandScore ||
        (score === bestOnHandScore && stockMM < bestOnHandMM)
      ) {
        bestOnHandScore = score;
        bestOnHandIdx = i;
        bestOnHandMM = stockMM;
      }
    }

    const chosenOnHandIdx =
      exactOnHandIdx >= 0 ? exactOnHandIdx : bestOnHandIdx;

    if (chosenOnHandIdx >= 0) {
      const [stock] = availableOnHand.splice(chosenOnHandIdx, 1);
      bins.push({
        stock,
        cuts: [cut],
        remainingMM: Math.max(0, toMM(stock) - cutMM),
      });
      continue;
    }

    // 3. No on-hand stock fits — fall back to new stock (infinite supply).
    //    Same priority: exact fit first, then best off-cut score. Because
    //    sortedNewStock is already ordered smallest → largest, equal-score
    //    candidates naturally resolve to the shorter (cheaper) piece.
    let bestNewStock: Measurement | undefined;
    let bestNewStockScore = Infinity;
    let bestNewStockMM = Infinity;

    for (const s of sortedNewStock) {
      const stockMM = toMM(s);
      if (stockMM < cutMM - TOLERANCE) continue;

      const offCutMM = stockMM - cutMM;

      if (offCutMM <= TOLERANCE) {
        // Exact fit (stock ≈ cutMM, first cut uses natural face, no kerf) — use it immediately.
        bestNewStock = s;
        break;
      }

      const score = simulateOffCut(offCutMM, pendingCuts);
      if (
        score < bestNewStockScore ||
        (score === bestNewStockScore && stockMM < bestNewStockMM)
      ) {
        bestNewStockScore = score;
        bestNewStock = s;
        bestNewStockMM = stockMM;
      }
    }

    if (bestNewStock !== undefined) {
      bins.push({
        stock: bestNewStock,
        cuts: [cut],
        remainingMM: Math.max(0, toMM(bestNewStock) - cutMM),
      });
      continue;
    }

    // 4. No stock option — anywhere — can fulfil this cut.
    missingStock.push(cut);
  }

  // ── Compile results ───────────────────────────────────────────────────────────

  return {
    /** Cuts that could not be fulfilled by any available stock. */
    missingStock,

    /** On-hand pieces that were never opened — still available for future use. */
    remainingStock: availableOnHand,

    /** Stock pieces that were opened (both on-hand and new stock). */
    usedStock: bins.map((b) => b.stock),

    /**
     * Leftover material from each opened stock piece after all assigned cuts.
     * Expressed in the same unit as the originating stock piece for readability.
     * Bins with zero remainder are perfect fits and produce no off-cut entry.
     */
    offCuts: bins
      .filter((b) => b.remainingMM > TOLERANCE)
      .map((b) => fromMM(b.remainingMM, b.stock.unit)),

    boards: bins.map((b) => ({
      stock: b.stock,
      cuts: b.cuts,
      offCutMM: b.remainingMM,
    })),
  };
}

export default CutStockOptimizer;
