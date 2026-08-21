// packages/stamps/src/Chip.tsx
import type { ReactNode } from "react";
import { chip } from "./chip.css";

type ChipProps = {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
};

/** Filter/category tag or single-select toggle. Pass `onClick` to make it
 * interactive (adds the pointer cursor + keyboard support); omit it for a
 * plain read-only tag. See `Badge` instead for a semantic status pill. */
export function Chip({ children, onClick, active = false, className = "" }: ChipProps) {
  const isInteractive = typeof onClick === "function";

  return (
    <span
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      className={`${chip({ active, interactive: isInteractive })} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
