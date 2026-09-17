/**
 * A single, standalone positioned-popover component meant to back EVERY
 * OxMarkdown popover/menu that needs to float next to some anchor element —
 * today that's the directive-attribute popover (`OxRenderer.tsx`'s
 * `InteractiveDirective`) and the `/` slash-command menu
 * (`SlashCommandPlugin.tsx`). `MentionPlugin.tsx`'s `@`-mention menu is
 * deliberately NOT ported to this (see its own header comment) — it's built
 * on `LexicalTypeaheadMenuPlugin`'s own anchor mechanism, which already
 * solves positioning correctly by a different, already-safe route.
 *
 * Built on `@floating-ui/react` rather than hand-rolled — it was ALREADY a
 * real, non-transitive-in-name-only dependency sitting in `node_modules`
 * (pulled in by `@lexical/react` itself, confirmed by checking
 * `package-lock.json` directly), so adopting it costs no new dependency,
 * same story as `mdast-util-directive` in the skill doc. Hand-rolling
 * flip/shift/max-height/scroll-tracking correctly (RTL, nested scroll
 * containers, viewport edges, resize) is exactly the kind of fiddly,
 * well-trodden problem a real positioning engine exists to solve — the
 * previous hand-rolled version (a single `rect.bottom + 4` / `rect.left`
 * calculation, recomputed via manual scroll/resize listeners on ONE of the
 * two popovers and not the other) is the actual bug class this replaces.
 *
 * What this component owns:
 *   - Positioning: `flip()` (top/bottom AND left/right directionality —
 *     flips when there's no room on the preferred side), `shift()` (keeps
 *     the popover on-screen when there's SOME but not full room), `size()`
 *     (caps `max-height` to whatever vertical space is actually available
 *     and lets the popover scroll internally past that), `offset()` (a
 *     small gap off the anchor), and `autoUpdate` (keeps position live
 *     across scroll — ANY scrolling ancestor, not just the window — resize,
 *     and layout shift, without a single hand-rolled listener).
 *   - Rendering via a real `document.body` portal (via `createPortal`,
 *     matching the pattern already used everywhere else in this codebase)
 *     so a scrolling ancestor container can never clip it.
 *   - Optional dismissal (`onDismiss`): outside press and Escape, via
 *     `useDismiss`. Opt-in per caller (`SlashCommandPlugin` already has its
 *     own Lexical-command-based Escape handling tied to its own "don't
 *     reopen for the same query" tracking, so it wires its OWN dismiss
 *     logic through this prop rather than duplicating two Escape paths).
 *   - Mobile layout: below a `640px` viewport width, ignores computed
 *     floating position entirely and renders as a full-width sheet pinned
 *     to the bottom of the screen instead — see the skill's "Mobile UX"
 *     TODO ("Popovers/menus: always full-width, always bottom-anchored...
 *     one predictable location beats a contextually-positioned one that
 *     risks getting clipped by or fighting with the on-screen keyboard").
 *     A `.ox-popover-backdrop` behind it gives a natural tap-outside-to-
 *     dismiss target too (also just an ordinary "outside press" as far as
 *     `useDismiss` is concerned — no special-casing needed).
 *
 * What this component deliberately does NOT own: WHEN to open. `open` and
 * `anchorEl` are fully controlled by the caller — this stays a pure
 * "given an anchor and open state, render a well-positioned box" component,
 * not a stateful menu/combobox. Each caller keeps its own reason for
 * being open (a directive being selected, a `/` trigger match, ...).
 */

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from "@floating-ui/react";

/** `640px` matches the general small-viewport breakpoint already used
 * elsewhere in nopal's styles — treated here as "mobile enough that a
 * floating popover risks fighting the on-screen keyboard or getting
 * clipped," not a device-type detection. */
const MOBILE_QUERY = "(max-width: 640px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export interface OxPopoverProps {
  /** The element the popover floats next to. `null` while there's nothing
   * to anchor to yet — the popover renders nothing in that case. */
  anchorEl: Element | null;
  open: boolean;
  /** Preferred side/alignment — `flip()` may choose the opposite side, or
   * `shift()` may nudge alignment, when there isn't room. */
  placement?: Placement;
  /** Called when an outside press or Escape should close the popover.
   * Omit entirely to opt out of built-in dismissal (e.g. a caller with its
   * own Escape/close handling already wired up). */
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}

/** Smallest usable height before we'd rather overflow the viewport a touch
 * than squeeze a popover down to something unreadable. */
const MIN_HEIGHT_PX = 120;

export default function OxPopover({
  anchorEl,
  open,
  placement = "bottom-start",
  onDismiss,
  className,
  children,
}: OxPopoverProps) {
  const isMobile = useIsMobileViewport();

  const { refs, floatingStyles, context } = useFloating({
    open,
    placement,
    strategy: "fixed",
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onDismiss?.();
    },
    elements: { reference: anchorEl },
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(MIN_HEIGHT_PX, availableHeight)}px`,
          });
        },
      }),
    ],
    // Repositions on scroll of ANY ancestor scroll container (not just the
    // window) and on resize — this is exactly the mechanism the old
    // hand-rolled version was missing on the slash-command menu, and had
    // to hand-roll (window-only) for the directive popover.
    whileElementsMounted: open ? autoUpdate : undefined,
  });

  const dismiss = useDismiss(context, {
    enabled: open && onDismiss != null,
    // Following the popover across a scroll rather than closing it is the
    // whole point here — `autoUpdate` above keeps it correctly positioned
    // instead.
    ancestorScroll: false,
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!open || !anchorEl) return null;

  if (isMobile) {
    return createPortal(
      <>
        <div className="ox-popover-backdrop" />
        <div
          ref={refs.setFloating}
          role="dialog"
          className={`ox-popover ox-popover--sheet ox-tokens${className ? ` ${className}` : ""}`}
          {...getFloatingProps()}
        >
          <div className="ox-popover-sheet-handle" aria-hidden="true" />
          {children}
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={`ox-popover ox-tokens${className ? ` ${className}` : ""}`}
      {...getFloatingProps()}
    >
      {children}
    </div>,
    document.body,
  );
}
