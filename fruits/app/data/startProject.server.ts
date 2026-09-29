// app/data/startProject.server.ts
// Starting a project (ADR-026): the one path, whichever door it comes
// through (the Maker's form, the folder API for the CLI's `vault mkdir`).
// Who may: an admin, or someone already guiding one (`canStartProject`).
// A name, trimmed, and not one this person already has. The folder goes
// under their own `projects` root, where `createVaultFolder` makes it a
// project and seeds its Skills; they read as its Guide (`withCreator`)
// with nothing written to the README.
import { canStartProject } from "robustness-core/data/projectSharing.server";
import type { Human } from "robustness-core/data/humans.server";
import { createVaultFolder, ensureVaultRootFolders, listFolderChildren } from "robustness-core/data/vault.server";
import type { VaultFolder } from "robustness-core/data/vault.types";

export type StartProjectResult = { ok: true; folder: VaultFolder } | { ok: false; error: string; status: 400 | 403 | 409 | 500 };

export async function startProject(user: Pick<Human, "_id" | "role">, rawName: string): Promise<StartProjectResult> {
  if (!(await canStartProject(user))) return { ok: false, error: "Start a project in the Maker", status: 403 };
  const name = rawName.trim();
  if (!name) return { ok: false, error: "Give the project a name.", status: 400 };

  const root = (await ensureVaultRootFolders(user._id)).find((r) => r.vault_root_key === "projects");
  if (!root) return { ok: false, error: "Your Vault has no projects folder yet. Try again.", status: 500 };
  const { folders } = await listFolderChildren(user._id, root._id);
  if (folders.some((f) => f.name.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `You already have a project called "${name}".`, status: 409 };
  }
  const folder = await createVaultFolder({ human_id: user._id, name, parent_folder_id: root._id });
  if (!folder) return { ok: false, error: "The project didn't save. Try again.", status: 500 };
  return { ok: true, folder };
}
