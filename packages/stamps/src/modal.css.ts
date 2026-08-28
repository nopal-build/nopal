// packages/stamps/src/modal.css.ts
import { style } from "@vanilla-extract/css";

export const backdrop = style({
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(0, 0, 0, 0.5)",
  zIndex: 1000,
});

export const panel = style({
  width: "100%",
  maxWidth: 400,
  padding: 16,
});

export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 12,
});

export const title = style({
  fontWeight: 700,
  fontSize: "1.125rem", // Tailwind's `text-lg`
});

export const closeButton = style({
  fontSize: "0.875rem", // Tailwind's `text-sm`
});
