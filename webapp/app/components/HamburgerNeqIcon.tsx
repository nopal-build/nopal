// app/components/HamburgerNeqIcon.tsx

/**
 * Three horizontal lines that morph into a "≠"-style mark: the top and
 * bottom lines slide 3px toward the center (they read as the two bars of
 * "=", drawn closer together), and the middle line rotates -55deg to
 * become the diagonal slash. Purely presentational — pass `open` and
 * pair it with your own toggle state and click handler (e.g. wrap it in
 * a `<CircleButton>` or a plain `<button>`, see `AppLayout`'s mobile menu
 * trigger or the "14 · Icons" section of `fruits_.styles.tsx`).
 *
 * Drawn from three `div` lines (not an SVG) so each line's `transform`
 * can be transitioned independently. Uses `currentColor`, so it inherits
 * whatever text color the wrapping element sets — including dark mode,
 * as long as that color already flips (e.g. `purple-text`, or
 * `CircleButton`'s own `.circle-btn` color, both of which already have a
 * `prefers-color-scheme: dark` override in `root.css`).
 */
export function HamburgerNeqIcon({
  open,
  size = 24,
}: {
  open: boolean;
  size?: number;
}) {
  const lineStyle: React.CSSProperties = {
    position: "absolute",
    left: "3px",
    width: "18px",
    height: "2px",
    borderRadius: "1px",
    background: "currentColor",
    transition: "transform 250ms ease",
  };

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div
        style={{
          ...lineStyle,
          top: "5px",
          transform: `translateY(${open ? 3 : 0}px)`,
        }}
      />
      <div
        style={{
          ...lineStyle,
          top: "11px",
          transformOrigin: "center",
          transform: `rotate(${open ? -55 : 0}deg)`,
        }}
      />
      <div
        style={{
          ...lineStyle,
          top: "17px",
          transform: `translateY(${open ? -3 : 0}px)`,
        }}
      />
    </div>
  );
}
