/**
 * The Daily Log's day-framing components, used by the real route
 * (`routes/fruits_.daily-log.tsx`). See `styles/dailyLog.css` for
 * `.daily-log-day`.
 */

import type { CSSProperties, ReactNode } from "react";
import "../styles/dailyLog.css";

/** One bordered, rounded frame per day, holding that day's prose + cards
 * + release log. A near-white/dark-plum background (`.daily-log-day`,
 * deliberately NOT the same warm `farground` tone `good-box`/cards use)
 * is what lets a Card visually "sit on top of" the day's own prose area
 * instead of blending into it. Zero padding on BOTH sides — the OxEditor
 * content inside already reserves a full `41px` gutter on EACH side
 * itself (`--ox-grid`, `.ox-content`'s own symmetric padding), so this
 * frame doesn't need to add any of its own on top. (An earlier version
 * added a matching `41px` on the RIGHT here too, from back when
 * `.ox-content` only reserved its gutter on the LEFT — stale once
 * `.ox-content` became symmetric; kept doubling the right gutter's
 * width until removed, which was ALSO why a Card's own bleed fell well
 * short of actually reaching this frame's edge — see `.ox-card-directive`
 * in `oxmarkdown.css`.) */
export function DayContainer({ children }: { children: ReactNode }) {
  return (
    <div
      className="daily-log-day ox-tokens"
      style={{ padding: "24px 0", marginBottom: "64px" }}
    >
      {children}
    </div>
  );
}

/** A day's heading ("Today"/"Yesterday"/a full date for anything older)
 * — same left gutter as everything below it (`--ox-grid`), same font
 * size across every day (deliberately unified — an earlier version had
 * "Today" and "Yesterday" at two different sizes), and no underline (a
 * border-bottom here read as a stray rule sitting above the day's own
 * framed container, not as part of it). `className`/`style` let a
 * caller vary color/weight per day (e.g. "Today" reads more prominent
 * than a locked past day) without duplicating the shared gutter/size/
 * spacing. */
export function DayTitle({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        paddingLeft: "var(--ox-grid, 41px)",
        fontFamily: "monospace",
        fontSize: "20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
