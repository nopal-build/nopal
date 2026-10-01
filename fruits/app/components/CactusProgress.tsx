// A print's progress as a nopal growing its pads (Austin, 2026-10-01).
// One pad per stage the print walks (`PRINT_STAGES`): a pad grows in when
// its stage starts, the newest one breathes so a long stage never looks
// frozen, and finished pads hold still. The count comes from the job's
// own log (`printStagesStarted`), so the cactus is as accurate as the
// stages are; it never pretends to know how far through a stage it is.
//
// The pad is the green pad from the "no." logo (`images/no-logo-color.svg`),
// recentred on the origin and placed five times.
import { palette } from "stamps/tokens";

const PAD =
  "M131.713 91.3031C119.565 90.6589 114.029 86.6122 113.814 83.7866C113.581 80.7124 120.377 74.9136 130.639 72.1348C139.643 69.6967 147.602 74.8475 149.863 82.0508C152.123 89.2542 141.061 91.7989 131.713 91.3031Z";
const PAD_CENTER = "translate(-132.5 -81.7)";

// Base pad first, then two on it, then one on each of those: the way a
// nopal grows, each pad from the top edge of the one below. Each is
// placed by its centre, the angle from its base to its tip, and a scale,
// in a 120 x 120 box, sized so each pad overlaps the one below; the pad
// grows from its base, its local left end.
const PLACES: [number, number, number, number][] = [
  [60, 90, -90, 1.45],
  [43, 58, -121.4, 1.42],
  [77, 58, -58.6, 1.42],
  [29, 28, -105.5, 1.2],
  [91, 28, -74.5, 1.2],
];

export function CactusProgress({ started, size = 44 }: { started: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Stage ${Math.max(started, 1)} of ${PLACES.length}`}>
      <style>{`
        .cactus-pad { transform-box: fill-box; transform-origin: 0% 50%; transition: transform 600ms ease-out; }
        .cactus-pad[data-state="growing"] { animation: cactus-breathe 1.6s ease-in-out infinite; }
        @keyframes cactus-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        @media (prefers-reduced-motion: reduce) {
          .cactus-pad { transition: none; }
          .cactus-pad[data-state="growing"] { animation: none; }
        }
      `}</style>
      {PLACES.map(([x, y, rotate, scale], i) => {
        const state = i < started - 1 ? "grown" : i === started - 1 ? "growing" : "bud";
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
            {/* The growth lives on its own group: a CSS transform on the
                path would replace the path's own centring transform. */}
            <g className="cactus-pad" data-state={state} style={{ transform: state === "bud" ? "scale(0)" : "scale(1)" }}>
              <path d={PAD} transform={PAD_CENTER} fill={palette.cactus[500]} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
