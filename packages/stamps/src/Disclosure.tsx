// packages/stamps/src/Disclosure.tsx
import type { ComponentProps, ReactNode } from "react";
import { body, chevron, details, summary, summaryContent } from "./disclosure.css";

type DisclosureProps = Omit<ComponentProps<"details">, "children" | "title"> & {
  /** The row: what you see closed, and click to open. */
  summary: ReactNode;
  /** What twirls down under it. */
  children: ReactNode;
};

/**
 * The stamp twirl-down (Austin, 2026-09-29): a row in a list that opens
 * in place to show more, and closes again, without leaving the page. A
 * native `<details>`, so the keyboard, find-in-page and no JavaScript
 * all work; pass `open` and `onToggle` to control it, or leave it to the
 * browser. Stack them for a list that expands one row at a time.
 */
export function Disclosure({ summary: row, children, className, ...rest }: DisclosureProps) {
  return (
    <details className={`${details} ${className ?? ""}`.trim()} {...rest}>
      <summary className={summary}>
        <svg className={chevron} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={summaryContent}>{row}</span>
      </summary>
      <div className={body}>{children}</div>
    </details>
  );
}
