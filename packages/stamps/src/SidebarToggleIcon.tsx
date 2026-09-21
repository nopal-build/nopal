// packages/stamps/src/SidebarToggleIcon.tsx
//
// The "open/close side panel" glyph — a rounded rectangle (the panel's
// own outline) split by a vertical divider, with a small arrow showing
// which way the panel will move. Ported from the Vault folder tree's two
// inline SVGs (fruits/app/routes/vault.tsx's `vault-sidebar-toggle`
// buttons — "Close folder tree" and "Open folder tree") so
// `DrawerContent`'s toggle uses the exact same icon Vault already
// established for this affordance.
//
// Unlike `HamburgerNeqIcon` (which animates a single icon between two
// states), the two `open` variants here are simply two different fixed
// icons — `DrawerContent` always uses `open` on its (mobile-only) close
// button and `open={false}` on its open button, never switching one
// icon's state dynamically the way `HamburgerNeqIcon` does.
export function SidebarToggleIcon({ open, size = 20 }: { open: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
      {open ? (
        <>
          <path d="M15 4v16" />
          <path d="M10 10l-2 2l2 2" />
        </>
      ) : (
        <>
          <path d="M9 4v16" />
          <path d="M14 10l2 2l-2 2" />
        </>
      )}
    </svg>
  );
}
