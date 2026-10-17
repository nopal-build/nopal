/**
 * `adjustForElementSize` (`oxmarkdown-core/src/wavyLine.ts`) — the
 * corner/edge/center-aware refinement on top of plain anchor resolution
 * `::icon{position=...}`/`::badge{position=...}`/`::path{start=...}`
 * all now share. Human-reported gap: `resolveAnchor` alone only answers
 * "where does this anchor EDGE sit in the container" — it has no idea an
 * `R`/`B`/`C` ref describes WHICH EDGE of the real, sized element being
 * placed should land there, so `R0,T0` used to put the element's
 * top-LEFT corner at the container's top-right corner (always overflowing
 * further right), not its own top-RIGHT corner flush against it.
 *
 * Worked examples below use the human's own numbers: a 200x100 container,
 * a 100x20 positioned element (their own "100px wide and 20px tall
 * badge").
 */
import { describe, expect, it } from "vitest";
import {
  adjustForElementSize,
  fitAndPositionPoints,
  parseLinePoints,
  resolveLinePoints,
  type LinePointTokens,
} from "oxmarkdown-core";

const CONTAINER_WIDTH = 200;
const CONTAINER_HEIGHT = 100;
const ELEMENT_WIDTH = 100;
const ELEMENT_HEIGHT = 20;

/** Parses a single `"x,y"` position string into its tokens AND its
 * raw-resolved (pre-element-size-adjustment) point, mirroring exactly
 * what `websiteIcons.tsx`/`websiteBadge.tsx` each do in real use. */
function resolve(position: string) {
  const tokens = parseLinePoints(position)[0] as LinePointTokens;
  const point = resolveLinePoints([tokens], CONTAINER_WIDTH, CONTAINER_HEIGHT)[0][0];
  const adjusted = adjustForElementSize(tokens, point, ELEMENT_WIDTH, ELEMENT_HEIGHT);
  return { tokens, point, adjusted };
}

describe("adjustForElementSize — the human's own worked examples", () => {
  it("L0,T0 — element's top-LEFT corner at the container's top-left corner (unchanged baseline)", () => {
    const { adjusted } = resolve("L0,T0");
    expect(adjusted).toEqual({ x: 0, y: 0 });
    // The element's own top-left corner (CSS left/top ARE its top-left
    // corner by definition) lands exactly at (0, 0).
  });

  it("R0,T0 — element's top-RIGHT corner at the container's top-right corner (the reported bug)", () => {
    const { adjusted } = resolve("R0,T0");
    // CSS left/top for the element's OWN top-left corner -- but its
    // right edge (left + width) must land at the container's right edge.
    expect(adjusted).toEqual({ x: CONTAINER_WIDTH - ELEMENT_WIDTH, y: 0 });
    expect(adjusted.x + ELEMENT_WIDTH).toBe(CONTAINER_WIDTH); // right edges align
  });

  it("L0,C0 — center-left of the element at the center-left of the container", () => {
    const { adjusted } = resolve("L0,C0");
    expect(adjusted).toEqual({ x: 0, y: CONTAINER_HEIGHT / 2 - ELEMENT_HEIGHT / 2 });
    expect(adjusted.y + ELEMENT_HEIGHT / 2).toBe(CONTAINER_HEIGHT / 2); // vertical centers align
  });

  it("L0,B0 — bottom-left of the element at the bottom-left of the container", () => {
    const { adjusted } = resolve("L0,B0");
    expect(adjusted).toEqual({ x: 0, y: CONTAINER_HEIGHT - ELEMENT_HEIGHT });
    expect(adjusted.y + ELEMENT_HEIGHT).toBe(CONTAINER_HEIGHT); // bottom edges align
  });

  it("C0,T0 — top-center of the element at the top-center of the container", () => {
    const { adjusted } = resolve("C0,T0");
    expect(adjusted).toEqual({ x: CONTAINER_WIDTH / 2 - ELEMENT_WIDTH / 2, y: 0 });
    expect(adjusted.x + ELEMENT_WIDTH / 2).toBe(CONTAINER_WIDTH / 2); // horizontal centers align
  });

  it("C0,C0 — the element's own center at the container's own center", () => {
    const { adjusted } = resolve("C0,C0");
    expect(adjusted).toEqual({
      x: CONTAINER_WIDTH / 2 - ELEMENT_WIDTH / 2,
      y: CONTAINER_HEIGHT / 2 - ELEMENT_HEIGHT / 2,
    });
    expect(adjusted.x + ELEMENT_WIDTH / 2).toBe(CONTAINER_WIDTH / 2);
    expect(adjusted.y + ELEMENT_HEIGHT / 2).toBe(CONTAINER_HEIGHT / 2);
  });

  it("a non-zero offset still applies on top of the edge-alignment (R10,B10 — 10px inset from the corner)", () => {
    const { adjusted } = resolve("R10,B10");
    // raw anchor resolution: x = 200-10=190, y = 100-10=90 (inset INWARD,
    // same "T/L add away, B/R subtract inward" convention resolveAnchor
    // already documents) -- THEN adjusted for the element's own size.
    expect(adjusted).toEqual({ x: 190 - ELEMENT_WIDTH, y: 90 - ELEMENT_HEIGHT });
  });

  it("a plain DELTA coordinate (no anchor letter) is left completely unadjusted on that axis", () => {
    const { point, adjusted } = resolve("10,20");
    // No anchor ref at all -- "edge-aware" adjustment has nothing to act
    // on; this is unchanged, exactly the same meaning a delta already had.
    expect(adjusted).toEqual(point);
    expect(adjusted).toEqual({ x: 10, y: 20 });
  });

  it("anchors and deltas can mix per-axis — only the anchored axis gets adjusted", () => {
    const { adjusted } = resolve("R0,20");
    // x is an anchor (R) -> adjusted; y is a plain delta -> unchanged.
    expect(adjusted).toEqual({ x: CONTAINER_WIDTH - ELEMENT_WIDTH, y: 20 });
  });
});

describe("fitAndPositionPoints — ::path{start=...}'s own shape gets the same treatment", () => {
  // A simple 10x10 natural-size square shape (diagonal line), scaled up
  // to a 100x100 target box, so its OWN real rendered size (100x100) is
  // known and non-trivial for the corner-math below.
  const subpaths = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  ];

  it("start=R0,T0 (with startTokens) puts the SHAPE's own top-right corner at the container's top-right corner", () => {
    const startTokens = parseLinePoints("R0,T0")[0] as LinePointTokens;
    const startPoint = resolveLinePoints([startTokens], CONTAINER_WIDTH, CONTAINER_HEIGHT)[0][0];
    const result = fitAndPositionPoints(subpaths, 100, 100, startPoint, startTokens);
    const xs = result.flat().map((p) => p.x);
    const ys = result.flat().map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(CONTAINER_WIDTH, 5); // shape's own right edge
    expect(Math.min(...ys)).toBeCloseTo(0, 5); // shape's own top edge
  });

  it("omitting startTokens keeps the ORIGINAL top-left-corner behavior, unchanged (backward compatible)", () => {
    const startTokens = parseLinePoints("R0,T0")[0] as LinePointTokens;
    const startPoint = resolveLinePoints([startTokens], CONTAINER_WIDTH, CONTAINER_HEIGHT)[0][0];
    const result = fitAndPositionPoints(subpaths, 100, 100, startPoint); // no startTokens arg
    const xs = result.flat().map((p) => p.x);
    // Old behavior: the shape's own top-left corner sits at the resolved
    // `start` point directly -- its min x is the raw anchor value, not
    // adjusted for its own 100px width.
    expect(Math.min(...xs)).toBeCloseTo(startPoint.x, 5);
  });
});
