// packages/stamps/src/centerContent.css.ts
//
// Backs the `CenterContent` component — one of `AppLayout`'s two
// content-area types (see `drawerContent.css.ts` for the other). Same
// centered/padded shell every route already hand-rolls as
// `className="container mx-auto px-4 py-12" style={{ maxWidth: "…" }}` —
// `maxWidth` itself is deliberately NOT baked in here (it's the one
// per-page knob, applied as an inline style by the component instead),
// this file only owns the parts that stay constant everywhere.
import { style } from "@vanilla-extract/css";

export const centerContent = style({
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
  paddingLeft: "16px",
  paddingRight: "16px",
  paddingTop: "48px",
  paddingBottom: "48px",
});
