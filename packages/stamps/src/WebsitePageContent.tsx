// packages/stamps/src/WebsitePageContent.tsx
import type { ReactNode } from "react";

/**
 * The shared "reading column" a rendered `/v2` website page's body sits
 * inside — used by BOTH the public renderer
 * (`webapp/app/components/WebsitePageView.tsx`) and the Vault website-page
 * editor's own live preview (`fruits/app/routes/vault.tsx`'s
 * `WebsitePageSplitEditor`), so the two stay visually and functionally
 * IDENTICAL without hand-copying this wrapper's own markup into both
 * places every time it changes.
 *
 * Deliberately just the wrapper `<div>` — not `OxRenderer` itself, and not
 * the website directive registry that builds a page's content. Both of
 * those stay duplicated, one full copy per app (see `OxRenderer.tsx`'s own
 * header comment for why: divergent editing-vs-read-only needs, and
 * independent per-app directive registries). This component only owns the
 * one piece that's safe and valuable to genuinely share: the max-width/
 * centering content shell, plus the container-query breakpoint a
 * `:::section{...}`'s own "grow full-bleed until the shell itself is
 * capped, then stop and round its corners" treatment keys off (see
 * `website.css`'s `.website-page-content`/`.website-section` — that CSS is
 * still duplicated by hand into each app's own stylesheet, like everything
 * else in that file, but every caller of THIS component is guaranteed to
 * reach it the exact same way, from the exact same className contract).
 *
 * `className` used with `.ox-content` (the two apps' own `OxRenderer`
 * output): pass `"website-page-ox"` (alongside `ox-no-heading-marks
 * ox-no-dots`) so the renderer contributes NO horizontal padding of its
 * own — this component's own 24px is the only inset, on both apps' pages
 * alike.
 */
export function WebsitePageContent({ children }: { children: ReactNode }) {
  return <div className="website-page-content">{children}</div>;
}
