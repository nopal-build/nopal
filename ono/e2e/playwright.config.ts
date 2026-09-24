import { defineConfig } from "@playwright/test";

// Port deliberately different from the manually-run dev servers documented
// in `oxmarkdown-editor/README.md` (4176 CSR, 4177 SSR) so this suite never
// collides with a server you already have running while testing by hand.
const PORT = 4178;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Rebuilds the wasm bundle from scratch, then serves it — see
  // `build-and-serve.sh`'s own comment for why this is a shell script
  // rather than an inline command.
  webServer: {
    command: "./build-and-serve.sh",
    cwd: __dirname,
    port: PORT,
    // The build itself (cargo + wasm-bindgen) can take a while on a cold
    // cache; the static file server only starts listening once it's done.
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
