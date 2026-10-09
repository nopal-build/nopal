import { Link, NavLink } from "react-router";
import OxRenderer from "./OxRenderer";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import { navLink } from "stamps/navLink.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import type { WebsiteLinkItem, ResolvedWebsiteDailyLogEntry } from "robustness-core/data/website.server";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";

const navLinkFontClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

/** The `/v2` site's own root path — shared so a "Home" nav item (`to:
 * "/v2"`, same destination `WebsiteHeader`'s own logo link points at)
 * doesn't fall into `NavLink`'s default PREFIX matching below (which
 * would otherwise highlight it on every single page, since every other
 * page's path also starts with `"/v2"`). */
export const WEBSITE_ROOT = "/v2";

/** Strips a single trailing slash (but never the root `"/"` itself) —
 * the Vault's Site Settings editor is a free-text `to` field, and a real
 * entry was found stored as `"/v2/"` rather than `"/v2"` (both resolve to
 * the same route, but only ONE matches `WEBSITE_ROOT` by plain `===`). */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** A nav/footer link's `to` is either an internal path (`/v2/...`) or an
 * arbitrary external URL (`https://...`, `mailto:...`) — same distinction
 * the old marketing `Layout`/`Footer` already makes by hand between
 * `<NavLink>`/`<Link>` and plain `<a>`. `variant` picks which `stamps`
 * treatment applies: `"nav"` gets the same pill/active-highlight recipe
 * `stamps/navLink.css`) `AppLayout`'s own topbar uses; `"mobile"` is the
 * same recipe's `context: "mobile"` block-level treatment, for
 * `WebsiteHeader`'s own hamburger dropdown; `"footer"` gets the plainer
 * `stamps/link.css` treatment, since a footer reads as quiet reference
 * links, not primary navigation. Both `"nav"`/`"mobile"` pass
 * `tone: "website"` — the marketing site's own current-page highlight
 * reads as a vibrant brand-blue accent, not the app's quieter neutral
 * default (see `navLink.css.ts`'s own `tone` variant). `onClick` is
 * optional — `WebsiteHeader` uses it to close its mobile dropdown on
 * tap; nothing else needs it. */
export function WebsiteLink({
  item,
  variant = "footer",
  onClick,
}: {
  item: WebsiteLinkItem;
  variant?: "nav" | "mobile" | "footer";
  onClick?: () => void;
}) {
  if (!item.to.startsWith("/")) {
    return (
      <a
        href={item.to}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={
          variant === "footer"
            ? link
            : variant === "mobile"
              ? `${navLink({ context: "mobile", tone: "website" })} ${navLinkFontClass}`
              : undefined
        }
      >
        {item.label}
      </a>
    );
  }
  if (variant === "nav" || variant === "mobile") {
    const to = stripTrailingSlash(item.to);
    return (
      <NavLink
        to={to}
        end={to === WEBSITE_ROOT}
        onClick={onClick}
        className={({ isActive }) =>
          `${navLink({ context: variant === "mobile" ? "mobile" : "topbar", active: isActive, tone: "website" })} ${navLinkFontClass}`
        }
      >
        {item.label}
      </NavLink>
    );
  }
  return (
    <Link to={item.to} className={link} onClick={onClick}>
      {item.label}
    </Link>
  );
}

/**
 * Shared body for both `/v2` page routes (`routes/v2._index.tsx`,
 * `routes/v2.$.tsx`) — plain `OxRenderer` on the page's front-matter-
 * stripped body, plus a "Draft" banner when the viewer only sees it
 * because they have Vault access to the underlying file (see
 * `loadWebsitePage.server.ts`).
 */
export function WebsitePageView({
  body,
  isDraftPreview,
  dailyLogEntries = {},
  includes = {},
}: {
  body: string;
  isDraftPreview: boolean;
  /** See `oxmarkdown/websiteDirectives.tsx`'s `::daily-log{...}` entry --
   * resolved server-side (`loadWebsitePage.server.ts`), since rendering it
   * needs real vault/DB access `OxRenderer` never has on its own. Optional
   * only so existing callers that don't pass it (none today) don't break. */
  dailyLogEntries?: Record<string, ResolvedWebsiteDailyLogEntry>;
  /** See `oxmarkdown/websiteDirectives.tsx`'s `::include-ox{...}` entry --
   * same reasoning as `dailyLogEntries` (resolved server-side, needs real
   * vault/DB access). Optional for the same reason. */
  includes?: Record<string, string>;
}) {
  const directives = buildWebsiteDirectiveRegistry({ dailyLogEntries, includes });
  return (
    <WebsitePageContent>
      {isDraftPreview && (
        <Surface
          className={sprinkles({
            display: "flex",
            alignItems: "center",
            gap: 2,
            p: 3,
            mb: 6,
          })}
        >
          <Badge variant="warning">Draft</Badge>
          <span className={textSize.sm}>
            Not published — visible to you because you have access to this
            page in the Vault.
          </span>
        </Surface>
      )}
      {/* `ox-no-heading-marks` -- a published page isn't markdown source;
          a title shouldn't render with a literal `#` in front of it (see
          oxmarkdown.css). `ox-no-dots` -- the dot-grid background reads as
          an editing-surface affordance ("you're writing in a document"),
          not something a public marketing page should show; same
          treatment the Vault's own website-page preview already gets
          (`vault.tsx`'s `WebsitePageSplitEditor`). `website-page-ox` --
          this renderer contributes no horizontal padding of its own;
          `WebsitePageContent` (stamps) already owns that -- same
          className list the Vault preview's own `OxRenderer` uses, so the
          two stay identical (see `website.css`). */}
      <OxRenderer
        markdown={body}
        directives={directives}
        className="ox-no-heading-marks ox-no-dots website-page-ox"
      />
    </WebsitePageContent>
  );
}

/** Shared `<title>`/`<meta name="description">` builder for both `/v2` page
 * routes — a page with no `title` front matter falls back to a generic
 * site title rather than an empty `<title>`. */
export function buildWebsiteMeta(title: string | null, description: string | null) {
  return [
    { title: title ? `${title} | Nopal` : "Nopal" },
    ...(description ? [{ name: "description", content: description }] : []),
  ];
}
