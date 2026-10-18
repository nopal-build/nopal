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

type MakerSubItem = { to: string; label: string };

/** The Maker's own sub-pages, gated the same way the Maker landing
 * page's own entry tiles/sections are (`maker.tsx`) -- "Manage" (Projects
 * and humans) is for anyone the Maker is shown to at all (staff or a
 * Guide); GraphLog/Performance/Stamps need Admin or Super; Admin
 * (Scripts) needs Super specifically. Shared between the desktop hover
 * dropdown and the mobile indented list below, so the two can never
 * silently drift apart. */
function makerSubItems(user: ReturnType<typeof useUser>): MakerSubItem[] {
  const items: MakerSubItem[] = [{ to: "/maker/projects", label: "Manage" }];
  if (permissions.isAdmin(user)) {
    items.push({ to: "/maker/graphlog", label: "GraphLog" });
    items.push({ to: "/maker/performance", label: "Performance" });
  }
  if (permissions.isSuper(user)) {
    items.push({ to: "/maker/scripts", label: "Admin" });
  }
  if (permissions.isAdmin(user)) {
    items.push({ to: "/maker/stamps", label: "Stamps" });
  }
  return items;
}

const navLinkFontClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

/**
 * Desktop topbar's "Maker" entry: still a real link (clicking it goes
 * straight to `/maker`), but hovering ANYWHERE over this wrapper --
 * including the dropdown panel itself, since it's a DOM descendant of
 * the same wrapper `mouseenter`/`mouseleave` are bound to, regardless of
 * its own `position: absolute` -- opens a panel listing the Maker's own
 * sub-pages. `onFocus`/`onBlur` open the same panel for keyboard nav,
 * closing only once focus genuinely leaves the whole wrapper (checked via
 * `relatedTarget`), not when it merely moves from the trigger to one of
 * the panel's own links.
 */
function MakerNavDropdown({ items }: { items: MakerSubItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <NavLink
        to="/maker"
        prefetch="intent"
        className={({ isActive }) =>
          `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
        }
      >
        Maker
      </NavLink>
      {open && items.length > 0 && (
        <div
          role="menu"
          aria-label="Maker"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            minWidth: "160px",
            background: "var(--farground)",
            border: "1px solid var(--midground)",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            padding: "6px",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              prefetch="intent"
              className={({ isActive }) =>
                `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
              }
              style={{ padding: "8px 10px", borderRadius: "6px", whiteSpace: "nowrap" }}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";
  const user = useUser();
  // The Maker is for admins and for anyone guiding a project (ADR-026);
  // `/maker` refuses everyone else on the server too.
  const guidesAProject = useMaker();
  const showMaker = permissions.isAdmin(user) || guidesAProject;
  const makerItems = showMaker ? makerSubItems(user) : [];
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
            {showMaker && <MakerNavDropdown items={makerItems} />}
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
                <>
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
                  {/* No hover on touch, so the Maker's own sub-pages are
                      just always-visible, indented entries right under
                      it -- same list `MakerNavDropdown` shows on desktop,
                      see `makerSubItems`. */}
                  <div
                    className={sprinkles({ display: "flex", flexDirection: "column" })}
                    style={{ paddingLeft: "20px" }}
                  >
                    {makerItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        prefetch="intent"
                        className={({ isActive }) =>
                          `${navLink({ context: "mobile", active: isActive })} ${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`
                        }
                        onClick={closeMenu}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </>
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
