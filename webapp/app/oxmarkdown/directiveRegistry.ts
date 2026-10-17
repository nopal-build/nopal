/**
 * DUPLICATED from fruits/app/oxmarkdown/directiveRegistry.ts -- see
 * webapp/app/components/OxRenderer.tsx's own comment for why. Not shared;
 * keep both in sync by hand.
 *
 * The directive-rendering contract shared between `OxRenderer` and (later)
 * `OxEditor` — callers register a renderer per directive name; `OxRenderer`
 * itself doesn't know what "csv-table" or "gallery" mean, only how to walk
 * the tree and hand a matched node off to whoever does.
 *
 * This is a real simplification over the old `util/nopalDirectives.ts`
 * bridge: because `OxRenderer` walks a real parsed tree instead of
 * regex-matched placeholder spans, there's no need for a built-in special
 * case (the old system hardcoded `csv-key` directly into `MdxRenderer`) —
 * every directive name, including `csv-key`, is just a registry entry
 * supplied by the caller.
 */

import type { ReactNode } from "react";
import type { DirectiveAttrs, SwatchRole } from "oxmarkdown-core";

export type DirectiveRenderProps = {
  attrs: DirectiveAttrs;
  /** The `[label]` bracket content, if the directive had one — rarely used
   * by nopal's own directives (title/file/folder are all attributes). */
  label: string | null;
  /** Only present for container directives — the recursively-rendered
   * inner markdown. */
  children?: ReactNode;
  /** Resolves a color role against the page's `::swatch`/`::palette`
   * registry, using round 8's three-step cascade (see the "Oxmarkdown
   * Colors" garden seed, and `oxmarkdown-core`'s `resolveSwatchRole`,
   * which this is a thin, already-bound wrapper around — the registry
   * itself is supplied automatically by `OxRenderer`, never by the
   * directive). Always present and always safe to call, even when the
   * current document registered no swatches at all — it simply falls
   * straight through to `fallback` in that case, so a directive never
   * needs its own existence check. */
  resolveSwatchRole: (opts: { role: SwatchRole; explicit?: string; palette?: string; fallback?: string }) => string | undefined;
};

export type DirectiveRenderer = (props: DirectiveRenderProps) => ReactNode;

export type DirectiveRegistry = Record<string, DirectiveRenderer>;
