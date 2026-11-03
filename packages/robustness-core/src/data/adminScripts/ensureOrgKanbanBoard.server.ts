// =============================================================================
// Admin script: Ensure Org Kanban Board (guide-projects-phases, Piece 1).
//
// Provisions the one-time, per-ORGANIZATION (not per-human) vault
// structure the Guide-facing "All Projects" Kanban view is built on top
// of (garden/3-growing/guide-projects-phases.md):
//
//   org/                                -- new Vault Root, one per Organization
//     kanban-projects/                  -- a `kanban-garden` anchor
//       README.md                       -- defines the ordered phase list
//       seed/ discovery/ design/ done/  -- starter phase columns
//
// Unlike `projects`/`personal`/`daily-logs`, `org` is NOT auto-provisioned
// per human by `ensureVaultRootFolders` (see `PER_HUMAN_VAULT_ROOT_KEYS`,
// `vaultRoots.ts`) -- it's a SINGLETON per Organization, so it needs this
// explicit provisioning step instead of that per-human loop.
//
// Ownership: every `vault_folders` row needs a `human_id` -- there's no
// "system"/ownerless-folder concept anywhere in this codebase (checked;
// no precedent for one). The `org` root is therefore owned by whichever
// real Human's id is passed as this script's argument (an email), exactly
// like a project is "owned" by its creator today -- real WRITE access for
// every OTHER org Guide is meant to be granted by an org-role-aware check
// layered on top (Piece 3 of the seed), the same pattern Sharing Roles
// already use for projects (`getProjectRoleForFolderId`'s org-Guide
// fallback), not by this literal ownership. That access-control piece
// isn't built yet -- this script only lays down the folder structure.
//
// Idempotent -- safe to re-run. Reuses an existing `org` root / existing
// `kanban-garden` anchor under it if one is already there (e.g. a prior
// run that got partway through), rather than creating a duplicate; only
// truly no-ops once `organizations.kanban_folder_id` already points at a
// folder that still exists.
// =============================================================================

import { query, formatRecord } from "../generic.server";
import {
  createVaultFolder,
  createFileRef,
  getFolderById,
  type VaultFolder,
} from "../vault.server";
import {
  getOrganization,
  setOrganizationKanbanFolderId,
  NOPAL_ORGANIZATION_ID,
} from "../organizations.server";
import { getHumanByEmail } from "../humans.server";
import type { AdminScriptRunOpts, AdminScriptResult } from "./types";

const STARTER_PHASES = [
  { slug: "seed", name: "Seed", type: "start" },
  { slug: "discovery", name: "Discovery", type: "normal" },
  { slug: "design", name: "Design", type: "normal" },
  { slug: "done", name: "Done", type: "end" },
] as const;

function readmeContent(): string {
  const phasesYaml = STARTER_PHASES.map((p) => `  - name: ${p.name}\n    type: ${p.type}`).join("\n");
  return `---
title: Projects
phases:
${phasesYaml}
---

# Projects

Each phase above is a direct subfolder of this board, in order. Each
card is a lightweight markdown file (NOT the project itself) carrying
display info plus a \`project:\` front-matter field pointing at the real
project folder under \`projects/\`. Moving a project's phase means moving
its card file between these folders — see \`garden/3-growing/
guide-projects-phases.md\`.
`;
}

async function findExistingOrgRoot(organizationId: string): Promise<VaultFolder | undefined> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE vault_root_key = "org" AND organization_id = $organizationId AND parent_folder_id = null
     ORDER BY created_at ASC LIMIT 1`,
    { organizationId },
  );
  const [row] = (result?.[0] ?? []).map(formatRecord);
  return row;
}

async function findExistingAnchor(orgRootId: string): Promise<VaultFolder | undefined> {
  const result = await query<[VaultFolder[]]>(
    `SELECT * FROM vault_folders
     WHERE parent_folder_id = $orgRootId AND folder_type = "kanban-garden" AND is_folder_type_root = true
     ORDER BY created_at ASC LIMIT 1`,
    { orgRootId },
  );
  const [row] = (result?.[0] ?? []).map(formatRecord);
  return row;
}

export async function run({ dryRun, args, log }: AdminScriptRunOpts): Promise<AdminScriptResult> {
  const organizationId = NOPAL_ORGANIZATION_ID;
  const org = await getOrganization(organizationId);
  if (!org) return { summary: `No Organization found for "${organizationId}".` };

  if (org.kanban_folder_id) {
    const existing = await getFolderById(org.kanban_folder_id);
    if (existing) {
      return {
        summary: `Already provisioned — ${organizationId}.kanban_folder_id -> ${org.kanban_folder_id} ("${existing.name}"). Nothing to do.`,
      };
    }
    log(`  ! ${organizationId}.kanban_folder_id (${org.kanban_folder_id}) points at a folder that no longer exists — re-provisioning.`);
  }

  const ownerEmail = args[0]?.trim();
  if (!ownerEmail) {
    return {
      summary: "No owner email given — pass the email of the Human who should own the new org/kanban-projects folder.",
    };
  }
  const owner = await getHumanByEmail(ownerEmail);
  if (!owner) return { summary: `No Human found for email "${ownerEmail}".` };

  log(
    `${dryRun ? "Would provision" : "Provisioning"} org/kanban-projects for "${organizationId}", owned by ${owner.name ?? owner.email} (${owner._id})…`,
  );

  let orgRoot = await findExistingOrgRoot(organizationId);
  if (orgRoot) {
    log(`  org/ already exists (${orgRoot._id}) — reusing it.`);
  } else if (dryRun) {
    log("  would create org/");
  } else {
    const created = await createVaultFolder({
      human_id: owner._id,
      name: "org",
      parent_folder_id: null,
      vault_root_key: "org",
      organization_id: organizationId,
    });
    if (!created) return { summary: "Failed to create the org/ root folder." };
    orgRoot = created;
    log(`  created org/ (${orgRoot._id})`);
  }

  if (dryRun) {
    return {
      summary: `Dry run — would ensure org/kanban-projects/ (owner ${owner.email}) and set ${organizationId}.kanban_folder_id.`,
    };
  }
  if (!orgRoot) return { summary: "Failed to resolve the org/ root folder." };

  let anchor = await findExistingAnchor(orgRoot._id);
  if (anchor) {
    log(`  org/kanban-projects/ already exists (${anchor._id}) — reusing it.`);
  } else {
    const created = await createVaultFolder({
      human_id: owner._id,
      name: "kanban-projects",
      parent_folder_id: orgRoot._id,
      folder_type: "kanban-garden",
      organization_id: organizationId,
    });
    if (!created) return { summary: "Failed to create org/kanban-projects/." };
    anchor = created;
    log(`  created org/kanban-projects/ (${anchor._id})`);

    const readme = await createFileRef({
      human_id: owner._id,
      name: "README.md",
      content: readmeContent(),
      content_type: "text/markdown",
      folder_id: anchor._id,
    });
    log(readme ? "  created org/kanban-projects/README.md" : "  ! failed to create org/kanban-projects/README.md");

    for (const phase of STARTER_PHASES) {
      const folder = await createVaultFolder({
        human_id: owner._id,
        name: phase.slug,
        parent_folder_id: anchor._id,
        organization_id: organizationId,
      });
      log(
        folder
          ? `  created org/kanban-projects/${phase.slug}/ (${phase.name}, ${phase.type})`
          : `  ! failed to create org/kanban-projects/${phase.slug}/`,
      );
    }
  }

  await setOrganizationKanbanFolderId(anchor._id, organizationId);
  log(`  set ${organizationId}.kanban_folder_id -> ${anchor._id}`);

  return {
    summary: `Provisioned org/kanban-projects/ (${anchor._id}) for "${organizationId}", owned by ${owner.email}.`,
  };
}
