// app/routes/v2.tsx — layout route for the `/v2/*` prototype marketing
// site (see the `vault` skill's "website projects" section). Deliberately
// NOT a port of the existing marketing `Layout`/`Footer` — just enough
// chrome to prove the OxMarkdown-driven CMS pipeline out end to end.
// Styled entirely with `stamps` (sprinkles + tokens + navLink/link
// recipes) rather than a hand-rolled stylesheet — see the `stamps`
// component guide (`fruits_.styles.tsx`) for the full inventory.
import { Link, Outlet, useLoaderData } from "react-router";
import {
  getPrimaryWebsiteFolder,
  getWebsiteSettings,
  type WebsiteSettings,
} from "robustness-core/data/website.server";
import { WebsiteLink } from "../components/WebsitePageView";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { colors, semanticColors } from "stamps/tokens";

const EMPTY_SETTINGS: WebsiteSettings = {
  nav: [],
  footer: { tagline: "", links: [], social: [] },
};

export async function loader() {
  const siteFolder = await getPrimaryWebsiteFolder();
  const settings = siteFolder ? await getWebsiteSettings(siteFolder) : EMPTY_SETTINGS;
  return { settings };
}

export default function V2Layout() {
  const { settings } = useLoaderData<typeof loader>();

  return (
    <div className={sprinkles({ display: "flex", flexDirection: "column" })} style={{ minHeight: "100vh" }}>
      <header
        className={sprinkles({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          px: 6,
          py: 4,
        })}
        style={{ borderBottom: `1px solid ${semanticColors.surfaceBorder}` }}
      >
        <Link
          to="/v2"
          className={sprinkles({ fontWeight: "bold" })}
          style={{ color: colors.purpleLight, textDecoration: "none", fontSize: "1.25rem" }}
        >
          Nopal
        </Link>
        {settings.nav.length > 0 && (
          <nav className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 1 })}>
            {settings.nav.map((item) => (
              <WebsiteLink key={item.to} item={item} variant="nav" />
            ))}
          </nav>
        )}
      </header>

      <main
        className={sprinkles({ flexGrow: 1 })}
        style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px" }}
      >
        <Outlet />
      </main>

      <footer
        className={sprinkles({ display: "flex", flexDirection: "column", gap: 3, p: 6 })}
        style={{ borderTop: `1px solid ${semanticColors.surfaceBorder}` }}
      >
        {settings.footer.tagline && (
          <p className={`${textSize.sm}`} style={{ color: semanticColors.textSubtle }}>
            {settings.footer.tagline}
          </p>
        )}
        {settings.footer.links.length > 0 && (
          <div className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 4 })}>
            {settings.footer.links.map((item) => (
              <WebsiteLink key={item.to} item={item} variant="footer" />
            ))}
          </div>
        )}
        {settings.footer.social.length > 0 && (
          <div className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 4 })}>
            {settings.footer.social.map((item) => (
              <WebsiteLink key={item.to} item={item} variant="footer" />
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
