import { Link, NavLink } from "react-router";
import OxRenderer from "./OxRenderer";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { navLink } from "stamps/navLink.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import type { WebsiteLinkItem } from "robustness-core/data/website.server";

const navLinkFontClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

/** A nav/footer link's `to` is either an internal path (`/v2/...`) or an
 * arbitrary external URL (`https://...`, `mailto:...`) — same distinction
 * the old marketing `Layout`/`Footer` already makes by hand between
 * `<NavLink>`/`<Link>` and plain `<a>`. `variant` picks which `stamps`
 * treatment applies: `"nav"` gets the same pill/active-highlight recipe
 * (`stamps/navLink.css`) `AppLayout`'s own topbar uses; `"footer"` gets the
 * plainer `stamps/link.css` treatment, since a footer reads as quiet
 * reference links, not primary navigation. */
export function WebsiteLink({
  item,
  variant = "footer",
}: {
  item: WebsiteLinkItem;
  variant?: "nav" | "footer";
}) {
  if (!item.to.startsWith("/")) {
    return (
      <a
        href={item.to}
        target="_blank"
        rel="noopener noreferrer"
        className={variant === "footer" ? link : undefined}
      >
        {item.label}
      </a>
    );
  }
  if (variant === "nav") {
    return (
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          `${navLink({ context: "topbar", active: isActive })} ${navLinkFontClass}`
        }
      >
        {item.label}
      </NavLink>
    );
  }
  return (
    <Link to={item.to} className={link}>
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
}: {
  body: string;
  isDraftPreview: boolean;
}) {
  return (
    <>
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
      <OxRenderer markdown={body} />
    </>
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
