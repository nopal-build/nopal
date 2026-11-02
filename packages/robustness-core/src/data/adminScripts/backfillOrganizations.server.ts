// =============================================================================
// Admin script: Backfill Organizations (vault-organizations, Phase A).
//
// Organizations are new (garden/3-growing/organizations.md): exactly one
// exists, Nopal (`NOPAL_ORGANIZATION_ID`), and both "every Human is already
// a Nopal member" and "every project belongs to Nopal" are meant to be true
// from day one, not something a human opts into. For every Human created
// (and every project folder created) BEFORE this rollout, that still needs
// an actual row/stamp — new ones get it automatically now
// (`setOrganizationMemberRole` isn't called at Human-creation time yet,
// so this also covers new Humans until that's wired in; project folders ARE
// already stamped at creation by `createVaultFolder`).
//
// For every Human with no `organization_members` row on Nopal: adds one.
// Default role (Austin, 2026-11-02): platform `role` Super/Admin -> org
// role Guide; platform `role` Human -> org role Client. A rough default,
// meant to be hand-corrected afterward (direct DB edit — no org-management
// UI yet) for anyone it miscategorizes, e.g. a Human-platform-role Crafter.
//
// For every `projects/<name>` Vault folder (and its descendants, since
// `organization_id` denormalizes the same way `vault_root_key` already
// does) with no `organization_id`: stamps Nopal's.
//
// Idempotent — safe to re-run.
// =============================================================================

import { query, formatRecord, merge } from "../generic.server";
import { NOPAL_ORGANIZATION_ID, setOrganizationMemberRole, getOrganizationsForHuman } from "../organizations.server";
import type { Human } from "../humans.server";
import type { VaultFolder } from "../vault.types";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

const now = () => new Date().toISOString();

async function allHumans(): Promise<Human[]> {
  const result = await query<[Human[]]>(`SELECT * FROM humans`);
  return (result?.[0] ?? []).map(formatRecord);
}

async function projectFoldersMissingOrganization(): Promise<VaultFolder[]> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders WHERE vault_root_key = "projects"`,
  );
  return (result?.[0] ?? []).map(formatRecord).filter((f) => !f.organization_id);
}

function defaultRoleFor(human: Human): "Guide" | "Client" {
  return human.role === "Super" || human.role === "Admin" ? "Guide" : "Client";
}

export async function run({ dryRun, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const humans = await allHumans();
  log(`Checking ${humans.length} human(s) for Nopal org membership…${dryRun ? " (dry run)" : ""}`);

  let membersAdded = 0;
  for (const human of humans) {
    const memberships = await getOrganizationsForHuman(human._id);
    if (memberships.some((m) => m.organization_id === NOPAL_ORGANIZATION_ID)) continue;

    const role = defaultRoleFor(human);
    log(`  ${dryRun ? "would add" : "adding"} ${human.name ?? human.email} (${human._id}) to Nopal as ${role}`);
    if (!dryRun) await setOrganizationMemberRole(human._id, role);
    membersAdded++;
  }

  const folders = await projectFoldersMissingOrganization();
  log(`Found ${folders.length} project folder(s) with no organization_id.`);
  let foldersStamped = 0;
  for (const folder of folders) {
    log(`  ${dryRun ? "would stamp" : "stamping"} "${folder.name}" (${folder._id}) -> ${NOPAL_ORGANIZATION_ID}`);
    if (!dryRun) {
      await merge("vault_folders", folder._id, { organization_id: NOPAL_ORGANIZATION_ID, updated_at: now() });
    }
    foldersStamped++;
  }

  const summary = `${membersAdded} human(s) added to Nopal, ${foldersStamped} project folder(s) stamped.`;
  log(summary);
  return { summary };
}
