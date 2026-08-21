import { reactRouter } from "@react-router/dev/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // vanillaExtractPlugin must run before reactRouter's own Vite plugin so
  // `.css.ts` files from `stamps` (or webapp's own future ones) are
  // compiled to real CSS before React Router's build sees them.
  plugins: [vanillaExtractPlugin(), reactRouter()],
  ssr: {
    // react-markdown, remark-gfm and rehype-raw are ESM-only packages.
    // Vite's SSR build must bundle them instead of externalising them.
    noExternal: ["react-markdown", "remark-gfm", "rehype-raw"],
  },
  test: {
    globals: true,
  },
});
