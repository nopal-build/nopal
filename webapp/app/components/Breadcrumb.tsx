// `GoodArrow` used to live in `GoodAssets.tsx` alongside a pile of other
// "Good" program assets -- inlined here directly once this was its only
// remaining consumer (the rest of that file, and the "Good" program pages
// that used it, were removed -- see garden/2-ready/website-switchover.md).
function GoodArrow() {
  return (
    <span className="good-arrow ml-2">
      <svg
        width="26"
        height="12"
        viewBox="0 0 26 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M24.4669 6.03131L19.7612 1.32566C18.4837 0.0481781 16.3013 0.985101 16.3477 2.79114L16.5122 9.20944C16.5573 10.9661 18.6833 11.8149 19.9258 10.5724L24.4669 6.03131ZM24.4669 6.03131C24.4669 6.03131 5.92127 6.07126 0.408142 6.03131"
          stroke="#7F5B8B"
        />
      </svg>
    </span>
  );
}

export function Breadcrumb({ children }: { children: React.ReactNode }) {
  return (
    <div className="breadcrumbs">
      <GoodArrow />
      {children}
    </div>
  );
}
