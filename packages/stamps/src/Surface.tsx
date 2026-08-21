// packages/stamps/src/Surface.tsx
import type { ComponentPropsWithoutRef } from "react";
import { surfaceBase, surfaceHoverable } from "./surface.css";

type SurfaceProps = ComponentPropsWithoutRef<"div"> & {
  /** Adds the hover border/shadow treatment — use for a clickable card
   * (wrap it in a `<Link>`/give it an `onClick`), not a static panel. */
  hoverable?: boolean;
};

/** The base card/panel primitive most "boxed" UI should sit inside —
 * dialogs, dropdown panels, menus, list rows. See `badge`/`chip` for the
 * same pattern applied to smaller pill-shaped elements. */
export function Surface({ hoverable, className = "", ...rest }: SurfaceProps) {
  const classes = [surfaceBase, hoverable && surfaceHoverable, className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...rest} />;
}
