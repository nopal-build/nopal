/**
 * The geometry of the margin (2026-10-01): where each note sits and the
 * arrow from it to the words it is about. Pure, so the rules are tested
 * as numbers (`tests/marginGeometry.test.ts`); `MarkMargin.tsx` does the
 * measuring and the drawing.
 *
 * The rules, which are Austin's:
 *   - a note never makes the text taller. It sits in the margin, out of
 *     the flow, level with the first line of what it marks;
 *   - when the note above is still in the way it slides down, and only
 *     down, so notes never overlap and never leave reading order;
 *   - an arrow runs from the note to the closest line of the underlined
 *     words, which is what says where a note that slid belongs. It never
 *     crosses a word or another arrow.
 *
 * The curve is the stamps line (`oxmarkdown-core`'s `buildSplinePath`,
 * the math under `WavyLine.tsx`). `WavyLine` itself takes its points as
 * fractions of its own box or as the centers of named elements, and has
 * no arrowhead, so the path is built from the same math here.
 */

import { buildSplinePath, type LinePoint } from "oxmarkdown-core";

export type Box = { left: number; right: number; top: number; bottom: number };

/** The arrow's fixed distances, in px. */
export const MARGIN = {
  /** From the text column to the notes, as the stylesheet draws them
   * (`.ox-mark-margin .ox-mark-notes`, `oxmarkdown.css`). The layout
   * pass measures the notes where they are; this is for the tests. */
  gutter: 24,
  /** Space between the note and the arrow's tail, and between its head
   * and the last word. */
  clear: 4,
  /** Arrowhead: stroke length and half-angle. */
  head: 6,
  headAngle: (28 * Math.PI) / 180,
  /** How far the arrow may leave a line's center while it runs along it.
   * Under half the space between two lines of text, so it never touches
   * the line above or below. */
  drift: 10,
  /** Arrows that run up the gutter each get their own lane, this far
   * apart, counted from the note's side. */
  lane: 4,
  lanes: 4,
} as const;

/** Rects of pieces of text, merged into one box per line. A piece joins
 * a line when its vertical center falls inside it. */
export function lineBoxes(rects: readonly Box[]): Box[] {
  const lines: Box[] = [];
  const pieces = rects.filter((r) => r.right > r.left && r.bottom > r.top).sort((a, b) => a.top - b.top || a.left - b.left);
  for (const r of pieces) {
    const center = (r.top + r.bottom) / 2;
    const line = lines.find((l) => center >= l.top && center <= l.bottom);
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    line.left = Math.min(line.left, r.left);
    line.right = Math.max(line.right, r.right);
    line.top = Math.min(line.top, r.top);
    line.bottom = Math.max(line.bottom, r.bottom);
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Where each note's top lands: where it wants to be, or just under the
 * note before it when that one is still in the way. Never above `want`.
 * Answers come back in the order given; notes are placed top to bottom,
 * and two that want the same line keep the order given. */
export function stackTops(notes: readonly { want: number; height: number }[]): number[] {
  const order = notes.map((n, i) => ({ ...n, i })).sort((a, b) => a.want - b.want || a.i - b.i);
  const tops = new Array<number>(notes.length);
  let floor = -Infinity;
  for (const n of order) {
    const top = Math.max(n.want, floor);
    tops[n.i] = top;
    floor = top + n.height;
  }
  return tops;
}

/** The line whose center is nearest `y`. */
export function closestLine(lines: readonly Box[], y: number): Box | null {
  let best: Box | null = null;
  let bestDistance = Infinity;
  for (const l of lines) {
    const d = Math.abs((l.top + l.bottom) / 2 - y);
    if (d < bestDistance) {
      best = l;
      bestDistance = d;
    }
  }
  return best;
}

/** Whether a line of a marked passage is the last thing on its row: the
 * space from its last word to the margin is blank. A sentence that ends
 * mid-row, with the next one following it, is not. `rows` are the lines
 * of the whole block the passage sits in. */
export function endsItsRow(line: Box, rows: readonly Box[]): boolean {
  const center = (line.top + line.bottom) / 2;
  const row = rows.find((r) => center >= r.top && center <= r.bottom);
  return !row || row.right <= line.right + 1;
}

/** Where an arrow's head stops. With `under`, the passage ends in the
 * middle of a row with other words after it: the arrow then runs along
 * the gap under that row, at this height, and comes up at the passage's
 * last word. */
export type Aim = LinePoint & { under?: number };

/**
 * Where an arrow's head stops: at the line of the passage closest to the
 * note (`noteY` is the center of the note's first line).
 *
 * A line that ends its row is preferred, and the head stops just past
 * its last word, level with it. When the passage has none (one sentence
 * in the middle of a row, the left photo of a pair), what comes after it
 * on the row is something else: the arrow runs under the row, in the
 * first clear band below it (`clearBandUnder`), and comes up at the
 * passage's end, so it never crosses a word or a photo and never points
 * at the wrong one.
 */
export function arrowTarget(lines: readonly Box[], rows: readonly Box[], noteY: number, columnRight: number, rowGap = 18): Aim | null {
  const open = lines.filter((l) => endsItsRow(l, rows));
  const line = closestLine(open.length > 0 ? open : lines, noteY);
  if (!line) return null;
  if (open.length > 0) return { x: Math.min(line.right, columnRight) + MARGIN.clear, y: (line.top + line.bottom) / 2 };
  return { x: line.right + 2, y: line.bottom + 2, under: clearBandUnder(line, rows, rowGap) };
}

/** The narrowest band an arrow is drawn through. */
const BAND = 6;

/** The middle of the first clear band under `line`, among whatever lies
 * to the right of its end: between two rows of text that is the gap
 * between them; under a photo it is past the captions of the photos
 * beside it. With nothing below, `rowGap` under the last thing. */
export function clearBandUnder(line: Box, rows: readonly Box[], rowGap = 18): number {
  const beside = rows.filter((r) => r.right > line.right + 1 && r.bottom > line.top).sort((a, b) => a.top - b.top);
  let floor = line.bottom;
  for (const r of beside) {
    if (r.top >= floor + BAND) return (floor + r.top) / 2;
    floor = Math.max(floor, r.bottom);
  }
  return floor + rowGap / 2;
}

/** The height an arrow travels to before it turns toward the text. */
function turnY(to: Aim): number {
  return to.under ?? to.y;
}

/** Whether a note this far from its line gets a run up the gutter rather
 * than one stroke. Under two drifts there is no room for the two turns. */
export function isRouted(noteY: number, targetY: number): boolean {
  return Math.abs(noteY - targetY) > MARGIN.drift * 2;
}

/**
 * A lane in the gutter for each arrow, in page order: 0 is nearest the
 * notes. An arrow takes the lane one closer to the text than any earlier
 * arrow whose run it shares a stretch of the gutter with, which is what
 * keeps two from drawing as one line and keeps a later arrow's turn
 * toward the text from crossing an earlier arrow's run. Past the last
 * lane they share it. `targetY` is where the arrow turns toward the text.
 */
export function gutterLanes(arrows: readonly { noteY: number; targetY: number }[]): number[] {
  const runs: { top: number; bottom: number; lane: number }[] = [];
  return arrows.map((a) => {
    if (!isRouted(a.noteY, a.targetY)) return 0;
    const top = Math.min(a.noteY, a.targetY);
    const bottom = Math.max(a.noteY, a.targetY);
    const beside = runs.filter((r) => r.top <= bottom && top <= r.bottom);
    const lane = beside.length === 0 ? 0 : Math.min(MARGIN.lanes - 1, Math.max(...beside.map((r) => r.lane)) + 1);
    runs.push({ top, bottom, lane });
    return lane;
  });
}

export type Arrow = { path: string; head: string; from: LinePoint; to: LinePoint };

/**
 * The arrow from a note to where its head stops (`arrowTarget`).
 *
 * `noteLeft` and `noteY` are the note's left edge and the center of its
 * first line; `columnRight` is the right edge of the text column.
 *
 * Level with a line that ends its row, it is one short stroke with a
 * slight bow. When the note slid away, it runs up (or down) its lane of
 * the gutter between the text and the margin and then along the blank
 * end of the row. To a passage with words after it on its row, it runs
 * along the gap under the row and hooks up at the last word. In every
 * case it crosses no word.
 */
export function arrowTo(noteLeft: number, noteY: number, to: Aim, columnRight: number, lane = 0): Arrow {
  const from = { x: noteLeft - MARGIN.clear, y: noteY };
  const turn = turnY(to);
  const routed = isRouted(from.y, turn);

  const head = (angle: number) => {
    const barb = (spread: number) => ({
      x: to.x - MARGIN.head * Math.cos(angle + spread),
      y: to.y - MARGIN.head * Math.sin(angle + spread),
    });
    return buildSplinePath([barb(MARGIN.headAngle), to, barb(-MARGIN.headAngle)], "straight");
  };

  if (!routed && to.under == null) {
    const bow = Math.min(5, Math.abs(from.x - to.x) * 0.08);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - bow };
    return {
      path: buildSplinePath([from, middle, to], "smooth", 0.5),
      // A spline arrives at its last point heading from the one before it.
      head: head(Math.atan2(to.y - middle.y, to.x - middle.x)),
      from,
      to,
    };
  }

  // Pieces with their handles spelled out, because a spline through the
  // corners swings wide of them, over the words or into the note.
  const pieces: string[] = [];
  // Where the arrow is, at the height it turns toward the text.
  let at: LinePoint;
  if (routed) {
    // A turn into the gutter and straight along its lane. The first lane
    // sits clear of the handwriting beside it.
    const gutterX = from.x - 6 - MARGIN.lane * lane;
    const toward = from.y > turn ? 1 : -1;
    const leave = { x: gutterX, y: from.y - toward * MARGIN.drift };
    const arrive = { x: gutterX, y: turn + toward * MARGIN.drift };
    const corner = { x: gutterX, y: from.y };
    pieces.push(buildSplinePath([from, corner, corner, leave], "bezier"), buildSplinePath([leave, arrive], "straight"));
    const settle = { x: Math.max(gutterX - 40, to.x + (gutterX - to.x) / 2), y: turn };
    if (to.under == null) {
      // A turn onto the row that arrives level, at the last word.
      pieces.push(buildSplinePath([arrive, { x: gutterX, y: turn }, settle, to], "bezier"));
      return { path: pieces.join(" "), head: head(Math.PI), from, to };
    }
    at = { x: Math.max(columnRight - 8, to.x + 12), y: turn };
    pieces.push(buildSplinePath([arrive, { x: gutterX, y: turn }, { x: gutterX - 4, y: turn }, at], "bezier"));
  } else {
    // Level with the row, or nearly: an easy bend down from the note into
    // the gap under it.
    at = { x: Math.max(columnRight - 8, to.x + 12), y: turn };
    const lean = (from.x - at.x) / 2;
    pieces.push(buildSplinePath([from, { x: from.x - lean, y: from.y }, { x: at.x + lean, y: turn }, at], "bezier"));
  }

  // Along the gap under the row, then up at the passage's last word.
  const foot = { x: to.x + 9, y: turn };
  if (foot.x < at.x) pieces.push(buildSplinePath([at, foot], "straight"));
  pieces.push(buildSplinePath([foot.x < at.x ? foot : at, { x: to.x + 3, y: turn }, { x: to.x, y: turn - 2 }, to], "bezier"));
  return { path: pieces.join(" "), head: head(-Math.PI / 2), from, to };
}
