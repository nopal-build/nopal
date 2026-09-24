import { reactRouter } from "@react-router/dev/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // vanillaExtractPlugin must run before reactRouter's own Vite plugin so
  // `.css.ts` files from `stamps` (or this app's own future ones) are
  // compiled to real CSS before React Router's build sees them.
  plugins: [vanillaExtractPlugin(), reactRouter()],
  server: {
    // Vite's dev server rejects requests for any Host header it doesn't
    // recognize (DNS rebinding protection) -- without this, the local
    // Caddy proxy (see repo-root Caddyfile / docker-compose.yml) fronting
    // this app at o.nopal.dev gets a 403 "Blocked request" for every
    // request, since the browser's Host header is `o.nopal.dev`, not
    // `localhost`.
    allowedHosts: ["o.nopal.dev", "nopal.dev"],
  },
  ssr: {
    // react-markdown, remark-gfm and rehype-raw are ESM-only packages.
    // Vite's SSR build must bundle them instead of externalising them.
    noExternal: ["react-markdown", "remark-gfm", "rehype-raw"],
    // CommonJS packages that reach this app only through the bundled
    // `robustness-core` source (its `attachmentFrames.server.ts`). Vite
    // externalises a dependency this package declares (`sharp`, `yaml`)
    // and INLINES one it does not, and an inlined CommonJS `ffmpeg-static`
    // reads `__dirname`, which an ES module does not have: the production
    // server crashed at boot with ERR_AMBIGUOUS_MODULE_SYNTAX on
    // 2026-09-22 while the dev server, which runs CommonJS through its own
    // module runner, never showed it. Declared in package.json too, so
    // they resolve from /app/node_modules in the pruned deploy image.
    external: ["ffmpeg-static", "heic-convert"],
  },
  test: {
    globals: true,
  },
});
