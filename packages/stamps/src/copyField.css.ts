// packages/stamps/src/copyField.css.ts
//
// Port of `.code-input` (root.css) plus the Tailwind utility classes
// `CopyField.tsx` layered on top of it. NOT removing `.code-input`/
// `.code-block` from root.css — other call sites (`fruits_.profile.tsx`,
// `fruits_.styles.tsx`) still reference them directly and haven't
// migrated yet.
import { style } from "@vanilla-extract/css";
import { fonts, semanticColors } from "./tokens";

export const row = style({
  display: "flex",
  alignItems: "center",
  gap: 8, // Tailwind's `gap-2`
});

export const field = style({
  fontFamily: fonts.mono,
  flex: "1 1 0%",
  minWidth: 0,
  fontSize: "0.75rem",
  padding: "6px 8px",
  background: semanticColors.surfaceInset,
  border: `1px solid ${semanticColors.surfaceBorder}`,
  borderRadius: 6,
  color: semanticColors.textSubtle,
});

export const copyButton = style({
  flexShrink: 0,
  padding: "6px 12px",
  fontSize: "0.75rem",
});
