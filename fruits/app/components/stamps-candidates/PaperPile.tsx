import { useEffect, useRef, type ReactNode } from "react";
import { button } from "stamps/button.css";
import { useStickyPaneMaxHeight } from "stamps/useStickyPaneMaxHeight";
import "./paperPile.css";

export type PaperSheet = {
  key: string;
  /** What the slip says. */
  label: ReactNode;
  /** A few quiet words after the label ("writing…"). */
  status?: ReactNode;
  /** The paper itself, drawn only while it is up. */
  content: ReactNode;
};

/**
 * Papers kept at the edge of a desk, for things to look at while doing
 * something else: a row of slips that stays in view as the page scrolls.
 * The first slip is what sits under the pile (`under`, "Preview"), and
 * it is what shows unless a paper is picked up. Picking a paper's slip
 * lays its sheet over that; one sheet is up at a time, and only that one
 * is drawn. Three ways back to what is under: its own slip, the button
 * at the sheet's top right, and Escape.
 *
 * Put it first inside the column it should cover: it sticks to the top of
 * that column and its sheet is as wide as it. Which sheet is up is the
 * caller's to hold (`up`, `onUp`).
 */
export function PaperPile({
  under,
  sheets,
  up,
  onUp,
  ...rest
}: {
  /** The name of what the pile sits on, for its slip and the way back. */
  under: string;
  sheets: PaperSheet[];
  up: string | null;
  onUp: (key: string | null) => void;
} & Omit<React.ComponentPropsWithoutRef<"section">, "children">) {
  const pile = useRef<HTMLElement | null>(null);
  const room = useStickyPaneMaxHeight(pile);
  const sheet = sheets.find((s) => s.key === up) ?? null;
  const isUp = !!sheet;
  useEffect(() => {
    if (!isUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onUp(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isUp, onUp]);
  return (
    <section ref={pile} className="paper-pile" data-up={sheet?.key ?? ""} style={room != null ? ({ "--paper-pile-room": `${room}px` } as React.CSSProperties) : undefined} {...rest}>
      <div className="paper-pile__slips">
        <button type="button" className="paper-pile__slip" aria-pressed={!sheet} onClick={() => onUp(null)} data-slip-under>
          {under}
        </button>
        {sheets.map((s) => (
          <button key={s.key} type="button" className="paper-pile__slip" aria-pressed={s.key === sheet?.key} onClick={() => onUp(s.key === sheet?.key ? null : s.key)} data-slip={s.key}>
            {s.label}
            {s.status != null && <span className="paper-pile__status">{s.status}</span>}
          </button>
        ))}
      </div>
      {sheet && (
        <div className="paper-pile__sheet" data-sheet={sheet.key}>
          <div className="paper-pile__scroll">
            <div className="paper-pile__back">
              <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={() => onUp(null)} data-sheet-down>
                Back to {under} ✕
              </button>
            </div>
            {sheet.content}
          </div>
        </div>
      )}
    </section>
  );
}
