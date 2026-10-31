/**
 * ProjectView — renders a project folder's README as a rolled-up project
 * page. The README's body IS the page, rendered via `OxRenderer`, with
 * `::gallery{folder="..."}` leaf directives resolved against
 * `galleryFolders` (see `oxmarkdown-core/galleryDirective.ts` and
 * `project.server.ts`'s `resolveProjectManifest`), and
 * `::LoadCellGraph{fileId="..."}` leaf directives resolved against
 * `loadCellGraphs` the same way (see
 * `oxmarkdown-core/loadCellGraphDirective.ts` and
 * `oxmarkdown/loadCellGraphDirective.tsx`'s registry entry) — unlike
 * gallery, this one is a caller-registered `directives` entry rather than
 * an `OxRenderer.tsx` built-in, since it's project/vault-specific domain
 * knowledge, not a generic markdown-rendering concern.
 *
 * Used to also resolve `::csv-table{...}`/`::svg{...}`/`:::note{...}`
 * directives (the old `MdxEditorView`/`nopalDirectives.ts` extension
 * mechanism) into real content, plus a `layout: "grid"` manifest option
 * with per-block `size="half"/"third"` classing. Dropped entirely rather
 * than ported to OxMarkdown — a deliberate product decision, not an
 * oversight, made while retiring `MdxEditor`/`MdxRenderer` (see the
 * `oxmarkdown` skill's Build status): old content using those directives
 * now renders as `OxRenderer`'s generic "unknown directive" marker unless
 * rewritten. `::gallery{...}` alone survives, re-added as a real OxMarkdown
 * built-in once it was noticed PhyLog's capture stage still writes it.
 */

import type { ResolvedGalleryImage, ResolvedLoadCellGraph } from "oxmarkdown-core";
import OxRenderer from "./OxRenderer";
import type { OxAnnotations } from "../oxmarkdown/marks";
import { buildLoadCellGraphDirectiveRegistry } from "../oxmarkdown/loadCellGraphDirective";

export interface ProjectViewProps {
  /** The README body (front matter already stripped). */
  body: string;
  /** Keyed by a `::gallery{folder="..."}` directive's `folder` attribute
   * value. Omit for a plain body with no gallery resolution at all. */
  galleryFolders?: Record<string, ResolvedGalleryImage[]>;
  /** Keyed by a `::LoadCellGraph{fileId="..."}` directive's `fileId`
   * attribute value. Omit for a plain body with no load-cell embeds at all
   * (e.g. the public/shared page, which doesn't resolve this — downloading
   * the raw/cleaned CSV requires authentication). */
  loadCellGraphs?: Record<string, ResolvedLoadCellGraph>;
  /** The pen: marks on this version of the page, and whether a new one
   * can be written. See `oxmarkdown/marks.tsx`. */
  annotations?: OxAnnotations;
  /** See `OxRendererProps.servedFileIds`. The shared link passes `{}` so a
   * `::file{}` draws without its picture (`newspaperShare.server.ts`). */
  servedFileIds?: Record<string, string>;
}

export function ProjectView({ body, galleryFolders, loadCellGraphs, annotations, servedFileIds }: ProjectViewProps) {
  return (
    <OxRenderer
      markdown={body}
      // Written by the skills, not by a person: plain paper (`ox-plain`).
      className="ox-plain"
      annotations={annotations}
      servedFileIds={servedFileIds}
      resolveGalleryFolder={
        galleryFolders ? (folderName) => galleryFolders[folderName] : undefined
      }
      directives={loadCellGraphs ? buildLoadCellGraphDirectiveRegistry(loadCellGraphs) : undefined}
    />
  );
}
