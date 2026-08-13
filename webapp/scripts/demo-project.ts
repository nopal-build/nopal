// =============================================================================
// One-off demo: creates a sample project folder with a manifest-driven
// README.md so the `/fruits/newspaper/:folderId` view has something real to
// render. Exercises all 3 directive forms (text/leaf/container) — see
// `app/util/nopalDirectives.ts`. Safe to re-run — deletes and recreates the
// demo folder each time.
//
// Run via: npx vite-node scripts/demo-project.ts [email]
// (defaults to gerald@nopal.build; DB/S3 connection comes from the same
// env/defaults as `npm run seed:data`.)
// =============================================================================

import { getHumanByEmail } from "robustness-core/data/humans.server";
import {
  createFileRef,
  createVaultFolder,
  deleteVaultFolderCascade,
  ensureVaultRootFolders,
  listFolderChildren,
} from "robustness-core/data/vault.server";
import { uploadPrivateFileToS3, getFileContentType } from "robustness-core/data/file.server";
import { PROJECT_CSV_NAME, serializeCsvFields } from "robustness-core/util/projectCsv";

const PROJECT_NAME = "Casa Verde Remodel";

const README_MD = `---
title: Casa Verde Remodel
type: client-deliverable
layout: grid
---

# Casa Verde Remodel

Full kitchen and primary bath remodel for the Verde family. Scope covers
demo, framing, electrical/plumbing rough-in, cabinetry, and finish work.

**Client:** :csv-key{key="name"} · **Location:** :csv-key{key="location"} · **Status:** :csv-key{key="status"}

## Latest update

Framing inspection passed. Cabinet order confirmed for delivery in three
weeks. Waiting on tile selection before finish carpentry can start.

:::note{title="Heads up"}
Tile selection is the long pole right now — client walkthrough is booked for next Tuesday.
:::

::csv-table{file="budget.csv" title="Budget"}

::gallery{folder="photos" title="Progress Photos" size="half"}

::svg{file="floorplan.svg" title="Floor Plan" size="half"}
`;

const PROJECT_CSV = serializeCsvFields([
  { key: "name", value: "Verde family" },
  { key: "location", value: "142 Calle Verde" },
  { key: "status", value: "in-progress" },
]);

const BUDGET_CSV = `Category,Budgeted,Spent
Demo,4500,4500
Framing,8200,7900
Electrical,6100,3200
Plumbing,5400,2800
Cabinetry,14000,0
Tile & Finish,9800,0
Permits,1200,1200
`;

function floorplanSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect x="10" y="10" width="380" height="280" fill="none" stroke="#3f2b46" stroke-width="4"/>
  <line x1="200" y1="10" x2="200" y2="150" stroke="#3f2b46" stroke-width="3"/>
  <line x1="10" y1="150" x2="400" y2="150" stroke="#3f2b46" stroke-width="3"/>
  <text x="30" y="90" font-size="16" fill="#3f2b46">Kitchen</text>
  <text x="230" y="90" font-size="16" fill="#3f2b46">Primary Bath</text>
  <text x="30" y="220" font-size="16" fill="#3f2b46">Living Room</text>
</svg>`;
}

function photoSvg(label: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="${color}"/>
  <text x="50%" y="50%" font-size="28" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>`;
}

async function uploadSvg(
  humanId: string,
  folderId: string,
  name: string,
  svg: string,
): Promise<void> {
  const s3Key = `vault/${humanId}/${folderId}/${Date.now()}-${name}`;
  const contentType = getFileContentType(name);
  const buffer = Buffer.from(svg, "utf-8");
  const s3Url = await uploadPrivateFileToS3(buffer, s3Key);
  await createFileRef({
    human_id: humanId,
    name,
    s3_url: s3Url,
    s3_key: s3Key,
    content_type: contentType,
    folder_id: folderId,
    size: buffer.byteLength,
  });
}

async function main() {
  const email = process.argv[2] ?? "gerald@nopal.build";
  const human = await getHumanByEmail(email);
  if (!human) {
    console.error(`No human found for ${email}`);
    process.exit(1);
  }
  console.log(`Seeding demo project for ${human.name} (${human._id})…`);

  const roots = await ensureVaultRootFolders(human._id);
  const projectsRoot = roots.find((r) => r.vault_root_key === "projects");
  if (!projectsRoot) throw new Error("projects root folder missing");

  // Idempotent: wipe any previous run's demo folder first.
  const existingChildren = await listFolderChildren(human._id, projectsRoot._id);
  const existing = existingChildren.folders.find((f) => f.name === PROJECT_NAME);
  if (existing) {
    console.log(`Removing existing "${PROJECT_NAME}"…`);
    await deleteVaultFolderCascade(existing._id);
  }

  const project = await createVaultFolder({
    human_id: human._id,
    name: PROJECT_NAME,
    parent_folder_id: projectsRoot._id,
  });
  if (!project) throw new Error("failed to create project folder");
  console.log(`Created folder "${project.name}" (${project._id})`);

  const photos = await createVaultFolder({
    human_id: human._id,
    name: "photos",
    parent_folder_id: project._id,
  });
  if (!photos) throw new Error("failed to create photos folder");

  await createFileRef({
    human_id: human._id,
    name: "README.md",
    content: README_MD,
    content_type: "text/markdown",
    folder_id: project._id,
  });
  await createFileRef({
    human_id: human._id,
    name: PROJECT_CSV_NAME,
    content: PROJECT_CSV,
    content_type: "text/csv",
    folder_id: project._id,
  });
  await createFileRef({
    human_id: human._id,
    name: "budget.csv",
    content: BUDGET_CSV,
    content_type: "text/csv",
    folder_id: project._id,
  });
  await uploadSvg(human._id, project._id, "floorplan.svg", floorplanSvg());
  await uploadSvg(human._id, photos._id, "demo-1.svg", photoSvg("Demo day", "#c0533e"));
  await uploadSvg(human._id, photos._id, "demo-2.svg", photoSvg("Framing done", "#3f7f5c"));

  console.log(`\n✓ Done. Visit /fruits/newspaper/${project._id} (as ${email}).`);
}

main().catch((err) => {
  console.error("Demo project seed failed:", err);
  process.exit(1);
});
