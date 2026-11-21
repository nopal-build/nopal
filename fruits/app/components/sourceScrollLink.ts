// app/components/sourceScrollLink.ts
// How a split editor lines its Markdown up with what is drawn beside it
// (Austin, 2026-11-21, after a day with the first version: matching by
// fraction of length "gets increasingly off with more images, the
// parallax while scrolling is also somewhat disorienting").
//
// Three things, the way editors with a source pane and a preview pane do
// it (VS Code's `data-line`, Joplin's `source-line` and scroll map):
//
// 1. Anchors. `OxRenderer`'s `sourceAnchors` marks each drawn block with
//    the source line it came from. Each anchor is measured on both
//    sides, and a position on one side becomes a position on the other
//    by going to the anchors around it and interpolating between them. A
//    picture is one line here and a tall block there, and that only
//    stretches the one stretch between its two anchors; nothing adds up
//    down the page. With no anchors (an editor whose preview doesn't
//    mark its blocks) the map is its two ends, which is the old
//    fraction-of-length match.
// 2. The Markdown holds still while the page scrolls, and glides to the
//    matching place once the scroll settles. Two columns moving at two
//    speeds was the parallax.
// 3. The cursor is the main link. Clicking or typing in the Markdown
//    marks the block being edited in the Preview, and brings it level
//    with the cursor's line when it is out of view. The Markdown is not
//    moved by that: the hands are on it.
//
// The Markdown is a plain textarea, which cannot say where a wrapped
// line sits, so the source side is measured on a hidden copy of the text
// laid out with the textarea's own font and width, one element per line
// (the markdown-it demo's way).
import { useEffect, useRef, useState, type RefObject } from "react";
import { findScrollingAncestor } from "stamps/useStickyPaneMaxHeight";

/** One place known on both sides: a source line, the textarea scroll
 * offset that puts that line at the top, and how far down the drawn page
 * its block starts. */
export type ScrollAnchor = { line: number; source: number; drawn: number };

/** The anchors in order with both ends added. An anchor that goes
 * backwards on either side (blocks side by side in a grid, a measurement
 * taken mid-layout) is dropped, so a position always maps to one place.
 * Pure. */
export function buildScrollMap(anchors: ScrollAnchor[], sourceEnd: number, drawnEnd: number): ScrollAnchor[] {
  const map: ScrollAnchor[] = [{ line: 0, source: 0, drawn: 0 }];
  for (const a of [...anchors].sort((x, y) => x.line - y.line)) {
    const last = map[map.length - 1];
    if (a.source <= last.source || a.drawn < last.drawn || a.source >= sourceEnd || a.drawn > drawnEnd) continue;
    map.push(a);
  }
  const last = map[map.length - 1];
  map.push({ line: Number.MAX_SAFE_INTEGER, source: Math.max(sourceEnd, last.source), drawn: Math.max(drawnEnd, last.drawn) });
  return map;
}

/** A position on one side as the matching position on the other:
 * straight-line between the two anchors around it, held at the ends.
 * Pure. */
export function convertPosition(map: ScrollAnchor[], value: number, from: "source" | "drawn"): number {
  const to = from === "source" ? "drawn" : "source";
  if (map.length === 0) return 0;
  if (value <= map[0][from]) return map[0][to];
  for (let i = 1; i < map.length; i++) {
    const a = map[i - 1];
    const b = map[i];
    if (value > b[from]) continue;
    const span = b[from] - a[from];
    return span <= 0 ? b[to] : a[to] + ((value - a[from]) / span) * (b[to] - a[to]);
  }
  return map[map.length - 1][to];
}

/** The 1-based line a character offset is on. Pure. */
export function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** The last anchored line at or before `line`, or null when the cursor is
 * above the first one. Pure. */
export function anchorLineFor(lines: number[], line: number): number | null {
  let found: number | null = null;
  for (const l of lines) if (l <= line && (found === null || l > found)) found = l;
  return found;
}

/** Where the block being edited sits in the Preview, from its top. */
export type SourceMark = { top: number; height: number };

const SETTLE_MS = 140;
/** Room kept clear at the top of the window for whatever is pinned there. */
const TOP_CLEAR = 64;
const BOTTOM_CLEAR = 24;

/** Wires the three behaviours above to a textarea and the element its
 * preview is drawn in. Returns the mark to draw in the Preview while the
 * cursor is in the Markdown, or null. */
export function useSourceScrollLink({
  textareaRef,
  previewRef,
  body,
  enabled,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  body: string;
  enabled: boolean;
}): SourceMark | null {
  const [mark, setMark] = useState<SourceMark | null>(null);
  // What the wiring below does when the text changes.
  const textChanged = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMark(null);
      return;
    }
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    const scroller = preview ? findScrollingAncestor(preview) : null;
    const host = textarea?.parentElement;
    if (!textarea || !preview || !scroller || !host) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The hidden copy of the text the source side is measured on.
    const mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, { position: "absolute", top: "0", left: "0", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "break-word", boxSizing: "border-box", zIndex: "-1" });
    host.appendChild(mirror);
    // Scrolling the Markdown to its end doesn't carry on into the page:
    // that page scroll would settle and pull the Markdown back.
    const chained = textarea.style.overscrollBehavior;
    textarea.style.overscrollBehavior = "contain";
    let mirrored: string | null = null;
    let mirroredWidth = 0;
    function layMirror() {
      const width = textarea!.clientWidth;
      if (mirrored === textarea!.value && mirroredWidth === width) return;
      const cs = getComputedStyle(textarea!);
      Object.assign(mirror.style, { width: `${width}px`, font: cs.font, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, padding: cs.padding, tabSize: cs.tabSize });
      const lines = textarea!.value.split("\n");
      const frag = document.createDocumentFragment();
      for (const text of lines) {
        const row = document.createElement("div");
        // An empty line still takes a line's height.
        row.textContent = text === "" ? "​" : text;
        frag.appendChild(row);
      }
      mirror.replaceChildren(frag);
      mirrored = textarea!.value;
      mirroredWidth = width;
    }
    const padTop = () => parseFloat(getComputedStyle(textarea!).paddingTop) || 0;
    /** How far down the text a line starts, from the first line. */
    function sourceTop(line: number): number | null {
      const row = mirror.children[line - 1] as HTMLElement | undefined;
      return row ? row.offsetTop - padTop() : null;
    }

    let map: ScrollAnchor[] | null = null;
    function scrollMap(): ScrollAnchor[] {
      if (map) return map;
      layMirror();
      const top = preview!.getBoundingClientRect().top;
      const anchors: ScrollAnchor[] = [];
      for (const el of preview!.querySelectorAll<HTMLElement>("[data-source-line]")) {
        const line = Number(el.dataset.sourceLine);
        const source = sourceTop(line);
        if (source != null) anchors.push({ line, source, drawn: el.getBoundingClientRect().top - top });
      }
      map = buildScrollMap(anchors, Math.max(0, textarea!.scrollHeight - textarea!.clientHeight), preview!.getBoundingClientRect().height);
      return map;
    }

    // ── The page scrolled: once it settles, the Markdown glides so the
    // line at its top edge is the one level with it in the Preview. ──
    let settle: ReturnType<typeof setTimeout> | null = null;
    // Set while the page is being scrolled by the cursor link below, so
    // that scroll doesn't move the Markdown out from under the cursor.
    let ours = false;
    let oursDone: ReturnType<typeof setTimeout> | null = null;
    function follow() {
      const level = textarea!.getBoundingClientRect().top - preview!.getBoundingClientRect().top;
      const target = level <= 0 ? 0 : convertPosition(scrollMap(), level, "drawn");
      textarea!.scrollTo({ top: Math.round(target), behavior: calm ? "auto" : "smooth" });
    }
    function onScroll() {
      if (ours) {
        if (oursDone) clearTimeout(oursDone);
        oursDone = setTimeout(() => (ours = false), SETTLE_MS);
        return;
      }
      if (settle) clearTimeout(settle);
      settle = setTimeout(follow, SETTLE_MS);
    }

    // ── The cursor moved in the Markdown: mark its block in the Preview,
    // and bring the block level with the cursor's line if it is out of
    // view. ──
    let frame = 0;
    function drawnBlockFor(line: number): HTMLElement | null {
      const marked = [...preview!.querySelectorAll<HTMLElement>("[data-source-line]")];
      const at = anchorLineFor(marked.map((el) => Number(el.dataset.sourceLine)), line);
      if (at === null) return null;
      // The last element on that line is the innermost (a list's first
      // item, a quote's first paragraph).
      const el = marked.filter((m) => Number(m.dataset.sourceLine) === at).pop() ?? null;
      // A component-drawn block is the element after its marker.
      return el && el.offsetHeight === 0 ? (el.nextElementSibling as HTMLElement | null) : el;
    }
    function link(bringIntoView: boolean) {
      if (document.activeElement !== textarea) return;
      const line = lineAtOffset(textarea!.value, textarea!.selectionStart);
      const block = drawnBlockFor(line);
      if (!block) {
        setMark(null);
        return;
      }
      const rect = block.getBoundingClientRect();
      const previewTop = preview!.getBoundingClientRect().top;
      setMark((prev) => {
        const next = { top: Math.round(rect.top - previewTop), height: Math.round(rect.height) };
        return prev && prev.top === next.top && prev.height === next.height ? prev : next;
      });
      if (!bringIntoView) return;
      const view = scroller!.getBoundingClientRect();
      const visibleTop = view.top + TOP_CLEAR;
      const visibleBottom = view.bottom - BOTTOM_CLEAR;
      const inView = rect.top >= visibleTop && Math.min(rect.bottom, rect.top + 120) <= visibleBottom;
      if (inView) return;
      // Level with the cursor's own line, kept inside the window.
      layMirror();
      const caret = sourceTop(line);
      const caretLevel = textarea!.getBoundingClientRect().top + padTop() + (caret ?? 0) - textarea!.scrollTop;
      const level = Math.min(Math.max(caretLevel, visibleTop), visibleBottom - 120);
      ours = true;
      if (oursDone) clearTimeout(oursDone);
      oursDone = setTimeout(() => (ours = false), SETTLE_MS * 3);
      if (settle) clearTimeout(settle);
      scroller!.scrollBy({ top: Math.round(rect.top - level), behavior: calm ? "auto" : "smooth" });
    }
    function onCursor() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => link(true));
    }
    function onSelection() {
      if (document.activeElement === textarea) onCursor();
    }
    const onBlur = () => setMark(null);

    // What is drawn changed size (typing, a picture arriving, the window):
    // the map is stale, and the mark is put back where its block now is.
    const resized = new ResizeObserver(() => {
      map = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => link(false));
    });
    resized.observe(preview);
    resized.observe(textarea);
    // Typing changes the text without always changing the drawn size (a
    // letter swapped for another), so it says so itself.
    textChanged.current = () => {
      map = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => link(false));
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("selectionchange", onSelection);
    textarea.addEventListener("focus", onCursor);
    textarea.addEventListener("blur", onBlur);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      document.removeEventListener("selectionchange", onSelection);
      textarea.removeEventListener("focus", onCursor);
      textarea.removeEventListener("blur", onBlur);
      resized.disconnect();
      cancelAnimationFrame(frame);
      if (settle) clearTimeout(settle);
      if (oursDone) clearTimeout(oursDone);
      mirror.remove();
      textarea.style.overscrollBehavior = chained;
      textChanged.current = null;
    };
  }, [enabled, textareaRef, previewRef]);

  useEffect(() => {
    textChanged.current?.();
  }, [body]);

  return mark;
}
