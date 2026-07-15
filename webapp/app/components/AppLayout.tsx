// app/components/AppLayout.tsx
import { Link, NavLink } from "react-router";
import { ReactNode, useState, useCallback, useEffect } from "react";
import { useUser, permissions } from "../hooks/useUser";
import nopalLogo from "../images/nopal-v2.svg";
import nopalDarkLogo from "../images/nopal-dark-v2.svg";
import { useSchemePref } from "../hooks/useSchemePref";

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
      style={{
        height: BANNER_HEIGHT,
        background: "var(--yellow)",
        color: "var(--purple)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        fontSize: "13px",
        fontFamily: "monospace",
        flexShrink: 0,
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
        style={{
          background: "var(--purple)",
          color: "var(--yellow)",
          border: "none",
          borderRadius: "4px",
          padding: "2px 10px",
          fontSize: "12px",
          fontFamily: "monospace",
          cursor: returning ? "default" : "pointer",
        }}
      >
        {returning ? "Returning…" : "Return to admin"}
      </button>
    </div>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {open ? (
        <>
          <line x1="4" y1="4" x2="20" y2="20" />
          <line x1="20" y1="4" x2="4" y2="20" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-mono py-2 rounded block ${
    isActive ? "font-bold" : "purple-light-text"
  }`;

const navLinkStyle = ({ isActive }: { isActive: boolean }) =>
  ({
    ...(isActive
      ? {
          color: "var(--purple)",
          background: "var(--foreground)",
          paddingLeft: "8px",
        }
      : {}),
    textDecoration: "none",
    transition: "background 150ms, color 150ms",
  }) as React.CSSProperties;

export function AppLayout({ children }: { children?: ReactNode }) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";
  const user = useUser();
  const isSuper = permissions.isSuper(user);
  const isAdmin = permissions.isAdmin(user);

  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="flex flex-col" style={{ height: "100vh" }}>
      {user && <ImpersonationBanner targetName={user.name || user.email} />}
      <div
        className="app-layout"
        style={{ height: "auto", flex: 1, minHeight: 0 }}
      >
      {/* ===== SIDEBAR (desktop ≥860px) ===== */}
      <aside className="app-sidebar">
        <Link to="/" prefetch="intent">
          <img src={isDark ? nopalDarkLogo : nopalLogo} alt="nopal" />
        </Link>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <NavLink
            to="/fruits"
            prefetch="intent"
            end
            className={navLinkClass}
            style={navLinkStyle}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/fruits/daily-log"
            prefetch="intent"
            className={navLinkClass}
            style={navLinkStyle}
          >
            Daily Log
          </NavLink>
          <NavLink
            to="/fruits/vault"
            prefetch="intent"
            className={navLinkClass}
            style={navLinkStyle}
          >
            Vault
          </NavLink>
          {isSuper && (
            <NavLink
              to="/fruits/styles"
              prefetch="intent"
              className={navLinkClass}
              style={navLinkStyle}
            >
              Styles
            </NavLink>
          )}
        </nav>

        <div style={{ marginTop: "auto" }}>
          <NavLink
            to="/fruits/profile"
            prefetch="intent"
            className={navLinkClass}
            style={navLinkStyle}
          >
            Profile
          </NavLink>
        </div>
      </aside>

      {/* ===== TOP NAV (mobile <860px) ===== */}
      <div className="app-topnav">
        <div className="app-topnav-bar">
          <Link to="/fruits" prefetch="intent">
            <img
              src={isDark ? nopalDarkLogo : nopalLogo}
              alt="Nopal"
              style={{ width: "64px", display: "block" }}
            />
          </Link>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="purple-text"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <HamburgerIcon open={menuOpen} />
          </button>
        </div>

        {menuOpen && (
          <div className="app-topnav-menu">
            <NavLink
              to="/fruits"
              prefetch="intent"
              end
              className={navLinkClass}
              style={navLinkStyle}
              onClick={closeMenu}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/fruits/daily-log"
              prefetch="intent"
              className={navLinkClass}
              style={navLinkStyle}
              onClick={closeMenu}
            >
              Daily Log
            </NavLink>
            <NavLink
              to="/fruits/vault"
              prefetch="intent"
              className={navLinkClass}
              style={navLinkStyle}
              onClick={closeMenu}
            >
              Vault
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/fruits/styles"
                prefetch="intent"
                className={navLinkClass}
                style={navLinkStyle}
                onClick={closeMenu}
              >
                Styles
              </NavLink>
            )}
            <NavLink
              to="/fruits/profile"
              prefetch="intent"
              className={navLinkClass}
              style={navLinkStyle}
              onClick={closeMenu}
            >
              Profile
            </NavLink>
          </div>
        )}
      </div>

      {/* ===== MAIN ===== */}
      <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
