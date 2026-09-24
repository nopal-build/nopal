import type { ReactNode } from "react";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import "./pinnedCard.css";

/**
 * A card pinned into a scrapbook: a stamps `Surface` that leans a little,
 * with a strip of tape at the top, a title and a small label (a date,
 * usually) in a `Badge`. Put several inside a `PinnedCardWall`; the lean
 * varies card to card by position, so no two neighbours match.
 */
export function PinnedCard({
  title,
  label,
  children,
  ...rest
}: {
  title: ReactNode;
  label?: ReactNode;
  children: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"div">, "title">) {
  return (
    <Surface className="pinned-card" {...rest}>
      <div className="pinned-card__head">
        <span className="pinned-card__title">{title}</span>
        {label != null && <Badge>{label}</Badge>}
      </div>
      {children}
    </Surface>
  );
}

/** Pinned cards two across on a wide screen, in reading order (left to
 * right, then down), the right-hand one of each pair a little lower; one
 * stack on a phone. */
export function PinnedCardWall({ children }: { children: ReactNode }) {
  return <div className="pinned-wall">{children}</div>;
}
