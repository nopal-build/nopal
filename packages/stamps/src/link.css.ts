// packages/stamps/src/link.css.ts
//
// Port of `.link` from webapp's `root.css`. Exported as a raw class
// (not a component) — same reasoning as `Surface`'s `surfaceBase`/
// `navLink`/`button`: applied to `<a>`, `<Link>`, AND plain `<button>`
// (inline "cancel"/"undo" actions) polymorphically across the app today.
import { style } from "@vanilla-extract/css";
import { colors, darkModeMediaQuery } from "./tokens";

export const link = style({
  color: colors.green,
  selectors: {
    "&:hover": { textDecoration: "underline" },
  },
  "@media": {
    [darkModeMediaQuery]: {
      color: colors.greenLight,
    },
  },
});
