// packages/stamps/src/LayoutFlipIcon.tsx
//
// "Flip which side the markdown/preview panes are on" glyph -- two plain
// CSS boxes (see `layoutFlipIcon.css.ts`'s own header), not an SVG. Shows
// the CURRENT layout (narrow "markdown" box + wide "preview" box, ordered
// by `mdSide`) rather than a generic direction-agnostic "swap" icon --
// same "a toggle icon reflects real state" convention `SidebarToggleIcon`
// already established (its two `open` variants are genuinely different
// icons, not one icon animating blindly).
import { narrowBox, wideBox, wrapper } from "./layoutFlipIcon.css";

export function LayoutFlipIcon({ mdSide }: { mdSide: "left" | "right" }) {
  const markdownBox = <span key="md" className={narrowBox} />;
  const previewBox = <span key="preview" className={wideBox} />;
  return (
    <span className={wrapper} aria-hidden="true">
      {mdSide === "left" ? [markdownBox, previewBox] : [previewBox, markdownBox]}
    </span>
  );
}
