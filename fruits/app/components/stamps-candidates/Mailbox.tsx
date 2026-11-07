import type { ReactNode } from "react";
import { semanticColors } from "stamps/tokens";

// The drawing's own box. One ink throughout, the way `SlopeGauge` and
// the postage stamps are drawn: a 3 unit line with round ends and round
// corners, in the brand text colour (`currentColor`), on the card's
// surface. Stamps has no line tokens yet; the numbers are here.
const W = 124;
const H = 132;
const LINE = 3;

/**
 * A mailbox on a post, with a flag. Always drawn: the flag is the only
 * thing that changes. Down, it lies along the box, an outline; up, it
 * stands above the box, filled. It carries no number and has nowhere to
 * put one.
 *
 * A button: the whole drawing opens whatever the caller opens. Holds no
 * state and knows nothing about mail: the caller owns `flagUp` and what
 * `onOpen` does.
 */
export function Mailbox({
  flagUp,
  onOpen,
  label,
  description,
  height = 96,
  ...rest
}: {
  flagUp: boolean;
  onOpen: () => void;
  /** The word under the drawing. */
  label: ReactNode;
  /** What a screen reader hears, which has to say whether the flag is up. */
  description: string;
  /** The drawing's height in px; the width follows. */
  height?: number;
} & Omit<React.ComponentPropsWithoutRef<"button">, "onClick" | "type" | "aria-label">) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={description}
      data-mailbox
      data-flag={flagUp ? "up" : "down"}
      {...rest}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: 0,
        border: "none",
        background: "transparent",
        color: semanticColors.textBrand,
        cursor: "pointer",
        font: "inherit",
        ...rest.style,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={(height * W) / H}
        height={height}
        fill="none"
        stroke="currentColor"
        strokeWidth={LINE}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* The post, behind the box. */}
        <path d="M54 80 L54 126 L66 126 L66 80" />
        {/* The box: a loaf, both shoulders round. */}
        <path d="M12 80 L12 44 A24 24 0 0 1 36 20 L84 20 A24 24 0 0 1 108 44 L108 80 Z" fill={semanticColors.surfaceCard} />
        {/* The door's arch, on the near end. */}
        <path d="M36 20 A24 24 0 0 1 60 44 L60 80" />
        {flagUp ? (
          <g data-mailbox-flag="up">
            <path d="M88 62 L88 6" />
            <path d="M88 6 L112 6 L112 22 L88 22 Z" fill="currentColor" />
          </g>
        ) : (
          <g data-mailbox-flag="down">
            <path d="M88 62 L114 62" />
            <path d="M98 50 L114 50 L114 62 L98 62 Z" />
          </g>
        )}
        {/* The pivot the flag turns on. */}
        <circle cx="88" cy="62" r="2.5" fill="currentColor" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
