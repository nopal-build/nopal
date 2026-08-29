/**
 * `nopal graphlog reset` and its three narrower siblings — GraphLog's own
 * "start over" operations (see the `graphlog` skill): destructive,
 * explicit, never run implicitly by anything else, so a human can
 * inspect the emptied-out state before re-running the pipeline. Split
 * into THREE independent depths, since GraphLog has three separate
 * kinds of generated content worth being able to wipe on their own:
 *
 *   - `resetProjectView` — deletes every direct child of the project
 *     folder EXCEPT `skills`/`syncs`/`graph` (and clears `README.md`'s
 *     BODY, front matter preserved, since Sharing Roles and lifecycle
 *     `status` live ONLY in that front matter), then clears
 *     `graph-project-view`'s `appliedByProjectView` marker off
 *     `graph-structure.md`'s front matter. In practice this project
 *     folder shape means there's rarely anything else TO delete here yet
 *     — this exists mainly to clear a stale README body and catch
 *     anything unexpected left at the root. That last marker step is not
 *     bookkeeping: it's the difference between a view that rebuilds on
 *     the next run and one that stays empty indefinitely. See the step
 *     itself for the mechanism.
 *   - `resetGraph` — deletes the `Graph` space folder outright (every
 *     `graph-log-*.md` file AND `graph-structure.md`, so both
 *     `graph-structure`'s own `asOfGraphHash` and `graph-project-view`'s
 *     `appliedByProjectView` marker — co-located on that same file, see
 *     `graphStructure.server.ts` — go with it). A fresh `sync-graph` run
 *     afterward regenerates every day from scratch (nothing left to
 *     compare an aggregate hash against).
 *   - `resetKnowledge` — deletes every `_knowledge/` sidecar folder
 *     nested anywhere under `syncs/` (see `syncKnowledge.server.ts`'s own
 *     `KNOWLEDGE_FOLDER_NAME` doc for the "one per source folder" shape).
 *     A fresh `sync-knowledge` run afterward regenerates every sidecar
 *     from scratch.
 *
 * `resetProjectAll` (`nopal graphlog reset`) simply runs all three, in
 * the order above — project-view first (so `graph`/`syncs` are still
 * there to be reset next), then `graph`, then `knowledge` (nested inside
 * whatever's left of `syncs`).
 *
 * Deliberately container-type-agnostic, same as every other GraphLog
 * stage (`dailyLogSync.server.ts`, `syncKnowledge.server.ts`, ...) — a
 * plain folder is enough, no `resolveProjectN02` call here. Deterministic
 * and free (no LLM calls), so unlike the agentic stages these never
 * return an `{ ok: false, error }` shape — a missing project folder is a
 * hard `throw`, same convention `dailyLogSync.server.ts`'s
 * `runDailyLogSync` already uses.
 */

import {
  deleteFileRef,
  deleteVaultFolderCascade,
  getFileRefById,
  getReadmeFileForFolder,
  listFolderChildren,
  updateFileRef,
  type VaultFolder,
} from "./vault.server";
import { splitFrontmatter, withReadmeBody } from "./project.types";
import { findProjectGraphFolder } from "./projectN02.server";
import { clearGraphStructureAppliedMarker, GRAPH_STRUCTURE_FILE } from "./graphStructure.server";
import { KNOWLEDGE_FOLDER_NAME } from "./syncKnowledge.server";

/** Folder types that survive `resetProjectView` — the human-writable
 * `skills`/`syncs` anchors, plus `graph` (GraphLog's own generated space,
 * deliberately left alone here — `resetGraph` is the explicit, separate
 * call for wiping it). */
const PROJECT_VIEW_SURVIVES = new Set(["skills", "syncs", "graph"]);

export type ProjectViewResetSummary = {
  deletedFolders: string[];
  deletedFiles: string[];
  readmeCleared: boolean;
  /** True when `graph-structure.md`'s `appliedByProjectView` marker was
   * actually present and has now been dropped — see the clearing step at
   * the end of `resetProjectView` for why this reset is incomplete
   * without it. False when there was no marker (or no structure file) to
   * clear, which is the normal case for a project whose view has never
   * run. */
  projectViewMarkerCleared: boolean;
};

/**
 * Deletes every direct child of `folder` EXCEPT its `skills`/`syncs`/
 * `graph` anchors, and clears `README.md`'s BODY (front matter preserved
 * byte-for-byte) — see this file's own module doc above for why README
 * is a special case. `nopal graphlog reset-project-view`.
 */
export async function resetProjectView(folder: VaultFolder): Promise<ProjectViewResetSummary> {
  const { folders, files } = await listFolderChildren(folder.human_id, folder._id);
  const deletedFolders: string[] = [];
  const deletedFiles: string[] = [];
  let readmeCleared = false;
  let projectViewMarkerCleared = false;

  for (const child of folders) {
    if (child.is_folder_type_root && PROJECT_VIEW_SURVIVES.has(child.folder_type ?? "")) continue;
    await deleteVaultFolderCascade(child._id);
    deletedFolders.push(child.name);
  }

  for (const file of files) {
    if (file.name.toLowerCase() === "readme.md") continue; // handled below — body cleared, never deleted.
    await deleteFileRef(file._id);
    deletedFiles.push(file.name);
  }

  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  if (readme) {
    const { body } = splitFrontmatter(readme.content ?? "");
    if (body.trim().length > 0) {
      await updateFileRef(readme._id, { content: withReadmeBody(readme.content ?? "", "") });
      readmeCleared = true;
    }
  }

  // Clearing the README body is only HALF of a project-view reset. Both
  // idempotency markers live on `graph-structure.md`'s front matter, and
  // this reset deliberately leaves the `graph` folder alone (that's
  // `resetGraph`'s job) -- so `appliedByProjectView` still matches
  // `asOfGraphHash` here, and `graph-project-view`'s own up-to-date check
  // would skip the very next run and leave the README empty until
  // something unrelated changed the graph. Only the applied marker is
  // dropped; `asOfGraphHash` belongs to `graph-structure` and stays.
  const graphFolder = await findProjectGraphFolder(folder);
  if (graphFolder) {
    const { files: graphFiles } = await listFolderChildren(folder.human_id, graphFolder._id);
    const structureListing = graphFiles.find((f) => f.name === GRAPH_STRUCTURE_FILE);
    if (structureListing) {
      const structureFile = await getFileRefById(structureListing._id);
      if (structureFile?.content) {
        projectViewMarkerCleared = await clearGraphStructureAppliedMarker(
          structureListing._id,
          structureFile.content,
        );
      }
    }
  }

  return { deletedFolders, deletedFiles, readmeCleared, projectViewMarkerCleared };
}

export type GraphResetSummary = {
  deletedFolders: string[];
};

/**
 * Deletes the project's `Graph` space folder outright, if it exists — a
 * no-op (empty summary) for a project that's never had `sync-graph` write
 * anything yet. `nopal graphlog reset-graph`.
 */
export async function resetGraph(folder: VaultFolder): Promise<GraphResetSummary> {
  const graphFolder = await findProjectGraphFolder(folder);
  if (!graphFolder) return { deletedFolders: [] };
  await deleteVaultFolderCascade(graphFolder._id);
  return { deletedFolders: [graphFolder.name] };
}

export type KnowledgeResetSummary = {
  deletedFolders: string[];
};

/** Recursively finds and deletes every `_knowledge/` folder nested
 * anywhere under `parentFolderId` — collected as a list of slash-joined
 * relative paths (e.g. `"Daily Logs/_knowledge"`) for a readable summary,
 * not re-parsed by anything. Never descends INTO a `_knowledge` folder
 * it's about to delete (nothing meaningful could be nested inside one
 * anyway — see `syncKnowledge.server.ts`'s own doc). */
async function deleteKnowledgeFoldersRecursive(
  humanId: string,
  parentFolderId: string,
  pathPrefix: string,
  deleted: string[],
): Promise<void> {
  const { folders } = await listFolderChildren(humanId, parentFolderId);
  for (const sub of folders) {
    const relativePath = pathPrefix ? `${pathPrefix}/${sub.name}` : sub.name;
    if (sub.name === KNOWLEDGE_FOLDER_NAME) {
      await deleteVaultFolderCascade(sub._id);
      deleted.push(relativePath);
      continue;
    }
    await deleteKnowledgeFoldersRecursive(humanId, sub._id, relativePath, deleted);
  }
}

/**
 * Deletes every `_knowledge/` sidecar folder nested anywhere under the
 * project's `syncs/` tree — a no-op (empty summary) for a project with no
 * `syncs` folder, or with `syncs` but no `_knowledge` folders yet. `nopal
 * graphlog reset-knowledge`.
 */
export async function resetKnowledge(folder: VaultFolder): Promise<KnowledgeResetSummary> {
  const { folders } = await listFolderChildren(folder.human_id, folder._id);
  const syncsFolder = folders.find((f) => f.is_folder_type_root && f.folder_type === "syncs");
  if (!syncsFolder) return { deletedFolders: [] };

  const deleted: string[] = [];
  await deleteKnowledgeFoldersRecursive(folder.human_id, syncsFolder._id, "", deleted);
  return { deletedFolders: deleted };
}

export type FullResetSummary = {
  projectView: ProjectViewResetSummary;
  graph: GraphResetSummary;
  knowledge: KnowledgeResetSummary;
};

/**
 * Runs all three resets above, in order — `resetProjectView` first (so
 * `graph`/`syncs` are still there to reset next), then `resetGraph`, then
 * `resetKnowledge` (nested inside whatever's left of `syncs`). `nopal
 * graphlog reset`.
 */
export async function resetProjectAll(folder: VaultFolder): Promise<FullResetSummary> {
  const projectView = await resetProjectView(folder);
  const graph = await resetGraph(folder);
  const knowledge = await resetKnowledge(folder);
  return { projectView, graph, knowledge };
}
