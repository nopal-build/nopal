import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  ssr: {
    // react-markdown, remark-gfm and rehype-raw are ESM-only packages.
    // Vite's SSR build must bundle them instead of externalising them.
    noExternal: ["react-markdown", "remark-gfm", "rehype-raw"],
  },
  test: {
    globals: true,
  },
});
