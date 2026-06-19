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

interface MdxEditorViewProps {
  markdown: string;
  csvFields?: Record<string, string>;
  className?: string;
  /** Vault items for resolving [[wiki-links]] and ![[embeds]]. */
  wikiItems?: VaultRefItem[];
  /** Called when the user clicks an unresolved [[wiki-link]] to create it. */
  onWikiLinkCreate?: (label: string) => void;
}

export default function MdxEditorView({
  markdown,
  csvFields,
  className,
  wikiItems,
  onWikiLinkCreate,
}: MdxEditorViewProps) {
  const editorState = useMemo(() => importFromMarkdown(markdown), [markdown]);

  return (
    <MdxRenderer
      state={editorState}
      csvFields={csvFields}
      className={className}
      wikiItems={wikiItems}
      onWikiLinkCreate={onWikiLinkCreate}
    />
  );
}
