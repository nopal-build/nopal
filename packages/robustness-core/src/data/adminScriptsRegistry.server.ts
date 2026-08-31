// Admin Scripts registry — the list of repair/maintenance scripts runnable
// from /fruits/maker/scripts (Admin/Super only), executed by the worker
// process (`packages/worker/worker.ts`) on the "admin-scripts" BullMQ queue
// (`adminScriptsQueue.server.ts`), with every run's outcome recorded to
// `admin_script_runs` (`adminScriptRuns.server.ts`).
//
// Why this exists instead of `npx vite-node scripts/whatever.ts` against a
// `fly proxy` tunnel: the worker already runs in production with the real
// DB credentials as live Fly secrets, and already has queue/log
// infrastructure (built for GraphLog) for a job that might take a while.
// Promoting a script here means "click Run in the admin UI" instead of a
// human copying a prod password into their own terminal. One-off/local
// debugging scripts can still live under `webapp/scripts/` — only ones
// expected to be RE-RUN regularly are worth promoting.
//
// Adding a new script:
//   1. Write `run(opts: AdminScriptRunOpts): Promise<AdminScriptResult>` in
//      its own file under `data/adminScripts/`, using `opts.log` for every
//      progress line (never `console.log` — see `types.ts`'s own doc).
//   2. Add it to REGISTRY below with a stable `name` (also used as the
//      BullMQ job name and the audit row's `script_name` — never rename
//      one without migrating the other).

import { run as runRecascadeSharedWith } from "./adminScripts/recascadeSharedWith.server";
import type { AdminScriptDefinition } from "./adminScripts/types";

export type { AdminScriptDefinition, AdminScriptRunOpts, AdminScriptResult } from "./adminScripts/types";

const REGISTRY: AdminScriptDefinition[] = [
  {
    name: "recascade-shared-with",
    label: "Re-cascade shared_with",
    description:
      "Repairs folders that lost shared_with when created inside an already-shared project (a lazily-provisioned Skills folder, a photos subfolder added after sharing, etc). Union-only (never removes access) and idempotent — safe to re-run.",
    run: runRecascadeSharedWith,
  },
];

const BY_NAME = new Map(REGISTRY.map((script) => [script.name, script]));

export function listAdminScripts(): AdminScriptDefinition[] {
  return REGISTRY;
}

export function getAdminScript(name: string): AdminScriptDefinition | undefined {
  return BY_NAME.get(name);
}
