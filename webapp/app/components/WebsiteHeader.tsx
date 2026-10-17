// app/components/WebsiteHeader.tsx
//
// The `/v2` site's own header — the Nopal wordmark, `nav` (every ordinary
// link, always rendered in full), and an OPTIONAL, separate
// `featuredButton` rendered as its own `stamps/button.css` `callout`
// pill alongside it (NOT carved out of `nav` — see `WebsiteSettings`'s
// own doc comment in `website.server.ts` for why this is a dedicated
// `_site-settings.json` field rather than a "last item in `nav`"
// positional convention this component used to use). Below
// `breakpoints.navMax` (`stamps/tokens`, 859px) `nav` collapses behind a
// `HamburgerNeqIcon` toggle (the same glyph `AppLayout`'s own mobile nav
// uses) — `featuredButton`'s pill always stays visible, on every width,
// since it's the one link the site most wants a visitor to take.
//
// Lives in `webapp` only — unlike `websiteDirectives.tsx`/`WavyLine.tsx`/
// `website.css`, there's no `fruits`-side copy of this file to keep in
// sync. The Vault website-page editor's own live preview
// (`WebsitePageSplitEditor` in `fruits/app/routes/vault.tsx`) renders only
// a page's BODY (`WebsitePageView`/`OxRenderer`), never this surrounding
// site chrome — so this component only ever needs to exist here.
import { Link } from "react-router";
import { useState } from "react";
import nopalLogo from "../images/nopal-v2.svg";
import nopalDarkLogo from "../images/nopal-dark-v2.svg";
import { WebsiteLink, WEBSITE_ROOT } from "./WebsitePageView";
import { HamburgerNeqIcon } from "stamps/HamburgerNeqIcon";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import type { WebsiteLinkItem } from "robustness-core/data/website.server";

/** A `::button`-style CTA for the one nav item `WebsiteHeader` features —
 * same internal-vs-external distinction `WebsiteLink` makes, but styled as
 * a `stamps/button.css` `callout` pill instead of a plain nav link, since
 * this is meant to visually outweigh the rest of the nav. `size: "thin"`
 * keeps the pill's own horizontal rhythm but shrinks its vertical padding
 * to sit comfortably at nav-link height instead of towering over the rest
 * of the header. Not folded into `WebsiteLink` itself — that component's
 * whole job is picking between its existing nav/mobile/footer LINK
 * treatments, not a button look, and this is only ever used here. */
function FeaturedNavCta({ item }: { item: WebsiteLinkItem }) {
  const className = button({ variant: "callout", size: "thin" });
  const style = { textDecoration: "none" } as const;
  if (!item.to.startsWith("/")) {
    return (
      <a href={item.to} target="_blank" rel="noopener noreferrer" className={className} style={style}>
        {item.label}
      </a>
    );
  }
  return (
    <Link to={item.to} className={className} style={style}>
      {item.label}
    </Link>
  );
}

export function WebsiteHeader({
  nav,
  featuredButton,
}: {
  nav: WebsiteLinkItem[];
  featuredButton?: WebsiteLinkItem;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const logo = (
    <Link to={WEBSITE_ROOT} aria-label="Nopal home" className="website-header-logo">
      <picture>
        <source srcSet={nopalDarkLogo} media="(prefers-color-scheme: dark)" />
        <img src={nopalLogo} alt="Nopal" className="website-header-logo-img" />
      </picture>
    </Link>
  );

  return (
    <header className="website-header">
      {/* ===== Desktop bar (≥860px) ===== */}
      <div className="website-header-row website-header-row--desktop">
        {logo}
        {nav.length > 0 && (
          <nav className="website-header-links">
            {nav.map((item) => (
              <WebsiteLink key={item.to} item={item} variant="nav" />
            ))}
          </nav>
        )}
        {featuredButton && <FeaturedNavCta item={featuredButton} />}
      </div>

      {/* ===== Mobile bar + dropdown (≤859px) ===== */}
      <div className="website-header-row website-header-row--mobile">
        <div className="website-header-row-top">
          {logo}
          <div className={sprinkles({ display: "flex", alignItems: "center", gap: 3 })}>
            {featuredButton && <FeaturedNavCta item={featuredButton} />}
            {nav.length > 0 && (
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                className="website-header-toggle"
              >
                <HamburgerNeqIcon open={menuOpen} />
              </button>
            )}
          </div>
        </div>
        {menuOpen && nav.length > 0 && (
          <div className="website-header-dropdown">
            {nav.map((item) => (
              <WebsiteLink key={item.to} item={item} variant="mobile" onClick={closeMenu} />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
