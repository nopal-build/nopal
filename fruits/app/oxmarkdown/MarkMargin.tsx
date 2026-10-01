/**
 * The margin (2026-10-01): the notes on a page, beside the words they are
 * about, each with an arrow back to them.
 *
 * THE MARGIN IS ITS OWN LAYER, NOT PART OF THE TEXT. Austin's rule is
 * that the text is never made taller to fit a note. The notes used to be
 * rendered inside the blocks they marked and kept out of the way with
 * CSS (a float, then `position: absolute`), which held only as long as
 * no block rule reached them: a list rule put every bullet's note a line
 * low, and under 1024px they were back in the flow. Here no note is in
 * the text at all, at any width. This layer lies over the page, holds
 * every note, and a pass places each one. There is nothing in the flow
 * for a stylesheet to get wrong.
 *
 * What decides where:
 *   - the rules are `marginGeometry.ts`, as plain numbers with tests:
 *     level with the first line of the passage, down (only down) when
 *     the note above is in the way, an arrow to the closest line that
 *     ends its row, a lane each in the gutter;
 *   - WHEN to measure again is `autoUpdate` from `@floating-ui/react`,
 *     the positioning engine OxMarkdown's popovers already run on
 *     (`OxPopover.tsx`, whose header says why its hand-rolled
 *     predecessor was a bug class). It watches each passage and its note
 *     for a resize, a window resize and a layout shift, so a photo
 *     loading above, the handwriting font arriving or a toggle opening
 *     all re-place the notes without a listener written here;
 *   - WHERE a narrow screen stops having a margin is the stylesheet's one
 *     breakpoint (`.ox-mark-margin`), read here from the layer itself
 *     rather than written a second time.
 *
 * `computePosition`, the other half of that engine, is not used: it
 * answers "beside this element", and every note here goes in one column
 * whose only question is how far down, which is one subtraction against
 * this layer.
 *
 * Rendered once by `OxRenderer` when the pen is on. On a screen with no
 * margin the layer is not displayed and each thought carries a small
 * mark that opens its notes instead (`MarkNotes`, `marks.tsx`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoUpdate } from "@floating-ui/react";
import { arrowTarget, arrowTo, gutterLanes, lineBoxes, stackTops, type Box } from "./marginGeometry";
import { MarkNoteList, type OxAnnotations, type OxMarkNote } from "./marks";

type Drawn = { arrows: { path: string; head: string }[]; spill: number };
const NOTHING: Drawn = { arrows: [], spill: 0 };

/** Never part of the words: the pen's mark and its box. */
const NOT_WORDS = ".ox-mark-handle, .ox-popover, .ox-popover-backdrop";
/** A unit's own words stop at a thought nested inside it. */
const UNIT_SKIPS = `${NOT_WORDS}, [data-mark-unit]`;
/** A block's own words stop at a block nested inside it (a nested list). */
const BLOCK_SKIPS = `${NOT_WORDS}, .ox-mark-host`;

/** The boxes of an element's own words (and its photo), relative to
 * `origin`. Text nodes only: an element's box is as wide as its block,
 * not its words. */
function wordBoxes(unit: Element, origin: DOMRect, skips: string): Box[] {
  const boxes: Box[] = [];
  const add = (r: DOMRect) => boxes.push({ left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top });
  const walker = document.createTreeWalker(unit, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node instanceof Element && node !== unit && node.matches(skips)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (!node.data.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) add(r);
    } else if (node instanceof HTMLImageElement || node instanceof HTMLVideoElement) {
      add(node.getBoundingClientRect());
    }
  }
  if (boxes.length === 0) add(unit.getBoundingClientRect());
  return boxes;
}

/** Every thought on the page, by its key. */
function unitsByKey(root: Element): Map<string, Element> {
  const units = new Map<string, Element>();
  for (const el of root.querySelectorAll("[data-mark-unit]")) {
    const key = el.getAttribute("data-mark-unit");
    if (key && !units.has(key)) units.set(key, el);
  }
  return units;
}

export function MarkMargin({ annotations }: { annotations: OxAnnotations }) {
  const layerRef = useRef<HTMLElement>(null);
  const [drawn, setDrawn] = useState<Drawn>(NOTHING);
  const drawnKey = useRef(JSON.stringify(NOTHING));
  const frame = useRef(0);

  // One group of notes per marked thought, in the order the marks came.
  const groups = useMemo(() => {
    const byUnit = new Map<string, OxMarkNote[]>();
    for (const mark of annotations.marks) byUnit.set(mark.unitKey, [...(byUnit.get(mark.unitKey) ?? []), mark]);
    return [...byUnit];
  }, [annotations.marks]);

  const place = useCallback(() => {
    const layer = layerRef.current;
    const root = layer?.closest<HTMLElement>(".ox-annotated");
    if (!layer || !root) return;
    const show = (next: Drawn) => {
      const key = JSON.stringify(next);
      if (key === drawnKey.current) return;
      drawnKey.current = key;
      setDrawn(next);
    };
    const els = [...layer.querySelectorAll<HTMLElement>(".ox-mark-notes")];
    // No margin at this width: the stylesheet has taken the layer away.
    if (els.length === 0 || getComputedStyle(layer).display === "none") {
      show(NOTHING);
      return;
    }

    const origin = layer.getBoundingClientRect();
    const columnRight = origin.width - parseFloat(getComputedStyle(root).paddingRight || "0");
    const units = unitsByKey(root);

    // The rows of whatever a marked passage shares its row with, measured
    // once each: the block it sits in, or for a photo the whole gallery
    // (the photo beside it, and their captions).
    const blockRows = new Map<Element, Box[]>();
    const rowsAround = (unit: Element) => {
      const gallery = unit.closest(".ox-gallery-directive");
      const block = gallery ?? unit.closest(".ox-mark-host");
      if (!block) return [];
      if (!blockRows.has(block)) blockRows.set(block, lineBoxes(wordBoxes(block, origin, gallery ? NOT_WORDS : BLOCK_SKIPS)));
      return blockRows.get(block)!;
    };

    const notes = els.flatMap((el) => {
      const unit = units.get(el.dataset.notesFor ?? "");
      // A note whose passage is not on the page has nowhere to sit.
      el.style.visibility = unit ? "" : "hidden";
      if (!unit) return [];
      const lines = lineBoxes(wordBoxes(unit, origin, UNIT_SKIPS));
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || el.offsetHeight;
      // The gap between two rows of the passage's own text: its leading
      // less the height of a line's words.
      const leading = parseFloat(getComputedStyle(unit).lineHeight);
      const rowGap = lines[0] && leading ? Math.max(6, leading - (lines[0].bottom - lines[0].top)) : undefined;
      // Level with the first line of what it marks: centers aligned.
      const first = lines[0];
      const want = first ? (first.top + first.bottom) / 2 - lineHeight / 2 : 0;
      return [{ el, lines, rows: rowsAround(unit), rowGap, lineHeight, want, height: el.offsetHeight }];
    });
    if (notes.length === 0) {
      show(NOTHING);
      return;
    }

    const tops = stackTops(notes);
    // The notes' column is the stylesheet's; the arrows start from where
    // it put them.
    const noteLeft = notes[0].el.getBoundingClientRect().left - origin.left;
    const aims = notes.map((note, i) => {
      const noteY = tops[i] + note.lineHeight / 2;
      return { noteY, target: arrowTarget(note.lines, note.rows, noteY, columnRight, note.rowGap) };
    });
    const lanes = gutterLanes(aims.map((a) => ({ noteY: a.noteY, targetY: a.target?.under ?? a.target?.y ?? a.noteY })));

    const arrows: Drawn["arrows"] = [];
    let lowest = 0;
    notes.forEach((note, i) => {
      note.el.style.top = `${tops[i]}px`;
      lowest = Math.max(lowest, tops[i] + note.height);
      const { noteY, target } = aims[i];
      if (target) {
        const { path, head } = arrowTo(noteLeft, noteY, target, columnRight, lanes[i]);
        arrows.push({ path, head });
      }
    });
    layer.dataset.placed = "true";

    // A note that runs past the end of the page gets room under the page,
    // never inside the text.
    const content = root.querySelector(".ox-dot-grid")?.getBoundingClientRect();
    const spill = content ? Math.max(0, Math.ceil(lowest - (content.bottom - origin.top))) : 0;
    show({ arrows, spill });
  }, []);

  // Any number of reasons to look again in one frame is one look.
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      place();
    });
  }, [place]);

  // After every render (a mark was written, taken back, or read by a
  // run), each passage and its note are handed to the engine to watch.
  // The page scrolls with its notes, so scrolling is not a reason to look.
  useEffect(() => {
    const layer = layerRef.current;
    const root = layer?.closest<HTMLElement>(".ox-annotated");
    if (!layer || !root) return;
    const units = unitsByKey(root);
    const stops = [...layer.querySelectorAll<HTMLElement>(".ox-mark-notes")].flatMap((el) => {
      const unit = units.get(el.dataset.notesFor ?? "");
      return unit ? [autoUpdate(unit, el, schedule, { ancestorScroll: false })] : [];
    });
    schedule();
    return () => {
      for (const stop of stops) stop();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  });

  if (groups.length === 0) return null;
  return (
    <>
      <aside ref={layerRef} className="ox-mark-margin" aria-label="Notes in the margin">
        {groups.map(([unitKey, notes]) => (
          <div key={unitKey} className="ox-mark-notes" role="note" data-notes-for={unitKey}>
            <MarkNoteList notes={notes} viewerId={annotations.viewerId} onMoveAction={annotations.onMoveAction} />
          </div>
        ))}
        <svg className="ox-mark-arrows" aria-hidden="true">
          {drawn.arrows.map((a, i) => (
            <g key={i}>
              <path d={a.path} />
              <path d={a.head} />
            </g>
          ))}
        </svg>
      </aside>
      {drawn.spill > 0 && <div className="ox-mark-spill" style={{ height: drawn.spill }} />}
    </>
  );
}
