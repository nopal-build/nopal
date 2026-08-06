import { useEffect, useRef } from "react";

/**
 * Client-side mirror of `VaultChangeEvent` (`data/realtime.server.ts`) — kept
 * as a separate, hand-written type rather than importing the `.server.ts`
 * one directly, so this file stays safely importable from client bundles.
 */
export type VaultChangeEvent = {
  table: "file_refs" | "vault_folders";
  action: "CREATE" | "UPDATE" | "DELETE";
  id: string;
  humanId: string;
  folderId: string | null;
  name: string | null;
  contentType: string | null;
  archived: boolean;
  at: string;
};

// ─── Self-dedup ─────────────────────────────────────────────────────────────
// A mutation this browser TAB just made shows up moments later as an echo
// over its own `/api/events` connection. Nothing downstream should ever
// depend on that echo being suppressed for CORRECTNESS (every consumer of
// these events is expected to apply them as an idempotent upsert/removal by
// id) — this is purely to avoid a redundant, presentational reaction (e.g.
// an extra revalidate, a "new file" flash) firing for your own action.
//
// Any code performing a vault mutation calls `markOwnMutation(id)` right
// after a successful response, with the id the server just handed back;
// `useVaultEvents` consults (and clears) this before ever calling the
// caller's `onEvent`.

const OWN_MUTATION_TTL_MS = 15_000;
const ownMutations = new Map<string, number>();

export function markOwnMutation(id: string | null | undefined) {
  if (!id) return;
  ownMutations.set(id, Date.now() + OWN_MUTATION_TTL_MS);
}

function consumeOwnMutation(id: string): boolean {
  const expiresAt = ownMutations.get(id);
  if (expiresAt === undefined) return false;
  ownMutations.delete(id);
  return Date.now() < expiresAt;
}

/**
 * Subscribes to this human's real-time vault change feed for as long as the
 * calling component is mounted (`GET /api/events`, backed by SurrealDB's own
 * LIVE SELECT — see the `realtime.server.ts` header for the full design).
 * `EventSource` reconnects on its own; this hook doesn't try to replay
 * anything missed while disconnected — callers that care about eventual
 * consistency should revalidate on reconnect themselves, the same way the
 * Daily Log page already does for iOS's bfcache restore.
 */
export function useVaultEvents(onEvent: (event: VaultChangeEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/events");

    const handleChange = (message: MessageEvent<string>) => {
      let event: VaultChangeEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (consumeOwnMutation(event.id)) return;
      handlerRef.current(event);
    };

    source.addEventListener("vault-change", handleChange);
    return () => {
      source.removeEventListener("vault-change", handleChange);
      source.close();
    };
  }, []);
}
