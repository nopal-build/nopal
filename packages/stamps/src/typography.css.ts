// packages/stamps/src/typography.css.ts
//
// Font-size (+ `truncate`) — the two typography concerns that don't fit
// `sprinkles` because they each set multiple, independently-varying CSS
// properties as one fixed bundle rather than a single scalar property:
//
//   - `textSize`: Tailwind's `text-sm` sets font-size AND line-height
//     together (different values per step, e.g. `sm` = 0.875rem font-size
//     / 1.25rem line-height) — sprinkles can't express "one key, two
//     linked values," so this is a plain `styleVariants` map instead.
//   - `truncate`: `overflow`/`textOverflow`/`whiteSpace` always travel
//     together for the ellipsis effect to work at all — same reasoning
//     Tailwind itself ships it as one compound utility, not three.
//
// Same Tailwind step names on purpose (`xs`/`sm`/`lg`/`2xl`, …) — no new
// mental model, same reasoning as the color/spacing scales.
import { style, styleVariants } from "@vanilla-extract/css";

export const textSize = styleVariants({
  xs: { fontSize: "0.75rem", lineHeight: "1rem" },
  sm: { fontSize: "0.875rem", lineHeight: "1.25rem" },
  base: { fontSize: "1rem", lineHeight: "1.5rem" },
  lg: { fontSize: "1.125rem", lineHeight: "1.75rem" },
  xl: { fontSize: "1.25rem", lineHeight: "1.75rem" },
  "2xl": { fontSize: "1.5rem", lineHeight: "2rem" },
  "3xl": { fontSize: "1.875rem", lineHeight: "2.25rem" },
  "4xl": { fontSize: "2.25rem", lineHeight: "2.5rem" },
  "6xl": { fontSize: "3.75rem", lineHeight: "1" },
});

export const truncate = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
