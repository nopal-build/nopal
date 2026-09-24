// packages/stamps/src/Grid.tsx
//
// A real CSS grid — auto-fits as many `minColumnWidth`-wide columns as
// the container allows, wrapping to fewer (down to one) as it narrows.
// `gridTemplateColumns` isn't expressible in `sprinkles` (it's not a
// single scalar value), so this is the one within-content layout
// primitive that reaches for a plain inline style instead — see `Stack`/
// `Cluster` for the flex-based equivalents, all three meant to be
// composed inside either `CenterContent` or `DrawerContent` (see the
// Layout category in the Stamps guide).
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { sprinkles, type Space } from "./sprinkles.css";

type GridProps = ComponentPropsWithoutRef<"div"> & {
  /** Gap between cells, on the shared spacing scale (`sprinkles.css.ts`). Defaults to `4` (1rem). */
  gap?: Space;
  /** Minimum width of a column before wrapping to fewer per row. Pass a
   * bare number for px, or any CSS length string. Defaults to `240`. */
  minColumnWidth?: number | string;
};

export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { gap = 4, minColumnWidth = 240, className = "", style, ...rest },
  ref,
) {
  const minWidth =
    typeof minColumnWidth === "number" ? `${minColumnWidth}px` : minColumnWidth;
  return (
    <div
      ref={ref}
      className={`${sprinkles({ display: "grid", gap })} ${className}`.trim()}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}, 1fr))`,
        ...style,
      }}
      {...rest}
    />
  );
});
