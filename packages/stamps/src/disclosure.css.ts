// packages/stamps/src/disclosure.css.ts
//
// The stamp twirl-down (`Disclosure.tsx`): a row that opens in place. The
// summary is the row; the chevron turns when it's open; the body sits
// under it with a little left room, so a stack of them reads as a list.
import { style } from "@vanilla-extract/css";
import { colors, semanticColors } from "./tokens";

export const details = style({
  borderBottom: `1px solid ${semanticColors.surfaceBorder}`,
  selectors: {
    "&:last-child": { borderBottom: "none" },
  },
});

export const summary = style({
  listStyle: "none",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 4px",
  cursor: "pointer",
  color: "inherit",
  outline: "none",
  selectors: {
    "&::-webkit-details-marker": { display: "none" },
    "&:focus-visible": { boxShadow: `0 0 0 2px ${colors.pink}` },
  },
});

export const summaryContent = style({
  flex: "1 1 auto",
  minWidth: 0,
});

export const chevron = style({
  flex: "0 0 auto",
  color: semanticColors.textSubtle,
  transition: "transform 120ms ease",
  selectors: {
    [`${details}[open] > ${summary} > &`]: { transform: "rotate(90deg)" },
  },
});

export const body = style({
  padding: "4px 4px 14px 26px",
});
