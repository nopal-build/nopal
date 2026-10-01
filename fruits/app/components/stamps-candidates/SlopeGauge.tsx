import type { ReactNode } from "react";
import "./slopeGauge.css";

// Geometry, in the SVG's own 360 × 276 box: the trail pivots at the
// bottom left on level ground and tilts up as the slope gets steeper.
const PX = 44;
const PY = 252;
const WORD_R = 236;
const TRAIL_R = 176;
const GUIDE_R = 200;
const W = 360;
const H = 276;

/** Evenly spaced slopes from nearly level to nearly a wall, one per word. */
function slopesFor(count: number): number[] {
  if (count <= 1) return [40];
  return Array.from({ length: count }, (_, i) => Math.round(4 + (i * 72) / (count - 1)));
}

function point(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  // Rounded, so the server's and the browser's floating point agree and
  // hydration doesn't see two different drawings.
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(PX + r * Math.cos(rad)), y: round(PY - r * Math.sin(rad)) };
}

/**
 * A slope you set by tapping a word. The words sit on a quarter circle at
 * the slope each names, from nearly level (the first) to nearly a wall
 * (the last); tapping one tilts the trail up from level ground to it, so
 * a later word reads as a steeper climb. One ink colour throughout. Before
 * anything is chosen there is only the ground.
 *
 * Holds no state and saves nothing: the caller owns `chosen` and decides
 * what a tap does.
 */
export function SlopeGauge<K extends string>({
  options,
  chosen,
  onChoose,
  caption,
  note,
  size = "full",
  ...rest
}: {
  /** Least steep first. */
  options: readonly { key: K; label: string }[];
  chosen: K | null;
  onChoose: (key: K) => void;
  caption?: ReactNode;
  /** A line under the gauge, e.g. a save that failed. */
  note?: ReactNode;
  size?: "full" | "compact";
} & Omit<React.ComponentPropsWithoutRef<"div">, "onChoose">) {
  const slopes = slopesFor(options.length);
  const chosenIndex = options.findIndex((s) => s.key === chosen);
  const slope = chosenIndex === -1 ? 0 : slopes[chosenIndex];
  const guideEnd = point(GUIDE_R, 84);

  return (
    <div className={`slope-gauge slope-gauge--${size}`} {...rest}>
      {caption != null && <p className="slope-gauge__caption">{caption}</p>}
      <div className="slope-gauge__dial">
        <svg className="slope-gauge__svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {/* The quarter the slope can move through, faint. */}
          <path
            d={`M ${PX + GUIDE_R} ${PY} A ${GUIDE_R} ${GUIDE_R} 0 0 0 ${guideEnd.x} ${guideEnd.y}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
            strokeDasharray="3 7"
          />
          {slopes.map((deg, i) => {
            const a = point(GUIDE_R - 8, deg);
            const b = point(GUIDE_R + 8, deg);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity={0.4} strokeWidth={2} />;
          })}
          {/* Level ground. */}
          <line x1={PX - 20} y1={PY} x2={W - 16} y2={PY} stroke="currentColor" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
          {/* The trail: drawn level and tilted up to the chosen slope, so the
              change animates. Hidden until the first tap. */}
          <g
            className="slope-gauge__trail"
            style={{ transform: `rotate(${-slope}deg)`, opacity: chosen != null ? 1 : 0 }}
          >
            <line x1={PX} y1={PY} x2={PX + TRAIL_R} y2={PY} stroke="currentColor" strokeWidth={7} strokeLinecap="round" />
            <circle cx={PX + TRAIL_R} cy={PY} r={7} fill="currentColor" />
          </g>
          <circle cx={PX} cy={PY} r={6} fill="currentColor" />
        </svg>
        {options.map((s, i) => {
          const p = point(WORD_R, slopes[i]);
          const isChosen = chosen === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={isChosen}
              className="slope-gauge__word"
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
              onClick={() => onChoose(s.key)}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {note != null && <p className="slope-gauge__note">{note}</p>}
    </div>
  );
}
