// packages/stamps/src/Stack.tsx
//
// A vertical rhythm — replaces the `sprinkles({ display: "flex",
// flexDirection: "column", gap })` one-liner repeated at nearly every
// call site that stacks a handful of blocks. One of the three
// "within-content" layout primitives (see `Cluster` for the horizontal
// wrapping equivalent, `Grid` for a real CSS grid) meant to be composed
// inside either `CenterContent` or `DrawerContent` — see the Layout
// category in the Stamps guide.
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { sprinkles, type Space } from "./sprinkles.css";

type StackProps = ComponentPropsWithoutRef<"div"> & {
  /** Gap between children, on the shared spacing scale (`sprinkles.css.ts`). Defaults to `4` (1rem). */
  gap?: Space;
  align?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 4, align, className = "", ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`${sprinkles({
        display: "flex",
        flexDirection: "column",
        gap,
        alignItems: align,
      })} ${className}`.trim()}
      {...rest}
    />
  );
});
