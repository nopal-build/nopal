/**
 * Resolves a project folder (a folder under the `projects` vault root) into
 * a `ResolvedProject` — the manifest parsed from its `README.md` front
 * matter (defaulted, never required — see `resolveProjectManifest`'s own
 * doc below), the README's body (rendered as-is via MdxEditorView), and
 * every file/subfolder referenced by a `file="..."`/`folder="..."`
 * attribute on a directive in that body, fetched and shaped into plain
 * JSON-serializable Records so it can be returned directly as loader data.
 *
 * Deliberately generic about directive names: this doesn't hardcode
 * "csv-table"/"gallery"/"svg" — it just scans every leaf directive
 * (`::name{...}`) for `file`/`folder` attributes and resolves whatever it
 * finds. New block kinds that reference vault content don't need any
 * changes here, only a renderer registered in `ProjectView.tsx`.
 *
 * Deliberately shallow: `file`/`folder` attribute values only match direct
 * children of the project folder (no nested paths), and galleries are
 * exactly one level deep. Revisit once a real project needs more nesting.
 */

import { extractLeafDirectives } from "../util/nopalDirectives";
import { PROJECT_CSV_NAME, csvFieldsToRecord, parseCsvFields } from "../util/projectCsv";
import type { ProjectManifest, ResolvedFile, ResolvedProject } from "./project.types";
import { parseProjectManifest } from "./project.types";
import { getFileRefById, listFolderChildren } from "./vault.server";
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

  const directives = extractLeafDirectives(body);
  const filesByName = new Map(children.files.map((f) => [f.name, f]));
  const foldersByName = new Map(children.folders.map((f) => [f.name, f]));

  // `project.csv` — the optional flat key/value "facts" file `:csv-key{...}`
  // resolves against. Not a directive target itself, so it's not picked up
  // by the directive scan below; resolve it separately when present.
  let csvFields: Record<string, string> | undefined;
  const projectCsvListing = filesByName.get(PROJECT_CSV_NAME);
  if (projectCsvListing) {
    const full = await getFileRefById(projectCsvListing._id);
    if (full?.content) csvFields = csvFieldsToRecord(parseCsvFields(full.content));
  }

  const files: Record<string, ResolvedFile> = {};
  const folders: Record<string, ResolvedFile[]> = {};

  for (const directive of directives) {
    const filePath = directive.attrs.file;
    if (filePath && !(filePath in files)) {
      const listing = filesByName.get(filePath);
      if (listing) {
        // Text-based files (markdown/csv/...) need their content fetched;
        // everything else (svg/image/pdf/...) only needs a URL.
        const isText = listing.content_type.startsWith("text/");
        const full = isText ? await getFileRefById(listing._id) : null;
        files[filePath] = {
          url: fileUrl(listing._id),
          name: listing.name,
          content: full?.content ?? undefined,
        };
      }
    }

    const folderPath = directive.attrs.folder;
    if (folderPath && !(folderPath in folders)) {
      const subfolder = foldersByName.get(folderPath);
      if (subfolder) {
        const subChildren = await listFolderChildren(humanId, subfolder._id);
        folders[folderPath] = subChildren.files
          .filter((f) => f.content_type.startsWith("image/"))
          .map((f) => ({ url: fileUrl(f._id), name: f.name }));
      }
    }
  }

  return { manifest: resolvedManifest, body, files, folders, csvFields };
}

/** Convenience re-export so route files only need one import for the type. */
export type { ProjectManifest, ResolvedProject };
