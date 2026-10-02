/**
 * The margin's rules as numbers (`oxmarkdown/marginGeometry.ts`,
 * 2026-10-01): a note sits level with the first line of what it marks,
 * slides down (only down) when the note above is in the way, and an
 * arrow runs from it to the closest line of its words without crossing
 * a word. That a note takes no room in the text is CSS and is walked in
 * a browser; this pins what the layout pass computes.
 */
import { describe, expect, it } from "vitest";
import { MARGIN, arrowTarget, arrowTo, clearBandUnder, closestLine, endsItsRow, gutterLanes, isRouted, lineBoxes, stackTops, type Box } from "../oxmarkdown/marginGeometry";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("lines of a marked passage", () => {
  it("merges the pieces of one line and keeps lines apart", () => {
    // "Nobody is logging the survey" ends a line; the sentence runs on,
    // partly bold, for most of the next.
    const lines = lineBoxes([box(700, 100, 980, 123), box(40, 141, 300, 164), box(300, 140, 420, 165), box(420, 141, 860, 164)]);
    expect(lines).toEqual([box(700, 100, 980, 123), box(40, 140, 860, 165)]);
  });

  it("ignores empty rects", () => {
    expect(lineBoxes([box(10, 10, 10, 30), box(10, 10, 60, 30)])).toEqual([box(10, 10, 60, 30)]);
  });
});

describe("stacking notes in the margin", () => {
  it("leaves a note where it wants to be when nothing is in the way", () => {
    expect(stackTops([{ want: 100, height: 82 }, { want: 400, height: 41 }])).toEqual([100, 400]);
  });

  it("slides a note down under the one above, never up, never overlapping", () => {
    const notes = [
      { want: 100, height: 369 },
      { want: 141, height: 82 },
      { want: 182, height: 41 },
      { want: 900, height: 41 },
    ];
    const tops = stackTops(notes);
    expect(tops).toEqual([100, 469, 551, 900]);
    notes.forEach((n, i) => {
      expect(tops[i]).toBeGreaterThanOrEqual(n.want);
      if (i > 0) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] + notes[i - 1].height);
    });
  });

  it("places by height on the page, whatever order they arrive in", () => {
    expect(stackTops([{ want: 300, height: 41 }, { want: 100, height: 250 }])).toEqual([350, 100]);
  });
});

describe("the arrow", () => {
  const columnRight = 1000;
  const noteLeft = columnRight + MARGIN.gutter;
  // A sentence that starts mid-row, fills the next, and ends mid-row with
  // another sentence after it on that same row.
  const lines = [box(700, 100, 1000, 123), box(40, 141, 1000, 164), box(40, 182, 520, 205)];
  const rows = [box(40, 100, 1000, 123), box(40, 141, 1000, 164), box(40, 182, 990, 205)];
  const center = (b: Box) => (b.top + b.bottom) / 2;

  it("points at the line nearest the note", () => {
    expect(closestLine(lines, 112)).toBe(lines[0]);
    expect(closestLine(lines, 600)).toBe(lines[2]);
    expect(closestLine([], 600)).toBeNull();
  });

  it("knows a line that ends its row from one with more words after it", () => {
    expect(endsItsRow(lines[0], rows)).toBe(true);
    expect(endsItsRow(lines[2], rows)).toBe(false);
    // The paragraph's own last line: nothing after it.
    expect(endsItsRow(box(40, 182, 520, 205), [box(40, 182, 520, 205)])).toBe(true);
  });

  it("aims at the closest line that ends its row, never across the next sentence", () => {
    // Far below: the last line is closest, but the next sentence follows
    // it on its row, so the arrow goes to the line above.
    expect(arrowTarget(lines, rows, 600, columnRight)).toEqual({ x: columnRight + MARGIN.clear, y: center(lines[1]) });
    // The last line of a paragraph: to just past its last word.
    const last = [box(40, 182, 520, 205)];
    expect(arrowTarget(last, last, 600, columnRight)).toEqual({ x: 520 + MARGIN.clear, y: center(last[0]) });
  });

  describe("to one sentence inside a row, with words after it", () => {
    const inside = [box(300, 141, 620, 164)];
    const gapTop = 164;
    const gapBottom = 164 + 18;

    it("aims at the passage's own last word, from the gap under its row", () => {
      expect(arrowTarget(inside, rows, 152, columnRight, 18)).toEqual({ x: 622, y: 166, under: 173 });
    });

    for (const [name, noteY, lane] of [["level with the row", 152.5, 0], ["from a note that slid far down", 700, 2], ["from a note above", 20, 1]] as const) {
      it(`${name}: stays in the gutter or in that gap, and comes up at the last word`, () => {
        const to = arrowTarget(inside, rows, noteY, columnRight, 18)!;
        const a = arrowTo(noteLeft, noteY, to, columnRight, lane);
        const points = [...a.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
        for (const p of points) {
          // In the text column, every point and handle is in the gap
          // between this row's words and the next row's: over no word,
          // of this passage or of the sentence after it.
          const inGutter = p.x >= columnRight - 8 && p.x < noteLeft;
          const inTheGap = p.y >= gapTop && p.y <= gapBottom;
          expect(inGutter || inTheGap).toBe(true);
          // And never left of the passage's end.
          expect(p.x).toBeGreaterThanOrEqual(inside[0].right);
        }
        expect(a.to).toEqual({ x: 622, y: 166, under: 173 });
        // The head points up at the underline's end.
        expect(a.head).toContain("L 622,166");
      });
    }
  });

  describe("to the left photo of a pair", () => {
    // Two photos side by side with a caption under each, and the next
    // pair below (the boxes of a gallery, as `lineBoxes` merges them).
    const left = box(40, 300, 480, 740);
    const gallery = [box(40, 300, 1000, 740), box(40, 744, 760, 758), box(40, 800, 1000, 1240)];

    it("finds the clear band past the captions, not the sliver above them", () => {
      expect(endsItsRow(left, gallery)).toBe(false);
      expect(clearBandUnder(left, gallery)).toBe((758 + 800) / 2);
    });

    it("goes under the pair and comes up at the photo's corner, over neither photo nor caption", () => {
      const to = arrowTarget([left], gallery, 520, columnRight)!;
      expect(to).toEqual({ x: 482, y: 742, under: 779 });
      const a = arrowTo(noteLeft, 520, to, columnRight, 0);
      const points = [...a.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      for (const p of points) {
        const inGutter = p.x >= columnRight - 8 && p.x < noteLeft;
        const inTheBand = p.y > 758 && p.y < 800;
        // The last stretch comes up between the two photos' columns.
        const betweenThePhotos = p.x >= 480 && p.x <= 492 && p.y >= 740;
        expect(inGutter || inTheBand || betweenThePhotos).toBe(true);
      }
    });
  });

  it("level with its line, is one stroke from the note to just past the last word", () => {
    const to = arrowTarget(lines, rows, 111.5, columnRight)!;
    const a = arrowTo(noteLeft, 111.5, to, columnRight);
    expect(a.from).toEqual({ x: noteLeft - MARGIN.clear, y: 111.5 });
    expect(a.to).toEqual({ x: columnRight + MARGIN.clear, y: 111.5 });
    expect(a.path.startsWith(`M ${a.from.x},${a.from.y}`)).toBe(true);
    expect(a.head).toContain(`L ${a.to.x},${a.to.y}`);
    // Never starts inside the note or ends inside the text.
    expect(a.to.x).toBeGreaterThan(lines[0].right);
    expect(a.from.x).toBeLessThan(noteLeft);
    expect(a.from.x - a.to.x).toBeGreaterThan(MARGIN.head);
  });

  it("from a note that slid down, runs up the gutter and along the blank end of the row", () => {
    const last = [box(40, 141, 520, 164)];
    const to = arrowTarget(last, last, 520, columnRight)!;
    for (const lane of [0, 1, 2, 3]) {
      const a = arrowTo(noteLeft, 520, to, columnRight, lane);
      const points = [...a.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      for (const p of points) {
        // Every point and handle of the curve is in the gutter, or beside
        // the line's own blank end and within a drift of its center:
        // never over the words of this line or the lines under it.
        const inGutter = p.x >= columnRight && p.x < noteLeft;
        const alongRow = p.x > last[0].right && Math.abs(p.y - center(last[0])) <= MARGIN.drift + 0.01;
        expect(inGutter || alongRow).toBe(true);
      }
      expect(a.to).toEqual({ x: 520 + MARGIN.clear, y: center(last[0]) });
    }
  });

  it("gives arrows that share a stretch of the gutter their own lanes, nearest the notes first", () => {
    // One level note, then three that slid: the second and third runs
    // overlap; the fourth starts below both.
    expect(
      gutterLanes([
        { noteY: 100, targetY: 100 },
        { noteY: 500, targetY: 180 },
        { noteY: 620, targetY: 420 },
        { noteY: 1400, targetY: 900 },
      ]),
    ).toEqual([0, 0, 1, 0]);
    // More than there are lanes: the last ones share the last lane.
    const piled = Array.from({ length: 6 }, (_, i) => ({ noteY: 600 + i * 41, targetY: 100 + i * 41 }));
    expect(gutterLanes(piled)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(isRouted(100, 115)).toBe(false);
  });
});
