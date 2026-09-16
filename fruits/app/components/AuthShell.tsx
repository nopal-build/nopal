// app/components/AuthShell.tsx
//
// Shared chrome for pages that appear before/without a session (login
// flow, and the public, unauthenticated vault-sharing pages) — replaces
// the `Layout`/`Footer` marketing chrome + `.scene1` hero art those pages
// used to borrow from webapp. That dependency was never appropriate here
// (this app has no reason to pull in webapp's CSS/images at all — see
// docs/marketing-app-split-plan.md), and broke outright once the two
// apps' asset pipelines actually separated (the `.scene1`/`.scene0*`
// background art in particular references image paths that only ever
// existed in webapp).
//
// Deliberately minimal: a centered logo (the same "no." mark
// `AppLayout` uses, for visual continuity with the page a successful
// login actually lands on) + a centered content column. No nav, no
// footer.
import { Link } from "react-router";
import type { ReactNode } from "react";
import { semanticColors } from "stamps/tokens";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { useSchemePref } from "../hooks/useSchemePref";
import noLogoColor from "../images/no-logo-color.svg";
import noLogoWhite from "../images/no-logo-white.svg";

export function AuthShell({
  title,
  maxWidth = "24rem",
  children,
}: {
  /** A plain string for most pages; a `ReactNode` (e.g. breadcrumb links)
   * for the public vault-sharing pages' folder-path headings. Omit
   * entirely for a page with no heading of its own. */
  title?: ReactNode;
  maxWidth?: string;
  children: ReactNode;
}) {
  const schemePref = useSchemePref();
  const isDark = schemePref === "dark";

  return (
    <div
      className={sprinkles({ display: "flex", flexDirection: "column", alignItems: "center" })}
      style={{ minHeight: "100vh", background: semanticColors.surfacePage }}
    >
      <div
        className={sprinkles({ px: 4, py: 12 })}
        style={{ width: "100%", maxWidth }}
      >
        <Link
          to="/"
          className={sprinkles({ display: "flex", justifyContent: "center", mb: 8 })}
        >
          <img src={isDark ? noLogoWhite : noLogoColor} alt="Nopal" style={{ height: "28px" }} />
        </Link>
        {title && (
          <h1
            className={`${textSize["3xl"]} ${sprinkles({ fontWeight: "bold", mb: 4 })}`}
            style={{ color: semanticColors.textBrand }}
          >
            {title}
          </h1>
        )}
        {children}
      </div>
    </div>
  );
}

/** Stamps-native replacement for the legacy `.red-text` class. */
export function AuthErrorText({ children }: { children: ReactNode }) {
  return <div style={{ color: semanticColors.textDanger }}>{children}</div>;
}
