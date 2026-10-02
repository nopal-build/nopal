// packages/stamps/src/ExpandIcon.tsx
//
// "Expand to fullscreen" glyph -- two opposing corner-arrows on a
// diagonal, pointing outward. `currentColor`-based (same convention
// `SidebarToggleIcon`'s `stroke` uses) so callers set color via ordinary
// CSS `color` rather than a hardcoded fill baked into the SVG itself --
// the source SVG this was ported from used a literal `#7F5B8B`
// (`palette.plum[300]`), which callers should apply via `color` instead
// (e.g. `style={{ color: palette.plum[300] }}`) if they want that exact
// look.
export function ExpandIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7.77832 6.43706C8.11529 6.77419 8.1154 7.3208 7.77832 7.65786C7.44124 7.99493 6.89461 7.99482 6.55747 7.65786L4.39952 5.5C4.06239 5.16288 4.06239 4.61631 4.39952 4.2792C4.73665 3.94208 5.28324 3.94208 5.62037 4.2792L7.77832 6.43706Z"
        fill="currentColor"
      />
      <path
        d="M0 1C0 0.447715 0.447715 0 1 0H4.58579C5.47669 0 5.92286 1.07714 5.29289 1.70711L1.70711 5.29289C1.07714 5.92286 0 5.47669 0 4.58579V1Z"
        fill="currentColor"
      />
      <path
        d="M12 11C12 11.5523 11.5523 12 11 12H7.41421C6.52331 12 6.07714 10.9229 6.70711 10.2929L10.2929 6.70711C10.9229 6.07714 12 6.52331 12 7.41421V11Z"
        fill="currentColor"
      />
    </svg>
  );
}
