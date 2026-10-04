// app/routes/v2.tsx — layout route for the `/v2/*` prototype marketing
// site (see the `vault` skill's "website projects" section). Deliberately
// NOT a port of the existing marketing `Layout`/`Footer` — just enough
// chrome to prove the OxMarkdown-driven CMS pipeline out end to end.
// Styled entirely with `stamps` (sprinkles + tokens + navLink/link
// recipes) rather than a hand-rolled stylesheet — see the `stamps`
// component guide (`fruits/app/routes/styles.tsx`, the app's living style
// guide) for the full inventory. The header itself is its own component
// (`../components/WebsiteHeader.tsx`) — real logic (mobile menu state,
// rendering `settings.featuredButton` as its own pill CTA) that doesn't
// belong inline in a route module.
import { Outlet, useLoaderData, type LinksFunction } from "react-router";
import {
  getPrimaryWebsiteFolder,
  getWebsiteSettings,
  type WebsiteSettings,
} from "robustness-core/data/website.server";
import { WebsiteLink } from "../components/WebsitePageView";
import { WebsiteHeader } from "../components/WebsiteHeader";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import websiteStyles from "../styles/website.css?url";
import oxmarkdownStyles from "../styles/oxmarkdown.css?url";

// REAL BUG fixed here, found via a real repro (sampling a live
// `:::section-title{...}` heading's `getBoundingClientRect()` every 50ms
// right after a fresh navigation): unlike every OTHER route in this app
// (`about.tsx`, `health.tsx`, `explore.tsx`, `good.*.tsx`, ...) --  which
// all bring in their own route-specific CSS via a `?url` import + this
// exact `links()` export, producing a real render-blocking `<link>` in
// the SSR'd `<head>` -- `website.css`/`oxmarkdown.css` used to be pulled
// in only as a plain side-effect `import "../styles/website.css"` deep
// inside component files (`websiteDirectives.tsx`, `OxRenderer.tsx`, ...).
// In Vite's DEV server that CSS is instead injected by a `<style>` tag
// AFTER the browser downloads/parses/executes that component's own JS
// module -- unavoidably later than first paint on a fresh/cold
// navigation, so the SSR'd HTML briefly paints unstyled (no `flex`/
// `margin-left: auto` yet on `.website-section-title`, so its heading
// sits flush left) before snapping to its real, right-aligned position
// the instant that CSS lands -- the exact jump reported. This never
// showed up in the Vault preview (`fruits`) because that page is reached
// via an in-app SPA navigation, by which point the SAME CSS module
// (imported by an EARLIER route in that same session) had already been
// injected -- there's no observable gap there, just a warm cache, not a
// structurally different loading path. A real production BUILD also
// wouldn't show this (Vite extracts real CSS files there, referenced the
// same render-blocking way regardless), but dev is where this page
// actually gets previewed day to day, so it's still worth fixing this,
// the same way every sibling route already does.
// ORDER MATTERS: `oxmarkdown.css` FIRST, `website.css` SECOND -- several
// rules in each file target the exact same selector at EQUAL specificity
// (e.g. `.ox-content :is(h1...)  { margin: 0 }` vs. `.website-section-
// title :is(h1...) { margin: 0 0 8px auto }`), so whichever `<link>`
// lands LAST in the document wins any tie. This matches the ORIGINAL
// (pre-`links()`) load order every OTHER consumer of these two files
// still relies on -- `websiteDirectives.tsx`/`websiteStamps.tsx`/
// `websiteIcons.tsx` (fruits' copies, and webapp's before they were
// trimmed down to rely on this `links()` export instead) all import
// `OxRenderer` (which pulls in `oxmarkdown.css`) BEFORE their own later
// `import "../styles/website.css"` line, so `website.css`'s side effects
// always registered second/last. Getting this backwards here silently
// undid `.website-section-title`'s own `margin-left: auto` -- found via
// a real repro (a live heading's computed `marginLeft` reading `0px`
// instead of a real resolved pixel value, despite `text-align: right`
// -- a property `oxmarkdown.css` never touches -- still applying
// correctly), not just eyeballing a screenshot.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: oxmarkdownStyles },
  { rel: "stylesheet", href: websiteStyles },
];

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
    <div
      className={`website-page-bg ${sprinkles({ display: "flex", flexDirection: "column" })}`}
      style={{ minHeight: "100vh" }}
    >
      <WebsiteHeader nav={settings.nav} featuredButton={settings.featuredButton} />

      {/* Horizontal max-width/centering lives on `WebsitePageContent`
          (stamps) now, inside `WebsitePageView` -- shared with the Vault
          preview's own identical wrapper (see `website.css`'s
          `.website-page-content`). This `<main>` only owns the page-level
          VERTICAL rhythm above/below it. */}
      <main className={sprinkles({ flexGrow: 1 })} style={{ width: "100%", padding: "32px 0 64px" }}>
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
