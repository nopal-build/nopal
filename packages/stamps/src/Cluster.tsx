// packages/stamps/src/Cluster.tsx
//
// A wrapping horizontal row — replaces the `sprinkles({ display: "flex",
// flexWrap: "wrap", alignItems: "…", gap })` one-liner repeated at nearly
// every call site that lays out a label/value pair, a tag list, or a
// button group. See `Stack` for the vertical equivalent, `Grid` for a
// real CSS grid — the three "within-content" layout primitives meant to
// be composed inside either `CenterContent` or `DrawerContent` (see the
// Layout category in the Stamps guide).
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { sprinkles, type Space } from "./sprinkles.css";

type ClusterProps = ComponentPropsWithoutRef<"div"> & {
  /** Gap between children, on the shared spacing scale (`sprinkles.css.ts`). Defaults to `2` (0.5rem). */
  gap?: Space;
  align?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  /** Set `false` for a strictly single-line row (rare — almost everything wants to wrap). Defaults to `true`. */
  wrap?: boolean;
};

export const Cluster = forwardRef<HTMLDivElement, ClusterProps>(function Cluster(
  { gap = 2, align = "center", wrap = true, className = "", ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`${sprinkles({
        display: "flex",
        flexDirection: "row",
        flexWrap: wrap ? "wrap" : "nowrap",
        alignItems: align,
        gap,
      })} ${className}`.trim()}
      {...rest}
    />
  );
});
