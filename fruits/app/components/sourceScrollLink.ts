// app/components/sourceScrollLink.ts
// How a split editor keeps its Markdown in step with what is drawn beside
// it (Austin, 2026-11-21, after a day with the first version: matching
// by fraction of length "gets increasingly off with more images").
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
// 2. The two scroll together, whichever one is being scrolled: the page
//    moves the Markdown, and the Markdown moves the page. (For one merge
//    the Markdown held still and glided into place once the page
//    settled; in use the two moving together "overall feels more
//    natural".)
// 3. Putting the cursor in the Markdown jumps the page to that spot: the
//    block being edited is marked in the Preview and brought level with
//    the cursor's line when it is out of view. The Markdown is not moved
//    by that: the hands are on it.
//
// What the map is between. One side is the Markdown's own scroll offset.
// The other is THE PAGE'S scroll offset, not a place in the Preview: an
// anchor's place on that side is how far the page has to be scrolled for
// its block to sit level with the top of the Markdown box once that box
// is pinned. So the top of the page is the top of the Markdown and the
// bottom is the bottom, both ends are reached together, and everything
// between is one unbroken line. Two earlier versions lined the Markdown
// up against where its box happened to be on screen. That box moves (it
// starts under the header and pins partway down, growing as it goes), so
// the match moved with it: the Markdown slid backwards while the page
// went forwards, and a Markdown that fit the pinned box but not the
// short one was clamped to its top, which read as "go to the top of the
// page" (Austin: "a strange freak out where the preview jumps back to
// the top").
//
// Each side ignores a scroll it didn't get from a hand. The page ignores
// the scroll the Markdown just gave it. The Markdown only counts as
// scrolled by hand when a wheel, a touch, a key or a pressed pointer was
// just on it: the browser also scrolls it by itself, when its box
// changes size, and passing that on to the page was the freak out's
// other half.
//
// The Markdown is a plain textarea, which cannot say where a wrapped
// line sits, so that side is measured on a hidden copy of the text laid
// out with the textarea's own font and width, one element per line (the
// markdown-it demo's way).
import { useEffect, useRef, useState, type RefObject } from "react";
import { findScrollingAncestor } from "stamps/useStickyPaneMaxHeight";

/** One place known on both sides: a source line, the Markdown scroll
 * offset that puts that line at the top, and the matching offset on the
 * drawn side (in the editor, the page's scroll offset that puts the
 * line's block level with it). */
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

/** How long after the last scroll event a scroll of ours counts as over. */
const SETTLE_MS = 140;
/** How long after a wheel, touch or key on the Markdown its scrolling
 * still counts as by hand (the browser eases a wheel's scroll out). */
const HAND_MS = 500;
/** The least scroll travel a pinned Markdown needs before scrolling it
 * moves the page. */
const MIN_TRAVEL = 240;
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
  layoutKey,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  body: string;
  enabled: boolean;
  /** Changes when what scrolls the preview changes (the editor taking
   * over the window makes itself the scroller), so the wiring is redone
   * against the new one. */
  layoutKey?: unknown;
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

    // How far below its pane's top edge the textarea starts: where the
    // Markdown's first line sits once the pane is pinned to the top.
    const pane = host;
    let map: ScrollAnchor[] | null = null;
    function scrollMap(): ScrollAnchor[] {
      if (map) return map;
      layMirror();
      const inset = textarea!.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      // An element's place in what the page scrolls, less the inset: the
      // page offset that puts it level with the pinned Markdown's top.
      const base = scroller!.scrollTop - scroller!.getBoundingClientRect().top - inset;
      const anchors: ScrollAnchor[] = [];
      for (const el of preview!.querySelectorAll<HTMLElement>("[data-source-line]")) {
        const line = Number(el.dataset.sourceLine);
        const source = sourceTop(line);
        const drawn = base + el.getBoundingClientRect().top;
        // Nothing in the first windowful is an anchor. The page has a
        // header above the editor that the Markdown has no lines for, and
        // an exact match right under it would spend that whole header on
        // the Markdown's first few lines (a touch on the Markdown, a
        // lurch of the page). Left out, the header is spread over the
        // first windowful, and the match is exact from there down.
        if (source != null && drawn >= scroller!.clientHeight) anchors.push({ line, source, drawn });
      }
      map = buildScrollMap(anchors, pinnedRoom(), Math.max(0, scroller!.scrollHeight - scroller!.clientHeight));
      return map;
    }
    /** How far the Markdown can scroll once its pane is pinned and at its
     * full height. Not how far it can scroll right now: at the top of the
     * page the pane is shorter, so the Markdown has more travel there,
     * and a map built on that would stretch and shrink as the pane grew
     * (the Markdown sliding backwards while the page went forwards). */
    function pinnedRoom(): number {
      const cs = getComputedStyle(scroller!);
      const full = scroller!.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const grows = Math.max(0, full - pane.offsetHeight);
      return Math.max(0, textarea!.scrollHeight - (textarea!.clientHeight + grows));
    }

    // ── The page scrolled: the Markdown goes with it. ──
    let following = 0;
    // Where `follow` last put the Markdown, so its own scroll event isn't
    // read as someone scrolling it.
    let given: number | null = null;
    // Set while the page is being scrolled by us (the Markdown driving
    // it, or the cursor link below), so that scroll isn't passed back.
    let ours = false;
    let oursDone: ReturnType<typeof setTimeout> | null = null;
    function pageIsOurs(ms = SETTLE_MS) {
      ours = true;
      if (oursDone) clearTimeout(oursDone);
      oursDone = setTimeout(() => (ours = false), ms);
    }
    function follow() {
      // Not while a hand is on the Markdown: the page can be scrolled by
      // the wheel carrying on past the Markdown's end, and that must not
      // pull the Markdown back.
      if (pressed || performance.now() - wheelAt < HAND_MS) return;
      textarea!.scrollTop = Math.round(convertPosition(scrollMap(), scroller!.scrollTop, "drawn"));
      // What the browser made of it (it clamps).
      given = textarea!.scrollTop;
    }
    function onScroll() {
      if (ours) {
        pageIsOurs();
        return;
      }
      cancelAnimationFrame(following);
      following = requestAnimationFrame(follow);
    }

    // ── The Markdown was scrolled by hand: the page goes with it. ──
    let handAt = -Infinity;
    // The wheel or a finger in particular: what can carry on into the page.
    let wheelAt = -Infinity;
    let pressed = false;
    const hand = (e?: Event) => {
      handAt = performance.now();
      if (e && (e.type === "wheel" || e.type.startsWith("touch"))) wheelAt = handAt;
    };
    const press = () => {
      pressed = true;
      hand();
    };
    // Declared before `follow` runs, though after it is written: it only
    // runs from a scroll event.
    const release = () => {
      if (pressed) hand();
      pressed = false;
    };
    function onSourceScroll() {
      const byHand = pressed || performance.now() - handAt < HAND_MS;
      if (!byHand || (given !== null && Math.abs(textarea!.scrollTop - given) <= 1)) {
        given = textarea!.scrollTop;
        return;
      }
      given = null;
      // A Markdown that all but fits its box has almost no travel to
      // spend on a whole page: a notch of the wheel would throw the page
      // most of its length. It is all in view anyway, so it is left to
      // scroll by itself, and the cursor is the link.
      if (pinnedRoom() < MIN_TRAVEL) return;
      cancelAnimationFrame(following);
      const to = Math.round(convertPosition(scrollMap(), textarea!.scrollTop, "source"));
      if (to === Math.round(scroller!.scrollTop)) return;
      pageIsOurs();
      scroller!.scrollTop = to;
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
      pageIsOurs(SETTLE_MS * 3);
      cancelAnimationFrame(following);
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
    resized.observe(scroller);
    // Typing changes the text without always changing the drawn size (a
    // letter swapped for another), so it says so itself.
    textChanged.current = () => {
      map = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => link(false));
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    textarea.addEventListener("scroll", onSourceScroll, { passive: true });
    const hands = ["wheel", "touchstart", "touchmove", "keydown", "input"] as const;
    for (const type of hands) textarea.addEventListener(type, hand, { passive: true });
    textarea.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("selectionchange", onSelection);
    textarea.addEventListener("focus", onCursor);
    textarea.addEventListener("blur", onBlur);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      textarea.removeEventListener("scroll", onSourceScroll);
      for (const type of hands) textarea.removeEventListener(type, hand);
      textarea.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      document.removeEventListener("selectionchange", onSelection);
      textarea.removeEventListener("focus", onCursor);
      textarea.removeEventListener("blur", onBlur);
      resized.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(following);
      if (oursDone) clearTimeout(oursDone);
      mirror.remove();
      textChanged.current = null;
    };
  }, [enabled, layoutKey, textareaRef, previewRef]);

  useEffect(() => {
    textChanged.current?.();
  }, [body]);

  return mark;
}
