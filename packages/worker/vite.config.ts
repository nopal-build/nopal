import { defineConfig } from "vite";

// `worker.ts` is run directly via `vite-node` (see package.json's "start"
// script), which uses Vite's own `.env` loading — by default relative to
// THIS package's directory. All of PhyLog's secrets (ANTHROPIC_API_KEY,
// DATABASE_*, S3_*, etc.) live in `webapp/.env` (see that file, and
// webapp's own `.env-example`) — there's deliberately only ONE `.env` for
// local dev, not a duplicate copy per package, so `envDir` points back at
// it instead.
export default defineConfig({
  envDir: "../../webapp",
});
