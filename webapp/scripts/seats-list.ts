// Lists every project's members with their Sharing Role and seat
// (ADR-022), as `project_id<TAB>project<TAB>email<TAB>name<TAB>role<TAB>seat`.
// READ-ONLY. Run it, mark the clients and observers in the output, and
// feed the marked lines to `seats-set.ts`. Nothing here writes.
//
//   npx tsx scripts/seats-list.ts > seats.tsv
import { query } from "robustness-core/data/generic.server";
import { getHumansById } from "robustness-core/data/humans.server";
import { parseProjectSharing } from "robustness-core/data/project.types";
import { getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { ownerTierRoleNames } from "robustness-core/data/sharingRoles.server";

const ownerTier = await ownerTierRoleNames();

type Folder = { id: { id: string }; human_id: string; name: string; parent_folder_id: string };

const roots = await query<[{ id: { id: string } }[]]>(
  `SELECT id FROM vault_folders WHERE vault_root_key = "projects" AND (parent_folder_id = NONE OR parent_folder_id = NULL)`,
);
const rootIds = (roots?.[0] ?? []).map((r) => String(r.id.id));
const projects = await query<[Folder[]]>(
  `SELECT id, human_id, name, parent_folder_id FROM vault_folders WHERE parent_folder_id IN $rootIds ORDER BY name ASC`,
  { rootIds },
);

console.log(["project_id", "project", "email", "name", "role", "seat"].join("\t"));
for (const p of projects?.[0] ?? []) {
  const id = String(p.id.id);
  const readme = await getReadmeFileForFolder(p.human_id, id);
  const sharing = parseProjectSharing(readme?.content ?? "");
  const humans = new Map((await getHumansById([p.human_id, ...sharing.map((s) => s.human)])).map((h) => [h._id, h]));
  const owner = humans.get(p.human_id);
  console.log([id, p.name, owner?.email ?? p.human_id, owner?.name ?? "", "Owner (creator)", "guide"].join("\t"));
  for (const s of sharing) {
    const h = humans.get(s.human);
    console.log([id, p.name, h?.email ?? s.human, h?.name ?? "", s.role, s.seat ?? `${ownerTier.has(s.role) ? "guide" : "client"} (unmarked)`].join("\t"));
  }
}
process.exit(0);
