// packages/stamps/src/print.css.ts
//
// Paper, the second medium (`oxmarkdown.css`'s "Paper" block has the
// type). What doesn't belong on paper is said once, here, and a control
// takes the class instead of its page carrying a print stylesheet of its
// own: a page's download links, which a printed file would only carry
// as a button to itself.
import { style } from "@vanilla-extract/css";

export const hideInPrint = style({
  "@media": {
    print: { display: "none" },
  },
});
