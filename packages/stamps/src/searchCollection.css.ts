// packages/stamps/src/searchCollection.css.ts
import { style } from "@vanilla-extract/css";
import { semanticColors } from "./tokens";

export const box = style({
  display: "flex",
  flexDirection: "column",
});

// The list area is a page-background "well" so rows inside can be plain
// `Surface` cards that flip for dark mode on their own — no forced-white
// backgrounds or explicit text colors needed. Same day/white-night/purple
// swap as `--color-surface-page` (was `.collection-well`).
export const well = style({
  display: "flex",
  flexDirection: "column",
  gap: 8, // Tailwind's `gap-2`
  overflowY: "auto",
  padding: 12, // Tailwind's `p-3`
  background: semanticColors.surfacePage,
  borderRadius: "7px 7px 0 0",
});

export const divider = style({
  borderColor: "currentColor",
  opacity: 0.2,
  margin: 0,
});

export const footerArea = style({
  display: "flex",
  flexDirection: "column",
  gap: 12, // Tailwind's `gap-3`
  padding: 12, // Tailwind's `p-3`
});

export const searchFieldWrapper = style({
  position: "relative",
});

export const searchFieldInput = style({
  paddingRight: 36, // Tailwind's `pr-9` — room for the icon below
});

export const searchIcon = style({
  position: "absolute",
  right: "10px",
  top: "50%",
  transform: "translateY(-50%)",
  color: semanticColors.textSubtle,
  pointerEvents: "none",
});
