// packages/stamps/src/checkbox.css.ts
//
// Visually matched to OxMarkdown's own task-list checkbox
// (`.ox-task-checkbox`, `webapp`/`fruits`'s `styles/oxmarkdown.css`) --
// same 23px glyph, 5px (checkbox) border-radius, 2.5px border, and
// ALWAYS-transparent background (checked is signaled by an overlay glyph
// appearing, never by filling the box solid) -- rather than inventing a
// second, independent visual language for "a checkbox" elsewhere in the
// app. Not a literal dependency on `oxmarkdown.css`'s own `.ox-tokens`
// CSS custom properties though (`--ox-color-accent`/`--ox-grid`, scoped
// under `.ox-content.ox-tokens`, so unresolved anywhere else, e.g. this
// component's own demo on the Stamps guide page) -- `semanticColors.
// textBrand` resolves to the EXACT same `--plum-300`/`--moon` pair
// `--ox-color-accent` does (confirmed directly against root.css), so this
// stays visually identical while remaining usable standalone, anywhere.
import { style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { semanticColors } from "./tokens";

// Wraps the (visually hidden) native `<input>` + the visual box + an
// optional label -- only rendered when `Checkbox` is given a `label`
// (a real, standalone field). Clicking anywhere in it toggles the native
// input, same as any ordinary `<label>`/`<input>` pairing.
export const wrapper = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
});

// The standard "visually hidden but still focusable/clickable" technique
// (same one `input.css.ts`'s `label` recipe uses for `hideLabel`) -- the
// real `<input type="checkbox"|"radio">` stays in the DOM (so a
// surrounding `<form>`, screen readers, and keyboard focus all see a real
// control), `box` below is the only thing actually painted.
export const srOnlyInput = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
});

// The border/background NEVER changes between checked and unchecked --
// same as `.ox-task-checkbox::before`, which sets the accent border
// unconditionally; only the overlay glyph (`CheckMark`/`dot` below,
// rendered conditionally in `Checkbox.tsx`) signals checked state. No
// `checked` variant needed here at all because of that.
export const box = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    width: 23,
    height: 23,
    border: `2.5px solid ${semanticColors.textBrand}`,
    background: "transparent",
    color: semanticColors.textBrand,
  },
  variants: {
    // `"checkbox"` -- OxMarkdown's own 5px-radius square. `"radio"` -- a
    // circle, for a MUTUALLY EXCLUSIVE selection (the same visual
    // convention a native `<input type="radio">` already uses) --
    // OxMarkdown has no radio concept of its own; this extends its exact
    // look (border weight/color, transparent fill, overlay-glyph-signals-
    // checked) to a shape it doesn't otherwise define.
    shape: {
      checkbox: { borderRadius: 5 },
      radio: { borderRadius: "9999px" },
    },
    disabled: {
      true: { opacity: 0.5 },
      false: {},
    },
  },
  defaultVariants: {
    shape: "checkbox",
    disabled: false,
  },
});

// The radio's own inner "checked" indicator -- a smaller solid circle,
// centered inside `box` by that parent's own `display: inline-flex` +
// `alignItems`/`justifyContent: center` (no absolute positioning needed).
// `currentColor` -- `box` already sets `color` to the same accent token
// its own border uses, so this (and `CheckMark`, `Checkbox.tsx`) always
// matches without a second color reference to keep in sync.
export const dot = style({
  width: 11,
  height: 11,
  borderRadius: "9999px",
  background: "currentColor",
});

export const labelText = recipe({
  base: {
    color: semanticColors.textPrimary,
  },
  variants: {
    // Same "sr-only" visually-hidden technique as `input.css.ts`'s own
    // `hideLabel` variant -- kept in the DOM for screen readers.
    hidden: {
      true: {
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      },
      false: {},
    },
  },
});

export type BoxVariants = RecipeVariants<typeof box>;
export type LabelTextVariants = RecipeVariants<typeof labelText>;
