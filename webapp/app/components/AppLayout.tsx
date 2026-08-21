// app/components/AppLayout.tsx
import { Link, NavLink, useLocation } from "react-router";
import { ReactNode, useState, useCallback, useEffect } from "react";
import { useUser, permissions } from "../hooks/useUser";
import noLogoColor from "../images/no-logo-color.svg";
import noLogoWhite from "../images/no-logo-white.svg";
import { useSchemePref } from "../hooks/useSchemePref";
import { HamburgerNeqIcon } from "stamps/HamburgerNeqIcon";
import { navLink } from "stamps/navLink.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { colors, fonts } from "stamps/tokens";
import {
  main as mainClass,
  shell as shellClass,
  topbar,
  topbarLogo,
  topbarLogoImg,
  topbarNav,
  topbarProfile,
  topnav,
  topnavBar,
  topnavMenu,
} from "stamps/appLayoutShell.css";

const BANNER_HEIGHT = 40;

type ImpersonationStatus = {
  impersonating: boolean;
  adminName?: string;
  adminEmail?: string;
};

/**
 * Persistent notice shown on every page while an Admin/Super is "logged in
 * as" another human via the profile page's management menu. Deliberately
 * not wired through any route loader — there's no shared `/fruits` layout
 * loader, and every leaf route already independently calls `getUser`, so
 * threading impersonation state through all of them would touch dozens of
 * files. Instead this polls a tiny status endpoint on mount, which also
 * happens to be where the 1-day impersonation window actually gets
 * enforced (see `getImpersonationStatus` in `modules/auth/auth.server.ts`).
 */
function ImpersonationBanner({ targetName }: { targetName: string }) {
  const [status, setStatus] = useState<ImpersonationStatus | null>(null);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/impersonation-status")
      .then((res) => res.json())
      .then((json: ImpersonationStatus) => {
        if (!cancelled) setStatus(json);
      })
      .catch(() => {
        // Fail closed — no banner rather than a broken one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.impersonating) return null;

  async function handleReturn() {
    setReturning(true);
    try {
      await fetch("/api/admin/stop-impersonating", { method: "POST" });
    } finally {
      window.location.href = "/fruits/profile";
    }
  }

  return (
    <div
      className={sprinkles({
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        flexShrink: 0,
      })}
      style={{
        height: BANNER_HEIGHT,
        background: colors.yellow,
        color: colors.purple,
        fontSize: "13px", // between textSize.xs/sm — not on the scale, kept literal
        fontFamily: fonts.mono,
      }}
    >
      <span>
        Viewing as <strong>{targetName}</strong> — signed in as{" "}
        {status.adminName ?? status.adminEmail}
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={returning}
        className={`${textSize.xs} ${sprinkles({ py: 0.5, px: 2.5 })}`}
        style={{
          background: colors.purple,
          color: colors.yellow,
          border: "none",
          borderRadius: "4px",
          fontFamily: fonts.mono,
          cursor: returning ? "default" : "pointer",
        }}
      >
        {returning ? "Returning…" : "Return to admin"}
      </button>
    </div>
  );
}

function getCurrentSectionLabel(pathname: string): string {
  if (pathname.startsWith("/fruits/daily-log")) return "Daily Log";
  if (pathname.startsWith("/fruits/vault")) return "Vault";
  if (pathname.startsWith("/fruits/profile")) return "Profile";
  if (pathname.startsWith("/fruits/maker")) return "Maker";
  if (pathname.startsWith("/fruits/styles")) return "Stamps";
  return "Dashboard";
}

const navLinkFontClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

export function AppLayout({ children }: { children?: ReactNode }) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";
  const user = useUser();
  const isAdmin = permissions.isAdmin(user);
  const location = useLocation();
  const currentSectionLabel = getCurrentSectionLabel(location.pathname);

  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div
      className={sprinkles({ display: "flex", flexDirection: "column" })}
      style={{ height: "100vh" }}
    >
      {user && <ImpersonationBanner targetName={user.name || user.email} />}
      <div className={shellClass} style={{ height: "auto", flex: 1, minHeight: 0 }}>
        {/* ===== TOP NAV BAR (desktop ≥860px) ===== */}
        <header className={topbar}>
          <Link to="/" prefetch="intent" className={topbarLogo}>
            <img
              src={isDark ? noLogoWhite : noLogoColor}
              alt="no."
              className={topbarLogoImg}
            />
          </Link>

          <nav className={topbarNav}>
            <NavLink
              to="/fruits"
              prefetch="intent"
              end
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/fruits/daily-log"
              prefetch="intent"
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              Daily Log
            </NavLink>
            <NavLink
              to="/fruits/vault"
              prefetch="intent"
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              Vault
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/fruits/maker"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
                }
              >
                Maker
              </NavLink>
            )}
          </nav>

          <div className={topbarProfile}>
            <NavLink
              to="/fruits/profile"
              prefetch="intent"
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              Profile
            </NavLink>
          </div>
        </header>

        {/* ===== TOP NAV (mobile <860px) ===== */}
        <div className={topnav}>
          <div className={topnavBar}>
            <Link to="/fruits" prefetch="intent">
              <img
                src={isDark ? noLogoWhite : noLogoColor}
                alt="no."
                style={{ height: "20px", display: "block" }}
              />
            </Link>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className={`purple-text ${sprinkles({
                p: 1,
                display: "flex",
                alignItems: "center",
                gap: 2,
              })}`}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              <span className={navLinkFontClass}>{currentSectionLabel}</span>
              <HamburgerNeqIcon open={menuOpen} />
            </button>
          </div>

          {menuOpen && (
            <div className={topnavMenu}>
              <NavLink
                to="/fruits"
                prefetch="intent"
                end
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/fruits/daily-log"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                Daily Log
              </NavLink>
              <NavLink
                to="/fruits/vault"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                Vault
              </NavLink>
              {isAdmin && (
                <NavLink
                  to="/fruits/maker"
                  prefetch="intent"
                  className={({ isActive }) =>
                    `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                  }
                  onClick={closeMenu}
                >
                  Maker
                </NavLink>
              )}
              <NavLink
                to="/fruits/profile"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                Profile
              </NavLink>
            </div>
          )}
        </div>

        {/* ===== MAIN ===== */}
        <main className={mainClass}>{children}</main>
      </div>
    </div>
  );
}
