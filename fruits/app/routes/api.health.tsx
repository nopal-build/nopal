import type { LoaderFunctionArgs } from "react-router";

/**
 * GET /api/health
 *
 * Deliberately dumb — no DB/CMS/S3 calls. Fly's health checks (see
 * `[[http_service.checks]]` in fly.toml) and the `bluegreen` deploy
 * strategy both poll this to decide whether a machine is fit to receive
 * traffic. If this depended on downstream services, a slow/degraded
 * Notion or SurrealDB call would make Fly think a perfectly healthy
 * webapp process is unhealthy and could block a deploy from ever
 * completing — "can this process serve an HTTP response" is the only
 * thing that should gate that.
 */
export async function loader(_: LoaderFunctionArgs) {
  return new Response("ok", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
