// packages/stamps/src/moreMenu.css.ts
import { style } from "@vanilla-extract/css";

export const root = style({
  position: "relative",
  display: "inline-block",
});

export const triggerWrapper = style({
  display: "inline-block",
});

export const panel = style({
  display: "flex",
  flexDirection: "column",
  gap: 2, // Tailwind's `gap-0.5`
});
