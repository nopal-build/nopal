/**
 * MdxEditorView — static, non-interactive markdown display.
 *
 * Parses the raw nopal markdown, then delegates all rendering to MdxRenderer.
 * No Lexical, no editor overhead. Visually identical to MdxEditorEditable.
 */

import { useMemo } from "react";
import { importFromMarkdown } from "../util/nopalEditorState";
import MdxRenderer from "./MdxRenderer";
import type { VaultRefItem } from "./refPopoverPlugin";
import type { DirectiveRegistry } from "../util/nopalDirectives";

interface MdxEditorViewProps {
  markdown: string;
  csvFields?: Record<string, string>;
  className?: string;
  /** Vault items for resolving [[wiki-links]] and ![[embeds]]. */
  wikiItems?: VaultRefItem[];
  /** Called when the user clicks an unresolved [[wiki-link]] to create it. */
  onWikiLinkCreate?: (label: string) => void;
  /** Renderers for `::name{...}`/`:::name{...}`/`:name{...}` directives — see `util/nopalDirectives.ts`. */
  directives?: DirectiveRegistry;
}

export default function MdxEditorView({
  markdown,
  csvFields,
  className,
  wikiItems,
  onWikiLinkCreate,
  directives,
}: MdxEditorViewProps) {
  const editorState = useMemo(() => importFromMarkdown(markdown), [markdown]);

  return (
    <MdxRenderer
      state={editorState}
      csvFields={csvFields}
      className={className}
      wikiItems={wikiItems}
      onWikiLinkCreate={onWikiLinkCreate}
      directives={directives}
    />
  );
}
