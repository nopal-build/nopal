import { reactRouter } from "@react-router/dev/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // vanillaExtractPlugin must run before reactRouter's own Vite plugin so
  // `.css.ts` files from `stamps` (or webapp's own future ones) are
  // compiled to real CSS before React Router's build sees them.
  plugins: [vanillaExtractPlugin(), reactRouter()],
  server: {
    // Vite's dev server rejects requests for any Host header it doesn't
    // recognize (DNS rebinding protection) — without this, the local
    // Caddy proxy (see repo-root Caddyfile / docker-compose.yml) fronting
    // the app at these custom hostnames gets a 403 "Blocked request" for
    // every request, since the browser's Host header is `nopal.dev`/
    // `o.nopal.dev`, not `localhost`.
    allowedHosts: ["nopal.dev", "o.nopal.dev"],
  },
  ssr: {
    // react-markdown, remark-gfm and rehype-raw are ESM-only packages.
    // Vite's SSR build must bundle them instead of externalising them.
    noExternal: ["react-markdown", "remark-gfm", "rehype-raw"],
  },
  test: {
    globals: true,
  },
});
