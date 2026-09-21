// packages/stamps/src/CenterContent.tsx
//
// The default `AppLayout` content-area type: centers `children` in a
// max-width column with the page's standard padding. Use this for
// anything read top-to-bottom with no persistent side panel — forms,
// docs, dashboards, detail pages. See `DrawerContent` for the other
// content-area type (full width + a persistent left drawer, e.g. the
// Vault folder tree) — every page should pick exactly one of the two as
// its outermost content wrapper.
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { centerContent } from "./centerContent.css";

type CenterContentProps = ComponentPropsWithoutRef<"div"> & {
  /** Caps the column's width. Defaults to `680` (px) — pass a bare
   * number for px, or any CSS length string (e.g. `"42rem"`) to override
   * per page. Common precedents already in use: `420` (single-column
   * cards), `480` (forms/detail panels), `640` (a record's own detail
   * page), `860` (wide/dashboard content). */
  maxWidth?: number | string;
};

export const CenterContent = forwardRef<HTMLDivElement, CenterContentProps>(
  function CenterContent({ maxWidth = 680, className = "", style, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={`${centerContent} ${className}`.trim()}
        style={{
          maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
          ...style,
        }}
        {...rest}
      />
    );
  },
);
