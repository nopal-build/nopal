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

// Auth-adjacent endpoints: unauthenticated by design, so IP is the only
// signal available to slow down brute-force/credential-stuffing attempts.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  ...rateLimitHeaders,
  message: { error: "Too many attempts. Please wait a minute and try again." },
});
app.use(["/api/passkeys", "/api/cli-auth/exchange"], authLimiter);

// Uploads: each call costs S3 storage/transfer.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  ...rateLimitHeaders,
  message: { error: "Too many uploads. Please wait a bit and try again." },
});
app.use(
  [
    "/api/upload",
    "/api/daily-log/upload",
    "/api/vault/upload",
    "/api/vault/presign",
    "/api/vault/multipart-init",
    "/api/vault/multipart-part",
    "/api/vault/multipart-complete",
    "/api/upload/presign",
  ],
  uploadLimiter,
);

// Public, no-session forms: each submission triggers an email send (and, for
// the WC waiver, a permanent legal record) — worth throttling per IP.
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

/**
 * Milliseconds from right now until the next local midnight (00:00:00.000
 * of tomorrow if it's already past midnight today, effectively "tonight
 * at midnight" whenever this is called during the day). Used to anchor
 * GraphLog's scheduled-run cron to an actual wall-clock midnight, unlike
 * the other crons below which just repeat every 24h from server start.
 */
function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

httpServer.listen(3000, () => {
  console.log("App listening on http://localhost:3000");

  // ── Daily archive cleanup ─────────────────────────────────────────────────
  // Calls the protected cleanup endpoint once per day. Requires CRON_SECRET
  // to be set in the environment (fly secrets set CRON_SECRET=<value>).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const runArchiveCleanup = async () => {
      try {
        const res = await fetch(
          "http://localhost:3000/api/vault/archive-cleanup",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cronSecret}` },
          },
        );
        const data = await res.json();
        console.log("[cron] archive-cleanup:", data);
      } catch (err) {
        console.error("[cron] archive-cleanup failed:", err);
      }
    };
    // Wait 30 s for the server to warm up, then run once and repeat every 24 h.
    setTimeout(() => {
      runArchiveCleanup();
      setInterval(runArchiveCleanup, 24 * 60 * 60 * 1000);
    }, 30_000);

    // ── Trashed-project cleanup ────────────────────────────────────────────
    // Permanently deletes any project folder that's been sitting in
    // "Trashed" status for 30+ days (see the vault skill's Projects
    // section, and projectStatus.server.ts). Same CRON_SECRET, staggered a
    // little from the archive cleanup above.
    const runTrashCleanup = async () => {
      try {
        const res = await fetch(
          "http://localhost:3000/api/vault/trash-cleanup",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cronSecret}` },
          },
        );
        const data = await res.json();
        console.log("[cron] trash-cleanup:", data);
      } catch (err) {
        console.error("[cron] trash-cleanup failed:", err);
      }
    };
    setTimeout(() => {
      runTrashCleanup();
      setInterval(runTrashCleanup, 24 * 60 * 60 * 1000);
    }, 37_000);

    // ── Daily-log sort ────────────────────────────────────────────────────
    // Sorts every human's closed, not-yet-sorted daily logs (mentions →
    // project backlinks, completed Card tasks, Card file attachments —
    // see sorter.server.ts) into their Release Logs. Same CRON_SECRET,
    // same once-a-day cadence as the archive cleanup above — just
    // staggered a little so the two don't fire in the exact same tick.
    //
    // Temporary kill switch: only scheduled at all when SORTER_ENABLED is
    // "true" (see `isSorterEnabled` in `sorter.server.ts`) — the route
    // itself also checks this, but skipping the schedule entirely avoids
    // pointless daily log noise while the Sorter's next phase (real
    // project-folder filing) is being built out.
    if (process.env.SORTER_ENABLED === "true") {
      const runDailyLogSort = async () => {
        try {
          const res = await fetch(
            "http://localhost:3000/api/daily-log/sort-all",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${cronSecret}` },
            },
          );
          const data = await res.json();
          console.log("[cron] daily-log/sort-all:", data);
        } catch (err) {
          console.error("[cron] daily-log/sort-all failed:", err);
        }
      };
      setTimeout(() => {
        runDailyLogSort();
        setInterval(runDailyLogSort, 24 * 60 * 60 * 1000);
      }, 45_000);
    }

    // ── GraphLog scheduled run ─────────────────────────────────────────────
    // Runs GraphLog's full pipeline for every project/personal space an
    // Admin/Super has enrolled ("More Actions" → Enable GraphLog Schedule
    // in the Vault — see `graphLogSchedule.server.ts`). Same CRON_SECRET,
    // but anchored to actual local midnight rather than "once every 24h
    // from server start" like the crons above — the whole point of this
    // one is running overnight.
    const runGraphLogSchedule = async () => {
      try {
        const res = await fetch(
          "http://localhost:3000/api/graphlog/scheduled-run",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cronSecret}` },
          },
        );
        const data = await res.json();
        console.log("[cron] graphlog/scheduled-run:", data);
      } catch (err) {
        console.error("[cron] graphlog/scheduled-run failed:", err);
      }
    };
    setTimeout(() => {
      runGraphLogSchedule();
      setInterval(runGraphLogSchedule, 24 * 60 * 60 * 1000);
    }, msUntilNextMidnight());
  }
});
