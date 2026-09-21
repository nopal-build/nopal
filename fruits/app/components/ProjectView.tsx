/**
 * ProjectView — renders a project folder's README as a rolled-up project
 * page. The README's body IS the page, rendered via `OxRenderer`, with
 * `::gallery{folder="..."}` leaf directives resolved against
 * `galleryFolders` (see `oxmarkdown-core/galleryDirective.ts` and
 * `project.server.ts`'s `resolveProjectManifest`).
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

import type { ResolvedGalleryImage } from "oxmarkdown-core";
import OxRenderer from "./OxRenderer";
import type { OxAnnotations } from "../oxmarkdown/marks";

export interface ProjectViewProps {
  /** The README body (front matter already stripped). */
  body: string;
  /** Keyed by a `::gallery{folder="..."}` directive's `folder` attribute
   * value. Omit for a plain body with no gallery resolution at all. */
  galleryFolders?: Record<string, ResolvedGalleryImage[]>;
  /** The pen: marks on this version of the page, and whether a new one
   * can be written. See `oxmarkdown/marks.tsx`. */
  annotations?: OxAnnotations;
}

export function ProjectView({ body, galleryFolders, annotations }: ProjectViewProps) {
  return (
    <OxRenderer
      markdown={body}
      annotations={annotations}
      resolveGalleryFolder={
        galleryFolders ? (folderName) => galleryFolders[folderName] : undefined
      }
    />
  );
}
