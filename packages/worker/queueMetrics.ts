// queueMetrics.ts — exposes current BullMQ queue depths as a Prometheus
// `/metrics` endpoint, scraped by Fly's built-in custom-metrics support
// (see fly.toml's `[metrics]` section) into the SAME Fly-managed
// Prometheus `ops/grafana`'s dashboards already query — no separate
// metrics backend to run or pay for. See ops/grafana/README.md for the
// Grafana side (the "Nopal — At a Glance" dashboard's queue panel).
//
// Deliberately separate, READ-ONLY `Queue` handles (never `.add()`, only
// `.getJobCounts()`) rather than reusing worker.ts's own `Worker`
// instances — a `Worker` has no job-count API of its own, and keeping
// this module import-free of worker.ts avoids any risk of this ever
// accidentally affecting job processing.
import { Queue } from "bullmq";
import { createServer } from "node:http";
import { Registry, Gauge, Counter } from "@prometheus-io/client";
import { GRAPHLOG_QUEUE_NAME } from "robustness-core/data/graphLogQueue.server";
import { ADMIN_SCRIPTS_QUEUE_NAME } from "robustness-core/data/adminScriptsQueue.server";
import { MEDIA_QUEUE_NAME } from "robustness-core/data/mediaQueue.server";
import { PUBLIC_ZIP_QUEUE_NAME } from "robustness-core/data/publicZip.server";
import { LETTER_PDF_QUEUE_NAME } from "robustness-core/data/letterPdf.server";
import { LETTER_RECORDING_QUEUE_NAME } from "robustness-core/data/letterRecordingQueue.server";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9091);

const QUEUE_NAMES = [
  GRAPHLOG_QUEUE_NAME,
  ADMIN_SCRIPTS_QUEUE_NAME,
  MEDIA_QUEUE_NAME,
  PUBLIC_ZIP_QUEUE_NAME,
  LETTER_PDF_QUEUE_NAME,
  LETTER_RECORDING_QUEUE_NAME,
] as const;

const queues = QUEUE_NAMES.map((name) => new Queue(name, { connection: { url: REDIS_URL, maxRetriesPerRequest: null } }));

const registry = new Registry();

// A Gauge with a `collect()` callback is prom-client's documented pattern
// for "fetch the current value fresh on every scrape" rather than something
// code elsewhere increments/decrements over time -- exactly BullMQ's
// `getJobCounts()` shape. Every worker MACHINE reports the same counts
// (they all read the same Redis queues), so dashboard/alert queries should
// collapse across Fly's `instance` label with max()/sum() by (queue, state).
new Gauge({
  name: "bullmq_queue_jobs",
  help: "Current BullMQ job count per queue and state (waiting/active/delayed/failed).",
  labelNames: ["queue", "state"],
  registers: [registry],
  async collect() {
    await Promise.all(
      queues.map(async (queue) => {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
        for (const [state, count] of Object.entries(counts)) {
          this.set({ queue: queue.name, state }, count);
        }
      }),
    );
  },
});

// A Counter, unlike the Gauge above, is incremented at the MOMENT a job
// fails (see worker.ts's own `.on("failed", ...)` handlers) rather than
// polled from current queue state. The Gauge's "failed" state only ever
// shows today's total backlog of not-yet-retried failures -- it can't
// show WHEN failures happened, since `increase()` on a value that can also
// go down (a retry/cleanup removes a failed job) is meaningless. This is
// what the "Worker Queue Failed Jobs" dashboard panel's bar chart uses
// instead, via `increase(bullmq_job_failures_total[...])`.
const jobFailures = new Counter({
  name: "bullmq_job_failures_total",
  help: "Total BullMQ job failures observed by this worker process since it started (resets on restart/deploy, which is fine -- Prometheus's increase()/rate() handle counter resets correctly).",
  labelNames: ["queue"],
  registers: [registry],
});

/** Call from a Worker's own `.on("failed", ...)` handler -- see worker.ts. */
export function recordJobFailure(queueName: string): void {
  jobFailures.inc({ queue: queueName });
}

/** Starts the scrape endpoint Fly's `[metrics]` config (fly.toml) polls
 * every 15s. Internal-only -- this worker still has no public
 * `[http_service]`/listener of any kind otherwise. */
export function startQueueMetricsServer(): void {
  const server = createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    registry
      .metrics()
      .then((body) => {
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(body);
      })
      .catch((err: unknown) => {
        console.error("[worker] /metrics scrape failed:", err);
        res.writeHead(500).end(String(err));
      });
  });
  server.listen(METRICS_PORT, "0.0.0.0", () => {
    console.log(`[worker] Queue metrics listening on :${METRICS_PORT}/metrics.`);
  });
}
