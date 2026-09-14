import { createRequestHandler } from "@react-router/express";
import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";

const app = express();

// Trust the first proxy hop (Fly.io in prod). This makes req.ip reflect the
// real client IP from x-forwarded-for rather than the proxy's address.
app.set("trust proxy", 1);

app.use((req, _res, next) => {
  // Expose the resolved client IP as a custom header so React Router
  // action functions can read it from request.headers without importing Express.
  req.headers["x-real-ip"] = req.ip ?? req.socket.remoteAddress ?? "unknown";
  next();
});

const httpServer = createServer(app);

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? null
    : await import("vite").then((vite) =>
        vite.createServer({
          server: {
            middlewareMode: true,
            hmr: { server: httpServer },
          },
        }),
      );

app.use(
  viteDevServer ? viteDevServer.middlewares : express.static("build/client"),
);

// ── Rate limiting ────────────────────────────────────────────────────────────
// Placed AFTER the static-file middleware above, so requests for hashed
// JS/CSS/image assets (served directly by `express.static`/Vite and never
// reach here) don't eat into anyone's quota — only real page loads and API
// calls do. Keyed by IP (via `trust proxy` above, so this correctly reads
// the real client IP behind Fly's proxy rather than Fly's own address).
//
// Backed by in-memory counters, which is fine today (single Fly machine —
// see `min_machines_running`/no autoscaling in fly.toml). If this app ever
// runs multiple machines, swap the store for a shared one (e.g. Redis/
// Upstash via `rate-limit-redis`) so limits are enforced across instances.
const rateLimitHeaders = { standardHeaders: true, legacyHeaders: false };

// Broad safety net: protects the server/DB from being slammed by any one IP.
const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  ...rateLimitHeaders,
  message: { error: "Too many requests. Please slow down and try again shortly." },
});
app.use(generalLimiter);

// Public, no-session forms: each submission triggers an email send (and, for
// the WC waiver, a permanent legal record) — worth throttling per IP.
// (The auth-adjacent/upload limiters that used to live here moved to the
// fruits app along with the routes they guarded -- see
// docs/marketing-app-split-plan.md, Phase 3.)
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  ...rateLimitHeaders,
  message: { error: "Too many submissions. Please try again later." },
});
app.use(["/contact", "/docs/wc-waiver"], publicFormLimiter);

const build = viteDevServer
  ? () => viteDevServer.ssrLoadModule("virtual:react-router/server-build")
  : await import("./build/server/index.js");

app.all("*", createRequestHandler({ build }));

// The daily cron jobs (archive/trash cleanup, daily-log sort, GraphLog
// scheduled runs) that used to live here moved to the fruits app along
// with the vault/daily-log/graphlog routes they call -- see
// docs/marketing-app-split-plan.md, Phase 3.
httpServer.listen(3000, () => {
  console.log("App listening on http://localhost:3000");
});
