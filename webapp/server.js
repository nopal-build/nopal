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

// ── Legacy redirects for routes that moved to the app service ───────────────
// Everything under the old /fruits/* prefix, every top-level auth-flow
// route, the public vault-sharing routes, and every /api/* endpoint
// except /api/health moved to the fruits app (o.nopal.build) -- see
// docs/marketing-app-split-plan.md. Old bookmarks, emails already sent
// with these links, and any not-yet-updated CLI install (see Phase 6 of
// that doc) still point at THIS host for these paths -- a 404 here would
// be a silent regression for every one of them, so this redirects to the
// equivalent path on the app instead. Placed before the static/Vite
// middleware so these never fall through to a real 404 page first.
//
// 308 (not 301/302): preserves the HTTP method and body on redirect,
// which matters here specifically because the CLI's own
// `POST /api/cli-auth/exchange` call (crates/core/src/auth.rs) is one of
// the things this list covers -- a 301/302 risks some HTTP clients
// silently downgrading a POST to a GET, which would break that call
// instead of transparently forwarding it.
const APP_BASE_URL_FOR_REDIRECTS = process.env.APP_BASE_URL || "https://o.nopal.build";
const MOVED_TOP_LEVEL_PATHS = new Set([
  "/login",
  "/login-error",
  "/logout",
  "/magic-link",
  "/verify",
  "/cli-login",
]);
const MOVED_PATH_PREFIXES = ["/welcome/", "/card/", "/public/file/", "/public/folder/"];

app.use((req, res, next) => {
  const path = req.path;

  let newPath = null;
  if (path === "/fruits" || path.startsWith("/fruits/")) {
    newPath = path.slice("/fruits".length) || "/";
  } else if (
    MOVED_TOP_LEVEL_PATHS.has(path) ||
    MOVED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    newPath = path;
  } else if (path.startsWith("/api/") && path !== "/api/health") {
    newPath = path;
  }

  if (newPath === null) return next();

  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex);
  res.redirect(308, `${APP_BASE_URL_FOR_REDIRECTS}${newPath}${query}`);
});

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
