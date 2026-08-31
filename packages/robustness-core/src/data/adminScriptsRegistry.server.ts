// Admin Scripts registry — the list of repair/maintenance scripts runnable
// from /fruits/maker/scripts (Super only), executed by the worker process
// (`packages/worker/worker.ts`) on the "admin-scripts" BullMQ queue
// (`adminScriptsQueue.server.ts`), with every run's outcome recorded to
// `admin_script_runs` (`adminScriptRuns.server.ts`).
//
// Why this exists instead of `npx vite-node scripts/whatever.ts` against a
// `fly proxy` tunnel: the worker already runs in production with the real
// DB credentials as live Fly secrets, and already has queue/log
// infrastructure (built for GraphLog) for a job that might take a while.
// Promoting a script here means "click Run in the admin UI" instead of a
// human copying a prod password into their own terminal. One-off/local
// debugging scripts (and non-repair tools like `pull-daily-logs.ts` or
// `visual-check.ts`, which need a browser or pull data DOWN rather than
// repair it in place) can still live under `webapp/scripts/` — only
// scripts expected to be RE-RUN regularly against production are worth
// promoting here.
//
// Adding a new script:
//   1. Write `run(opts: AdminScriptRunOpts): Promise<AdminScriptResult>` in
//      its own file under `data/adminScripts/`, using `opts.log` for every
//      progress line (never `console.log` — see `types.ts`'s own doc) and
//      honoring `opts.dryRun` for every real write, even if the original
//      script never had a dry-run mode — the Run form always offers the
//      checkbox, so every registered script must actually respect it.
//   2. APPEND it to REGISTRY below (don't insert earlier in the list) —
//      /fruits/maker/scripts/new shows scripts newest-first, and "newest"
//      just means "closest to the end of this array". Reordering existing
//      entries would misrepresent when they were actually added.
//   3. Give it a stable `name` (also used as the BullMQ job name and the
//      audit row's `script_name` — never rename one without migrating the
//      other).
//
// Retiring a script: once its own drift is believed fully cleaned up (or
// the bug it repairs can no longer happen), don't delete it outright —
// set `deprecated: { reason }` instead. It's still runnable (a repair can
// resurface in data nobody's looked at in a while) but /scripts/new shows
// it de-emphasized, in its own section, with the reason visible. Only
// delete a script once you're confident NOTHING in production could still
// need it.

import { run as runRecascadeSharedWith } from "./adminScripts/recascadeSharedWith.server";
import { run as runRepairDuplicateSkillsFolders } from "./adminScripts/repairDuplicateSkillsFolders.server";
import { run as runDedupeDailyLogReadmes } from "./adminScripts/migrateDedupeDailyLogReadmes.server";
import { run as runMergeDuplicateVaultFolders } from "./adminScripts/migrateMergeDuplicateVaultFolders.server";
import { run as runBackfillSharingRoles } from "./adminScripts/migrateBackfillSharingRoles.server";
import { run as runSyncsSkillsToFolderTypes } from "./adminScripts/migrateSyncsSkillsToFolderTypes.server";
import { run as runVaultRootKeys } from "./adminScripts/migrateVaultRootKeys.server";
import { run as runBackfillSyncedDailyLogDates } from "./adminScripts/backfillSyncedDailyLogDates.server";
import { run as runReseedGraphlogSkills } from "./adminScripts/reseedGraphlogSkills.server";
import { run as runDedupeSummaries } from "./adminScripts/dedupeSummaries.server";
import type { AdminScriptDefinition } from "./adminScripts/types";

export type { AdminScriptDefinition, AdminScriptRunOpts, AdminScriptResult } from "./adminScripts/types";

// Chronological, oldest first — see this file's own module doc before
// reordering. `listAdminScripts` returns this as-is; callers that want
// newest-first (the Run page) reverse it themselves.
const REGISTRY: AdminScriptDefinition[] = [
  {
    name: "recascade-shared-with",
    label: "Re-cascade shared_with",
    description:
      "Repairs folders that lost shared_with when created inside an already-shared project (a lazily-provisioned Skills folder, a photos subfolder added after sharing, etc). Union-only (never removes access) and idempotent.",
    run: runRecascadeSharedWith,
  },
  {
    name: "repair-duplicate-skills-folders",
    label: "Repair duplicate Skills folders",
    description:
      "Deletes the auto-provisioned duplicate Skills folder on projects that ended up with two (from a since-fixed pull-daily-logs race), keeping the real one. Idempotent.",
    run: runRepairDuplicateSkillsFolders,
  },
  {
    name: "migrate-dedupe-daily-log-readmes",
    label: "Dedupe daily-log readme.md mirrors",
    description:
      "Run AFTER \"Merge duplicate vault folders\" — removes extra readme.md mirrors left in a now-canonical folder, keeping whichever copy matches the real daily_logs content. Idempotent.",
    run: runDedupeDailyLogReadmes,
  },
  {
    name: "migrate-merge-duplicate-vault-folders",
    label: "Merge duplicate vault folders",
    description:
      "Merges same-named sibling folders left behind by a since-fixed race in folder creation — oldest becomes canonical, others' children/files are reparented onto it, then the empty duplicate is deleted. Idempotent.",
    run: runMergeDuplicateVaultFolders,
  },
  {
    name: "migrate-backfill-sharing-roles",
    label: "Backfill missing Sharing Roles",
    description:
      "For humans with legacy shared_with view access but no entry in a project's Sharing Roles list, adds one at the least-privileged role — fixes \"can view but every owner-gated action 403s\". Idempotent.",
    run: runBackfillSharingRoles,
  },
  {
    name: "migrate-syncs-skills-to-folder-types",
    label: "Migrate stray skills/syncs roots",
    description:
      "Moves any leftover top-level skills/syncs folders (from before they became Vault Folder Types) under personal/, tagging folder_type on every descendant. Idempotent.",
    deprecated: {
      reason:
        "One-time migration for the skills/syncs → Vault Folder Type rollout. Every human created since should already be on the new shape — keep only as a safety net for stragglers.",
    },
    run: runSyncsSkillsToFolderTypes,
  },
  {
    name: "migrate-vault-root-keys",
    label: "Backfill vault root keys",
    description:
      "Ensures every human's Vault Root Folders (daily-logs/projects/personal) exist and are tagged, re-homes stray root-level folders/files under the right root, and propagates vault_root_key to every descendant. Idempotent.",
    deprecated: {
      reason:
        "One-time migration for the vault-v2 rollout. Every human created since already gets Vault Root Folders at creation — keep only as a safety net for pre-rollout accounts.",
    },
    run: runVaultRootKeys,
  },
  {
    name: "backfill-synced-daily-log-dates",
    label: "Backfill synced Daily Log dates",
    description:
      "Recovers a missing date on already-synced Daily Logs files (syncs/Daily Logs/) from the filename itself, so sync-graph can pick them up as candidates. Idempotent.",
    argLabel: "Project name (optional — leave blank to scan every project)",
    run: runBackfillSyncedDailyLogDates,
  },
  {
    name: "reseed-graphlog-skills",
    label: "Reseed GraphLog skill files",
    description:
      "Overwrites a project's skills/GRAPH.md, GRAPH_STRUCTURE.md, PROJECT_VIEW.md with the current defaults, but only when the existing file still matches a known previous default (never clobbers a hand-edited file). Idempotent.",
    argLabel: 'Project name (optional — defaults to "Nopal O.")',
    run: runReseedGraphlogSkills,
  },
  {
    name: "dedupe-summaries",
    label: "Dedupe *-summary.md files",
    description:
      "Removes duplicate *-summary.md files in one folder created by a since-fixed PhyLog concurrent-retry bug, keeping the oldest copy. Idempotent.",
    argLabel: "Folder id",
    argRequired: true,
    run: runDedupeSummaries,
  },
];

const BY_NAME = new Map(REGISTRY.map((script) => [script.name, script]));

/** Chronological, oldest first (registration order — see module doc). */
export function listAdminScripts(): AdminScriptDefinition[] {
  return REGISTRY;
}

export function getAdminScript(name: string): AdminScriptDefinition | undefined {
  return BY_NAME.get(name);
}
