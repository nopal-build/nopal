/**
 * `::LoadCellGraph{fileId="..."}` — embeds one load-cell test run's Sensor
 * Data tab widget (summary stats, raw/cleaned CSV downloads, Force vs. Time
 * + Force vs. Displacement charts — `LoadCellGraphCard.tsx`) directly into
 * a project README/Letter, so a "Test Results" section can show the exact
 * chart the Sensor Data tab would without a person re-screenshotting it.
 *
 *   ### Test Results
 *   ::LoadCellGraph{fileId="bws98xswj2t0i6ltmoec"}
 *
 * A LEAF directive (own row, no children — same shape as
 * `::gallery{folder="..."}`/`::video{fileId="..."}`), since the directive
 * never wraps other markdown. `fileId` is the run's RAW csv vault file id
 * (the same id `SensorDataRunSummary.rawFileId`/`nopal vault info <path>`
 * already expose) — this is the convention `::file{fileId="..."}`/
 * `::video{fileId="..."}` already established for "reference one existing
 * vault file directly," as opposed to `::gallery{folder="..."}`'s by-NAME
 * folder lookup (there's no project-relative "folder" a single CSV needs
 * resolving against — a vault file id is already globally stable). An
 * optional `title="..."` attribute overrides the embed's heading (defaults
 * to the run's own name, i.e. the CSV's filename minus `.csv`).
 *
 * A CALLER-REGISTERED directive (`ProjectView.tsx`'s own `directives`
 * prop), NOT a new `OxRenderer.tsx`/`oxmarkdown-core` built-in like
 * `::gallery`/`::video` — this is project/vault-specific domain knowledge
 * (`robustness-core`'s one recognized load-cell CSV shape), not a generic
 * markdown-rendering concern `webapp`'s copy of `OxRenderer.tsx` has any
 * reason to know about. Mirrors `websiteDirectives.tsx`'s own
 * registry-building pattern, just for ONE directive instead of a whole
 * vocabulary.
 *
 * Resolution happens server-side in `resolveProjectManifest`
 * (`robustness-core/data/project.server.ts`), which scans the README body
 * for every `::LoadCellGraph{fileId="..."}` occurrence and resolves each
 * via `resolveLoadCellGraphByFileId` — the SAME "resolve by scanning raw
 * directive occurrences, hand the result down as a plain data prop" shape
 * `galleryFolders` already uses. Renders nothing (not an empty box, not an
 * error marker) when the fileId doesn't resolve — unknown id, not a
 * recognized load-cell CSV, or this render context has no resolved data at
 * all (e.g. a public/shared page, which doesn't wire this registry in —
 * downloading the raw/cleaned CSV requires authentication, same as the
 * Sensor Data tab itself).
 */

import type { DirectiveRegistry } from "./directiveRegistry";
import type { ResolvedLoadCellGraph } from "oxmarkdown-core";
import { LoadCellGraphCard } from "../components/LoadCellGraphCard";

export function buildLoadCellGraphDirectiveRegistry(
  loadCellGraphs: Record<string, ResolvedLoadCellGraph>,
): DirectiveRegistry {
  return {
    LoadCellGraph: ({ attrs }) => {
      const fileId = attrs.fileId;
      const resolved = fileId ? loadCellGraphs[fileId] : undefined;
      if (!resolved) return null;
      return (
        <LoadCellGraphCard
          title={attrs.title ?? resolved.title}
          meta={resolved.meta}
          rows={resolved.rows}
          rawFileId={resolved.rawFileId}
          cleanedFileId={resolved.cleanedFileId}
          downloadName={attrs.title ?? resolved.title}
        />
      );
    },
  };
}
