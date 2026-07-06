import { createRequestHandler } from "@react-router/express";
import express from "express";
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

const build = viteDevServer
  ? () => viteDevServer.ssrLoadModule("virtual:react-router/server-build")
  : await import("./build/server/index.js");

app.all("*", createRequestHandler({ build }));

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
  }
});
