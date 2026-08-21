// packages/stamps/src/sprinkles.css.ts
//
// Typed, atomic utility classes — the direct replacement for Tailwind's
// spacing/layout utilities (`p-4`, `gap-2`, `flex items-center`, …).
// Same mental model on purpose (same numeric scale, same shorthand
// names) so existing muscle memory carries over — the difference is
// `sprinkles({ p: 4.5 })` is a TypeScript error (`4.5` isn't in the
// scale), where `className="p-4.5"` in Tailwind just silently renders
// nothing.
//
// The scale below is exactly the set of values already in real use
// across the app (checked via a full grep sweep before adding this file)
// — not Tailwind's full default scale. Add a new rung here the same way
// a new color rung gets added to `tokens.ts`: only when something
// actually needs it.
import { defineProperties, createSprinkles } from "@vanilla-extract/sprinkles";

const space = {
  0: "0",
  0.5: "0.125rem",
  1: "0.25rem",
  1.5: "0.375rem",
  2: "0.5rem",
  2.5: "0.625rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  9: "2.25rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
  40: "10rem",
} as const;

const spaceProperties = defineProperties({
  properties: {
    padding: space,
    paddingTop: space,
    paddingBottom: space,
    paddingLeft: space,
    paddingRight: space,
    margin: space,
    marginTop: space,
    marginBottom: space,
    marginLeft: space,
    marginRight: space,
    gap: space,
    rowGap: space,
    columnGap: space,
  },
  shorthands: {
    p: ["padding"],
    px: ["paddingLeft", "paddingRight"],
    py: ["paddingTop", "paddingBottom"],
    pt: ["paddingTop"],
    pb: ["paddingBottom"],
    pl: ["paddingLeft"],
    pr: ["paddingRight"],
    m: ["margin"],
    mx: ["marginLeft", "marginRight"],
    my: ["marginTop", "marginBottom"],
    mt: ["marginTop"],
    mb: ["marginBottom"],
    ml: ["marginLeft"],
    mr: ["marginRight"],
  },
});

// Layout properties — bundled into the SAME sprinkles config as spacing
// on purpose. Spacing classes almost never show up alone in this
// codebase (`"flex items-center gap-2 p-4"` is the norm, not the
// exception) — splitting these into a separate sprinkles instance would
// leave every converted line half on Tailwind, half not. See the
// `stamps` design-system conversation for the full reasoning.
const layoutProperties = defineProperties({
  properties: {
    display: ["none", "block", "inline-block", "inline", "flex", "inline-flex", "grid"],
    flexDirection: ["row", "row-reverse", "column", "column-reverse"],
    flexWrap: ["nowrap", "wrap", "wrap-reverse"],
    alignItems: ["stretch", "flex-start", "center", "flex-end", "baseline"],
    justifyContent: [
      "flex-start",
      "center",
      "flex-end",
      "space-between",
      "space-around",
      "space-evenly",
    ],
    flexShrink: [0, 1],
    flexGrow: [0, 1],
    textAlign: ["left", "center", "right"],
  },
});

export const sprinkles = createSprinkles(spaceProperties, layoutProperties);
export type Sprinkles = Parameters<typeof sprinkles>[0];
