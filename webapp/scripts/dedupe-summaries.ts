// One-off cleanup: removes duplicate `*-summary.md` files created by the
// concurrent-retry bug found while testing PhyLog's pre-capture stage
// (fixed: server.js's httpServer.setTimeout + the CLI client's request
// timeout). Keeps the OLDEST copy of each duplicated name per folder,
// deletes the rest.
//
// Run via: npx vite-node scripts/dedupe-summaries.ts <folderId>

import { listFolderChildren, deleteFileRef } from "../app/data/vault.server";
import { getHumanByEmail } from "../app/data/humans.server";

async function main() {
  const folderId = process.argv[2];
  if (!folderId) {
    console.error("Usage: dedupe-summaries.ts <folderId>");
    process.exit(1);
  }
  const human = await getHumanByEmail("gerald@nopal.build");
  if (!human) throw new Error("no human");

  const { files } = await listFolderChildren(human._id, folderId);
  const byName = new Map<string, typeof files>();
  for (const f of files) {
    if (!f.name.endsWith("-summary.md")) continue;
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }

  for (const [name, list] of byName) {
    if (list.length <= 1) continue;
    const sorted = [...list].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    const [, ...dupes] = sorted;
    for (const dupe of dupes) {
      console.log(`Deleting duplicate ${name} (${dupe._id})`);
      await deleteFileRef(dupe._id);
    }
  }
  console.log("Done.");
}

main().then(() => process.exit(0));
