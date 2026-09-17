import type { LoaderFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { subscribeToVaultEvents, type VaultChangeEvent } from "robustness-core/data/realtime.server";

/**
 * GET /api/events
 *
 * Server-Sent Events stream of this signed-in human's own real-time vault
 * changes (a file or folder created, updated, archived, or deleted —
 * anywhere in their vault, driven by SurrealDB's own LIVE SELECT change
 * feed; see `data/realtime.server.ts`). One connection per browser tab
 * (`useVaultEvents`, `hooks/useVaultEvents.ts`) — SSE rather than a
 * WebSocket since nothing ever needs to flow the other direction, and
 * `EventSource` already reconnects on its own.
 *
 * Session-cookie auth only (no bearer support) — this is a browser-tab
 * feature, not something the CLI/API needs.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const encoder = new TextEncoder();
  // 25s: comfortably under every intermediary's typical idle-connection
  // timeout (Fly's proxy, most browsers) without sending needless traffic.
  const HEARTBEAT_MS = 25_000;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller already closed (client disconnected between the
          // event firing and this call) — nothing to do, cleanup below
          // handles unsubscribing.
        }
      };

      send("ready", { at: new Date().toISOString() });

      unsubscribe = subscribeToVaultEvents(user._id, (event: VaultChangeEvent) => {
        send("vault-change", event);
      });

      heartbeat = setInterval(() => {
        // A comment line: keeps the connection visibly alive through
        // proxies/idle timeouts without surfacing as a `message` event to
        // any `EventSource` listener.
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // See `send` above.
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Disable response buffering on nginx-style reverse proxies; a no-op
      // (but harmless) header everywhere else.
      "X-Accel-Buffering": "no",
    },
  });
}
