/**
 * Guide Projects board — reading (and creating cards for) the "All
 * Projects" Kanban view's real data (garden/3-growing/
 * guide-projects-phases.md). The board itself is a `kanban-garden`
 * folder (`org/kanban-projects/`, provisioned by the "Ensure Org Kanban
 * Board" admin script) — this module is the one place that knows how to
 * interpret that folder's README front matter (the ordered phase list)
 * and each phase subfolder's card files, so nothing else has to
 * reimplement that shape.
 *
 * A card is a LIGHTWEIGHT POINTER FILE, never the real project — the
 * real project keeps living at its ordinary `projects/<name>/` path,
 * untouched. A card's own front matter carries just enough to render the
 * board (title/target finish/guide) plus a `project:` field (a
 * `/humanId:path` string, same format a mention's own href uses — see
 * `fileReferences.server.ts`'s `"frontmatter-field"` reference kind) so
 * the pointer survives the real project being renamed or moved.
 */

import { parse as parseYaml } from "yaml";
import { splitFrontmatter } from "./project.types";
import { getOrganization, NOPAL_ORGANIZATION_ID } from "./organizations.server";
import {
  createFileRef,
  getFileRefById,
  getFolderById,
  listFolderChildren,
  type VaultFolder,
} from "./vault.server";
import type { FileRef } from "./vault.types";
import { computeCurrentMentionTarget, resolveVaultPath } from "./fileReferences.server";

export type BoardPhaseType = "start" | "normal" | "end";

export type BoardPhase = {
  name: string;
  type: BoardPhaseType;
  folder: VaultFolder;
};

export type BoardCard = {
  file: FileRef;
  title: string;
  targetFinish: string | null;
  guideHumanId: string | null;
  /** The real project's current vault_folders id — `null` if the
   * `project:` field is missing/unresolvable (e.g. the real project was
   * deleted; the stale field itself is left untouched, see
   * `fileReferences.server.ts`'s own deletion doc). Resolved fresh on
   * every read (not just echoed from the stored string), so the link
   * target is always real right now. */
  projectFolderId: string | null;
};

type FrontmatterPhaseDef = { name: string; type: string };

function isPhaseDef(value: unknown): value is FrontmatterPhaseDef {
  return !!value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

/** Reads `org/kanban-projects/README.md`'s front matter for the ordered
 * phase list it declares, matched against the anchor's real direct
 * subfolders by name (case-insensitive). A phase declared in the README
 * with no matching folder is skipped — same "don't fail closed on bad
 * front matter" philosophy `parseProjectManifest` already uses for a
 * project's own README. */
async function readPhaseDefs(anchor: VaultFolder): Promise<FrontmatterPhaseDef[]> {
  const { files } = await listFolderChildren(anchor.human_id, anchor._id);
  const readmeListing = files.find((f) => f.name.toLowerCase() === "readme.md");
  if (!readmeListing) return [];
  const readme = await getFileRefById(readmeListing._id);
  const { frontmatter } = splitFrontmatter(readme?.content ?? "");
  if (!frontmatter) return [];
  let data: unknown;
  try {
    data = parseYaml(frontmatter);
  } catch {
    return [];
  }
  const phases = (data as { phases?: unknown } | null)?.phases;
  return Array.isArray(phases) ? phases.filter(isPhaseDef) : [];
}

/** The Organization's board anchor (`org/kanban-projects/`) — `null`
 * until the "Ensure Org Kanban Board" admin script has provisioned one. */
export async function getOrgBoardAnchor(
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<VaultFolder | null> {
  const org = await getOrganization(organizationId);
  if (!org?.kanban_folder_id) return null;
  return (await getFolderById(org.kanban_folder_id)) ?? null;
}

/** Every phase, in the README's declared order, each with its real
 * subfolder attached. */
export async function listBoardPhases(anchor: VaultFolder): Promise<BoardPhase[]> {
  const [phaseDefs, { folders }] = await Promise.all([
    readPhaseDefs(anchor),
    listFolderChildren(anchor.human_id, anchor._id),
  ]);
  const byName = new Map(folders.map((f) => [f.name.toLowerCase(), f] as const));
  const out: BoardPhase[] = [];
  for (const def of phaseDefs) {
    const folder = byName.get(def.name.toLowerCase());
    if (!folder) continue;
    const type: BoardPhaseType = def.type === "start" || def.type === "end" ? def.type : "normal";
    out.push({ name: def.name, type, folder });
  }
  return out;
}

function parseCardFrontmatter(content: string | null | undefined): {
  title: string | null;
  targetFinish: string | null;
  guideHumanId: string | null;
  projectRef: string | null;
} {
  const { frontmatter } = splitFrontmatter(content ?? "");
  if (!frontmatter) return { title: null, targetFinish: null, guideHumanId: null, projectRef: null };
  let data: unknown;
  try {
    data = parseYaml(frontmatter);
  } catch {
    return { title: null, targetFinish: null, guideHumanId: null, projectRef: null };
  }
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    title: typeof obj.title === "string" ? obj.title : null,
    targetFinish: typeof obj.target_finish === "string" ? obj.target_finish : null,
    guideHumanId: typeof obj.guide === "string" ? obj.guide : null,
    projectRef: typeof obj.project === "string" ? obj.project : null,
  };
}

const MENTION_HREF_RE = /^\/([^:/]+):(.+)$/;

/** Every card file inside one phase folder, with its front matter parsed
 * and its `project:` pointer freshly RESOLVED to an id (not just parsed
 * as a string) — so a stale/renamed-since path still resolves correctly
 * even a moment before rename-propagation would have rewritten the
 * card's own stored field. */
export async function listPhaseCards(phase: BoardPhase): Promise<BoardCard[]> {
  const { files } = await listFolderChildren(phase.folder.human_id, phase.folder._id);
  const cards: BoardCard[] = [];
  for (const listing of files) {
    if (listing.name.toLowerCase() === "readme.md") continue;
    const file = await getFileRefById(listing._id);
    if (!file) continue;
    const parsed = parseCardFrontmatter(file.content);
    let projectFolderId: string | null = null;
    if (parsed.projectRef) {
      const match = MENTION_HREF_RE.exec(parsed.projectRef);
      if (match) {
        const [, targetHumanId, rawPath] = match;
        const resolved = await resolveVaultPath(targetHumanId, rawPath);
        if (resolved?.type === "folder") projectFolderId = resolved.id;
      }
    }
    cards.push({
      file,
      title: parsed.title ?? file.name.replace(/\.md$/i, ""),
      targetFinish: parsed.targetFinish,
      guideHumanId: parsed.guideHumanId,
      projectFolderId,
    });
  }
  return cards;
}

/** Creates a Kanban card for a brand-new project, placed in the board's
 * Start-type phase (found by TYPE, not by the name "Seed" — an org could
 * rename it). A no-op, not an error, when the org has no board yet (or
 * the board has no Start-type phase) — starting a project never fails
 * just because this secondary piece isn't set up, same philosophy
 * `startProject` already applies to `openSeedRound`. */
export async function createBoardCardForNewProject(
  project: VaultFolder,
  guideHumanId: string,
  organizationId: string = NOPAL_ORGANIZATION_ID,
): Promise<void> {
  const anchor = await getOrgBoardAnchor(organizationId);
  if (!anchor) return;
  const phases = await listBoardPhases(anchor);
  const startPhase = phases.find((p) => p.type === "start");
  if (!startPhase) return;

  const projectTarget = await computeCurrentMentionTarget({ type: "folder", id: project._id });
  if (!projectTarget) return;

  await createFileRef({
    human_id: anchor.human_id,
    name: `${project.name}.md`,
    content: `---\ntitle: ${JSON.stringify(project.name)}\nguide: ${guideHumanId}\nproject: ${projectTarget.href}\n---\n`,
    content_type: "text/markdown",
    folder_id: startPhase.folder._id,
  });
}
