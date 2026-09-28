// packages/stamps/src/layoutFlipIcon.css.ts
//
// Backs `LayoutFlipIcon` -- deliberately plain boxes, not an SVG (per its
// own design note: two rounded rectangles, 3px radius). `wideBox` uses
// `semanticColors` (scheme-aware) rather than the literal, day-scene-only
// `colors.farground`/`colors.midground` -- this icon needs to keep
// reading correctly in dark mode, unlike the website's own literal-
// purple conventions (which are deliberately scheme-invariant for a
// different, documented reason -- see `website.css`).
import { style } from "@vanilla-extract/css";
import { colors, semanticColors } from "./tokens";

export const wrapper = style({
  display: "inline-flex",
  alignItems: "stretch",
  gap: "2px",
  width: "16px",
  height: "12px",
  flexShrink: 0,
});

const box = style({
  display: "block",
  borderRadius: "3px",
});

// The markdown pane -- narrow because it's the FIXED/bounded-width side
// of the real split view (`Preview` is the greedy one that takes
// whatever's left) -- see the layout's own CSS for why. `colors.purple`
// deliberately literal/scheme-invariant here too, matching every other
// "this represents the editor/markdown side" accent already established
// (`WavyLine`/`::line{color="purple"}` etc. all skip the green/red dark-
// mode swap the same way).
export const narrowBox = style([
  box,
  {
    flex: "0 0 5px",
    background: colors.purple,
  },
]);

// The preview pane -- wide/greedy, reading as an ordinary card surface.
export const wideBox = style([
  box,
  {
    flex: "1 1 auto",
    background: semanticColors.surfaceCard,
    border: `1px solid ${semanticColors.surfaceBorder}`,
  },
]);
