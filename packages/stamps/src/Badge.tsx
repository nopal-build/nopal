// packages/stamps/src/Badge.tsx
import type { ReactNode } from "react";
import { badge, type BadgeVariants } from "./badge.css";

type BadgeProps = {
  variant?: NonNullable<BadgeVariants>["variant"];
  children: ReactNode;
  className?: string;
};

/**
 * Semantic status pill (Complete, Overdue, Invited, …). Variant colors live
 * in `badge.css.ts` (a vanilla-extract recipe) rather than Tailwind/global
 * CSS classes — pass `variant`, don't hand-roll pill spans with inline
 * `--farground`/`--midground` colors (they won't flip for dark mode; see
 * the `neutral` variant's `@media` block here for how that's handled).
 */
export function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  return <span className={`${badge({ variant })} ${className}`.trim()}>{children}</span>;
}
