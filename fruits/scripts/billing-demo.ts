// A project to click through billing by hand on the dev stack (payments
// seed, 2026-11-03). Pulled data has only real clients, so this makes a
// "Billing demo" project with austin@nopal.build (local admin_1) as Guide
// and a Demo Client who logs in by code through Mailpit. Run again, it
// finds what it made; `--remove` takes it all away, with its billing rows.
//
// From fruits/, with the dev stack up:
//   DATABASE_USERNAME=root DATABASE_PASSWORD=root npx vite-node scripts/billing-demo.ts [--remove]
import { RecordId } from "surrealdb";
import { query } from "robustness-core/data/generic.server";
import { createHuman, deleteHuman, getHumanByEmail, getHumanById, type Human } from "robustness-core/data/humans.server";
import { writeProjectSharing } from "robustness-core/data/projectSharing.server";
import {
  createVaultFolder,
  deleteVaultFolderCascade,
  ensureVaultRootFolders,
  listFolderChildren,
} from "robustness-core/data/vault.server";

const NAME = "Billing demo";
const CLIENT_EMAIL = "demo-client@example.com";
const APP = "http://localhost:3001";

async function main() {
  const guide = (await getHumanById("admin_1")) as Human;
  const root = (await ensureVaultRootFolders(guide._id)).find((r) => r.vault_root_key === "projects")!;
  const existing = (await listFolderChildren(guide._id, root._id)).folders.find((f) => f.name === NAME);
  const client = await getHumanByEmail(CLIENT_EMAIL);

  if (process.argv.includes("--remove")) {
    if (existing) {
      await query(`DELETE billing_charges WHERE project_folder_id = $f; DELETE $plan;`, {
        f: existing._id,
        plan: new RecordId("billing_plans", existing._id),
      });
      await deleteVaultFolderCascade(existing._id);
    }
    if (client) {
      await query(`DELETE $c`, { c: new RecordId("billing_customers", client._id) });
      await deleteHuman(client._id);
    }
    console.log("Removed the billing demo.");
    process.exit(0);
  }

  const demoClient = client ?? (await createHuman({ email: CLIENT_EMAIL, name: "Demo Client", role: "Human" }))!;
  const folder = existing ?? (await createVaultFolder({ human_id: guide._id, name: NAME, parent_folder_id: root._id }))!;
  await writeProjectSharing(folder, [
    { human: guide._id, role: "Guide" },
    { human: demoClient._id, role: "Client" },
  ]);
  console.log(`Billing demo ready.
  Guide (you):   ${APP}/maker/projects/${folder._id}
  Payments list: ${APP}/maker/payments
  Demo Client:   log in as ${CLIENT_EMAIL} in a private window; the code is in Mailpit (http://localhost:8025)
                 then ${APP}/profile#payments and ${APP}/newspaper/${folder._id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
