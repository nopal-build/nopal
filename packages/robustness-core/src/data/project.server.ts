/**
 * Resolves a project folder (a folder under the `projects` vault root) into
 * a `ResolvedProject` — the manifest parsed from its `README.md` front
 * matter (defaulted, never required — see `resolveProjectManifest`'s own
 * doc below), the README's body (rendered as-is via `OxRenderer`), and two
 * leaf-directive resolutions scanned out of that body:
 *   - every folder referenced by a `::gallery{folder="..."}` directive (see
 *     `oxmarkdown-core/galleryDirective.ts`), resolved into that folder's
 *     own images.
 *   - every load-cell run CSV referenced by a
 *     `::LoadCellGraph{fileId="..."}` directive (see
 *     `oxmarkdown-core/loadCellGraphDirective.ts`), resolved into that
 *     run's cleaned rows/summary/download ids via
 *     `resolveLoadCellGraphByFileId` (`loadCellSensorData.server.ts`) — an
 *     optional `title="..."` attribute overrides the run's own name as the
 *     embed's heading.
 *
 * Used to also resolve `file="..."` attributes on OTHER directive names
 * (the old `::csv-table{...}`/`::svg{...}`, feeding `ProjectView.tsx`'s
 * now-deleted `MdxEditorView`-based directive registry) — dropped when
 * `MdxEditor` was retired, since nothing renders those anymore (see the
 * `oxmarkdown` skill's Build status). `::gallery{folder="..."}` survives
 * (re-added, this time as a real OxMarkdown built-in — see
 * `OxRenderer.tsx`'s `resolveGalleryFolder`), since it's the one directive
 * PhyLog's capture stage actually still writes. `::LoadCellGraph{...}` is a
 * new, CALLER-REGISTERED directive instead (`ProjectView.tsx`'s own
 * `directives` prop, not a new `OxRenderer.tsx` built-in) — see
 * `oxmarkdown/loadCellGraphDirective.tsx`'s own header for why.
 *
 * Deliberately shallow: a `folder` attribute value only matches a DIRECT
 * child of the project folder (no nested paths), and a gallery folder's
 * images are exactly one level deep. Revisit once a real project needs
 * more nesting. `LoadCellGraph{fileId="..."}` has no such limitation — a
 * vault file id is already globally stable, not a path needing a folder to
 * resolve against.
 */

import { findLeafDirectiveOccurrences } from "../util/nopalDirectives";
import type { ProjectManifest, ResolvedProject } from "./project.types";
import { parseProjectManifest } from "./project.types";
import type { ResolvedGalleryImage } from "oxmarkdown-core";
import { getFileRefById, listFolderChildren } from "./vault.server";
import { resolveLoadCellGraphsInBody } from "./loadCellSensorData.server";
import type { VaultFolder } from "./vault.types";

function fileUrl(fileId: string): string {
  return `/api/vault/view/${fileId}`;
}

/**
 * NEVER fails closed — a project's detail page is gated on the viewer's
 * ACCESS to the folder (`canViewFolder`, checked by the caller before this
 * ever runs), not on whether the README happens to have valid manifest
 * front matter yet. A missing README, empty content, or missing/malformed
 * front matter all just mean "use the defaults" (an empty body, `layout:
 * "document"`, no title override) rather than a reason to bounce the
 * viewer to the plain vault folder view — a brand new project (or one
 * someone hand-wrote without ever adding front matter) is still a real
 * project, not a dead end.
 */
export async function resolveProjectManifest(
  humanId: string,
  folder: VaultFolder,
): Promise<ResolvedProject> {
  const children = await listFolderChildren(humanId, folder._id);

  const readmeListing = children.files.find(
    (f) => f.name.toLowerCase() === "readme.md",
  );

  let rawContent = "";
  if (readmeListing) {
    const readme = await getFileRefById(readmeListing._id);
    rawContent = readme?.content ?? "";
  }

  const { manifest, body } = parseProjectManifest(rawContent);
  const resolvedManifest: ProjectManifest = manifest ?? {};

  const foldersByName = new Map(children.folders.map((f) => [f.name, f]));
  const galleryFolders: Record<string, ResolvedGalleryImage[]> = {};

  for (const directive of findLeafDirectiveOccurrences(body)) {
    if (directive.name !== "gallery") continue;
    const folderName = directive.attrs.folder;
    if (!folderName || folderName in galleryFolders) continue;
    const subfolder = foldersByName.get(folderName);
    if (!subfolder) continue;
    const subChildren = await listFolderChildren(humanId, subfolder._id);
    galleryFolders[folderName] = subChildren.files
      .filter((f) => f.content_type.startsWith("image/") || f.content_type.startsWith("video/"))
      .map((f) => ({
        url: fileUrl(f._id),
        name: f.name,
        kind: f.content_type.startsWith("video/") ? ("video" as const) : ("image" as const),
      }));
  }

  const loadCellGraphs = await resolveLoadCellGraphsInBody(body);

  return { manifest: resolvedManifest, body, galleryFolders, loadCellGraphs };
}

/** Convenience re-export so route files only need one import for the type. */
export type { ProjectManifest, ResolvedProject };
