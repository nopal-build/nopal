// Shared types for the Admin Scripts registry (`adminScriptsRegistry.server.ts`).
// Kept in their own type-only file so an individual script module (e.g.
// `recascadeSharedWith.server.ts`) and the registry that lists it can each
// import these without importing EACH OTHER.

/** What a registered script's `run` is handed. Mirrors the `{ log }` shape
 * every GraphLog stage function already takes (`syncKnowledge.server.ts`
 * etc.) -- `log` is the ONLY way a script should report progress; never
 * `console.log` directly, since the worker forwards every `log` call both
 * to BullMQ's own `job.log()` (for live tailing while a run is in
 * progress) and into the run's permanent audit row (`adminScriptRuns.server.ts`),
 * which console output would never reach. */
export type AdminScriptRunOpts = {
  dryRun: boolean;
  /** Positional arguments from the UI's own single free-text field (see
   * `AdminScriptDefinition.argLabel` below) -- empty for a script that
   * takes none. */
  args: string[];
  log: (line: string) => void;
};

/** `summary` is the one-line result shown on the run's own history row
 * (e.g. "12 folder(s) repaired across 5 anchor(s)."), distinct from the
 * full `log` -- the audit trail keeps both. */
export type AdminScriptResult = {
  summary: string;
};

export type AdminScriptDefinition = {
  /** Stable id -- used as the BullMQ job name AND the audit row's
   * `script_name`, so never rename one without migrating the other. */
  name: string;
  label: string;
  description: string;
  /** If set, the Run form shows a single free-text input with this
   * label, and whatever's typed becomes `args[0]` (`args` stays `[]` if
   * left blank). `null`/omitted for a script that takes no argument at
   * all. */
  argLabel?: string;
  /** Whether the Run form blocks submission until the arg field is
   * non-empty -- e.g. a folder id a script can't infer on its own,
   * versus an optional project name that defaults to scanning everything. */
  argRequired?: boolean;
  /** Set when a script is believed to no longer be useful -- the drift it
   * repairs has been fully cleaned up, or was tied to a one-time rollout
   * that's long done -- but is being kept around rather than deleted
   * outright, in case it's ever needed again. Shown with a "Deprecated"
   * badge and moved into its own de-emphasized section on the Run page,
   * never hidden entirely -- an admin should still be able to see it and
   * why, and still run it if the judgment call above turns out wrong. */
  deprecated?: { reason: string };
  run: (opts: AdminScriptRunOpts) => Promise<AdminScriptResult>;
};
