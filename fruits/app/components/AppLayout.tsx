// app/components/AppLayout.tsx
import { Link, NavLink, useLocation } from "react-router";
import { ReactNode, useState, useCallback, useEffect, useRef } from "react";
import { useHome, useMaker, useUser, useVaultHidden, permissions } from "../hooks/useUser";
import { displayName } from "robustness-core/data/humanNames";
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
 * not wired through any route loader — there's no shared root layout
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
      window.location.href = "/profile";
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
        Viewing as <strong>{targetName}</strong>, signed in as{" "}
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

function getCurrentSectionLabel(pathname: string, homeLabel: string): string {
  if (pathname.startsWith("/daily-log")) return "Daily Log";
  if (pathname.startsWith("/vault")) return "Vault";
  if (pathname.startsWith("/profile")) return "Profile";
  if (pathname.startsWith("/maker")) return "Maker";
  return homeLabel;
}

const navLinkFontClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

export function AppLayout({ children }: { children?: ReactNode }) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";
  const user = useUser();
  // The Maker is for admins and for anyone guiding a project (ADR-026);
  // `/maker` refuses everyone else on the server too.
  const guidesAProject = useMaker();
  const showMaker = permissions.isAdmin(user) || guidesAProject;
  // A client gets their project, the Daily Log and their account, nothing
  // else (ADR-023); `/vault` refuses them on the server too.
  const showVault = !useVaultHidden();
  const home = useHome();
  const homeTo = home.projectId ? `/newspaper/${home.projectId}` : "/";
  const homeLabel = home.plural ? "My Projects" : "My Project";
  const location = useLocation();
  const currentSectionLabel = getCurrentSectionLabel(location.pathname, homeLabel);

  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Words when they fit the window, the menu only when they don't
  // (Austin, 2026-10-01): a hidden copy of the topbar is measured at its
  // natural width on mount and on every resize, and the shell's
  // `data-nav` picks the bar (`appLayoutShell.css.ts`). Before the first
  // measurement the breakpoint decides.
  const measureRef = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<"words" | "menu" | null>(null);
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const decide = () => setNav(el.scrollWidth <= window.innerWidth ? "words" : "menu");
    decide();
    window.addEventListener("resize", decide);
    return () => window.removeEventListener("resize", decide);
  }, [showVault, showMaker, homeLabel]);
  useEffect(() => {
    if (nav === "words") setMenuOpen(false);
  }, [nav]);

  return (
    <div
      className={sprinkles({ display: "flex", flexDirection: "column" })}
      style={{ height: "100vh" }}
    >
      {user && <ImpersonationBanner targetName={displayName(user)} />}
      <div className={shellClass} style={{ height: "auto", flex: 1, minHeight: 0 }} data-nav={nav ?? undefined}>
        {/* The topbar's natural width, measured to choose words or menu.
            Same pieces and spacing as the narrow topbar, never seen. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          style={{
            // Fixed and zero-height so a phone never scrolls sideways to it;
            // scrollWidth still reports the row's full width.
            position: "fixed",
            top: 0,
            left: 0,
            height: 0,
            overflow: "hidden",
            visibility: "hidden",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 16px",
            width: "max-content",
            whiteSpace: "nowrap",
          }}
        >
          <img src={noLogoColor} alt="" className={topbarLogoImg} />
          <span className={topbarNav} style={{ margin: 0 }}>
            {["Daily Log", homeLabel, ...(showVault ? ["Vault"] : []), ...(showMaker ? ["Maker"] : [])].map((label) => (
              <span key={label} className={`${navLink({ context: "topbar" })} ${navLinkFontClass}`}>
                {label}
              </span>
            ))}
          </span>
          <span className={`${navLink({ context: "topbar" })} ${navLinkFontClass}`}>Profile</span>
        </div>
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
              to="/daily-log"
              prefetch="intent"
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              Daily Log
            </NavLink>
            <NavLink
              to={homeTo}
              prefetch="intent"
              end
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
            >
              {homeLabel}
            </NavLink>
            {showVault && (
              <NavLink
                to="/vault"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
                }
              >
                Vault
              </NavLink>
            )}
            {showMaker && (
              <NavLink
                to="/maker"
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
              to="/profile"
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
            <Link to="/" prefetch="intent">
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
                to="/daily-log"
                prefetch="intent"
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                Daily Log
              </NavLink>
              <NavLink
                to={homeTo}
                prefetch="intent"
                end
                className={({ isActive }) =>
                  `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                }
                onClick={closeMenu}
              >
                {homeLabel}
              </NavLink>
              {showVault && (
                <NavLink
                  to="/vault"
                  prefetch="intent"
                  className={({ isActive }) =>
                    `${navLink({ context: "mobile", active: isActive })} ${navLinkFontClass}`
                  }
                  onClick={closeMenu}
                >
                  Vault
                </NavLink>
              )}
              {showMaker && (
                <NavLink
                  to="/maker"
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
                to="/profile"
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
